const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const code=fs.readFileSync(require('node:path').join(__dirname,'../assets/brizy-bridge.js'),'utf8');
const row=(extra='')=>`<section class="brz-section"><div class="brz-container"><div class="brz-row__container" id="original"><div class="brz-row"><div class="brz-columns"><div class="brz-column__items"><div class="brz-wrapper"><div class="brz-wp-title"><span class="brz-wp-title-content">Title</span></div></div><div class="brz-wrapper"><div class="brz-wp-post-content"><p>Original text</p></div></div><div id="preserved-icons">Icons</div></div></div><div class="brz-columns"><div class="brz-column__items"><div class="brz-wrapper"><div class="brz-image"><picture><source srcset="a.jpg"><img src="a.jpg"></picture>${extra}</div></div></div></div></div></div></div></section>`;
function setup(content){
 const dom=new JSDOM(`<main class="brz">${content}</main><template data-ppg-brizy><section data-ppg class="ppg"><div class="ppg-copy"></div></section></template>`,{runScripts:'outside-only'});
 Object.defineProperty(dom.window.document,'readyState',{value:'complete'});
 let tick;dom.window.setInterval=cb=>{tick=cb;return 1;};dom.window.clearInterval=()=>{};
 let initialized=0;dom.window.PortareProductGallery={init(){initialized++;}};
 dom.window.eval(code);
 return {dom,doc:dom.window.document,tick:()=>tick(),init:()=>initialized};
}
test('supported image-only row mounts and retains supplemental content',()=>{const s=setup(row());assert.equal(s.doc.querySelectorAll('[data-ppg]').length,1);assert.equal(s.doc.querySelector('#original').hidden,true);assert.ok(s.doc.querySelector('.ppg-preserved #preserved-icons'));assert.equal(s.init(),1);s.dom.window.close();});
test('image plus authored paragraph fails closed',()=>{const s=setup(row('<p id="authored">Do not hide me</p>'));assert.equal(s.doc.querySelector('[data-ppg]'),null);assert.equal(s.doc.querySelector('#original').hidden,false);assert.equal(s.doc.querySelector('#authored').textContent,'Do not hide me');s.dom.window.close();});
test('image plus embed fails closed',()=>{const s=setup(row('<iframe src="about:blank"></iframe>'));assert.equal(s.doc.querySelector('[data-ppg]'),null);assert.equal(s.doc.querySelector('#original').hidden,false);s.dom.window.close();});
test('late hydration leaves no contradictory notice',()=>{const s=setup('');assert.equal(s.doc.querySelector('.ppg-mount-notice'),null);s.doc.querySelector('main').insertAdjacentHTML('beforeend',row());s.tick();assert.ok(s.doc.querySelector('[data-ppg]'));assert.equal(s.doc.querySelector('.ppg-mount-notice'),null);s.dom.window.close();});
test('successful hydration removes a bridge-owned old notice',()=>{const s=setup('');s.doc.querySelector('main').insertAdjacentHTML('beforeend','<p class="ppg-mount-notice" data-ppg-bridge-notice="1">old</p>'+row());s.tick();assert.ok(s.doc.querySelector('[data-ppg]'));assert.equal(s.doc.querySelector('.ppg-mount-notice'),null);s.dom.window.close();});
test('unsupported layout warns only after bounded retries',()=>{const s=setup('');for(let i=0;i<19;i++)s.tick();assert.equal(s.doc.querySelector('.ppg-mount-notice'),null);s.tick();assert.equal(s.doc.querySelectorAll('.ppg-mount-notice').length,1);s.dom.window.close();});
test('explicit shortcode wins over auto placement',()=>{const s=setup('<section data-ppg class="explicit"></section>'+row());assert.equal(s.doc.querySelectorAll('[data-ppg]').length,1);assert.equal(s.doc.querySelector('#original').hidden,false);s.dom.window.close();});
