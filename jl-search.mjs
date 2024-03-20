const log = console.log.bind(console);

const caps = {}; // Capabilities, through polyfill or otherwise
load_caps(caps);

let element_id = 0;


const collator = new Intl.Collator("sv");
const numformat = new Intl.NumberFormat(); // Use locale

// Since event targes are disabled during view transitions, we are
// catching clicks here and replaying them after transition finished.
const global_events = [];
function global_onclick(ev) {
  // log("catched click", ev, ev.target);
  global_events.push(ev);
}

class El extends HTMLElement {
  static is = "jl-search"
  static states = {
    closed: ['▼', "Expand"],
    opened: ['▲', "Collapse"],
    loading: [El.spinner, "Loading"],
    // loading: ["\u26ED", "Loading"],
    flux: ["\u26A0", El.prototype.flux_reason],
    invalid: ["\u{1F6AB}", El.prototype.invalid_reason],
    error: ["\u{1F641}", El.prototype.error_reason],
    normal: ["\u25CC", ""],
    changed: ["\u{1F514}", El.prototype.changed_reason],
    updating: ["\u2731", "Data unsaved"],
    repairing: ["\u{1F527}", "Correcting data format"],
    saving: ["\u2601", "Saving"],
    saved: ["\u2714", "Saved"],
  };

  static properties = {
    lock: Boolean,
  }

  constructor() {
    super();
    const $el = this;

    $el._id = ++element_id;
    $el._li_id = 0;
    $el._ev = {};
    $el._error = null;
    $el._req_id = 0;
    $el._memory = new Map();
    $el._caps = caps;
    $el._transitions = new Set();
    $el._transitions_resolve = null;
    $el._page_size = 8;

    $el._selected_index = null;
    $el._accepted = false;
    $el._retain_opened = false;

    // Keeping async actions straight
    $el._searching = false;
    $el._mouse_inside = false;

    const data_tmpl = {
      options: [],
      req: 0,
      query: "",
      count: 0,
      speed: undefined,
    }

    $el._data = {
      found: { ...data_tmpl },
      rendered: { ...data_tmpl },
    }

    $el._$inp = $el.querySelector("input");
    $el._$opts = $el.querySelector("nav");
    $el._$label = $el.querySelector("fieldset");
    $el._$feedback = $el.querySelector("nav footer");
    $el._$state = $el.querySelector(".state");


    // TODO: react on replaced input or input attributes. Remember our own
    // attributes
    $el.setup_$el();
    $el.setup_$inp();
    $el.setup_$label();
    $el.setup_$opts();
    $el.setup_$state();

  }

  setup_$label() {
    const $el = this;
    const $label = $el._$label;
    if (!$label.id) $label.setAttribute("id", `${El.is}-anchor-${$el._id}`);
    // log("setup label", $label);
  }

  setup_$opts() {
    const $el = this;
    const $opts = $el._$opts;

    $opts.setAttribute("popover", "manual");
    $opts.setAttribute("anchor", $el._$label.id);
    $opts.classList.add("empty");

    caps.popover.then(() => {
      $opts.classList.add('loaded-popover');
      // $opts.style.animationIterationCount = "0";
    });

    let open_promise = null;
    let open_resolve;
    $opts.get_open_promise = () => {
      // Can't use only :popover-open since it might not have finished open?
      // Or did I miss something
      // if ($opts.matches(":popover-open") && $opts.offsetParent) {
      if ($opts.matches(":popover-open")) {
        // log("get_open_promise");
        // log(":popover-open", $el.querySelector(":popover-open"));
        // log("offsetParent", $opts.offsetParent);
        return Promise.resolve();
      }

      if (open_promise) return open_promise;
      return open_promise = new Promise(resolve => {
        // log("Creating new open_promise");
        open_resolve = resolve;
      });
    }

    let close_promise = null;
    let close_resolve;
    $opts.get_close_promise = () => {
      if (!$opts.matches(":popover-open")) {
        // log("get_close_promise");
        return Promise.resolve();
      }

      if (close_promise) return close_promise;
      return close_promise = new Promise(resolve => {
        // log("Creating new close_promise");
        close_resolve = resolve;
      });
    }

    // $opts.addEventListener("transitionstart", ev => log("start"));
    // $opts.addEventListener("transitionend", ev => log("end"));
    // $opts.addEventListener("transitioncancel", ev => log("cancel"));
    // $opts.addEventListener("transitionrun", ev => log("run"));

    $opts.addEventListener("transitionend", ev => {
      if ($el.dataset.anim === "opening") {
        log("transitioned to opened");
        if (!open_promise) return;
        open_promise = null;
        open_resolve();
        return;
      }

      if ($el.dataset.anim === "closing") {
        log("transitioned to closed");
        if (!close_promise) return;
        close_promise = null;
        close_resolve();
        return;
      }

      log("unexpected transition");
    });


    $opts.addEventListener("toggle", ev => {
      return;
      if (ev.newState === "open") {
        log("$opts toggle to opened");
        if (!open_promise) return;
        open_promise = null;
        open_resolve();
      } else {
        log("$opts toggle to closed");
        if (!close_promise) return;
        close_promise = null;
        close_resolve();
      }
    });


  }

