import { html, css, LitElement } from "https://para.se/2024/x/lit.mjs";
import { classMap } from "https://para.se/2024/x/lit/directives/class-map.mjs";
// import { until } from "https://para.se/2024/x/lit/directives/until.mjs";
// import { repeat } from "https://para.se/2024/x/lit/directives/repeat.mjs";
// import { ref, createRef } from 'https://para.se./2024/x/lit/directives/ref.mjs';
import { unsafeHTML } from "https://para.se/2024/x/lit/directives/unsafe-html.mjs";

// eslint-disable-next-line no-unused-vars
import { JlSearch, load_caps, sleep } from "../jl-search.mjs";

// eslint-disable-next-line no-unused-vars
const log = console.log.bind(console);

/*
  Prefixes:
  $ : dom element
  h : html string
  t : text string
*/

const LOADING = {};
const symbol_font_url =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:FILL@0..1&display=block";
const symbol_font_promise = import_cssP(symbol_font_url);

const $doc = document.documentElement;

const url_search = "https://wiki.para.se:9071/s/";

const field_style = css`
  :host {
    display: inline-block;

    --padding: 0.75em;
    --line-height: 1.5;
    --disabled-opacity: 0.38;
    --font-family: sans-serif;
    --border-radius: 0.25rem;
    --border-width: 0.15rem;
    --border-width-focus: 0.1875rem;
    --outline-color: var(--c-outline, gray);
    --input-bg: var(--c-surface-bright);
    --input-ink: var(--c-on-surface);
    --selected-bg: var(--c-tertiary-container);
    --selected-ink: var(--c-on-tertiary-container);
    --hover-color: var(--c-on-surface, black);
    --focus-color: var(--c-primary, green);
    --focus-bg: var(--c-surface-dim, lightgray);
    --highlight-bg: var(--c-secondary-container);
    --active-color: var(--c-tertiary-container, orange);
    --disabled-color: var(--c-outline-a33, silver);
    --error-ink: var(--c-error, red);
    --error-container-bg: var(--c-error-container);
    --error-container-ink: var(--c-on-error-container);
  }

  jl-search {
    --hr-color: var(--c-surface-dim, silver);
    --shadow-color: var(--c-shadow, black);

    width: 100%;
  }

  /* Avoid FOUC while main style loads */
  jl-search[init] {
    height: calc(var(--line-height) * 1em + 2 * var(--padding));
  }

  fieldset[init] {
    visibility: hidden;
  }

  @keyframes fade_in {
    0% {
      opacity: 0;
    }

    100% {
      opacity: 1;
    }
  }

  ul > li {
    display: grid;
    box-sizing: border-box;
    grid-template-columns: 15% auto;
    column-gap: var(--padding);
  }

  ul > li > p {
    font-size: 0.8em;
    margin: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
  }

  ul > li > p:not(.is_loading) {
    animation: fade_in 1s linear forwards;
  }

  ul > li > img {
    object-fit: cover;
    /* Center top works much better than golden ratio for most wikipedia image
    thumbs */
    object-position: center top;
    grid-row: span 2;
    width: 100%;
    flex: 0 0 auto;
    aspect-ratio: 1 / 1;
    outline: thin solid var(--outline-color);
    transition: filter 1s, opacity 1s;
  }

  ul > li > img.is_default {
    filter: blur(2px);
    opacity: 0.3;
    outline: none;
  }

  ul > li > img.is_loading {
    filter: blur(3px);
    opacity: 0.1;
    outline: none;
  }
`;

const symbol_style = css`
  .symbol {
    font-family: "Material Symbols Outlined";
    line-height: 1;
    display: inline-block;
    width: 1em;
    overflow: hidden;
    transition: opacity 1.5s;
  }

  jl-search[loading-symbols] .symbol:not(.state) {
    opacity: 0;
  }

  fieldset .symbol {
    font-size: 1.5em;
    /* max set to line-height to not increase total */
    user-select: none;
    padding: calc(var(--_padding) - 0.25em);
  }
`;

const SHARED = {
  render_sync: undefined,
  render_async: undefined,
  in_setup: false,
};

const RECS_P = new Map();
const RECS = new Map();
// const TMPL_meta = new WeakMap();

class JlSearchWiki extends JlSearch {
  async search({ query }) {
    if (query === "i_am_lying") throw Error("BOOM");
    const query_out = encodeURIComponent(query);
    const res = await fetch(url_search + query_out);
    const json = await res.json();
    return json;
  }

