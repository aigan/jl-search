import { html, css, LitElement } from "https://para.se/2024/x/lit.mjs";
import { classMap } from 'https://para.se/2024/x/lit/directives/class-map.mjs';
import { JlSearch, load_caps } from "../../jl-search.mjs";

// eslint-disable-next-line no-unused-vars
const log = console.log.bind(console);

const LOADING = {};
const symbol_font_url = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:FILL@0..1&display=block";
const symbol_font_promise = import_cssP(symbol_font_url);

const $doc = document.documentElement;

const url_search = "https://wiki.para.se:9071/s/";



const field_style = css`

:host {
  display: inline-block;

    --padding: .75em;
    --lineheight: 1.5;
    --disabled-opacity: .38;
    --font-family: sans-serif;
    --border-radius: .25rem;
    --border-width: .15rem;
    --border-width-focus: .1875rem;
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
  --input-height: calc(var(--lineheight) * 1em + 2 * var(--padding));

  width: 100%;

}


/* Avoid FOUC while main style loads */
jl-search[init] {
  height: var(--input-height);
}

jl-search[init]>* {
  display: none;
}


@keyframes fade_in {
    0% {
      opacity: 0
    }

    100% {
      opacity: 1
    }
  }

  jl-search ul>li {
    display: grid;
    grid-template-columns: 15% auto;
    column-gap: var(--padding);
  }

  ul>li>p {
    font-size: .8em;
    margin: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
    animation: fade_in 1s linear forwards;
  }

  ul>li>img {
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

  ul>li>img.default {
    filter: blur(2px);
    opacity: .3;
    outline: none;
  }

`;

const symbol_style = css`
  .symbol {
    font-family: 'Material Symbols Outlined';
    line-height: 1;
    display: inline-block;
    width: 1em;
    overflow: hidden;
    transition: opacity 1.5s;
  }

  jl-search:not(.loaded-symbols) .symbol {
    opacity: 0;
  }

jl-search>fieldset .symbol {
  font-size: 1.5em;
  /* max set to line-height to not increase total */
  user-select: none;
  padding: calc(var(--_padding) - .25em);
}
`;


class JlSearchWiki extends JlSearch {
  async search({ query }) {
    const query_out = encodeURIComponent(query);
    const res = await fetch(url_search + query_out);
    const json = await res.json();
    return json;
  }

  static states = {
    closed: ['expand_more', "Expand"],
    opened: ['expand_less', "Collapse"],
    loading: [JlSearchWiki.spinner, "Loading"],
    error: ["sentiment_very_dissatisfied", JlSearchWiki.prototype.error_reason],
  }

  static recs = new Map();

  async prepare_options(q_res) {
    const found = q_res.found;
    const max = Math.min(found.length, this._page_size);
    const recs_p = [];
    for (let i = 0; i < max; i++) {
      const opt_id = found[i];
      recs_p.push(this.get_rec(opt_id));
    }
  }

  get_rec(opt_id) {
    const recs = this.constructor.recs;
    if (recs.has(opt_id)) return recs.get(opt_id);
    const promise = this.load_rec(opt_id);
    recs.set(opt_id, promise);
    return promise;
  }

  async load_rec(opt_id) {
    const res = await fetch(
      "https://en.wikipedia.org/api/rest_v1/page/summary/"
      + encodeURIComponent(opt_id)
    );
    return await res.json();
  }

  render_item_content($li, opt_id){
    const recs = this.constructor.recs;
    const rec_p = recs.get(opt_id);
    const title = this.format(opt_id);

    const $img = document.createElement("img");
    const $title = document.createElement("b");
    const $desc = document.createElement("p");

    $img.src = "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Wikipedia-logo-v2.svg/225px-Wikipedia-logo-v2.svg.png";
    $img.classList.add("default");
    $title.innerText = title;

    $li.replaceChildren($img, $title, $desc);

    rec_p.then(rec => {
      $desc.innerText = rec.description ?? "";
      if (rec.thumbnail) {
        $img.src = rec.thumbnail.source;
        $img.classList.remove("default");
      }
    }).catch(err => {
      console.warn("Failed to get", opt_id, err);
    })
  }

  to_query(text) { return this.parse(text).toLowerCase() }

  // Keeping trailing space allows search for word break
  parse(text) { return text.trimStart().replaceAll(/\s+/g, "_") }

  format(opt_id) { return opt_id.replaceAll("_", " ") }


}


load_caps();
customElements.define(JlSearchWiki.is, JlSearchWiki);


// Could use adoptedStyleSheets but not sure about if anchor_positioning
// polyfill can handle it.
const { pathname } = new URL(import.meta.url);
const style_base = pathname.split('/').slice(0, -3).join('/');

class El extends LitElement {

  static is = "jl-search-wiki";

  static styles = [field_style, symbol_style];

  static properties = {
    loaded_symbols: { type: Boolean },
  }

  constructor() {
    super();
    this.loaded_symbols = false;
    this.setup_symbols();
  }

  render() {
    const main_class = { 'loaded-symbols': this.loaded_symbols };

    return html`
<link rel="stylesheet"
  @load=${this.on_style} 
  href="${style_base}/jl-search.css"
>
<jl-search init class=${classMap(main_class)}>
<fieldset>
  <span class="symbol">dictionary</span>
  <input placeholder="wikipedia articles">
  <span class="state symbol"></span>
</fieldset>
<nav>
  <section>
    <hr>
    <ul></ul>
    <hr>
    <footer></footer>
  </section>
</nav>
</jl-search>
      `;
  }

  $$(selector) {
    return this.shadowRoot?.querySelector(selector);
  }

  async setup_symbols() {
    await symbol_font_promise;
    // await import_cssP(symbol_font_url);
    await document.fonts.load("1em Material Symbols Outlined");
    // this.$$("jl-search").classList.add('loaded-symbols');
    this.loaded_symbols = true;
  }

  static style_var_default = {
    "--jl-search_move-speed": "0.25s",
  }

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
  }

}

export function import_cssP(url, type) {
  if (LOADING[url]) return LOADING[url];

  if (url.match(/^\./)) {
    throw new Error(`Importing relative url ${url}\nYou are likely to be eaten by a grue`);
  }

  return LOADING[url] = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('href', url);

    link.onload = () => resolve(link);
    link.onerror = err => reject(err);

    document.head.appendChild(link);
  })
}

customElements.define(El.is, El);