  static input_defaults = {
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    // todo: add aria
  }

  setup_$inp() {
    const $el = this;
    const $inp = $el._$inp;

    // Adding defaults
    for (const [attr, value] of Object.entries(El.input_defaults)) {
      if ($inp.hasAttribute(attr)) continue;
      $inp.setAttribute(attr, value);
    }

    $el._ev.inp = {
      input: ev => $el.on_input(ev),
      // keydown: ev => $el.on_keydown(ev),
      focus: ev => $el.on_focus(ev),
      // click: ev => $el.on_click(ev),
    }

    for (const [type, listener] of Object.entries($el._ev.inp)) {
      $inp.addEventListener(type, listener);
    }
  }

  setup_$state() {
    const $el = this;
    const $state = $el._$state;
    $el._ev.state = {
      click: ev => $el.on_state_click(ev),
    }

    for (const [type, listener] of Object.entries($el._ev.state)) {
      $state.addEventListener(type, listener);
    }
  }

  async on_state_click(ev) {
    const $el = this;
    ev.stopPropagation(); // do $el.onclick after

    const state = $el.dataset.state;
    // log("Click on state", state, "toggle", ev);
    const opened = $el.hasAttribute("opened");

    if (opened) {
      $el._retain_opened = false;
      await $el.hide_options();
    } else {
      $el._retain_opened = true;
      $el.render_feedback($el._data.rendered);
      await $el.show_options();
    }

    // Manually propagate click after all else is done
    $el.on_click(ev);
  }

  on_click(ev) {
    const $el = this;
    // log("BING");
    $el._$inp.focus();
  }

  setup_$el() {
    const $el = this;
    $el._ev.el = {
      focusout: ev => $el.on_focusout(ev),
      mousedown: ev => $el.on_mousedown(ev),
      click: ev => $el.on_click(ev),
    }

    for (const [type, listener] of Object.entries($el._ev.el)) {
      $el.addEventListener(type, listener);
    }

    caps.loaded.then(() => $el.removeAttribute("init"));

    $el.dataset.state = "loading";
  }

  on_mousedown(ev) {
    this._mouse_inside = true;
    // log("mousedown");
    setTimeout(() => { this._mouse_inside = false });
  }

  on_focusout(ev) {
    const $el = this;
    // log("on_focusout");
    if ($el.has_focus()) return;
    if ($el._mouse_inside) return;

    // log("focusout -> hide");
    $el.hide_options();
  }

  on_input(ev) {
    const $el = this;
    if (!$el._input_ready) return;
    $el._retain_opened = true;
    $el.handle_search_input($el._$inp.value);
  }

  on_keydown(ev) {
    log("on_keydown", ev)
  }

  on_focus(ev) {
    const $el = this;
    const $inp = $el._$inp;
    // log("input focused", $el._retain_opened, $el._mouse_inside);

    if (!navigator.userActivation.hasBeenActive) return;

    // Also handle history
    // if (!$el._options.length && !$el._options_query.length) return;
    if ($el._retain_opened) $el.show_options();
  }

  handle_search_input(query_in) {
    const $el = this;

    $el._selected_index = null;
    $el._accepted = false;
    $el._error = null;

    const query = query_in.trim().toLowerCase();

    if (!query.length) return $el.set_options_from_history();

    const req_id = ++$el._req_id;
    // log("search", req_id, query);
    // $el.render_feedback($el._data.rendered);
    const promise = $el.get_result_promise(query, req_id);
    promise.then(res => $el.on_result(res));
  }