  static states = {
    closed: ["expand_more", "Expand"],
    opened: ["expand_less", "Collapse"],
    loading: [JlSearchWiki.spinner, "Loading"],
    error: ["sentiment_very_dissatisfied", JlSearchWiki.prototype.error_reason],
  };

  async prepare_options(q_res) {
    const found = q_res.found;
    const max = Math.min(found.length, this._page_size);
    for (let i = 0; i < max; i++) {
      this.get_rec(found[i]);
    }
  }

  get_rec(opt_id) {
    if (RECS_P.has(opt_id)) return RECS_P.get(opt_id);
    const promise = this.load_rec(opt_id);
    RECS_P.set(opt_id, promise);
    return promise;
  }

  async load_rec(opt_id) {
    const res = await fetch(
      "https://en.wikipedia.org/api/rest_v1/page/summary/" +
        encodeURIComponent(opt_id)
    );
    const rec = await res.json();
    // await sleep(5000);
    RECS.set(opt_id, rec);
    return rec;
  }

  to_query(text) {
    return this.parse(text).toLowerCase();
  }

  // Keeping trailing space allows search for word break
  parse(text) {
    return text.trimStart().replaceAll(/\s+/g, "_");
  }

  format(opt_id) {
    return opt_id.replaceAll("_", " ");
  }

  constructor() {
    super();
    // log("Use shared request_render");
    this.use_mono_render(SHARED.render_sync, SHARED.render_async);
  }

  connectedCallback() {
    // log("jl-search setup start");
    SHARED.in_setup = true;
    super.connectedCallback();
    SHARED.in_setup = false;
    // log("jl-search setup finish");
  }
}

customElements.define(JlSearchWiki.is, JlSearchWiki);

// Could use adoptedStyleSheets but not sure about if anchor_positioning
// polyfill can handle it.
const { pathname } = new URL(import.meta.url);
const style_base = pathname.split("/").slice(0, -2).join("/");

class El extends LitElement {
  static is = "jl-search-wiki";

  static styles = [field_style, symbol_style];

  static properties = {
    autocomplete: { type: Boolean },
  };

  constructor() {
    super();
    this._loaded_symbols = false;
    this.setup_symbols();
    load_caps();

    this.inputId = "";

    // log("Declare shared request_render");
    // No render jl-search should cause side effect. But the first render of
    // jl-search (connectedCallback) will trigger render calls for setup.

    let dirty = false;
    SHARED.render_sync = ($el, reason) => {
      if (SHARED.in_setup) return;
      // log("sync", reason, this.isUpdatePending);
      this.update();
      dirty = false;
    };

    // Bundling not needed, but requestUpdate() is needlessly fast and may be
    // called and finish several times for one action. Could use setTimeout,
    // but don't need several async updates per frame anyway.
    SHARED.render_async = ($el, reason) => {
      if (SHARED.in_setup) return;
      // log("async", reason, dirty ? "BATCHED" : "");
      if (dirty) return;
      dirty = true;
      requestAnimationFrame(() => {
        if (!dirty) return;
        dirty = false;
        this.requestUpdate();
      });
    };
  }

  render() {
    // log("render");

    // For now, the init property is not handled by lit.

    return html`
      <link
        rel="stylesheet"
        @load=${this.on_style}
        href="${style_base}/jl-search.css"
      />
      <jl-search
        init
        ?loading-symbols=${!this._loaded_symbols}
        ?autocomplete=${this.autocomplete}
      >
        <fieldset init>${this.h_fieldset()}</fieldset>
        <nav>${this.h_nav()}</nav>
      </jl-search>
    `;
  }

  h_fieldset() {
    const $jls = this.$jls;

    let h_state = "",
      t_tip = "";
    const state = $jls?.dataset.state;

    if (state) {
      const JLS = this.$jls.constructor;
      // log("get state html from", state, JLS.states[state]);
      h_state = unsafeHTML(JLS.states[state][0]);
      t_tip = $jls.get_tooltip(state);
    }

    // log("input-id", this.inputId, this.getAttribute("input-id"), this.xyZ);

    return html`
      <span class="symbol">dictionary</span>
      <input id=${this.inputId} placeholder="wikipedia articles" />
      <span class="state symbol" title=${t_tip}>${h_state}</span>
    `;
  }

