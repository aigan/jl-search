import { html, LitElement, css } from 'https://para.se/2024/x/lit.mjs';
import { classMap } from 'https://para.se/2024/x/lit/directives/class-map.mjs';

const log = console.log.bind(console);

let ready_shared = load_conditional_dependencies();
ready_shared.then(() => {
  log("loaded font", document.fonts.check("1em Material Symbols Outlined"))
}).catch(err=>console.error(err));


const style_local = css`
:host {
  display: inline-block;

  --padding: .5rem;
  --shadow: lch(0 0 0 / 0.05);
  --focus: lch(40 95 301);
  --field-bg: white;
  --disabled: lch(35 0 296);
  --border-width: .15rem;
  --border-radius: .35rem;
  --ring-unselected: 0 0 0 var(--border-width) var(--shadow);
  --ring-focus: 0 0 0 var(--border-width) var(--focus);

  font-family: var(--font-family, sans-serif);

    /* color: red; */
}


.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  /* -webkit-font-feature-settings: 'liga'; */
  -webkit-font-smoothing: antialiased;
}

.material-symbols-outlined {
  font-size: inherit;
}


input {
  padding: 0;
  margin: 0;
  border: none;
  outline: none;
  font-family: inherit;
  font-size: inherit;
  color: inherit;
  background-color: transparent;
}

input:focus, input:focus-within {
  outline: none;
  border: none;
}

label[for=input1]{
  display: inline-block;
  padding-bottom:.3rem;
  padding-left: var(--padding);
  /* border: thick solid red; */
}

.input-group {
  box-shadow: var(--ring-unselected);
  display: flex;
  align-items: center;
  gap: var(--padding);

  border-radius: var(--border-radius);
  padding: var(--padding);
  background: var(--field-bg);
  transition: box-shadow .2s;
}

.input-group:focus-within {
  box-shadow: var(--ring-focus);
  /* background: color-mix(in lch, currentcolor, black); */
}

.input-group:has(input:disabled){
  --faded: color-mix(in lch, currentcolor, 60% white );
  color: var(--faded, silver);
}

/* .input-group > * {
  padding: var(--padding);
} */

.state-loading {
  animation: spin 2s infinite linear;
}


@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(359deg); }}

`;


const glyphs = {
  spinner: "\uD83D\uDCC0",
  warning: "\u26A0",
}


class El extends LitElement {
  static is = "jl-search"

  render() { return this.h_nonfloating() }

	static states = {
		loading:  ['spinner',"Loading value"],
		flux:     ['warning', El.prototype.flux_reason],
		invalid:  ['exclamation-circle', El.prototype.invalid_reason],
		error:    ['frown-o', El.prototype.error_reason],
		normal:   ['circle-thin', ""],
		changed:  ['bell', El.prototype.changed_reason],
		updating: ['asterisk',"Data unsaved"],
		repairing:['wrench',"Correcting data format"],
		saving:   ['cloud-upload',"Saving"],
		saved:    ['check', "Saved"],
	};

  static properties = {
    prefix: String,
    label: String,
    default_value: String,
    lock: { type: Boolean },
  }

  static styles = style_local;

  h_nonfloating() {
    const gel = this;
    const txt_placeholder = gel.placeholder || gel.label;
    const classes = {
      "has-validation": true,
      punish: gel.was_invalid,
      reward: gel.show_validity,
      flux: gel.state === 'flux'
    }
    return html`

<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet" />

<div class=${classMap(classes)}>
  ${gel.h_label()}
  <label class="input-group">
    ${gel.h_prefix()}
    ${gel.h_input()}
    ${gel.h_state()}
  </label>
  ${gel.h_suggestions() }
  ${gel.h_feedback()}
</div>
`;
  }

  h_input() {
    const gel = this;
    return html`<input
  type="text"
  id="input1"
  ?required=${gel.required}
  placeholder=${gel.placeholder || ""}
  maxlength=${gel.maxlength || ""}
  ?disabled=${gel.lock}
  value=${gel.default_value}
 >`;
  }

  h_prefix() {
		if (!this.prefix) return;
		return html`<span id="prefix">${this.prefix}</span>`;
 	}
  
  h_label() { 
    const gel = this;
		if( !gel.label ) return;
		return html`<label for="input1">${gel.label}${gel.h_tip()}</label>`;

  }

  h_tip()
	{
		const gel = this;
		if( !gel.tip ) return; //# No falsy tips
		return html` <i class="help_item fa fa-question-circle" title=${gel.tip} />`;
	}


	h_state(){
		const gel = this;
		if( gel.nobox ) return;
		const icon = El.states[gel.state||'loading'][0];

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
		return html`<div class="invalid-feedback d-block">${ feedback }</div>`;
	}
	
	h_valid( feedback="" ){
		//# Bootstrap needs the div, even if empty
		//# Implement for extra stuff
		return html`<div class="valid-feedback d-block">${feedback}</div>`;
	}

  // connectedCallback() { 
  //   super.connectedCallback();
  //   log('connect', document.head);
  //   load_fonts();
  // }

  async scheduleUpdate() {
    await ready_shared;
    super.scheduleUpdate();
  }


}
customElements.define(El.is, El);

function load_conditional_dependencies() { 
  return load_fonts1()
}

function load_fonts() { 
  const font = new FontFace(
    "Material Symbols Outlined",
    "url(https://fonts.gstatic.com/s/materialsymbolsoutlined/v161/kJF1BvYX7BgnkSrUwT8OhrdQw4oELdPIeeII9v6oDMzByHX9rA6RzazHD_dY43zj-jCxv3fzvRNU22ZXGJpEpjC_1v-p_4MrImHCIJIZrDCvHOej.woff2)"
  );
  document.fonts.add(font);
  return font.load();
}

function load_fonts1() { 
  const symbols_style_url = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:FILL@1";
  const found = document.querySelector(`link[href="${symbols_style_url}"]`);
  if (found) return Promise.resolve();

  return new Promise((resolve, reject) =>{
    const $link = document.createElement('link');
    $link.setAttribute('rel', 'stylesheet');
    $link.setAttribute('href', symbols_style_url);
    $link.onload = () => {
      log('loaded link');
      document.fonts.load("1em Material Symbols Outlined").then(resolve,reject);
    }
    $link.onerror = err => reject(Error(`Failed loading stylesheet ${symbols_style_url}`))

    document.head.appendChild($link);
  });
}

/*
Resources
https://open-props.style/
https://getbootstrap.com/docs/5.3/forms/form-control/
https://tailwindui.com/components/application-ui/forms/input-groups
https://material-components.github.io/material-components-web-catalog/#/component/text-field
https://fonts.google.com/icons
https://fonts.google.com/noto/specimen/Noto+Emoji?query=noto+emoji



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