  get_result_promise(query, req_id) {
    const $el = this;

    /*
    Store the search result promise in $el._memory. Use that promise for
    subsequent searches, regardless of if the search has concluded or not.
    */


    if ($el._memory.has(query)) return $el._memory.get(query).then(res => ({
      ...res,
      req: req_id,
      from_memory: true,
    }))

    $el._searching = true;
    $el.update_state();

    const time_start = Date.now();
    const record_p = $el.search({ query, req_id }).catch(err => ({
      error: err,
      found: [],
      query,
    })).then(rec => ({
      found: [],
      req: req_id,
      ...rec,
      first_req: req_id,
      req_sent: time_start,
      speed: (Date.now() - time_start),
      from_memory: false,
    }));

    $el._memory.set(query, record_p);
    return record_p;
  }

  async on_result(res) {
    const $el = this;

    // log("result", res );
    // Use this result, but remove it from memory if it's an error, so that
    // future queries will try again.
    if (res.error) $el._memory.delete(res.query);


    // handle slow responses
    if (res.req < $el._data.found.req) return; // Too late

    // Show result in order even if more is on the way
    if (res.error) console.error(res.error);
    else if (res.from_memory) log(res.query + ":", "got", res.count, "results from memory");
    else log(res.query + ":", "got", res.count, "results in", res.speed / 1000, "seconds");

    $el._data.found = res;

    // This error is not normalized. Leaving the details to the renderer.
    // Displayed as part of reder_feedback.
    if (res.error) {
      $el._error = res.error;
      $el.show_error();
    }


    await $el.prepare_options(res).catch(err => {
      res.error = err;
    })


    // Now only continue if we haven't rendered anything later
    // log("timing", res.req, "compared to", $el._data.rendered.req);
    if (res.req < $el._data.rendered.req) return;


    if (res.req === $el._req_id) {
      $el._searching = false;
      $el.update_state();
    }

    // Since we allow async prepare. There may have come new search results
    // during the preparations.

    try {
      // $el.startViewTransition("render options",() =>
      $el.render_options({
        ...res,

        current_req: $el._req_id, // Searching
        found_req: $el._found_req, // Preparing
        prepared_req: res.req, // Rendering
        previous_req: $el._rendered_req,
        has_focus: $el.has_focus(),
      })
      // );
      $el._data.rendered = res;
    } catch (error) {
      log("render error", error);
      $el._error = error;
      $el.show_error();
    }


    $el.show_options()
  }

  set_options_from_history() {
    const $el = this;
    // log("Set opitons from history", $el.has_focus());
    const req_id = ++$el._req_id;
    $el.on_result({
      count: 0,
      first_req: 0,
      found: [],
      from_memory: true,
      query: "",
      speed: 0,
      req: req_id,
    });

  }

  async search() {
    // No search function was set to override this
    throw Error("Don't know where to even begin")
  }

  prepare_options() {
    // override for async process of search result
    return Promise.resolve();
  }

  // override for custom layout
  render_options({ found = [], error, count = 0, speed, query }) {
    /*
    Callbacks for handling animations

    enter_before
    enter_anim_before returns Promise
    enter_anim_after
    (enter_after)

    (exit_before)
    exit_anim_before returns Promise
    exit_anim_after
    exit_after
    
    */

    const $el = this;
    const max = Math.min(found.length, $el._page_size);
    // log("render options from", found);

    $el._$opts.classList.toggle("empty", count === 0);

    const added = [];
    const removed = [];

    const $ul = $el.querySelector("ul");
    const children = [...$ul.children]
      .filter($li => (!$li.classList.contains('exit')));
    let i = 0;
    for (const $child of children) {
      const val = $child.dataset.text;
      // log("consider", $child);
      if ($child.classList.contains("exit")) console.warn("DANGER");
      while (i < max) {
        const order = collator.compare(val, found[i]);
        // log("compare", val, "with", i, found[i], order);

        if (order === -1) {
          // log("  remove");
          removed.push($child);
          break;
        } else if (order === +1) {
          // log("  insert", found[i], "before", val);
          const $new = $el.render_item(found[i]);
          // $el.enter_before($new);
          $ul.insertBefore($new, $child);
          added.push($new);
        } else {
          i++;
          break;
        }

        i++;
      }
    }

    // Append the rest of the items found
    for (let j = i; j < max; j++) {
      // log("append", found[j]);
      const $new = $el.render_item(found[j]);
      // $el.enter_before($new);
      $ul.append($new);
      added.push($new);
    }

    // Remove previous items pushed beyond page limit

    // log("existing children", children.length);
    // log("added", added.length);
    // log("removed", removed.length);
    // log("pagesize", $el._page_size);

    const pos = - added.length + removed.length + max;

    // log("remove from", pos, "to", children.length);
    for (let i = pos; i < children.length; i++) {
      // log("should remove overflow child", i);
      const $child = children[i];
      removed.push($child);
    }

    $el.enter_anim_before(added);
    $el.exit_anim_before(removed).then(() => {
      // $el.exit_anim_after(removed);
      for (const $child of removed) $child.remove();
      // $el.exit_after();
    });

    $el.render_feedback({ error, count, speed, query });
  }

