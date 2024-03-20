import { JlSearch, load_caps } from "../jl-search.mjs";

// eslint-disable-next-line no-unused-vars
const log = console.log.bind(console);

const LOADING = {};
const symbol_font_url =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:FILL@0..1&display=block";
const symbol_font_promise = import_cssP(symbol_font_url);

const url_search = "https://wiki.para.se:9071/s/";

const html = String.raw;
const css = String.raw;

const style = css`
  :host {
    max-width: 25em;
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

  ul > li > img.default {
    filter: blur(2px);
    opacity: 0.3;
    outline: none;
  }

  .symbol {
    font-family: "Material Symbols Outlined";
    line-height: 1;
    display: inline-block;
    width: 1em;
    overflow: hidden;
    transition: opacity 1.5s;
  }

  fieldset[init] .symbol:not(.state) {
    opacity: 0;
  }
  
  fieldset .symbol {
    font-size: 1.5em;
    /* max set to line-height to not increase total */
    user-select: none;
    padding: calc(var(--_padding) - 0.25em);
  }
`;

const template = html`
  <style>
    ${style}
  </style>
  <fieldset init>
    <span class="symbol">dictionary</span>
    <input placeholder="wikipedia articles" name="serach" />
    <span class="state symbol"></span>
  </fieldset>
  <nav>
    <section>
      <hr />
      <ul></ul>
      <hr />
      <footer></footer>
    </section>
  </nav>
`;

class JlSearchWiki extends JlSearch {
  $$(sel) {
    return this.shadowRoot.querySelector(sel);
  }

  async search({ query }) {
    
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
      "https://en.wikipedia.org/api/rest_v1/page/summary/" +
        encodeURIComponent(opt_id)
    );
    return await res.json();
  }

  render_item_content($li, opt_id) {
    const recs = this.constructor.recs;
    const rec_p = recs.get(opt_id);
    const title = this.format(opt_id);

    const $img = document.createElement("img");
    const $title = document.createElement("b");
    const $desc = document.createElement("p");

    $img.src =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Wikipedia-logo-v2.svg/225px-Wikipedia-logo-v2.svg.png";
    $img.classList.add("default");
    $title.innerText = title;

    $li.replaceChildren($img, $title, $desc);

    rec_p
      .then((rec) => {
        $desc.innerText = rec.description ?? "";
        if (rec.thumbnail) {
          $img.src = rec.thumbnail.source;
          $img.classList.remove("default");
        }
      })
      .catch((err) => {
        console.warn("Failed to get", opt_id, err);
      });
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
    this.attachShadow({ mode: "open" });

    this.setup();
  }

  async setup() {
    load_caps();

    await this.setup_style();
    const $root = this.shadowRoot;
    // log("Using template");
    $root.innerHTML = template;
    $root.querySelector(".state").innerHTML = this.spinner;

    await symbol_font_promise;
    await document.fonts.load("1em Material Symbols Outlined");
    $root.querySelector("fieldset").removeAttribute("init");

    this.setup_dom();
  }

  async setup_style() {
    // The jl-search.css that prefixes the selectors with jl-search so they can
    // be used in Light dom. We load the styles here and convert them for living
    // in the shadow.

    const style_url = new URL("../jl-search.css", import.meta.url);
    const res = await fetch(style_url);
    const text = await res.text();

    // Assuming the host will not use selectors with chars here used for
    // regexp. Avoid space or > in host selector
    const shroud = new RegExp(/^\s*jl-search([^ {>]*)/);
    const shrouded = text.split("\n").map(row => {
      const match = row.match(shroud);
      if (!match) return row;
      const [host_old, selector] = match;
      const host_new = selector ? `:host(${selector})` : ":host";
      return row.replace(host_old, host_new);
    }).join("\n");
    // log(shrouded);

    const css = new CSSStyleSheet();
    await css.replace(shrouded);
    this.shadowRoot.adoptedStyleSheets.push(css);
  }
}

customElements.define(JlSearchWiki.is, JlSearchWiki);

export function import_cssP(url, type) {
  if (LOADING[url]) return LOADING[url];

  return (LOADING[url] = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.setAttribute("href", url);

    link.onload = () => resolve(link);
    link.onerror = (err) => reject(err);

    document.head.appendChild(link);
  }));
}
