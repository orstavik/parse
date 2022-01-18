(function (dispatchEventOG) {
  if (document.readyState !== 'loading')
    throw new Error('new ParserObserver(..) can only be created while document is loading');

  function* addedNodes(mrs) {
    for (let {addedNodes} of mrs)
      for (let n of addedNodes)
        yield n;
  }

  function* xpathIterator(xpr) {
    for (var i = 0; i < xpr.snapshotLength; i++)
      yield xpr[i] ??= xpr.snapshotItem(i);
  }

  class ParserBreakEvent extends Event {
    #added;
    #previouslyOpen;
    #stillOpen;

    constructor(listsWithAdded, previouslyOpen, stillOpen = []) {
      super('parser-break');
      this.#added = listsWithAdded;
      this.#previouslyOpen = previouslyOpen;
      this.#stillOpen = stillOpen;
    }

    * openNodes() {
      yield* this.#stillOpen[Symbol.iterator]();
    }

    * endedNodes() {
      for (let n of this.#previouslyOpen)
        if(this.#stillOpen.indexOf(n)===-1)
          yield n;
      for (let added of this.addedNodes())
        if (this.#stillOpen.indexOf(added) === -1)
          yield added;
    }

    * endedElements() {
      for (let n of this.endedNodes())
        if(n instanceof Element)
          yield n;
    }

    * addedNodes() {
      for (let list of this.#added)
        for (let n of (list instanceof XPathResult ? xpathIterator(list) : addedNodes(list)))
          yield n;
    }
  }

  function makeOnMoObserver() {
    const c = new Comment();                                                               //MO-readystatechange race #1
    const touchDom = _ => document.body.append(c);                                         //MO-readystatechange race #1
    document.addEventListener('readystatechange', touchDom, {capture: true, once: true});  //MO-readystatechange race #1

    let openEnded = [];
    let addeds = [document.evaluate("//node()", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)];

    return function onMO(mrs) {
      //1. skip DOM mutation inside <script>
      if (document.currentScript)
        return;
      //2. The end parser-break
      if (document.readyState !== 'loading') {
        this.disconnect();
        (mrs[mrs.length - 1].addedNodes[0] === c) && (c.remove(), mrs.pop());              //MO-readystatechange race #2
        document.removeEventListener('readystatechange', touchDom, {capture: true});       //MO-readystatechange race #2
        return dispatchEventOG.call(document, new ParserBreakEvent([...addeds, mrs], openEnded));
      }
      //3. A parser-break
      addeds.push(mrs);
      const nodes = mrs[mrs.length - 1].addedNodes;
      const lastAdded = nodes[nodes.length - 1];
      //4. .connectedCallback() macro-task is a BAD parser-break
      if (lastAdded.connectedCallback)
        return;
      const previousOpen = openEnded;
      openEnded = [];
      for (let n = lastAdded; n; n = n.parentElement)
        n.nodeType === Node.ELEMENT_NODE && n.tagName !== "SCRIPT" && openEnded.unshift(n);
      dispatchEventOG.call(lastAdded, new ParserBreakEvent(addeds.splice(0), previousOpen, openEnded));
    }
  }

  const mo = new MutationObserver(makeOnMoObserver());
  mo.observe(document.documentElement, {childList: true, subtree: true});
})(dispatchEvent);