  async enter_anim_before(elements) {
    const $el = this;
    if (!$el.hasAttribute("more-anim")) return Promise.resolve();
    await $el._$opts.get_open_promise();
    // log("$opts opened", $el._$opts.offsetParent);

    for (const $li of elements) {
      const rect = $li.getBoundingClientRect();
      const height_goal = rect.height;
      if (!height_goal) throw Error("Could not get item height");
      // log("item", $li, $li.parentElement, "start", rect.height);
      const style = $li.style;
      style.height = "0px";
      style.overflow = "hidden";
      requestAnimationFrame(() => {
        style.transition = "height .3s";
        style.height = height_goal + "px";
        $li.addEventListener('transitionend', () => {
          delete style.height;
          delete style.overflow;
        }, { once: true });
      });
    }
  }

  exit_anim_before(elements) {
    const $el = this;
    if (!$el.hasAttribute("more-anim")) return Promise.resolve();
    return new Promise((resolve, reject) => {
      for (const $li of elements) {
        const height_start = $li.scrollHeight;
        if (!height_start) throw Error("Could not get item height");
        const style = $li.style;
        $li.classList.add("exit");
        requestAnimationFrame(() => {
          style.height = height_start + "px";
          requestAnimationFrame(() => {
            style.transition = "height .3s";
            style.height = "0px";
          });
        });

        $li.addEventListener('transitionend', () => {
          resolve();
        }, { once: true });
      }
    });
  }

  render_item(text) {
    const $el = this;
    const $li = document.createElement("li");
    $li.dataset.text = text;
    // $li.style.viewTransitionName = `jl-search-${$el._id}-li-${++$el._li_id}`;
    $el.render_item_content($li, text);
    return $li;
  }

  render_item_content($li, text) {
    $li.innerText = text;
  }

  render_state(state) {
    const $el = this;
    $el.render_tooltip(state);
    $el.render_state_html(state);
    $el.render_feedback($el._data.rendered);
  }

  render_tooltip(state) {
    const $el = this;
    $el._$state.title = $el.get_tooltip(state);
  }

  get_tooltip(state) {
    const $el = this;
    const tip = El.states[state][1];
    return (typeof tip === 'function') ? tip.apply($el) : tip;
  }

  render_state_html(state) {
    const $el = this;
    log("render state", state, "html to", El.states[state][0]);
    $el._$state.innerHTML = El.states[state][0];
  }

  render_feedback({ error, count, speed, query }) {
    // console.warn("render feedback", query);
    const $el = this;
    if ($el._error) return $el.render_error(error);
    $el._$feedback.classList.remove("error");
    $el._$feedback.innerHTML = $el.get_feedback({ count, speed, query });
  }

  render_error(error) {
    const $el = this;
    $el._$feedback.classList.add("error");
    $el._$feedback.innerHTML = $el.error_reason(error);
  }

  get_feedback({ count, speed, query }) {
    const $el = this;
    if ($el._searching) return "Fetching search result . . .";
    if (!query.length) return "Try typing some letters";
    if (count === 1) return `Found one measly result after ${speed / 1000} seconds`;
    if (count > 0) return `Found ${numformat.format(count)} results in ${speed / 1000} seconds`;
    return `Found absolutely nothing after searching for ${speed / 1000} seconds`;
  }

  async show_options() {
    const $el = this;

    if ($el.hasAttribute("opened") && !$el.dataset.anim) return;

    // The process can change direction at any time
    $el.dataset.anim = "opening";

    // console.warn("OPEN options", $el._data.found.found.length);
    await caps.popover;
    await caps.anchor_positioning; // wait on slow polyfill loads
    if ($el.dataset.anim !== "opening") return;

    // Firefox popover animation workaround
    // $el._$opts.style.animationIterationCount = "1";

    log("show_options set opened");
    await $el.toggle_options(true);
    if ($el.dataset.anim !== "opening") return;

    // May have changed async
    log("show_options popover");
    $el._$opts.togglePopover(true);

    delete $el.dataset.anim;
  }

