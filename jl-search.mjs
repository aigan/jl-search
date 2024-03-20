const log = console.log.bind(console);

// Capabilities, through polyfill or otherwise
export const caps = {};

export function init() {
  load_caps();
  customElements.define(El.is, El);
}


let element_id = 0;
export { El as JlSearch }
class El extends HTMLElement {

  static is = "jl-search";

  _id = ++element_id;
  // _caps = caps; // Expose capability promises

  _ready = false; // For one-time setup
  _ev = {};  // Event listeners
  _error = null; // Aggregated error state

  _req_id = 0; // search request sequence id
  _memory = new Map(); // Memoized search results
  _searching = false; // More results coming
  _query = null; // Latest running query
  _mouse_inside = false; // For focusout


  // Size of 8 is small enough for both nitive load and mobile screen size for
  // the double-row layout. But its far to small for the number of distinct
  // articles that uses the same name, so we need to extend it for some cases.
  // Applications using this sort of autocomplete widget could do its own
  // logic for asking for more results in certain cases, be it for an infinite
  // scroll, additional pages, grouping, or just extending the result list.
  _page_size = 8;

  _highlighted_option = null;
  _retain_opened = true; // User wants options opened
  _do_autocomplete = false;


  // Search response data
  static data_tmpl = {
    found: [],          // matches returned
    count: 0,           // total matches
    query: null,        // search query
    first_req: 0,       // original req_id
    req: 0,             // latest req_id
    error: null,        // error object
    req_sent: null,     // epoch
    speed: 0,           // ms
    from_memory: true,  // cached response
    from_visited: false,// previously selected options
  }

  // Separating found vs rendered search results since they could be async
  _data = {
    received: { ...El.data_tmpl },
    rendered: { ...El.data_tmpl },
  }





  // =====  SETUP  =====


  constructor() {
    super();
    const $el = this;
    $el.setup_visited();
  }



  connectedCallback() {
    const $el = this;
    // log("connected", $el._$inp.disabled);

    /*
     Possibly add setup(), init(), onReady(), config() or similar
     */

    $el._ev.document = {
      selectionchange: ev => $el.on_selectionchange(ev),
    }

    for (const [type, listener] of Object.entries($el._ev.document)) {
      document.addEventListener(type, listener);
    }

    // Auto-setup elements if they exist
    if (!$el._ready && $el.querySelector("fieldset")) $el.setup_dom();
  }



  disconnectedCallback() {
    const $el = this;
    for (const [type, listener] of Object.entries($el._ev.document)) {
      document.removeEventListener(type, listener);
    }

  }



  setup_dom() {
    const $el = this;
    $el._ready = true;

    // Not handling DOM mutations in this implementation
    $el._$inp = $el.querySelector("input");
    $el._$opts = $el.querySelector("nav");
    $el._$field = $el.querySelector("fieldset");
    $el._$feedback = $el.querySelector("nav footer");
    $el._$state = $el.querySelector(".state");


    // TODO: react on replaced input or input attributes. Remember our own
    // attributes
    $el.setup_$el();
    $el.setup_$inp();
    $el.setup_$field();
    $el.setup_$opts();
    $el.setup_$state();


    //Wait on other modules adding callbacks
    if (!$el._$inp.disabled) $el.first_input();
  }



  setup_$field() {
    const $el = this;
    const $field = $el._$field;
    const name = $el.constructor.is;
    if (!$field.id) $field.setAttribute("id", `${name}-anchor-${$el._id}`);
    // log("setup label", $field);

    $el._ev.field = {
      click: ev => $el.on_field_click(ev),
    }

    for (const [type, listener] of Object.entries($el._ev.field)) {
      $field.addEventListener(type, listener);
    }

    if (caps.missing.anchor_positioning) {
      let x = 0, y = 0, w = 0, h = 0, run = false;

      $el._ev.field_raf_start = () => {
        run = true;
        // log("starting raf");
        requestAnimationFrame(raf);
      }

      $el._ev.field_raf_stop = () => {
        run = false;
        // log("stopping raf");
      }

      const raf = () => {
        if (!run) return;
        if (
          $field.offsetTop === y &&
          $field.offsetLeft === x &&
          $field.offsetWidth === w &&
          $field.offsetHeight === h
        ) return requestAnimationFrame(raf);

        // log("field position changed");
        x = $field.offsetLeft;
        y = $field.offsetTop;
        w = $field.offsetWidth;
        h = $field.offsetHeight;
        $el.render_position_below($el._$opts, $field);
        requestAnimationFrame(raf);
      }
    }

  }



  setup_$opts() {
    const $el = this;
    const $opts = $el._$opts;

    $opts.setAttribute("popover", "manual");
    $opts.setAttribute("anchor", $el._$field.id);
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
      if ($opts.matches(":popover-open")) return Promise.resolve();

      // Are we animating? Since support for computedStyleMap is limited, we
      // just check for the default value of "0s" for no animation.
      if (getComputedStyle($opts).transitionDuration === "0s")
        return Promise.resolve();

      if (!$opts.computedStyleMap().get('transition-duration').value)
        return Promise.resolve();

      if (open_promise) return open_promise;

      return open_promise = new Promise(resolve => {
        // log("Creating new open_promise");
        open_resolve = resolve;
      });
    }

