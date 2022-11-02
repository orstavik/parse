# The `parse` event

The `parse` event is dispatched after the browser has parsed and added a new fragment of the main document to the DOM.

* `<script src="https://cdn.jsdelivr.net/gh/orstavik/parse@v1.0.1/parse.js"></script>`
* `.target` is the last parsed node in the `document`.
* `{bubbles: true}`

[Unit tests in action](https://orstavik.github.io/parse/test/)

## When to include the script?

You want to include the listener for the parse event before your use of the script. This ensures that you don't loose any `parse` events and their `.endedNodes()` and `.addedNodes()`.

```html
<script>
  window.addEventListener("parse", e => console.log("do your thing", e));
</script>
<script src="parse.js"></script>
```

## `parse` vs. `beforescriptexecute`

The `parse` event resemble the native `beforescriptexecute` event.

The `beforescriptexecute` event is dispatched before a `<script>` is triggered during loading of the main document. As such, the `beforescriptexecute` event signify a break when the parser switches from adding native elements into the DOM to running some JS script.

However, with web components there are *two* ways that JS scripts/functions can be triggered during loading:

1. the good old `<script>` (and `<script async>`?), and
2. the `.constructor()`, `.attributeChangedCallback()`, and `.connectedCallback()` of elements already defined and placed in the DOM.

The original Firefox `beforescriptexecute` event only triggers before `<script>` elements (1), and
*not* before custom element constructor() and ...Callback()s.

The `parse` event triggers before *both* custom elements *and* custom element constructors(),
with the following *two* exceptions:.
a. If the last element added to the DOM is the same, then there will be no second beforescriptevent,
even though two different scripts are technically triggered. There are two examples of such a situation:
I.  <script>console.log('script1');</script><web-comp><web-comp>
II. <web-comp-x></web-comp-x><web-comp><web-comp>   where web-comp-x implements connectedCallback().

When a web component's <start-tag> *immediately* follows either a <script> or another <web-comp-x>
(and where web-comp-x implements a custom connectedCallback()),
then there will be no `parse` event trigger *before* the web-comp constructor.

Note: When would a custom element start tag immediately follow a <script>, <start-tag>, or <end-tag>?

1. For some container elements whitespace might be meaningful. In such container elements no whitespace is meaningful.
2. An html minifier of some sort might remove all whitespace.
   In such situations custom elements *can* immediately follow either <script> or
   other custom elements' <start-tag> or <end-tag>. And in such sitautions, no `parse` event will be dispatched.

## WhatIs: the `.target` of the `parse` event?

The `target` of the `parse` event is the last element the parser has added to the DOM.
a) For sync `<script>`'s that is the <script> element itself. The <script> element is always added to the DOM before the
javascript functions it contains are triggered.
b) When web component constructors are triggered, the web component itself is not yet added to the DOM.
This means that the last element added by the parser to the DOM is either a) a previous sibling node, b) the parent
element, or c) a descendant of a previous sibling.

Most commonly, web component start tags are preceded by whitespace. Therefore, most commonly the `target` of a `parse` event would be a text node.

## How is the `parse` event implemented?

During "loading"/interpretation of the main document a `new MutationObserver(callback).observe(document.documentElement, {childList: true, subtree: true});` will aggregate all changes and only *break off* and trigger either

1. as a separte macro-task *before* a <script> begins,
2. as a micro-task that is added to a connectedCallback() macro-task for an already defined custom element,
3. as a separate macro-task *before* the constructor() of an already defined custom element,
   iff that custom element doesn't immediately follow either
   a) a </script> of a sync script,
   b) the startTag <web-comp-x>,   (*)
   c) the endTag </web-comp-x>, or (*)
   *) where <web-comp-x> implements a custom connectedCallback().

## Important test case 1:

a) Imagine the main document containing two *sibling* custom element tags
with **NO** whitespace in between:
<a-a></a-a><b-b></b-b>

<a-a>'s definition implement a custom connectedCallback().
Here, there should be no ``parse` event` event dispatched before <b-b>.

b) Imagine the main document containing two *nested* custom element tags:
<a-a><b-b></b-b></a-a>

<a-a>'s definition implement a custom connectedCallback().
Here, there should be no ``parse` event` event dispatched before <b-b>.

## Important test case 2:

There should be no ``parse` event` event after the first <script defer> has begun
or after the first 'readystatechange' event that marks the start of document.readyState === 'interactive'

## connectedCallback macro-task mixup

When the predictive parser creates an already defined web-comp that:

1) has NO constructor() definition,
2) triggers NO attributeChangedCallback(), and
3) triggers only a .connectedCallback(), then
   !!BAD!! the MO callback will run inside the same macro-task as the web-comp.connectedCallback().
   This is bad because we want all `parse` events to have their own macrotask.
   Therefore, the ParserObserver will not call a break in these instances.

## MO-readystatechange race

Chrome and FF runs 'readystatechange:interactive' before the last MO function with the remainder of the DOM.
Safari runs the last MO first, and then the readystatechange:interactive event listeners.
Safari is correct, Chrome and FF is wrong.

To force the MO to run before the readystatechange:interactive event listeners,
we add an event listener for readystatechange:interactive, and then we force a change to the DOM.
we then remove that node in the MO immediately, thus leaving the DOM intact.
This will trick the MO to run as a macrotask (the readystatechange event is macro task event)
before the readystatechange events.

## race condition in Chrome97.0.4692.71

When the last MO is triggered in Chrome97.0.4692.71, then the `document.readyState` remains at `loading` instead of being switched to `interactive` as it was before. This means that when the last MO runs, it is impossible to know if the document has been parsed till the end, or if there are more elements coming. Older Chrome did not behave like this, and neither does the other browsers. This means that Chrome97 will make an extra calls at the end, and many elements such as `<body>` and `<html>` will be considered still open even though they are actually closed.