  async toggle_options(force) {
    const $el = this;

    // Skip animations on larger screens. Using the same breakpoint as the
    // css. (Since small screen triggers movement of the field to the top of
    // screen.)

    const should_animate = window.matchMedia('(max-width: 30rem)').matches;
    if (should_animate) {
      await $el.startViewTransition("toggle_options", () => {
        $el.toggleAttribute("opened", force);
        $el.update_state();
      });
    } else {
      $el.toggleAttribute("opened", force);
      $el.update_state();
    }
  }

  startViewTransition(label, fn) {
    if (!document.startViewTransition) return fn();
    const $el = this;

    const transition = document.startViewTransition(fn);
    log("view transition", label);

    if (!$el._transitions.size) {
      log("adding global_onclick listener");
      document.addEventListener("click", global_onclick);
      const done = new Promise(resolve => {
        $el._transitions_resolve = resolve;
      });

      done.then(() => {
        log("all view transition finished");
        if ($el._transitions.size) throw Error("nor really done");

        document.removeEventListener("click", global_onclick);

        // Just in case something adds stuff during loop
        const events = [...global_events];
        global_events.length = 0;

        for (const ev of events) {
          if (ev.target !== document.documentElement) continue;
          const $target = document.elementFromPoint(
            ev.clientX, ev.clientY);

          if ($el.contains($target)) continue;

          log("replay event to", $target.tagName);
          $target.dispatchEvent(ev);
        }
      });
    }

    $el._transitions.add(transition);

    return transition.finished.then(() => {
      $el._transitions.delete(transition);
      log("view transition", label, "finished");
      if ($el._transitions.size) return;
      $el._transitions_resolve();
    });
  }

  async hide_options() {
    const $el = this;
    // log("hide");

    if (!$el.hasAttribute("opened") && !$el.dataset.anim) return;

    // The process can change direction at any time
    $el.dataset.anim = "closing";

    log("hide_options popver");
    const closed = $el._$opts.get_close_promise();
    await closed;

    if ($el.dataset.anim !== "closing") return;
    $el._$opts.hidePopover();

    log("hide_options set closed");
    await $el.toggle_options(false);

    log("hide_options done");
    delete $el.dataset.anim;
  }

  show_error() {
    const $el = this;
    $el.update_state();
    $el.render_error($el._error);
    $el.show_options();
  }

  update_state() {
    const $el = this;
    const state = $el.get_state();
    // log("Update state to", state);
    if ($el.dataset.state === state) return;
    $el.dataset.state = state;
    $el.render_state(state);
  }

  get_state() {
    const $el = this;
    // return "loading";
    if ($el._searching) return "loading";
    if ($el._error) return "error";
    if ($el.hasAttribute("opened")) return "opened";
    return "closed";
  }

  has_focus() {
    return this.getRootNode().activeElement === this._$inp;
  }

  async regain_focus() {
    const $el = this;
    const $inp = $el._$inp;

    // Only used for a workaround for autofocus not sticking during page load.

    if (!$inp.autofocus) return;
    if ($inp.disabled) return;

    if (navigator.userActivation.hasBeenActive) return;
    if (!caps.polyfilled.anchor_positioning) return;
    // log("regain focus");

    // This anchor_positioning polyfill seems to steal focus. Especially on
    // firefox. Can't find a consistent point to regain focus.
    await caps.anchor_positioning;

    $inp.focus();
  }

  async connectedCallback() {
    const $el = this;
    // super.connectedCallback();
    // log("connected", $el._$inp.disabled);

    const $inp = $el._$inp;

    /*
     Possibly add setup(), init(), onReady(), config() or similar
     */


    //Wait on other modules adding callbacks
    if (!$el._$inp.disabled) $el.first_input();
  }

  async first_input() {
    const $el = this;
    const $inp = $el._$inp;

    if (!navigator.userActivation.hasBeenActive)
      $inp.setSelectionRange(0, $inp.value.length);

    await caps.loaded;
    await $el.regain_focus(); // only conditionally
    // await sleep(3000);

    log("first input");
    $el.update_state();
    $el._input_ready = true;

    if ($inp.value.length) $el.handle_search_input($inp.value);
  }

  error_reason(error = this._error) {
    return error?.message ?? "Got an ouchie";
  }

  static spinner = `
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="spin">
  <path
  d="M12,1A11,11,0,1,0,23,12,11,11,0,0,0,12,1Zm0,19a8,8,0,1,1,8-8A8,8,0,0,1,12,20Z"
  opacity=".25"/>
  <circle cx="12" cy="2.5" r="1.5"/>
  </svg>
`;