  h_nav() {
    const $jls = this.$jls;
    if (!$jls) return;
    // log("prepared", $jls._data.prepared);

    const res = $jls._data.prepared;
    const found = res?.found ?? [];
    found.length = Math.min(found.length, $jls._page_size);

    // ${repeat(
    //   found,
    //   (opt) => opt,
    //   (opt) => this.h_item(opt)
    // )}

    const t_feedback = res.error
      ? $jls.error_reason(res.error)
      : $jls.get_feedback(res);

    return html`
      <section>
        <hr />
        <ul>
          ${found.map((opt) => this.h_item(opt))}
        </ul>
        <hr />
        <footer class=${classMap({ error: res.error })}>${t_feedback}</footer>
      </section>
    `;
  }

  h_item(opt_id) {
    const $jls = this.$jls;
    // log("Draw", opt_id);

    const title = $jls.format(opt_id);
    const rec = RECS.get(opt_id);

    // Redo when we got a record with a possible img src
    if (!rec) RECS_P.get(opt_id).then(SHARED.render_async);
    const t_selected = $jls._highlighted_option === opt_id ? "true" : "false";

    return html`
      <li data-id="${opt_id}" aria-selected=${t_selected}>
        ${this.h_img(opt_id)}
        <b>${title}</b>
        ${this.h_desc(opt_id)}
      </li>
    `;
  }

  h_img(opt_id) {
    // lit until() directive will replace the element every time if a promise
    // is returned, causing the img to be re-created every time. Also, we need
    // to transition the src on the same image for the fade-in effect. So
    // return the same html template here but with content depending on
    // promise.

    const rec = RECS.get(opt_id);
    let src = rec?.thumbnail?.source;
    const is_loading = !rec || (src && !rec.img_loaded);

    let is_default = false;
    if (!src) {
      is_default = true;
      src =
        "https://upload.wikimedia.org/wikipedia/commons/" +
        "thumb/8/80/Wikipedia-logo-v2.svg/225px-Wikipedia-logo-v2.svg.png";
    }

    return html`<img
      src=${src}
      @load=${(ev) => this.on_img_loaded(opt_id, ev)}
      class=${classMap({ is_default, is_loading })}
    />`;
  }

  on_img_loaded(opt_id, ev) {
    const rec = RECS.get(opt_id);
    if (!rec) return;
    rec.img_loaded = true;
    // log("loaded", opt_id);
    SHARED.render_async();
  }

  h_desc(opt_id) {
    // Same as h_img. For animations, we need to return the same <p> tag
    // regardless of loading state. Can't use until()

    const rec = RECS.get(opt_id);

    const t_desc = rec?.description ?? "";
    const is_loading = !rec;

    return html`<p class=${classMap({ is_loading })}>${t_desc}</p>`;

    // const rec = await rec_p;
    return rec.description ?? "";
  }

  async firstUpdated() {
    // await customElements.whenDefined("jl-search");
    this.$jls = this.$$("jl-search");
    // log("jl-search defined");
    // this.$jls.use_mono_render(() => this.requestUpdate());
    // log("Monorender ready");
  }

  $$(selector) {
    return this.shadowRoot?.querySelector(selector);
  }

  async setup_symbols() {
    await symbol_font_promise;
    // await import_cssP(symbol_font_url);
    await document.fonts.load("1em Material Symbols Outlined");
    // this.$$("jl-search").classList.add('loaded-symbols');
    this._loaded_symbols = true;
    this.requestUpdate();
  }

  static style_var_default = {
    "--jl-search_move-speed": "0.25s",
  };

  on_style() {
    // Some variables has to be placed in :root
    const root_style_computed = getComputedStyle($doc);
    const cls = this.constructor;
    for (const css_var of Object.keys(cls.style_var_default)) {
      if (root_style_computed.getPropertyValue(css_var).length) continue;
      const val = cls.style_var_default[css_var];
      // log("Set dot style", css_var, val);
      $doc.style.setProperty(css_var, val);
    }

    // log("fieldset init");
    this.$$("fieldset").removeAttribute("init");
  }
}

export function import_cssP(url, type) {
  if (LOADING[url]) return LOADING[url];

  if (url.match(/^\./)) {
    throw new Error(
      `Importing relative url ${url}\nYou are likely to be eaten by a grue`
    );
  }

  return (LOADING[url] = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.setAttribute("href", url);

    link.onload = () => resolve(link);
    link.onerror = (err) => reject(err);

    document.head.appendChild(link);
  }));
}

customElements.define(El.is, El);
