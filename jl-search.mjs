const log = console.log.bind(console);

const glyphs = {
  spinner: "\uD83D\uDCC0",
  warning: "\u26A0",
}

const collator = new Intl.Collator("sv");

class El extends HTMLElement {
  static is = "jl-input"

  static states = {
    loading: ['spinner', "Loading value"],
    flux: ['warning', El.prototype.flux_reason],
    invalid: ['exclamation-circle', El.prototype.invalid_reason],
    error: ['frown-o', El.prototype.error_reason],
    normal: ['circle-thin', ""],
    changed: ['bell', El.prototype.changed_reason],
    updating: ['asterisk', "Data unsaved"],
    repairing: ['wrench', "Correcting data format"],
    saving: ['cloud-upload', "Saving"],
    saved: ['check', "Saved"],
  };

  static properties = {
    lock: Boolean,
  }

  constructor() {
    super();
    const $el = this;

    $el._$inp = $el.querySelector("input");
    $el._ev = undefined;
    $el._selected_index = null;
    $el._accepted = false;
    $el._error = null;
    $el._req_id = 0;
    $el._options_req = 0;
    $el._options = [];
    $el._found_count = 0;
    $el._found_speed = undefined;
    $el._prepared_req = 0;
    $el._memory = new Map();


    // TODO: react on replaced input or input attributes. Remember our own
    // attributes
    $el.adjust_attributes();
    $el.add_listeners();
  }

  connectedCallback() {
    const gel = this;
    // super.connectedCallback();
    log("hello");
  }

  static input_defaults = {
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    // todo: add aria
  }

  adjust_attributes() {
    const $el = this;
    log('adjust attributes');
    const $inp = $el._$inp;

    // Adding defaults
    for (const [attr, value] of Object.entries(El.input_defaults)) {
      if ($inp.hasAttribute(attr)) continue;
      $inp.setAttribute(attr, value);
    }
  }

  add_listeners() {
    const $el = this;
    $el._ev = {
      input: ev => $el.on_input(ev),
      // keydown: ev => $el.on_keydown(ev),
      focus: ev => $el.on_focus(ev),
      // click: ev => $el.on_click(ev),
    }

    const $inp = $el._$inp;
    for (const [type, listener] of Object.entries($el._ev)) {
      $inp.addEventListener(type, listener);
    }
  }

  on_input(ev) {
    const $el = this;
    const $inp = $el._$inp;
    $el.handle_search_input($inp.value);
  }

  on_keydown(ev) {
    log("on_keydown", ev)
  }

  on_focus(ev) {
    const $el = this;
    const $inp = $el._$inp;
    // $el.handle_search_input($inp.value);
  }

  handle_search_input(text_in) {
    const $el = this;

    $el._selected_index = null;
    $el._accepted = false;
    $el._error = null;

    const text = text_in.trim().toLowerCase();
    log("search for", text, text.length);

    if (!text.length) return $el.set_options_from_history();

    const req_id = ++$el._req_id;
    const promise = $el.get_result_promise(text, req_id);
    promise.then(res => $el.on_result(res));
  }

  get_result_promise(text, req_id) {
    const $el = this;
    const time_start = Date.now();

    if ($el._memory.has(text)) return $el._memory.get(text).then(res => ({
      ...res,
      this_req: req_id,
      from_memory: true,
    }))

    const record_p = $el.search({ text, req_id }).then(res => ({
      first_req: req_id,
      this_req: req_id,
      req_sent: time_start,
      speed: (Date.now() - time_start),
      from_memory: false,
      ...res,
    })).catch(err => {
      // console.error(err);
      return {
        error: err,
      }
    })

    $el._memory.set(text, record_p);
    return record_p;
  }

  on_result(res) {
    const $el = this;

    // handle slow responses
    if (res.this_req < $el._options_req) return; // Too late

    // Show result in order even if more is on the way

    if (res.error) console.error(res.error);
    else if (res.from_memory) log("got", res.count, "results from memory");
    else log("got", res.count, "results in", res.speed / 1000, "seconds");

    if (res.error) { 
      log("handle error...");
    }


    $el._options = res.found ?? [];
    $el._options_req = res.this_req;
    $el._found_count = res.count;
    $el._found_speed = res.speed;

    $el.prepare_options(res).then(() => $el.render_options({
      options_req: $el._options_req,
      current_req: $el._req_id,
      prepared_req: res.this_req,
      prepared_query: res.text,
      current_query: $el._$inp.value,
      found: res.found ?? [],
      count: res.count,
      speed: res.speed,
      from_memory: res.from_memory,
      has_focus: $el.has_focus(),
    })).then(() => {
      $el._prepared_req = res.this_req;
      $el.show_options()
    })
  }