    let close_promise = null;
    let close_resolve;
    $opts.get_close_promise = () => {
      if (!$opts.matches(":popover-open")) return Promise.resolve();

      if (close_promise) return close_promise;

      // Are we animating? Since support for computedStyleMap is limited, we
      // just check for the default value of "0s" for no animation.
      if (getComputedStyle($opts).transitionDuration === "0s")
        return Promise.resolve();

      return close_promise = new Promise(resolve => {
        // log("Creating new close_promise");
        close_resolve = resolve;
      });
    }

    const on_transitionend = ev => {
      if (ev.target !== $opts) return; // Ignore transition from children

      if ($el.dataset.anim === "opening") {
        // log("transitioned to opened");
        if (!open_promise) return;
        open_promise = null;
        open_resolve();
        return;
      }

      if ($el.dataset.anim === "closing") {
        // log("transitioned to closed");
        if (!close_promise) return;
        close_promise = null;
        close_resolve();
        return;
      }

      // log("transition", ev.target, ev);
    }

    $el._ev.opts = {
      transitionend: on_transitionend,
      click: ev => $el.on_opts_click(ev),
    }

    for (const [type, listener] of Object.entries($el._ev.opts)) {
      $opts.addEventListener(type, listener);
    }

  }



  static input_defaults = {
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    // todo: add aria
  }


  setup_$inp() {
    const $el = this;
    const $inp = $el._$inp;

    // Adding defaults
    const defaults = $el.constructor.input_defaults;
    for (const [attr, value] of Object.entries(defaults)) {
      if ($inp.hasAttribute(attr)) continue;
      $inp.setAttribute(attr, value);
    }

    $el._ev.inp = {
      input: ev => $el.on_input(ev),
      beforeinput: ev => $el.before_input(ev),
      change: ev => $el.on_change(ev),
      keydown: ev => $el.on_keydown(ev),
      focus: ev => $el.on_focus(ev),
      // compositionstart: ev => $el.on_inp_event(ev),
      // compositionupdate: ev => $el.on_inp_event(ev),
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

    $el.render_state($el.get_state());
  }



  setup_$el() {
    const $el = this;
    $el._ev.el = {
      focusout: ev => $el.on_focusout(ev),
      mousedown: ev => $el.on_mousedown(ev),
      // click: ev => $el.on_click(ev),
    }

    for (const [type, listener] of Object.entries($el._ev.el)) {
      $el.addEventListener(type, listener);
    }

    caps.loaded.then(() => $el.removeAttribute("init"));
  }



  async first_input() {
    const $el = this;
    const $inp = $el._$inp;

    await caps.loaded;
    // await sleep(3000);
    // await $el.regain_focus(); // only conditionally
    if (!navigator.userActivation.hasBeenActive) $el.input_select();

    log($el.input_debug($inp.value, 0, $inp.value.length, "first_input"))

    $el.update_state();
    $el._input_ready = true;

    $el.handle_search_input($inp.value);
  }




  // =====  EVENTS  =====


  async on_state_click(ev) {
    const $el = this;
    ev.stopPropagation(); // do $el.onclick after
    if ($el._$inp.disabled) return;

    // const state = $el.dataset.state;
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
    $el.on_field_click(ev);
  }



  on_field_click(ev) {
    const $el = this;
    // log("CLICK field (userselect)");

    $el._pos_persist = false; // Allow text de-selection
    $el._$inp.focus();
  }



  on_mousedown(ev) {
    this._mouse_inside = true;
    // log("mousedown");
    setTimeout(() => { this._mouse_inside = false });
  }



  on_focusout(ev) {
    const $el = this;
    // log("on_focusout");
    if ($el.has_focus) return;
    if ($el._mouse_inside) return;

    // log("focusout -> hide");
    $el.hide_options();
  }



  before_input(ev) {
    const $el = this;
    // log("before_input", ev.inputType, ev.data);

    // Since mobile browser often miss the text-selection status, we will
    // handle events here if possible. See autocomplete()

    this._do_autocomplete = true;
    const $inp = $el._$inp;
    const txt = $inp.value;
    const pos1 = $inp.selectionStart;
    const pos2 = $inp.selectionEnd;
    log(ev.inputType, `»${txt}«(${txt.length}) [${$el._pos1},${$el._pos2}]→[${pos1},${pos2}]`);

    switch (ev.inputType) {
      case "insertText":
      case "insertReplacementText": {
        const pos = pos1 + ev.data.length;
        const txt_new = txt.slice(0, pos1) + ev.data + txt.slice(pos2);
        $el.set_input(txt_new, pos, pos, ev.inputType);
        break;
      }
      case "deleteContentBackward": {
        // The browser usually selects the char to be deleted. No need to step
        // back.
        let pos1a = pos1 < pos2 ? pos1 : Math.max(pos1 - 1, 0);
        const txt_new = txt.slice(0, pos1a) + txt.slice(pos2);
        $el.set_input(txt_new, pos1a, pos1a, ev.inputType);
        break;
      }
      case "deleteByCut":
      case "deleteContent":
      case "deleteContentForward": {
        let pos2b = pos1 < pos2 ? pos2 : pos2 + 1;
        const txt_new = txt.slice(0, pos1) + txt.slice(pos2b);
        $el.set_input(txt_new, pos1, pos1, ev.inputType);
        break;
      }
      default: {
        log("before_input", ev);
        return; // Pass to next handler
      }
    }

    ev.preventDefault();
    if (!$el._input_ready) return;
    $el._retain_opened = true;
    $el.handle_search_input($inp.value);
  }



  on_input(ev) {
    const $el = this;

    const $inp = $el._$inp;
    let txt = $inp.value;

    // TODO: use keydown for resolving input jitter

    /*
      Autocompletion with the completion text being inserted ans selected
      after the user input. Tried to make it work, even with compensating for
      async changes from mobile virtual keyboards or Input Method Editors. But
      even while keeping track of the autocompletion texts, there are still
      some situations where I cna't know for sure if a specific input was
      faulty because of a race condition.

      No wonder that the Google search field stopped using this form of
      autocompletion. I will have to resign to not using autocompletion with
      these input methods.

      So instead, autocomplete will be default off and only used in the
      precence of keyboard events that is not "Unidentified".
      */

    // Virtual keyboards will not send keydown events. Check here if selection
    // was deleted, so that we dont just add it back again.

    /*
    // Also skip autcomplete if last character was deleted, since backspace
    // can not be listened to on virtual keyboards. This do not apply on
    // desktop.

    if ($el._pos1 === $el._pos2 && $el._pos1 === txt.length + 1) {
      log("mobile backspace");
      $el._do_autocomplete = false;
    }

    // Mobile virtual keyboards async input may send input after de-selecting
    // or not yet recting on selection, causing the selected text to not be
    // removed.

    // Keyboard ADD to end with no selection
    if ($el._pos_persist
      && $el._pos1 < $el._pos2
      && $el._pos2 === $el._txt_cur.length
      && txt.length > $el._pos2
      && txt.startsWith($el._txt_cur)
    ) {
      const txt_added = txt.slice($el._pos2);
      const txt_base = txt.slice(0, $el._pos1);
      log($el.input_debug(txt, $inp.selectionStart, $inp.selectionEnd, "HICKUP"));
      log("##### Correcting text ADD END for missing selection");
      txt = $el._txt_cur = $inp.value = txt_base + txt_added;
    }

    // Keyboard ADD to middle with no selection
    if ($el._pos_persist
      && $el._pos1 < $el._pos2
      && $el._pos2 === $el._txt_cur.length
      && txt.length > $el._pos2
      && txt.startsWith($el._txt_cur.slice(0, $el._pos1))
      && txt.endsWith($el._txt_cur.slice($el._pos1))
    ) {
      const txt_base = txt.slice(0, $el._pos1);
      const txt_added = txt.slice($el._pos1, txt.length - $el._pos2);
      log($el.input_debug(txt, $inp.selectionStart, $inp.selectionEnd, "HICKUP"));
      log("##### Correcting text input ADD MIDDLE for missing selection");
      txt = $el._txt_cur = $inp.value = txt_base + txt_added;
    }

    // Keyboard BACKSPACE from end with no selection
    if ($el._pos_persist
      && $el._pos1 < $el._pos2
      && $el._pos2 === $el._txt_cur.length
      && txt.length === $el._pos2 - 1
      && txt === $el._txt_cur.slice(0, -1)
    ) {
      log($el.input_debug(txt, $inp.selectionStart, $inp.selectionEnd, "HICKUP"));
      log("##### Correcting text backspace END for missing selection");
      txt = $el._txt_cur = $inp.value = $el._txt_cur.slice(0, $el._pos1 - 1);
    }

    // Keyboard BACKSPACE from middle with no selection
    if ($el._pos_persist
      && $el._pos1 < $el._pos2
      && $el._pos2 === $el._txt_cur.length
      && txt.length === $el._pos2 - 1
      && txt === $el._txt_cur.slice(0, $el._pos1 - 1) + $el._txt_cur($el._pos1)
    ) {
      log($el.input_debug(txt, $inp.selectionStart, $inp.selectionEnd, "HICKUP"));
      log("##### Correcting text backspace MIDDLE for missing input change");
      txt = $el._txt_cur = $inp.value = txt.slice(0, $el._pos1 - 1);
    }
    */

    $el._pos1 = $inp.selectionStart;
    $el._pos2 = $inp.selectionEnd;
    log($el.input_debug(txt, $el._pos1, $el._pos2, "on_input"));

    if (!$el._input_ready) return;
    $el._retain_opened = true;

    $el.handle_search_input($el._$inp.value);
  }



  on_change(ev) {
    // const $el = this;
    // TODO: check if valid
    ev.stopPropagation();
  }



  on_keydown(ev) {
    log("on_keydown", ev.key);

    switch (ev.key) {
      case "Process": return;
      case "Unidentified": return;
      case "Escape": this.on_escape(ev); break;
      case "ArrowDown": this.next_option(); break;
      case "ArrowUp": this.previous_option(); break;
      case "Enter": this.on_enter(); break;
      case "Backspace": this.on_backspace(ev); return;
      default:
        this._do_autocomplete = true;
        this._pos_persist = false;
        return; // Pass to next handler
    }

    ev.preventDefault();
  }



  // See autocomplete()
  on_selectionchange(ev) {
    const $el = this;

    if (!$el.has_focus) return;
    const $inp = $el._$inp;

    const pos1 = $inp.selectionStart;
    const pos2 = $inp.selectionEnd;

    if (($el._pos1 === pos1) && ($el._pos2 === pos2)) return;

    const txt = $inp.value;
    log("on_select" + ($el._pos_persist ? " PERSIST" : ""),
      `»${txt}«(${txt.length}) [${$el._pos1},${$el._pos2}]→[${pos1},${pos2}]`);


    // Workaround for browsers some times losing the selected text.
    if ($el._pos_persist && pos1 === pos2 && pos2 === txt.length) {
      $inp.setSelectionRange($el._pos1, $el._pos2);
      log($el.input_debug(txt, $el._pos1, $el._pos2, "RE-SELECTED"));
      return;
    }

    // Selection changed. Do search on the left part and treat the right part
    // as transient autocomplete.
    // $el._do_autocomplete = false;
    $el._pos1 = pos1;
    $el._pos2 = pos2;

    if (($el._pos1 === $el._pos2) && (pos1 === pos2)) return;

    if (pos2 === txt.length && pos1 > 0) {
      const txt_prefix = txt.slice(0, pos1);
      log($el.input_debug(txt, pos1, pos2, "on_select -> search START"));
      return $el.handle_search_input(txt_prefix);
    } else {
      log($el.input_debug(txt, pos1, pos2, "on_select -> search WHOLE"));
      return $el.handle_search_input(txt);
    }
  }



  on_backspace(ev) {
    const $el = this;

    // A normal backspace will delete the selected text. Since we are using
    // live completion suggestions, we want to support backspace in relation
    // to anchor position.

    const $inp = $el._$inp;
    const txt = $inp.value;
    const pos1 = $inp.selectionStart;
    const pos2 = $inp.selectionEnd;

    // log($el.input_debug(txt, pos1, pos2, "BACKSPACE before"));

    // Use default behaviour if not in autocomplete mode
    // if (pos1 === pos2) return;
    if (pos2 !== txt.length) return;
    if (pos1 === 0) return;
    if (pos2 === 0) return;

    $el.set_input(txt.slice(0, pos1 - 1), (pos1 - 1), (pos1 - 1), "BACKSPACE");

    ev.preventDefault();
    $el._do_autocomplete = true;
    $el.handle_search_input($inp.value);
  }



  on_escape(ev) {
    const $el = this;
    // Make escape back out from current context, step by step. 1. close
    // options, 2. select all, 3. revert value

    if ($el.hasAttribute("opened")) return void this.hide_options();
    const $inp = $el._$inp;
    const pos1 = $inp.selectionStart;
    const pos2 = $inp.selectionEnd;
    if (pos1 === 0 && pos2 === $inp.value.length) return void $el.revert();

    $el.input_select();
    log($el.input_debug($inp.value, 0, $inp.value.length, "escape"));
  }



  on_enter() {
    const $el = this;
    // Should only accept valid values...
    const id = $el.parse($el._$inp.value);
    $el.select_option(id);
  }



  on_focus(ev) {
    const $el = this;
    // const $inp = $el._$inp;
    // log("input focused", $el._retain_opened, $el._mouse_inside);

    if (!navigator.userActivation.hasBeenActive) return;

    // Also handle history
    // if (!$el._options.length && !$el._options_query.length) return;
    if ($el._retain_opened) $el.show_options();
  }



  on_opts_click(ev) {
    const $el = this;

    const name = $el.constructor.is;
    const $target = ev.target.closest(name + " nav li");
    if (!$target) return;
    $el.select_option($target.dataset.id);
  }





  // =====  SETTERS  =====


  _pos1 = 0; // input text selection start
  _pos2 = 0; // input text selection end
  _pos_persist = false;


  input_select(pos1, pos2) {
    const $el = this;
    const $inp = $el._$inp;
    $el._pos_persist = true;

    if (pos1 == null) {
      pos1 = 0;
      pos2 = $inp.value.length;
    }

    // Detect user changing selection, so that the search can reflect the
    // non-selected beginning part.

    if ((pos1 === $el._pos1) && (pos2 === $el._pos2)) return;

    $el._pos1 = pos1;
    $el._pos2 = pos2;

    // Android virtual keyboard updating input field has async selection
    // handling, causing selected text to be deselected shortly afterwards.

    // Android update input filed selection async, causing race conditions.
    // Using a flag here as a workaround.

    $inp.setSelectionRange(pos1, pos2);
  }



  set_input(text, pos1, pos2, reason) {
    const $el = this;
    $el._$inp.value = text;
    $el.input_select(pos1, pos2);
    log($el.input_debug(text, pos1, pos2, reason));
  }





  // =====  GETTERS =====


  // Convert Search text to normalized query that will be memoized
  to_query(txt) {
    return txt;
  }



  // Convert input field text to id string
  parse(txt) {
    return txt.trim();
  }



  // convert string id to input field text
  format(opt_id) {
    return opt_id;
  }



  get_tooltip(state) {
    const $el = this;
    const tip = $el.constructor.states[state][1];
    return (typeof tip === 'function') ? tip.apply($el) : tip;
  }



  get_feedback(res) {
    const $el = this;
    if (res.from_visited && res.count) return "Showing options from search history";
    if ($el._searching) return "Fetching search result . . .";
    if (!res.query?.length) return "Try typing some letters";
    if (res.count === 1) return `Found one measly result after ${res.speed / 1000} seconds`;
    if (res.count > 0) return `Found ${numformat.format(res.count)} results in ${res.speed / 1000} seconds`;
    return `Found absolutely nothing after searching for ${res.speed / 1000} seconds`;
  }



  get_state() {
    const $el = this;
    if ($el._$inp.disabled) return "closed";
    if (!$el._input_ready) return "loading";
    // return "loading";
    if ($el._searching) return "loading";
    if ($el._error) return "error";
    if ($el.hasAttribute("opened")) return "opened";
    return "closed";
  }



  get has_focus() {
    return this.getRootNode().activeElement === this._$inp;
  }



  error_reason(error = this._error) {
    return error?.message ?? "Got an ouchie";
  }



  get value() {
    const $el = this;
    // Differ between db and el value. See parse/format. The standard
    // setFormValue() does differentiate these, but are using "state" for the
    // user version of the value and "value" for the sanitized version to be
    // sent to the server.

    return $el.parse(this._$inp.value);
  }



  css_var(name) {
    return getComputedStyle(this).getPropertyValue("--_" + name);
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
    return this.constructor.spinner;
  }




  // Not all states used in this element
  static states = {
    closed: ['▼', "Expand"],
    opened: ['▲', "Collapse"],
    loading: [El.spinner, "Loading"],
    // loading: ["\u26ED", "Loading"],
    // flux: ["\u26A0", El.prototype.flux_reason],
    // invalid: ["\u{1F6AB}", El.prototype.invalid_reason],
    error: ["\u{1F641}", El.prototype.error_reason],
    // normal: ["\u25CC", ""],
    // changed: ["\u{1F514}", El.prototype.changed_reason],
    // updating: ["\u2731", "Data unsaved"],
    // repairing: ["\u{1F527}", "Correcting data format"],
    // saving: ["\u2601", "Saving"],
    // saved: ["\u2714", "Saved"],
  };





  // =====  DEBUG  =====


  input_debug(txt, pos1, pos2, label) {
    if (pos1 === pos2) return `»${txt.slice(0, pos1)}❚${txt.slice(pos2)}« ${label}`;
    return `»${txt.slice(0, pos1)}❰${txt.slice(pos1, pos2)}❱${txt.slice(pos2)}« ${label}`;
  }





  // =====  ACTIONS  =====


  next_option() {
    const $el = this;

    const options = $el._data.rendered.found;
    if (!options.length) return;

    const max = Math.min(options.length, $el._page_size);
    let selected = options.indexOf($el._highlighted_option);
    selected++;
    if (selected >= max) selected = 0;

    const opt_id = options[selected] ?? null;
    log("next", selected, opt_id);

    $el.autocomplete($el._query ?? "", opt_id);
    $el.highlight_option(opt_id);

    $el._retain_opened = true;
    $el.removeAttribute("selected");
    $el.show_options();
  }



  previous_option() {
    const $el = this;

    const options = $el._data.rendered.found;
    if (!options.length) return;

    const max = Math.min(options.length, $el._page_size);
    let selected = options.indexOf($el._highlighted_option);
    if (selected < 1) selected = max;
    selected--;

    const opt_id = options[selected] ?? null;
    log("previous", selected, opt_id);

    $el.autocomplete($el._query ?? "", opt_id);
    $el.highlight_option(opt_id);

    $el._retain_opened = true;
    $el.removeAttribute("selected");
    $el.show_options();
  }



  select_option(opt_id) {
    const $el = this;
    // log("selected", id);
    $el.visited_add(opt_id);

    // Could do an animation of text going to input field
    $el.hide_options();
    $el._retain_opened = false;

    // This action keeps the options list unchanged. We may expect that
    // replacing the text would also update the list with search result for
    // that text, but keeping the list makes it easier to correct selection
    // mistakes, without too much confusion. Any subsequent input events will
    // update the options list.

    const txt = $el.format(opt_id);
    $el.set_input(txt, txt.length, txt.length, "selected");
    $el.highlight_option(opt_id);
    $el.animate_field_flash();
    $el.setAttribute("selected", opt_id);
    $el.dispatchEvent(new Event("change"));
    $el._$inp.blur();
  }



  auto_highlight(opt_id) {
    const $el = this;
    if ($el.parse($el._$inp.value) === opt_id)
      $el.highlight_option(opt_id);
    else
      $el.highlight_option(null);
  }



  highlight_option(opt_id) {
    const $el = this;
    log("Highlight", opt_id);
    $el._highlighted_option = opt_id;
    $el.render_highlight(opt_id);
  }



  async show_options() {
    const $el = this;
    // console.warn("opening");

    if ($el.hasAttribute("opened") && !$el.dataset.anim) return;

    // The process can change direction at any time
    $el.dataset.anim = "opening";

    // log("show_options caps");
    await caps.popover;
    // await caps.anchor_positioning; // wait on slow polyfill loads
    if ($el.dataset.anim !== "opening") return;

    // log("show_options set opened");
    await $el.toggle_options(true);
    if ($el.dataset.anim !== "opening") return;
    delete $el.dataset.anim;

    $el._$inp.scrollIntoViewIfNeeded();

    // May have changed async
    // log("show_options popover");
    $el._$opts.togglePopover(true);

    if (caps.missing.anchor_positioning) {
      $el.render_position_below($el._$opts, $el._$field);
      $el._ev.field_raf_start();
    }

  }



  async toggle_options(force) {
    const $el = this;

    // Skip animations on larger screens. Using the same breakpoint as the
    // css. (Since small screen triggers movement of the field to the top of
    // screen.)

    const should_animate = window.matchMedia('(max-width: 30rem)').matches;
    // log("toggle_options", force, should_animate);
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



  async hide_options() {
    const $el = this;
    // log("closing");

    if (!$el.hasAttribute("opened") && !$el.dataset.anim) return;

    // The process can change direction at any time
    $el.dataset.anim = "closing";

    // log("hide_options popver");
    await $el._$opts.get_close_promise();

    if ($el.dataset.anim !== "closing") return;
    $el._$opts.hidePopover();
    delete $el.dataset.anim;

    if (caps.missing.anchor_positioning) {
      $el._ev.field_raf_stop();
    }

    // log("hide_options set closed");
    await $el.toggle_options(false);

    // log("hide_options done");
  }



  revert() {
    const $el = this;
    // Restore original value. For now, same as removing value
    $el._$inp.value = "";
    log(`»« reverted`)
    $el.handle_search_input("");
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



  async regain_focus() {
    const $el = this;
    const $inp = $el._$inp;

    // Only used for a workaround for autofocus not sticking during page load.
    // Only problem with the anchor_positioning polyfill, so not used now.

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






  // =====  ANIMATIONS  =====


  animate_field_flash() {
    const $el = this;
    const keyframes = [
      {
        color: "white",
        background: $el.css_var("active-color"),
      },
      {
        color: $el.css_var("input-ink"),
        background: $el.css_var("input-bg"),
        offset: .15,
      },
      {
        color: "white",
        background: $el.css_var("active-color"),
        offset: .3,
      },
      {
        color: $el.css_var("selected-ink"),
        background: $el.css_var("selected-bg"),
      },
    ];
    $el._$field.animate(keyframes, 800);
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


  _transitions = new Set();
  _transitions_resolve = null;
  startViewTransition(label, fn) {
    if (!document.startViewTransition) return fn();
    const $el = this;

    const transition = document.startViewTransition(fn);
    // log("view transition", label);

    if (!$el._transitions.size) {
      // log("adding global_onclick listener");
      document.addEventListener("click", global_onclick);
      const done = new Promise(resolve => {
        $el._transitions_resolve = resolve;
      });

      done.then(() => {
        // log("all view transition finished");
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

          // log("replay event to", $target.tagName);
          $target.dispatchEvent(ev);
        }
      });
    }

    $el._transitions.add(transition);

    return transition.finished.then(() => {
      $el._transitions.delete(transition);
      // log("view transition", label, "finished");
      if ($el._transitions.size) return;
      $el._transitions_resolve();
    });
  }





  // =====  SEARCH  =====


  async search() {
    // No search function was set to override this
    throw Error("Don't know where to even begin")
  }



  prepare_options() {
    // override for async process of search result
    return Promise.resolve();
  }



  handle_search_input(txt) {
    const $el = this;

    // $el._accepted = false;
    $el._error = null;
    $el.removeAttribute("selected");

    const query = $el.to_query(txt);

    if (query === $el._query) {
      log(`⮞ »${query}« unchanged`);
      $el.auto_highlight($el._data.rendered.found[0]);
      return;
    }

    const req_id = ++$el._req_id;
    log(`${req_id} ⮞ »${query}« search`);
    if (!query.length) return $el.set_options_from_visited(req_id);

    const promise = $el.get_result_promise(query, req_id);
    $el._query = query;
    promise.then(res => $el.on_result(res));
  }



  get_result_promise(query, req_id) {
    const $el = this;

    /*
    Store the search result promise in $el._memory. Use that promise for
    subsequent searches, regardless of if the search has concluded or not.
    */

    // log(`Search for "${query}"`);

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
    })).then(res => ({
      found: [],
      req: req_id,

      ...res,

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


    // handle slow responses. There may be a newer req, but this is the most
    // recent response.
    if (res.req < $el._data.received.req) return;

    // Show result in order even if more is on the way
    if (res.error) console.error(`${res.req} ⮞`, res.error);
    else if (res.from_memory) log(`${res.req} ⮞ »${res.query}« got ${res.count} results from memory`);
    else log(`${res.req} ⮞ »${res.query}« got ${res.count} results in ${res.speed / 1000} seconds`);

    $el._data.received = res;

    // This error is not normalized. Leaving the details to the renderer.
    // Displayed as part of reder_feedback.
    if (res.error) {
      $el._error = res.error;
      $el.show_error();
    }



    // const $inp = $el._$inp;
    // const pos1 = $inp.selectionStart;
    // const pos2 = $inp.selectionEnd;
    // const txt = $inp.value;
    // log("autocomplete", $el._do_autocomplete ? "" : "SKIP",
    // "latest query", $el._query, "this query", res.query,
    // `»${txt}«(${txt.length}) [${$el._pos1},${$el._pos2}]→[${pos1},${pos2}]`);


    $el.maybe_autocomplete(res);
    $el.auto_highlight(res.found[0]);

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

    // log("render_options");
    try {
      // $el.startViewTransition("render options",() =>
      $el.render_options({
        ...res,

        current_req: $el._req_id, // Searching
        found_req: $el._found_req, // Preparing
        prepared_req: res.req, // Rendering
        previous_req: $el._rendered_req,
        has_focus: $el.has_focus,
        highlight: $el._highlighted_option,
      })
      // );
      $el._data.rendered = res;
    } catch (error) {
      log("render error", error);
      $el._error = error;
      $el.show_error();
    }

    // if ( $el._retain_opened && !res.from_memory ) $el.show_options()
    if ($el.has_focus) $el.show_options()
  }



  // =====  AUTOCOMPLETE  =====


  // Suggests selection by appending text in the input field, to the right of
  // the cursor, and making that text selected. The next typed letter will
  // delete that selected text, add the letter, and repeat the process.

  // This type of autocomplete does not work well with mobile browsers, since
  // their input events isn't atomic. The virtual keyboard will often update
  // the input field value based on older state, missing the added text or the
  // selection. The before_input() event handler tries to keep the text and
  // cursor in place, along with the on_selectionchange() handler.

  autocomplete(base, opt_id) {
    const $el = this;

    // log("autocomplete", base, opt_id);

    // Keep trailing spaces but format the rest
    let text = $el.format(opt_id);
    text += base.slice(text.length);

    // The autocomplete must be in sync with current $inp value
    $el.set_input(text, base.length, text.length, `autocomplete ${opt_id}`);
  }



  maybe_autocomplete(res) {
    const $el = this;

    if (!$el._do_autocomplete) return;
    $el._do_autocomplete = false;

    if ($el._query !== res.query) return;

    const opt_id = res.found[0];
    if (opt_id == null) return;

    const $inp = $el._$inp;
    const pos1 = $inp.selectionStart;
    const pos2 = $inp.selectionEnd;
    let text_base = $inp.value;

    // Only autocomplete if positioned at the end
    if (pos1 < pos2 || pos2 < text_base.length) return;

    $el.autocomplete(text_base, opt_id);
  }






  // =====  HISTORY OF PREVIOUS SELECTION  =====


  _visited = [];
  visited_add(opt_id) {
    const $el = this;

    if (!opt_id.length) return;

    const visited = $el._visited;
    const idx = visited.indexOf(opt_id);
    if (idx !== -1) visited.splice(idx, 1);
    visited.unshift(opt_id);
    if (visited.length > $el._page_size) visited.length = $el._page_size;

    localStorage.setItem("jl-input_visited", JSON.stringify(visited));
  }



  set_options_from_visited(req_id) {
    const $el = this;
    // log("Set opitons from visited");

    // Keep the render order even if visited list changes
    const latest = [...$el._visited];
    const res = {
      ...$el.constructor.data_tmpl,

      req: req_id,
      query: "",
      found: latest,
      count: latest.length,
      from_visited: true,
    };

    // $el._do_autocomplete = false;

    $el.on_result(res);
  }



  setup_visited() {
    const $el = this;
    const visited_raw = localStorage.getItem("jl-input_visited");
    // log("setup visited", visited_raw );
    if (!visited_raw) return;
    $el._visited = JSON.parse(visited_raw);
  }






  // =====  RENDERS  =====


  render_highlight(opt_id) {
    const $el = this;

    // Using indexes is not reliable since the rendering is async and may
    // contain elements that are animating out. The specific item may not yet
    // have been created. Highlight must also be applied in render_options()

    const $ul = $el._$opts.querySelector("ul");
    for (const $li of $ul.children) {
      $li.ariaSelected = ($li.dataset.id === opt_id);
    }
  }



  // override for custom layout
  render_options(res) {
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
    const { found = [], count = 0 } = res;

    const max = Math.min(found.length, $el._page_size);
    // log("render options from", found);

    $el._$opts.classList.toggle("empty", count === 0);

    const added = [];
    const removed = [];
    const highlight = res.highlight;

    const $ul = $el.querySelector("ul");
    const children = [...$ul.children]
      .filter($li => (!$li.classList.contains('exit')));
    let i = 0;
    for (const $child of children) {
      const val = $child.dataset.id;
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
          const highlighted = found[i] === highlight;
          const $new = $el.render_item(found[i], { highlighted });
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
      const highlighted = found[j] === highlight;
      const $new = $el.render_item(found[j], { highlighted });
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

    $el.render_feedback(res);
  }



  render_item(opt_id, { highlighted }) {
    const $el = this;
    const $li = document.createElement("li");
    $li.dataset.id = opt_id;
    $li.ariaSelected = highlighted;
    // $li.style.viewTransitionName = `jl-input-${$el._id}-li-${++$el._li_id}`;
    $el.render_item_content($li, opt_id);
    return $li;
  }



  render_item_content($li, opt_id) {
    const $el = this;
    $li.innerText = $el.format(opt_id);
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



  render_state_html(state) {
    const $el = this;
    // log("render state", state, "html to", El.states[state][0]);
    $el._$state.innerHTML = $el.constructor.states[state][0];
  }



  render_feedback(res) {
    // console.warn("render feedback", query);
    const $el = this;
    if (res.error) return $el.render_error(res.error);
    $el._$feedback.classList.remove("error");
    $el._$feedback.innerHTML = $el.get_feedback(res);
  }



  render_error(error) {
    const $el = this;
    $el._$feedback.classList.add("error");
    $el._$feedback.innerHTML = $el.error_reason(error);
  }



  render_position_below($target, $anchor) {
    const a_rect = $anchor.getBoundingClientRect();
    const { width, bottom, left } = a_rect;
    const t_style = $target.style;
    // log("Position anchor to", { width, bottom, left });
    t_style.width = width + "px";
    t_style.top = bottom + "px";
    t_style.left = left + "px";

  }




}

// log("element defined");






const collator = new Intl.Collator("sv");
const numformat = new Intl.NumberFormat(); // Use locale

// Since event targes are disabled during view transitions, we are
// catching clicks here and replaying them after transition finished.
const global_events = [];
function global_onclick(ev) {
  // log("catched click", ev, ev.target);
  global_events.push(ev);
}



export function load_caps() {
  caps.polyfilled = {};
  caps.missing = {};
  caps.popover = load_polyfill_popover();
  caps.anchor_positioning = load_polyfill_anchor_positioning();
  caps.scroll_into_view = load_polyfill_scroll_into_view();
  caps.user_activation = load_polyfill_user_activation();

  // Also using startViewTransition from View Transitions API


  caps.loaded = new Promise(resolve => {
    window.addEventListener('load', () => setTimeout(resolve, 0), { once: true });
  });

  // return caps;
  for (const [name, promise] of Object.entries(caps)) {
    if (!caps.polyfilled[name]) continue;
    // log("Capability", name);
    promise.then(() => log("Capability", name, "ready"));
  }
  return caps;
}



async function load_polyfill_popover() {
  if (HTMLElement.prototype.togglePopover) return;
  caps.polyfilled.popover = true;
  await import("https://cdn.jsdelivr.net/npm/@oddbird/popover-polyfill@latest");
  return;

  // Hack for handling the polyfill style specificity
  // const popover_css = new CSSStyleSheet();
  // await popover_css.replace(`
  // [popover]:not(.\\:popover-open) { 
  //   height: 0;
  //  }
  // `);
  // document.adoptedStyleSheets.push(popover_css);
  // return;
}



async function load_polyfill_anchor_positioning() {
  if ("anchorName" in document.documentElement.style) return;

  // Since the css-anchor-positioning polyfill doesn't handle shadow-dom, I
  // can do my own progressive enhancement in code.
  return caps.missing.anchor_positioning = true;

  // caps.polyfilled.anchor_positioning = true;
  // const { default: polyfill } = await import("https://unpkg.com/@oddbird/css-anchor-positioning/dist/css-anchor-positioning-fn.js");
  // await polyfill();
  // await sleep(0); // Go to the back of the queue
}


async function load_polyfill_scroll_into_view() {
  if (Element.prototype.scrollIntoViewIfNeeded) return;
  caps.polyfilled.scroll_into_view = true;
  const cnf = { scrollMode: 'if-needed', block: 'nearest' };
  const pkg = await import('https://esm.sh/scroll-into-view-if-needed');
  Element.prototype.scrollIntoViewIfNeeded = function () {
    pkg.default(this, cnf);
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



// eslint-disable-next-line no-unused-vars
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