  get spinner() {
    return El.spinner;
  }

}

customElements.define(El.is, El);
// log("element defined");


function load_caps(caps) {
  caps.polyfilled = {};
  caps.popover = load_polyfill_popover();
  caps.anchor_positioning = load_polyfill_anchor_positioning();
  caps.scroll_into_view = load_polyfill_scroll_into_view();
  caps.user_activation = load_polyfill_user_activation();

  // Also using startViewTransition from View Transitions API


  caps.loaded = new Promise(resolve => {
    window.addEventListener('load', () => setTimeout(resolve, 0));
  });

  // return;
  for (const [name, promise] of Object.entries(caps)) {
    if (!caps.polyfilled[name]) continue;
    // log("Capability", name);
    promise.then(() => log("Capability", name, "ready"));
  }

}

async function load_polyfill_popover() {
  if (HTMLElement.prototype.togglePopover) return;
  caps.polyfilled.popover = true;
  await import("https://cdn.jsdelivr.net/npm/@oddbird/popover-polyfill@latest");
  return;

  // Hack for handling the polyfill style specificity
  const popover_css = new CSSStyleSheet();
  await popover_css.replace(`
  [popover]:not(.\\:popover-open) { 
    height: 0;
   }
  `);

  // transform: scaleY(0);
  // display: none;
  // display: flex;

  document.adoptedStyleSheets.push(popover_css);
  return;
}

async function load_polyfill_anchor_positioning() {
  if ("anchorName" in document.documentElement.style) return Promise.resolve();
  caps.polyfilled.anchor_positioning = true;
  const { default: polyfill } = await import("https://unpkg.com/@oddbird/css-anchor-positioning/dist/css-anchor-positioning-fn.js");
  await polyfill();
  // await sleep(0); // Go to the back of the queue
}

// Not useful since the popover is a separate element
function load_polyfill_scroll_into_view() {
  if (Element.prototype.scrollIntoViewIfNeeded) {
    $el => $el.scrollIntoViewIfNeeded();
    return Promise.resolve();
  } else {
    caps.polyfilled.scroll_into_view = true;
    const cnf = { scrollMode: 'if-needed', block: 'nearest' };
    return import('https://esm.sh/scroll-into-view-if-needed')
      .then(pkg => {
        Element.prototype.scrollIntoViewIfNeeded = function () {
          pkg.default(this, cnf)
        }
      })
  }
}

function load_polyfill_user_activation() {
  if (navigator.userActivation) return Promise.resolve();

  caps.polyfilled.user_activation = true;
  navigator.userActivation = { hasBeenActive: false };

  const activation_handler = ev => {
    if (!ev.isTrusted) return;
    navigator.userActivation.hasBeenActive = true;
    window.removeEventListener("mousedown", activation_handler);
    window.removeEventListener("touchstart", activation_handler);
    window.removeEventListener("keydown", activation_handler);
  }

  window.addEventListener("mousedown", activation_handler);
  window.addEventListener("touchstart", activation_handler);
  window.addEventListener("keydown", activation_handler);
  return Promise.resolve();
}

function sleep(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}


/*
Resources
https://open-props.style/
https://getbootstrap.com/docs/5.3/forms/form-control/
https://tailwindui.com/components/application-ui/forms/input-groups
https://material-components.github.io/material-components-web-catalog/#/component/text-field
https://fonts.google.com/icons
https://fonts.google.com/noto/specimen/Noto+Emoji?query=noto+emoji
https://material-web.dev/

https://oklch.com/#73.40931506848489,0.3563,81.72,100


## Trigger errors:
Backend: trigger error
Frontend: i am lying

## Align unicode or svg with material symbols
width: 1em;
height: 1em;
display: flex;
justify-content: center;
align-items: center;

## Special adjustment for wider characters
width: 1.25em;
height: 1.25em;
font-size:.8em;


## Global spinner
const spinner = document.createElement('div');
spinner.id = "spinner";
spinner.className = "fadeOut";
const spinglyph = document.createElement('img');
spinglyph.src = "/fonts/noto-emoji/emoji_u1f4c0.svg";
spinner.jobcount = 0;
spinner.appendChild(spinglyph);
document.body.appendChild( spinner );
spinner.startGlobal = ()=>{ spinner.jobcount++; spinner.classList.remove('fadeOut') }
spinner.stopGlobal = ()=>{ if( --spinner.jobcount < 1 ) spinner.classList.add('fadeOut') }
spinner.offsetWidth; // Force reflow
setTimeout(spinner.startGlobal);

*/
