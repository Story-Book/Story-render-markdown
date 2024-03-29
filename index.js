/*
 * to-markdown - an HTML to Markdown converter
 *
 * Copyright 2011-15, Dom Christie
 * Licenced under the MIT licence
 *
 */

'use strict';

var toMarkdown;
var converters;
var mdConverters = require('./convert/md');
var gfmConverters = require('./convert/gfm');
var collapse = require('./lib/collapse-whitespace');

/*
 * Set up window and document for Node.js
 */

var _window = (typeof window !== 'undefined' ? window: this), _document;
if (typeof document === 'undefined') {
    _document = require('jsdom').jsdom();
}
else {
    _document = document;
}

/*
 * Utilities
 */

function trim (string) {
    return string.replace(/^[ \r\n\t]+|[ \r\n\t]+$/g, '');
}

var blocks = ['address', 'article', 'aside', 'audio', 'blockquote', 'body',
    'canvas', 'center', 'dd', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption',
    'figure', 'footer', 'form', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'header', 'hgroup', 'hr', 'html', 'isindex', 'li', 'main', 'menu', 'nav',
    'noframes', 'noscript', 'ol', 'output', 'p', 'pre', 'section', 'table',
    'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
];

function isBlock (node) {
    return blocks.indexOf(node.nodeName.toLowerCase()) !== -1;
}

var voids = [
    'area', 'base', 'br', 'col', 'command', 'embed', 'hr', 'img', 'input',
    'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr'
];

function isVoid (node) {
    return voids.indexOf(node.nodeName.toLowerCase()) !== -1;
}

/*
 * Parsing HTML strings
 */

function canParseHtml () {
    var Parser = _window.DOMParser, canParse = false;

    // Adapted from https://gist.github.com/1129031
    // Firefox/Opera/IE throw errors on unsupported types
    try {
        // WebKit returns null on unsupported types
        if (new Parser().parseFromString('', 'text/html')) {
            canParse = true;
        }
    } catch (e) {
    }
    return canParse;
}

function createHtmlParser () {
    var Parser = function () {};

    Parser.prototype.parseFromString = function (string) {
        var newDoc = _document.implementation.createHTMLDocument('');

        if (string.toLowerCase().indexOf('<!doctype') > -1) {
            newDoc.documentElement.innerHTML = string;
        }
        else {
            newDoc.body.innerHTML = string;
        }
        return newDoc;
    };
    return Parser;
}

var HtmlParser = canParseHtml() ? _window.DOMParser: createHtmlParser();

function htmlToDom (string) {
    var tree = new HtmlParser().parseFromString(string, 'text/html');
    collapse(tree, isBlock);
    return tree;
}

/*
 * Flattens DOM tree into single array
 */

function bfsOrder (node) {
    var inqueue  = [node],
        outqueue = [],
        elem, children, i;

    while (inqueue.length > 0) {
        elem = inqueue.shift();
        outqueue.push(elem);
        children = elem.childNodes;
        for (i = 0; i < children.length; i++) {
            if (children[i].nodeType === 1) {
                inqueue.push(children[i]);
            }
        }
    }
    outqueue.shift();
    return outqueue;
}

/*
 * Contructs a Markdown string of replacement text for a given node
 */

function getContent (node) {
    var text = '';
    for (var i = 0; i < node.childNodes.length; i++) {
        if (node.childNodes[i].nodeType === 1) {
            text += node.childNodes[i]._replacement;
        }
        else if (node.childNodes[i].nodeType === 3) {
            text += node.childNodes[i].data;
        }
        else {
            continue;
        }
    }
    return text;
}

/*
 * Returns the HTML string of an element with its contents converted
 */

function outer (node, content) {
    return node.cloneNode(false).outerHTML.replace('><', '>' + content + '<');
}

function canConvert (node, filter) {
    if (typeof filter === 'string') {
        return filter === node.nodeName.toLowerCase();
    }
    if (Array.isArray(filter)) {
        return filter.indexOf(node.nodeName.toLowerCase()) !== -1;
    }
    else if (typeof filter === 'function') {
        return filter.call(toMarkdown, node);
    }
    else {
        throw new TypeError('`filter` needs to be a string, array, or function');
    }
}

function isFlankedByWhitespace (side, node) {
    var sibling, regExp, isFlanked;

    if (side === 'left') {
        sibling = node.previousSibling;
        regExp = / $/;
    }
    else {
        sibling = node.nextSibling;
        regExp = /^ /;
    }

    if (sibling) {
        if (sibling.nodeType === 3) {
            isFlanked = regExp.test(sibling.nodeValue);
        }
        else if (sibling.nodeType === 1 && !isBlock(sibling)) {
            isFlanked = regExp.test(sibling.textContent);
        }
    }
    return isFlanked;
}

function flankingWhitespace (node) {
    var leading = '', trailing = '';

    if (!isBlock(node)) {
        var hasLeading  = /^[ \r\n\t]/.test(node.innerHTML),
            hasTrailing = /[ \r\n\t]$/.test(node.innerHTML);

        if (hasLeading && !isFlankedByWhitespace('left', node)) {
            leading = ' ';
        }
        if (hasTrailing && !isFlankedByWhitespace('right', node)) {
            trailing = ' ';
        }
    }

    return {leading : leading, trailing : trailing};
}

/*
 * Finds a Markdown converter, gets the replacement, and sets it on
 * `_replacement`
 */

function process (node) {
    var replacement, content = getContent(node);

    // Remove blank nodes
    if (!isVoid(node) && !/A/.test(node.nodeName) && /^\s*$/i.test(content)) {
        node._replacement = '';
        return;
    }

    for (var i = 0; i < converters.length; i++) {
        var converter = converters[i];

        if (canConvert(node, converter.filter)) {
            if (typeof converter.replacement !== 'function') {
                throw new TypeError(
                    '`replacement` needs to be a function that returns a string'
                );
            }

            var whitespace = flankingWhitespace(node);

            if (whitespace.leading || whitespace.trailing) {
                content = trim(content);
            }
            replacement = whitespace.leading +
                converter.replacement.call(toMarkdown, content, node) +
                whitespace.trailing;
            break;
        }
    }

    node._replacement = replacement;
}

toMarkdown = function (input, options) {
    options = options || {};

    if (typeof input !== 'string') {
        throw new TypeError(input + ' is not a string');
    }

    // Escape potential ol triggers
    input = input.replace(/(\d+)\. /g, '$1\\. ');

    var clone = htmlToDom(input).body,
        nodes = bfsOrder(clone),
        output;

    converters = mdConverters.slice(0);
    if (options.gfm) {
        converters = gfmConverters.concat(converters);
    }

    if (options.converters) {
        converters = options.converters.concat(converters);
    }

    // Process through nodes in reverse (so deepest child elements are first).
    for (var i = nodes.length - 1; i >= 0; i--) {
        process(nodes[i]);
    }
    output = getContent(clone);

    return output.replace(/^[\t\r\n]+|[\t\r\n\s]+$/g, '')
        .replace(/\n\s+\n/g, '\n\n')
        .replace(/\n{3,}/g, '\n\n');
};

toMarkdown.isBlock = isBlock;
toMarkdown.isVoid = isVoid;
toMarkdown.trim = trim;
toMarkdown.outer = outer;

module.exports = toMarkdown;