  set_options_from_history() {
    const $el = this;
    log("Set opitons from history", $el.has_focus());
    $el._options = [];
    $el.show_options();
  }

  // override for async process of search result
  prepare_options() {
    return Promise.resolve();
  }

  // override for custom layout
  render_options({ found, error }) {
    const max = Math.min(found.length, 10);
    const $el = this;
    log("render options from", found);

    const $ul = $el.querySelector("ul");
    const children = $ul.children;
    let i = 0;
    for (const $child of [...children]) {
      const val = $child.dataset.text;
      outer: while (true) {
        if (i >= max) break;

        const order = collator.compare(val, found[i]);
        log("compare", val, "with", found[i], order);

        switch (order) {
          case -1:
            log("  remove");
            $child.remove();
            break outer;
          case +1:
            log("  insert", found[i], "before", val);
            $ul.insertBefore($el.render_item(found[i]), $child);
            i++;
            continue outer;
          default:
            log("  keep");
            i++;
        }
      }

      if (i >= max) {
        $child.remove();
        continue;
      }
    }

    for (let j = i; j < max; j++) {
      log("append", found[j]);
      $ul.append($el.render_item(found[j]));
    }
  }

  render_item(text) {
    const $li = document.createElement("li");
    $li.innerHTML = text;
    $li.dataset.text = text;
    return $li;
  }

  show_options() {
    const $el = this;
    if (!$el.has_focus()) return;
    if (!$el._options.length) return; // May want to show "no results"


    // log("show results", $el._options);
  }

  has_focus() {
    return this.getRootNode().activeElement === this._$inp;
  }

  // on_click(ev) { log("on_click", ev) }

  show_suggestions() {
    log("show suggestions");
    const $el = this;
    const $inp = $el._$inp;
  }

  h_tip() {
    const gel = this;
    if (!gel.tip) return; //# No falsy tips
    return html` <i class="help_item fa fa-question-circle" title=${gel.tip} />`;
  }


  h_state() {
    const gel = this;
    if (gel.nobox) return;
    const icon = El.states[gel.state || 'loading'][0];

    return html`
      <span class="material-symbols-outlined">error</span>

      <span class="state-loading">${glyphs.spinner}</span>
    `;



    return html`
<span
  id="state"
  class="input-group-text"
  role="button"
  @tap=${() => gel.revert()} 
  title="Revert to latest version"
  > 
	<span class="fa-stack fa-fw">
		<i class="fa fa-refresh fa-stack-1x secondary" />
		<i class="fa fa-${icon} fa-stack-1x primary" />
	</span>
</span>`;
  }

  h_suggestions() {
    return html`<ul popover></ul>`;
  }

  h_feedback() {
    const gel = this;
    //# The warning could be a more recent and specific indication of
    //# the problem
    const feedback_invalid = gel.warning || gel.state_error;
    if (feedback_invalid) return gel.h_error(feedback_invalid);
    return gel.h_valid(gel.feedback);
  }

  h_error(feedback = "") {
    const gel = this;
    //# Bootstrap needs the div, even if empty
    return html`<div class="invalid-feedback d-block">${feedback}</div>`;
  }

  h_valid(feedback = "") {
    //# Bootstrap needs the div, even if empty
    //# Implement for extra stuff
    return html`<div class="valid-feedback d-block">${feedback}</div>`;
  }



}
customElements.define(El.is, El);


/*
Resources
https://open-props.style/
https://getbootstrap.com/docs/5.3/forms/form-control/
https://tailwindui.com/components/application-ui/forms/input-groups
https://material-components.github.io/material-components-web-catalog/#/component/text-field
https://fonts.google.com/icons
https://fonts.google.com/noto/specimen/Noto+Emoji?query=noto+emoji

https://oklch.com/#73.40931506848489,0.3563,81.72,100


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
