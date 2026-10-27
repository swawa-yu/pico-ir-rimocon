const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const Blockly=require('../docs/vendor/blockly/blockly_compressed.js');
require('../docs/vendor/blockly/blocks_compressed.js');
Object.assign(Blockly.Msg,require('../docs/vendor/blockly/msg/ja.js'));
const {pythonGenerator}=require('../docs/vendor/blockly/python_compressed.js');

function studio(exec,stored={},hash=''){
  const dom=new JSDOM(fs.readFileSync('docs/studio.html','utf8'),{url:'http://localhost/'+hash,runScripts:'outside-only'});
  const w=dom.window,calls=[];
  Blockly.utils.xml.injectDependencies({document:w.document,DOMParser:w.DOMParser,XMLSerializer:w.XMLSerializer});
  const workspace=new Blockly.Workspace();
  workspace.registerToolboxCategoryCallback=()=>{};workspace.scrollCenter=()=>{};
  const device={id:'2',port:{},busy:false,running:false,task:'program',
    async exec(code){calls.push(['write',code]);return exec(code);},
    async run(code){calls.push(['run',code]);this.running=true;},
    async stop(){calls.push(['stop']);this.running=false;},
    async interrupt(){calls.push(['interrupt']);this.running=false;},
    async repl(source){calls.push(['repl',source]);},
    async sendInput(text){calls.push(['stdin',text]);}
  };
  const workspaces=[workspace];
  w.Blockly=Object.create(Blockly);w.Blockly.inject=id=>{if(id==='blockly')return workspace;const ws=new Blockly.Workspace();ws.registerToolboxCategoryCallback=()=>{};workspaces.push(ws);return ws;};w.Blockly.svgResize=()=>{};
  w.python={pythonGenerator};
  w.StudioBlockSelection=require('../docs/block-selection.js');w.PicoBlocks=require('../docs/pico-blocks.js');w.StudioFiles=require('../docs/studio-files.js');
  w.StudioSamples=require('../docs/studio-samples.js');w.PicoSources=require('../docs/pico-sources.js');w.PicoProject={...require('../docs/pico-project.js'),async upload(device,files){calls.push(['write',files]);return JSON.parse(await exec(files));}};
  const links={};let linkNumber=0;
  w.PicoREPL=function(callbacks){const id=String(++linkNumber),link=id==='2'?device:{...device,id};Object.assign(link,callbacks);links[id]=link;return link;};
  w.eval(fs.readFileSync('docs/pico-devices.js','utf8'));
  for(const entry of w.PicoDevices.devices){entry.state='connected';entry.task='program';}
  w.PicoDevices.select('program','2');w.PicoDevices.select('observer','2');
  const forRole=w.PicoDevices.forRole.bind(w.PicoDevices);w.PicoDevices.forRole=(role,watcher)=>{if(role==='program')w.deviceWatcher=watcher;return forRole(role,watcher);};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};

  w.eval(fs.readFileSync('docs/vendor/codemirror/editor.js','utf8'));
  w.structuredClone=global.structuredClone;
  w.PicoEditor={extraction:w.PicoEditor.extraction,definitions:w.PicoEditor.definitions,symbols:w.PicoEditor.symbols,blocks:w.PicoEditor.blocks,step:w.PicoEditor.step,create:(_element,callbacks)=>{w.editorCallbacks=callbacks;return {setFile(){},cursor(){return w.editorPosition||0;},goTo(position){calls.push(['position',position]);},setReadOnly(value){calls.push(['readonly',value]);},highlightLines(range){calls.push(['highlight',range]);},goLine(line){calls.push(['line',line]);}};}};
  w.LiveAnalyzer={show(){}};w.SignalConverter={show(){calls.push(['conversion-show']);}};
  w.ResizeObserver=class{observe(){}};
  w.HTMLElement.prototype.scrollIntoView=function(){calls.push(['scroll',this.id]);};
  for(const [key,value] of Object.entries(stored))w.localStorage.setItem(key,value);
  w.eval(fs.readFileSync('docs/block-studio.js','utf8'));
  return {window:w,device,links,calls,workspaces,$:id=>w.document.getElementById(id),close(){for(const ws of workspaces)ws.dispose();dom.window.close();for(const type of Object.keys(Blockly.Blocks))if(type.startsWith('pico_'))delete Blockly.Blocks[type];}};
}

test('one click writes and runs without confirmation, keeps the shared console visible, and enables input until stopped',async()=>{
  let finishWrite;
  const s=studio(()=>new Promise(resolve=>finishWrite=resolve));
  try{
    s.$('run').click();s.$('run').click();
    assert.equal(s.$('console-panel').tagName,'SECTION');assert(s.$('run').disabled);
    assert.equal(s.$('console-panel').closest('[role=tabpanel]'),null);
    assert.equal(s.calls.filter(c=>c[0]==='scroll').length,0);
    s.$('analyzer-tab').click();assert.equal(s.$('console-panel').hidden,false);
    s.$('program-tab').click();
    assert.equal(s.window.document.querySelector('dialog[open]'),null);
    assert.equal(s.calls.filter(c=>c[0]==='write').length,1);
    assert.equal(s.calls.filter(c=>c[0]==='run').length,0);
    finishWrite(JSON.stringify({backup:'.pico-studio-1',changed:3}));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(s.calls.filter(c=>c[0]==='run').length,1);
    assert.equal(s.$('console-input').disabled,false);assert.equal(s.$('stop').disabled,false);
    s.$('stop').click();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(s.device.running,false);assert.equal(s.$('run').disabled,false);assert.equal(s.$('console-input').disabled,false);
  }finally{s.close();}
});

test('a failed write remains visible in the console, does not run the program and permits retry',async()=>{
  const s=studio(async()=>{throw Error('no space');});
  try{
    s.$('run').click();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(s.$('console-panel').tagName,'SECTION');assert.match(s.$('output').textContent,/no space/);
    assert.equal(s.calls.filter(c=>c[0]==='run').length,0);
    assert.equal(s.$('run').disabled,false);assert.equal(s.$('stop').disabled,true);
  }finally{s.close();}
});

test('each file keeps its editable blocks and unsupported Python survives text edits and switching',async()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  const fileButton=name=>[...s.$('file-tree').querySelectorAll('button')].find(b=>b.title===name);
  fileButton('parts.py').click();
  assert.equal(s.$('blockly').hidden,true);assert.equal(s.$('file-blockly').hidden,false);
  s.window.editorCallbacks.onChange('parts.py','import time\n\nclass Custom:\n    pass\n');
  const ws=s.workspaces[1];
  const klass=ws.getAllBlocks(false).find(b=>b.type==='pico_class');assert(klass);
  klass.setFieldValue('Renamed','HEADER');
  fileButton('main.py').click();
  assert.equal(s.$('blockly').hidden,true);assert.equal(s.$('file-blockly').hidden,false);
  fileButton('parts.py').click();
  assert.equal(ws.getAllBlocks(false).find(b=>b.type==='pico_class').getFieldValue('HEADER'),'Renamed');
  s.$('run').click();await new Promise(resolve=>setImmediate(resolve));
  const written=s.calls.find(c=>c[0]==='write')[1];
  assert.match(written['parts.py'],/class Renamed:\n    pass/);
 }finally{s.close();}
});

test('the terminal sends commands and program input in place, supports Ctrl+C and shows its own Pico state',async()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  const input=s.$('console-input');input.value='print(42)';input.dispatchEvent(new s.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  await new Promise(resolve=>setImmediate(resolve));assert(s.calls.some(c=>c[0]==='repl'&&c[1]==='print(42)'));
  assert.match(s.$('output').textContent,/>>> print\(42\)/);assert.match(s.$('console-state').textContent,/Pico 2.*接続済み/);
  s.$('run').click();await new Promise(resolve=>setImmediate(resolve));
  input.value='hello';input.dispatchEvent(new s.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await new Promise(resolve=>setImmediate(resolve));
  assert(s.calls.some(c=>c[0]==='stdin'&&c[1]==='hello'));assert.match(s.$('console-state').textContent,/実行中/);
  input.dispatchEvent(new s.window.KeyboardEvent('keydown',{key:'c',ctrlKey:true,bubbles:true,cancelable:true}));await new Promise(resolve=>setImmediate(resolve));assert.equal(s.device.running,false);
 }finally{s.close();}
});

test('creating and renaming a folder keeps its custom blocks and writes the resulting package paths',async()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};s.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  s.$('folder-create').click();s.$('file-path-input').value='tools';s.$('file-dialog-apply').click();
  s.$('file-create').click();s.$('file-path-input').value='tools/calc.py';s.$('file-dialog-apply').click();
  s.window.editorCallbacks.onChange('tools/calc.py','def twice(x):\n    return x*2\n');
  s.$('file-tree').querySelector('details[data-path="tools"] summary').click();
  s.$('file-rename').click();s.$('file-path-input').value='helpers';s.$('file-dialog-apply').click();
  assert.equal(s.$('file-tree').querySelector('[aria-current=true]').title,'helpers/calc.py');
  assert(s.workspaces[1].getAllBlocks(false).some(b=>b.type==='pico_def'));
  s.$('run').click();await new Promise(resolve=>setImmediate(resolve));
  const written=s.calls.find(c=>c[0]==='write')[1];
  assert.equal(written['helpers/__init__.py'],'');assert.match(written['helpers/calc.py'],/def twice/);assert.equal(written['tools/calc.py'],undefined);
 }finally{s.close();}
});

test('opening another project safely leaves a custom file that no longer exists',async()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  const original=s.window.localStorage.getItem('pico-blocks-project-2');
  s.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};s.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  s.$('file-create').click();s.$('file-path-input').value='scratch.py';s.$('file-dialog-apply').click();
  assert.equal(s.$('file-tree').querySelector('[aria-current=true]').title,'scratch.py');
  s.window.confirm=()=>true;
  Object.defineProperty(s.$('project-file'),'files',{value:[{size:original.length,async text(){return original;}}]});
  s.$('project-file').dispatchEvent(new s.window.Event('change'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(s.$('file-tree').querySelector('[aria-current=true]').title,'main.py');assert.doesNotMatch(s.$('file-tree').textContent,/scratch/);
 }finally{s.close();}
});


test('real-device step controls highlight the original line, advance through USB input, and unlock after stop',async()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.$('step-start').click();await new Promise(resolve=>setImmediate(resolve));
  const launched=s.calls.find(c=>c[0]==='run')[1],token=launched.match(/PICO_STEP:([a-z0-9]+):/)[1];
  assert(s.calls.some(c=>c[0]==='readonly'&&c[1]===true));
  s.window.deviceWatcher.onOutput('\x1ePICO_STEP:'+token+':2\x1f');
  assert.equal(s.$('step-next').hidden,false);assert.equal(s.$('step-next').disabled,false);
  assert.match(s.$('step-position').textContent,/main.py:2/);
  assert(s.calls.some(c=>c[0]==='highlight'&&c[1]?.from===2));
  assert.equal(s.$('console-input').disabled,true);
  assert.doesNotMatch(s.$('output').textContent,/PICO_STEP/);
  s.$('step-next').click();await new Promise(resolve=>setImmediate(resolve));
  assert(s.calls.some(c=>c[0]==='stdin'&&c[1]===''));
  assert.equal(s.$('step-next').disabled,true);assert.equal(s.$('console-input').disabled,false);
  s.$('stop').click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(s.$('step-next').hidden,true);assert.equal(s.$('step-start').disabled,false);
  assert(s.calls.some(c=>c[0]==='readonly'&&c[1]===false));
 }finally{s.close();}
});

test('write-only preserves console output, blocks terminal input throughout transfer, and finishes without running main.py',async()=>{
 let finishWrite;const s=studio(()=>new Promise(resolve=>finishWrite=resolve));
 try{
  s.$('output').textContent='previous result\n';
  s.$('write-only').click();
  assert.equal(s.calls.filter(c=>c[0]==='write').length,1);
  assert.match(s.$('output').textContent,/previous result\n[\s\S]*書き込み中/);
  assert.equal(s.$('console-input').disabled,true);assert.equal(s.$('console-input').placeholder,'書き込み中…');
  assert.equal(s.$('console-prompt').textContent,'');assert.match(s.$('console-state').textContent,/書き込み中/);
  assert(s.$('run').disabled&&s.$('write-only').disabled&&s.$('step-start').disabled);
  s.device.busy=true;s.device.running=true;s.window.deviceWatcher.onState('running');
  assert.equal(s.$('console-prompt').textContent,'');assert.match(s.$('console-state').textContent,/書き込み中/);
  s.$('console-input').value='print(99)';s.$('console-input').dispatchEvent(new s.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  assert.equal(s.calls.filter(c=>c[0]==='stdin'||c[0]==='repl').length,0);
  s.device.busy=false;s.device.running=false;finishWrite(JSON.stringify({backup:'.pico-studio-2',changed:1}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(s.calls.filter(c=>c[0]==='run').length,0);assert.equal(s.device.running,false);
  assert.match(s.$('output').textContent,/previous result[\s\S]*書き込み完了[\s\S]*\.pico-studio-2/);
  assert.equal(s.$('console-input').disabled,false);assert.equal(s.$('console-prompt').textContent,'>>>');
  assert.equal(s.$('write-only').disabled,false);assert.equal(s.$('run').disabled,false);
 }finally{s.close();}
});

test('fan sample replaces the whole project with its own PWM files and configuration',async()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.$('example').value='fan';s.$('example-load').click();
  assert.match(s.$('parts-rows').textContent,/PWM出力/);
  s.$('write-only').click();await new Promise(resolve=>setImmediate(resolve));
  const files=s.calls.find(c=>c[0]==='write')[1];
  assert.match(files['main.py'],/rp2\.bootsel_button\(\)[\s\S]*fan\.set\(50\)[\s\S]*fan\.set\(0\)/);
  assert.match(files['parts.py'],/fan = PWMOutput\(20, frequency=25000\)/);
  assert.doesNotMatch(files['parts.py'],/infrared = Infrared/);
 }finally{s.close();}
});

for(const sample of ['receive','receive_custom'])test(sample+' installs editable capture and conversion sources with the configured receiver',async()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.$('example').value=sample;s.$('example-load').click();
  s.$('write-only').click();await new Promise(resolve=>setImmediate(resolve));
  const files=s.calls.find(c=>c[0]==='write')[1];
  assert.match(files['parts.py'],/receiver = InfraredReceiver\(15\)/);
  assert.match(files['main.py'],/receiver\.receive\(1000\)/);
  assert.match(files['lib/live_receiver.py'],/hard=True/);
  assert.match(files['lib/ir_data.py'],/def durations_to_bits/);
  if(sample==='receive_custom'){
   assert.match(files['decode_signal.py'],/off >= on \* 2/);
   assert.match(files['main.py'],/from decode_signal import decode_signal/);
  }
 }finally{s.close();}
});

test('editing PWM source rebuilds the matching blocks and later block edits update the same file',async()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.$('example').value='fan';s.$('example-load').click();
  s.window.editorCallbacks.onChange('main.py','from parts import fan\nimport rp2\nwhile True:\n    if rp2.bootsel_button():\n        fan.set(75)\n    else:\n        fan.set(0)\n');
  const ws=s.workspaces[1],output=ws.getAllBlocks(false).find(b=>b.type==='pico_pwm'&&b.getInputTargetBlock('PERCENT').getFieldValue('NUM')===75);
  assert(output);output.getInputTargetBlock('PERCENT').setFieldValue(60,'NUM');
  s.$('write-only').click();await new Promise(resolve=>setImmediate(resolve));
  const files=s.calls.find(c=>c[0]==='write')[1];assert.match(files['main.py'],/fan\.set\(60\)/);assert.equal((files['main.py'].match(/from parts import fan/g)||[]).length,1);assert.match(files['main.py'],/while True/);
 }finally{s.close();}
});

test('project files round-trip including generated library edits and a sample replaces the complete file group',async()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.window.confirm=()=>true;
  s.$('example').value='modules';s.$('example-load').click();
  const saved=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2'));
  assert.equal(saved.format,'pico-blocks-5');assert(saved.files['my_tools.py']);assert(saved.files['lib/pico_parts.py']);
  saved.files['lib/pico_parts.py']+='\nCUSTOM_LIBRARY_MARKER = 42\n';
  const text=JSON.stringify(saved);
  Object.defineProperty(s.$('project-file'),'files',{value:[{size:text.length,async text(){return text;}}]});
  s.$('project-file').dispatchEvent(new s.window.Event('change'));await new Promise(resolve=>setImmediate(resolve));
  const restored=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2'));
  assert.equal(restored.files['lib/pico_parts.py'],saved.files['lib/pico_parts.py']);
  assert.equal(restored.files['my_tools.py'],saved.files['my_tools.py']);
  s.$('example').value='fan';s.$('example-load').click();
  const replaced=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2'));
  assert.equal(replaced.files['my_tools.py'],undefined);assert.doesNotMatch(replaced.files['lib/pico_parts.py'],/CUSTOM_LIBRARY_MARKER/);
 }finally{s.close();}
});


test('text imports include the built-in conversion library in the saved file group',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.window.editorCallbacks.onChange('main.py','import ir_data\nprint(ir_data.bits_to_int([0, 1]))\n');
  const project=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2'));
  assert.equal(project.files['lib/ir_data.py'],s.window.PicoSources.irData);
  assert.match(project.files['main.py'],/bits_to_int/);
 }finally{s.close();}
});


test('PC and Pico lists align missing files, mark differences and keep the shared list position',async()=>{
 let reads=0;
 const s=studio(async()=>++reads===1?JSON.stringify([{name:'boot.py',dir:false,same:null,size:4},{name:'main.py',dir:false,same:false,size:9},{name:'parts.py',dir:false,same:true}]):JSON.stringify({data:Buffer.from('print(2)\n').toString('base64')}));
 try{
  s.$('pico-files-refresh').click();await new Promise(resolve=>setImmediate(resolve));
  const pc=s.$('pc-file-tree'),pico=s.$('pico-file-tree');
  assert.equal(pc.parentElement,pico.parentElement);
  assert.deepEqual([...pc.children].map(row=>row.dataset.path),[...pico.children].map(row=>row.dataset.path));
  assert.equal(pc.querySelector('[data-path="boot.py"]').className,'file-placeholder');
  assert.equal(pico.querySelector('[data-path="lib"]').className,'file-placeholder');
  for(const nav of [pc,pico]){
   const changed=nav.querySelector('[data-path="main.py"]');assert.equal(changed.dataset.state,'changed');assert.equal(changed.lastChild.textContent,'≠');
  }
  pc.parentElement.scrollTop=40;
  pc.querySelector('[data-path="main.py"]').click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pc.parentElement.scrollTop,40);
  assert.equal(s.$('pico-file-status').textContent,'≠');assert.equal(s.$('pico-file-status').dataset.changed,'true');
  assert(s.$('pico-diff-rows').querySelector('tr.changed'));
 }finally{s.close();}
});

test('a new named project keeps hardware configuration and a named saved copy restores as a file group',()=>{
 const s=studio(async()=>'{"changed":0}');
 try{
  s.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};s.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const originalParts=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2')).parts;
  s.$('project-new').click();s.$('project-name-input').value='赤外線の練習';s.$('project-apply').click();
  const fresh=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2'));
  assert.equal(fresh.name,'赤外線の練習');assert.equal(fresh.files['main.py'],'');assert.deepEqual(fresh.parts,originalParts);
  const saved=[];s.window.URL.createObjectURL=blob=>{saved.push(blob);return 'blob:project';};s.window.URL.revokeObjectURL=()=>{};s.window.HTMLAnchorElement.prototype.click=function(){saved.push(this.download);};
  s.$('project-tabs').querySelector('[aria-selected=true]').dispatchEvent(new s.window.MouseEvent('contextmenu',{bubbles:true,clientX:10,clientY:10}));s.$('project-save-as').click();s.$('project-name-input').value='別の練習';s.$('project-apply').click();
  assert.equal(JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2')).name,'別の練習');assert.equal(saved[1],'別の練習.json');
 }finally{s.close();}
});

 test('typing a list comma preserves source bytes and does not write generated text back into the editor',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  const source='_outputs = [1,]\nprint(_outputs)\n\n';
  s.window.editorCallbacks.onChange('main.py',source);
  assert.equal(JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2')).files['main.py'],source);
  s.window.editorCallbacks.onChange('main.py','_outputs = [1,');
  assert.equal(JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2')).files['main.py'],'_outputs = [1,');
 }finally{s.close();}
});

 test('project tabs keep independent files and parts, restore after reload, and share the USB connection',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));let restored;
 try{
  s.window.editorCallbacks.onChange('main.py','value = 7\nprint(value)\n');
  s.$('example').value='fan';s.$('example-load').click();
  assert.equal(s.$('project-tabs').querySelectorAll('[role=tab]').length,2);
  s.$('project-tabs').querySelector('[role=tab]').click();
  assert.equal(JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2')).files['main.py'],'value = 7\nprint(value)\n');
  assert.equal(s.$('parts-empty').hidden,true);assert.match(s.$('parts-rows').textContent,/赤外線LED/);
  s.$('project-tabs').querySelectorAll('[role=tab]')[1].click();
  assert.match(s.$('parts-rows').textContent,/PWM出力/);
  const stored=Object.fromEntries(['pico-studio-tabs-1','pico-blocks-project-2'].map(key=>[key,s.window.localStorage.getItem(key)]));
  restored=studio(async()=>JSON.stringify({changed:0}),stored);
  assert.equal(restored.$('project-tabs').querySelectorAll('[role=tab]').length,2);
  assert.equal(restored.$('project-tabs').querySelector('[aria-selected=true] .project-tab-name').textContent,'BOOTSELで扇風機を回す（部品ライブラリ）');
  restored.$('project-tabs').querySelector('[role=tab]').click();
  assert.equal(JSON.parse(restored.window.localStorage.getItem('pico-blocks-project-2')).files['main.py'],'value = 7\nprint(value)\n');
  restored.window.confirm=()=>true;restored.$('project-tabs').querySelectorAll('.project-close')[1].click();restored.$('project-discard-close').click();
  assert.equal(restored.$('project-tabs').querySelectorAll('[role=tab]').length,1);assert(restored.device.port);assert(!restored.calls.some(call=>call[0]==='write'));
 }finally{restored?.close();s.close();}
});

test('parts settings show an empty state before a part is added and after the last part is removed',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.$('example').value='beginner_console';s.$('example-load').click();
  assert.equal(s.$('parts-empty').hidden,false);assert.equal(s.$('parts-rows').closest('table').hidden,true);
  s.$('new-part-kind').value='receiver';s.$('part-add').click();assert.equal(s.$('parts-empty').hidden,true);
  s.$('parts-rows').querySelector('button').click();assert.equal(s.$('parts-empty').hidden,false);
 }finally{s.close();}
});

test('each project restores its Pico, retains background console output, and leaves an independently selected analyzer alone',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));let restored;
 try{
  const pool=s.window.PicoDevices;
  pool.select('program','1');s.links['1'].onOutput('receive one\n');
  s.$('example').value='basic_send';s.$('example-load').click();pool.select('program','2');s.links['2'].onOutput('send two\n');
  s.links['1'].onOutput('background receive\n');
  assert.match(s.$('output').textContent,/send two/);assert.doesNotMatch(s.$('output').textContent,/receive one|background receive/);
  s.$('project-tabs').querySelector('[role=tab]').click();assert.equal(pool.roles.program,'1');assert.match(s.$('output').textContent,/receive one[\s\S]*background receive/);
  s.$('project-tabs').querySelectorAll('[role=tab]')[1].click();assert.equal(pool.roles.program,'2');assert.match(s.$('output').textContent,/send two/);
  pool.select('observer','1');pool.devices[0].task='observer';s.links['1'].running=true;s.$('analyzer-tab').click();
  assert.match(s.$('console-state').textContent,/Pico 1.*観測中/);assert(s.$('console-input').disabled);
  s.$('program-tab').click();assert.match(s.$('console-state').textContent,/Pico 2/);assert.equal(pool.roles.observer,'1');
  const tabs=JSON.parse(s.window.localStorage.getItem('pico-studio-tabs-1'));assert.deepEqual(tabs.projects.map(entry=>entry.data.pico),['1','2']);
  restored=studio(async()=>JSON.stringify({changed:0}),{'pico-studio-tabs-1':JSON.stringify(tabs)});assert.equal(restored.window.PicoDevices.roles.program,'2');restored.$('project-tabs').querySelector('[role=tab]').click();assert.equal(restored.window.PicoDevices.roles.program,'1');
 }finally{restored?.close();s.close();}
});

test('local save clears the dirty marker, undoing text edits restores it, duplicate stays unsaved, and close can be cancelled',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.window.URL.createObjectURL=()=> 'blob:project';s.window.URL.revokeObjectURL=()=>{};s.window.HTMLAnchorElement.prototype.click=function(){};
  const original=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2')).files['main.py'];
  assert(s.$('project-tabs').querySelector('.project-unsaved'));
  s.$('project-save').click();assert.equal(s.$('project-tabs').querySelector('.project-unsaved'),null);
  s.window.editorCallbacks.onChange('main.py','value = 9\nprint(value)\n');assert(s.$('project-tabs').querySelector('.project-unsaved'));
  s.window.editorCallbacks.onChange('main.py',original);assert.equal(s.$('project-tabs').querySelector('.project-unsaved'),null);
  const tab=s.$('project-tabs').querySelector('[role=tab]');tab.dispatchEvent(new s.window.MouseEvent('contextmenu',{bubbles:true,clientX:20,clientY:20}));assert.equal(s.$('project-menu').hidden,false);
  s.$('project-duplicate').click();s.$('project-name-input').value='copy';s.$('project-apply').click();
  assert.equal(s.$('project-tabs').querySelectorAll('[role=tab]').length,2);assert(s.$('project-tabs').querySelectorAll('[role=tab]')[1].querySelector('.project-unsaved'));
  s.$('project-tabs').querySelectorAll('.project-close')[1].click();assert(s.$('project-close-dialog').open);s.$('project-close-dialog').close();assert.equal(s.$('project-tabs').querySelectorAll('[role=tab]').length,2);
  const before=new s.window.Event('beforeunload',{cancelable:true});s.window.dispatchEvent(before);assert(before.defaultPrevented);
  s.$('project-save').click();const after=new s.window.Event('beforeunload',{cancelable:true});s.window.dispatchEvent(after);assert.equal(after.defaultPrevented,false);
 }finally{s.close();}
});

test('legacy tabs with no record of local saving remain protected as unsaved, including inactive tabs',()=>{
 const initial=studio(async()=>JSON.stringify({changed:0}));let restored;
 try{
  const data=JSON.parse(initial.window.localStorage.getItem('pico-blocks-project-2'));
  const tabs={active:0,projects:[{data,file:'main.py',dirty:false},{data:{...data,name:'old copy'},file:'main.py',dirty:false}]};
  restored=studio(async()=>JSON.stringify({changed:0}),{'pico-studio-tabs-1':JSON.stringify(tabs)});
  assert.equal(restored.$('project-tabs').querySelectorAll('.project-unsaved').length,2);restored.$('project-tabs').querySelectorAll('.project-close')[1].click();assert(restored.$('project-close-dialog').open);assert.equal(restored.$('project-tabs').querySelectorAll('[role=tab]').length,2);
 }finally{restored?.close();initial.close();}
});

test('discarded project tabs can be reopened with their files and Pico assignment',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.$('example').value='basic_send';s.$('example-load').click();s.window.PicoDevices.select('program','1');const source=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2')).files['main.py'];
  s.$('project-tabs').querySelectorAll('.project-close')[1].click();assert(s.$('project-close-dialog').open);s.$('project-discard-close').click();
  s.$('project-add').click();assert.equal(s.$('project-reopen').hidden,false);s.$('project-reopen').click();
  const reopened=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2'));assert.equal(reopened.files['main.py'],source);assert.equal(reopened.pico,'1');assert.equal(s.$('project-tabs').querySelectorAll('[role=tab]').length,2);
 }finally{s.close();}
});

test('save-and-close saves the targeted inactive project and leaves the other project selected',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  const downloaded=[];s.window.URL.createObjectURL=()=> 'blob:project';s.window.URL.revokeObjectURL=()=>{};s.window.HTMLAnchorElement.prototype.click=function(){downloaded.push(this.download);};
  s.$('example').value='basic_send';s.$('example-load').click();s.$('project-tabs').querySelector('.project-close').click();assert(s.$('project-close-dialog').open);
  s.$('project-save-close').click();assert.deepEqual(downloaded,['無題.json']);
  const tabs=JSON.parse(s.window.localStorage.getItem('pico-studio-tabs-1'));assert.equal(tabs.projects.length,1);assert.equal(tabs.projects[0].data.name,'ビット配列を送信する');assert.equal(tabs.closed.data.name,'無題');assert.equal(tabs.closed.dirty,false);
 }finally{s.close();}
});

test('save-and-close waits if the targeted project Pico is busy without replacing the other tab',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.window.PicoDevices.select('program','1');s.$('example').value='basic_send';s.$('example-load').click();s.window.PicoDevices.select('program','2');
  s.$('project-tabs').querySelector('.project-close').click();assert(s.$('project-close-dialog').open);s.links['1'].busy=true;
  s.$('project-save-close').click();assert.equal(s.$('project-tabs').querySelectorAll('[role=tab]').length,2);assert(s.$('project-close-dialog').open);
  const tabs=JSON.parse(s.window.localStorage.getItem('pico-studio-tabs-1'));assert.equal(tabs.projects[0].data.name,'無題');assert.equal(tabs.projects[1].data.name,'ビット配列を送信する');
 }finally{s.close();}
});

test('beginner projects include editable hardware and binary helpers for writing to a Pico',async()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  for(const name of ['times','binary','send','receive','rgb','fan_receive']){
   s.$('example').value='beginner_'+name;s.$('example-load').click();
   s.$('write-only').click();await new Promise(resolve=>setImmediate(resolve));
   const files=s.calls.filter(c=>c[0]==='write').at(-1)[1];
   assert.equal(files['main.py'],s.window.StudioSamples.beginner(name).files['main.py']);
   if(['binary','receive','fan_receive'].includes(name))assert.equal(files['lib/ir_data.py'],s.window.PicoSources.irData);
   else assert.equal(files['lib/ir_data.py'],undefined);
   if(name==='send')assert.match(files['parts.py'],/infrared = Infrared\(16, unit=560\)/);
   if(name==='fan_receive'){
    assert.match(files['parts.py'],/赤外線センサー = InfraredReceiver\(13\)/);
    assert.match(files['parts.py'],/扇風機 = PWMOutput\(20, frequency=25000\)/);
    assert.equal(files['lib/live_receiver.py'],s.window.PicoSources.receiver);
   }
   if(name==='receive'){
    assert.match(files['parts.py'],/receiver = InfraredReceiver\(15\)/);
    assert.equal(files['lib/live_receiver.py'],s.window.PicoSources.receiver);
   }
  }
 }finally{s.close();}
});

test('RGB settings can be added beside infrared PWM, changed, saved and written to a Pico',async()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.$('new-part-kind').value='rgb';s.$('part-add').click();
  const row=s.$('parts-rows').querySelector('[data-kind=rgb]');assert(row);
  const set=(field,value)=>{row.querySelector('[data-field='+field+']').value=value;};
  set('red','2');set('green','3');set('blue','4');set('common_anode','1');set('frequency','2000');
  s.$('parts-apply').click();
  const saved=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2')),rgb=saved.parts.find(p=>p.kind==='rgb');
  assert.deepEqual([rgb.red,rgb.green,rgb.blue,rgb.common_anode,rgb.frequency],[2,3,4,true,2000]);
  s.$('write-only').click();await new Promise(resolve=>setImmediate(resolve));
  const files=s.calls.filter(c=>c[0]==='write').at(-1)[1];assert.match(files['parts.py'],/RGBLED\(2, 3, 4, common_anode=True, frequency=2000\)/);
  assert.equal(files['lib/pico_parts.py'],s.window.PicoSources.parts);
 }finally{s.close();}
});

test('renaming a part updates its blocks and Python while preserving older references through project restore',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));let restored;
 try{
  s.window.editorCallbacks.onChange('main.py','from parts import infrared\ninfrared.on()\nprint(infrared)\n');
  const rename=variable=>{const row=s.$('parts-rows').querySelector('[data-kind=infrared]');row.querySelector('[data-field=name]').value=variable;s.$('parts-apply').click();return JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2'));};
  const first=rename('赤外線LED');
  assert.match(first.files['main.py'],/from parts import 赤外線LED/);
  assert.match(first.files['main.py'],/赤外線LED\.on\(\)/);
  assert.match(first.files['main.py'],/print\(infrared\)/);
  assert.match(first.files['parts.py'],/infrared = 赤外線LED/);
  const second=rename('送信用LED');
  assert.match(second.files['main.py'],/送信用LED\.on\(\)/);
  assert.match(second.files['parts.py'],/赤外線LED = 送信用LED/);
  assert.match(second.files['parts.py'],/infrared = 送信用LED/);
  restored=studio(async()=>JSON.stringify({changed:0}),Object.fromEntries(['pico-studio-tabs-1','pico-blocks-project-2'].map(key=>[key,s.window.localStorage.getItem(key)])));
  assert.equal(restored.$('parts-rows').querySelector('[data-kind=infrared] [data-field=name]').value,'送信用LED');
  assert.equal(JSON.parse(restored.window.localStorage.getItem('pico-blocks-project-2')).files['main.py'],second.files['main.py']);
 }finally{restored?.close();s.close();}
});

test('the display sample uses GP2 power before SoftI2C on GP3 and GP4 and opens as editable display blocks',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.$('example').value='display';s.$('example-load').click();
  const saved=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2'));
  const power=saved.parts.find(p=>p.kind==='led'),screen=saved.parts.find(p=>p.kind==='ssd1306');
  assert.deepEqual([power.pin,screen.scl,screen.sda],[2,3,4]);
  assert.match(saved.files['main.py'],/画面の電源\.on\(\)[\s\S]*time.sleep\(0.1\)[\s\S]*画面.text\('Hello, Pico!', 1\)/);
  assert(saved.files['lib/ssd1306.py']);
  assert(s.workspaces.at(-1).getAllBlocks(false).some(block=>block.type==='pico_display_text'));
  assert.equal(s.$('program-state').hidden,true);
  assert.equal(s.$('display-preview'),null);
 }finally{s.close();}
});

test('a new display defaults to SDA4 and SCL3 without changing existing parts',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.$('new-part-kind').value='ssd1306';s.$('part-add').click();
  const row=s.$('parts-rows').querySelector('[data-kind=ssd1306]');
  assert.equal(row.querySelector('[data-field=sda]').value,'4');
  assert.equal(row.querySelector('[data-field=scl]').value,'3');
 }finally{s.close();}
});

test('one grouped sample selector offers ASCII and UTF-8 projects without separate topics or Japanese-name variants',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  assert.equal(s.$('sample-topic'),null);
  const groups=[...s.$('example').querySelectorAll('optgroup')];
  assert(groups.every(group=>!group.hidden));
  const messages=groups.find(group=>group.label==='メッセージをやり取りする');
  assert.equal(messages.querySelectorAll('option').length,3);
  assert(!messages.textContent.includes('UTF-8'));
  assert(!s.$('example').textContent.includes('日本語名'));
  for(const mode of ['ascii_send','ascii_receive','ascii_display','utf8_send','utf8_receive']){
   s.$('example').value='message_'+mode;s.$('example').dispatchEvent(new s.window.Event('change'));s.$('example-load').click();
   const saved=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2'));
   assert.equal(saved.files['main.py'],s.window.StudioSamples.message(mode).files['main.py']);
   assert(!saved.files['main.py'].includes('38000'));assert(!saved.files['main.py'].includes('PWM'));
   if(mode==='ascii_display')assert(saved.files['lib/ssd1306.py']);
   if(mode.endsWith('receive')||mode==='ascii_display')assert(saved.files['lib/live_receiver.py']);
  }
 }finally{s.close();}
});

test('three work tabs switch panels and keyboard focus while retaining independent Pico assignments and USB ports',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  const pool=s.window.PicoDevices,ports=pool.devices.map(item=>item.link.port);pool.select('observer','1');
  s.$('conversion-tab').click();
  assert.equal(s.window.location.hash,'#conversion');assert.equal(s.$('conversion-panel').hidden,false);assert.equal(s.$('observer-panel').hidden,true);assert.equal(s.$('program-panel').hidden,true);
  assert.equal(s.$('conversion-tab').getAttribute('aria-selected'),'true');assert.equal(pool.roles.program,'2');assert.equal(pool.roles.observer,'1');assert(s.calls.some(call=>call[0]==='conversion-show'));
  s.$('conversion-tab').dispatchEvent(new s.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.equal(s.window.location.hash,'#program');assert.equal(s.window.document.activeElement,s.$('program-tab'));assert.equal(s.$('program-panel').hidden,false);
  s.$('program-tab').dispatchEvent(new s.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(s.window.location.hash,'#analyzer');
  s.$('analyzer-tab').dispatchEvent(new s.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(s.window.location.hash,'#conversion');
  assert.deepEqual(pool.devices.map(item=>item.link.port),ports);assert.equal(s.calls.filter(call=>['write','stop','run'].includes(call[0])).length,0);
 }finally{s.close();}
});

test('conversion deep links open the conversion panel after restoring the program project',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}),{},'#conversion');
 try{assert.equal(s.$('conversion-panel').hidden,false);assert.equal(s.$('conversion-tab').tabIndex,0);assert.equal(s.$('program-tab').tabIndex,-1);}
 finally{s.close();}
});

test('fresh pages start with the button-free zero sender and restoring a saved project preserves its code',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));let restored;
 try{
  const project=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2'));
  assert.equal(project.name,'無題');assert.equal(project.files['main.py'],s.window.StudioSamples.beginner('zero32').files['main.py']);
  s.window.editorCallbacks.onChange('main.py','print("my saved program")\n');
  const stored=Object.fromEntries(['pico-studio-tabs-1','pico-blocks-project-2'].map(key=>[key,s.window.localStorage.getItem(key)]));
  restored=studio(async()=>JSON.stringify({changed:0}),stored);
  assert.equal(JSON.parse(restored.window.localStorage.getItem('pico-blocks-project-2')).files['main.py'],'print("my saved program")\n');
 }finally{restored?.close();s.close();}
});

test('untouched untitled 65 and BOOTSEL starters are upgraded on startup, preserving pins, libraries and custom files',()=>{
 const initial=studio(async()=>JSON.stringify({changed:0}));let cases=[];
 try{
  const base=JSON.parse(initial.window.localStorage.getItem('pico-blocks-project-2'));
  base.name='無題';base.files['main.py']='from parts import infrared\n\ninfrared.send(65)\n';base.fileWorkspaces={};
  base.parts[0].pin=20;base.files['parts.py']=base.files['parts.py'].replace('Infrared(16,','Infrared(20,');
  base.files['notes.py']='print("keep")\n';base.files['lib/pico_parts.py']+='\nUSER_MARKER = 1\n';
  for(const [name,source,upgrades] of [['無題',initial.window.StudioSamples.beginner('continuous').files['main.py'],true],['無題',base.files['main.py'],true],['自作送信',base.files['main.py'],false],['無題',base.files['main.py']+'print("edited")\n',false]]){
   const data=structuredClone(base);data.name=name;data.files['main.py']=source;
   const s=studio(async()=>JSON.stringify({changed:0}),{'pico-blocks-project-2':JSON.stringify(data)});cases.push(s);
   const restored=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2'));
   assert.equal(restored.parts[0].pin,20);assert.equal(restored.files['notes.py'],base.files['notes.py']);assert.equal(restored.files['lib/pico_parts.py'],base.files['lib/pico_parts.py']);
   if(upgrades){assert.match(restored.files['main.py'],/send_bits\(\[0\] \* 32, leader=False\)/);assert.doesNotMatch(restored.files['main.py'],/send\(65\)/);}
   else assert.equal(restored.files['main.py'],source);
  }
 }finally{for(const s of cases)s.close();initial.close();}
});

test('legacy untitled starter workspaces also open as button-free zero senders',()=>{
 const data={format:'pico-blocks-2',parts:require('../docs/pico-blocks.js').defaults(),workspace:require('../docs/pico-blocks.js').examples.send()};
 const s=studio(async()=>JSON.stringify({changed:0}),{'pico-blocks-project-2':JSON.stringify(data)});
 try{const restored=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2'));assert.equal(restored.name,'無題');assert.match(restored.files['main.py'],/send_bits\(\[0\] \* 32, leader=False\)/);}
 finally{s.close();}
});

test('updating the old starter supplies time-array support and preserves an incompatible old runtime as a separate file',()=>{
 const original=studio(async()=>JSON.stringify({changed:0}));let restored;
 try{
  const data=JSON.parse(original.window.localStorage.getItem('pico-blocks-project-2'));
  data.name='無題';data.files['main.py']='from parts import infrared\ninfrared.send(65)\n';data.fileWorkspaces={};
  data.files['lib/pico_parts.py']='OLD_RUNTIME_MARKER = 1\n';data.files['lib/pico_parts_previous.py']='USER_FILE = 1\n';
  restored=studio(async()=>JSON.stringify({changed:0}),{'pico-blocks-project-2':JSON.stringify(data)});
  const files=JSON.parse(restored.window.localStorage.getItem('pico-blocks-project-2')).files;
  assert.match(files['main.py'],/send_bits\(\[0\] \* 32, leader=False\)/);assert.equal(files['lib/pico_parts.py'],restored.window.PicoSources.parts);
  assert.equal(files['lib/pico_parts_previous.py'],'USER_FILE = 1\n');assert.equal(files['lib/pico_parts_previous_2.py'],'OLD_RUNTIME_MARKER = 1\n');
 }finally{restored?.close();original.close();}
});

test('definition navigation follows an imported alias and returns to the call without changing program files',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.$('file-create').click();s.$('file-path-input').value='tools.py';s.$('file-dialog-apply').click();
  const helper='# helper\ndef twice(value):\n    return value * 2\n';
  s.window.editorCallbacks.onChange('tools.py',helper);
  [...s.$('file-tree').querySelectorAll('button')].find(b=>b.title==='main.py').click();
  const source='from tools import twice as double\nprint(double(2))\n';
  s.window.editorCallbacks.onChange('main.py',source);
  s.window.editorPosition=source.lastIndexOf('double')+2;
  const before=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2')).files;
  s.window.editorCallbacks.onDefinition(s.window.editorPosition);
  assert.equal(s.$('file-tree').querySelector('[aria-current=true]').title,'tools.py');
  assert(s.calls.some(call=>call[0]==='line'&&call[1]===2));
  assert.equal(s.$('definition-back').disabled,false);
  s.$('definition-back').click();
  assert.equal(s.$('file-tree').querySelector('[aria-current=true]').title,'main.py');
  assert(s.calls.some(call=>call[0]==='position'&&call[1]===s.window.editorPosition));
  const after=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2')).files;
  assert.equal(after['main.py'],before['main.py']);assert.equal(after['tools.py'],before['tools.py']);
  assert.equal(s.calls.filter(call=>call[0]==='scroll').length,0);
 }finally{s.close();}
});

test('a component block context menu opens its library method and project switches clear reference history',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.window.editorCallbacks.onChange('main.py','from parts import infrared\ninfrared.send(65)\n');
  const block=s.workspaces[1].getAllBlocks(false).find(b=>b.type==='pico_send');assert(block);
  const options=[];block.customContextMenu(options);
  const reference=options.find(item=>item.text==='定義へ移動');assert(reference?.enabled);reference.callback();
  assert.equal(s.$('file-tree').querySelector('[aria-current=true]').title,'lib/pico_parts.py');
  const line=s.window.PicoSources.parts.slice(0,s.window.PicoSources.parts.indexOf('    def send(self, value)')).split('\n').length;
  assert(s.calls.some(call=>call[0]==='line'&&call[1]===line));
  assert.equal(s.$('definition-back').disabled,false);
  s.$('example').value='beginner_times';s.$('example-load').click();
  assert.equal(s.$('definition-back').disabled,true);
 }finally{s.close();}
});

test('unavailable builtin definitions leave the active file and reference history alone',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.window.editorCallbacks.onChange('main.py','print(7)\n');
  s.window.editorCallbacks.onDefinition(2);
  assert.equal(s.$('file-tree').querySelector('[aria-current=true]').title,'main.py');
  assert.equal(s.$('definition-back').disabled,true);
  assert.match(s.$('studio-status').textContent,/このプロジェクト内に定義が見つかりません/);
 }finally{s.close();}
});

test('a module import offers a preview and opens its project file',async()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  const source='from parts import infrared\ninfrared.send(65)\n';s.window.editorCallbacks.onChange('main.py',source);
  const position=source.indexOf('parts')+2,preview=s.window.editorCallbacks.onPreview(position);
  assert.equal(preview.path,'parts.py');assert.match(preview.text,/infrared/);
  const block=s.workspaces[1].getAllBlocks(false).find(b=>b.type==='pico_from_import');assert(block);
  const node=s.window.document.createElementNS('http://www.w3.org/2000/svg','g');node.setAttribute('data-id',block.id);s.$('file-blockly').append(node);
  node.dispatchEvent(new s.window.MouseEvent('pointerover',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,450));
  const popup=s.window.document.querySelector('.block-definition-preview');assert.equal(popup.hidden,false);assert.match(popup.textContent,/parts.py/);
  popup.querySelector('button').click();assert.equal(s.$('file-tree').querySelector('[aria-current=true]').title,'parts.py');
 }finally{s.close();}
});

function pointAtBlock(s,block,{shiftKey=false,button=0}={}){
 const node=s.window.document.createElementNS('http://www.w3.org/2000/svg','g');node.setAttribute('data-id',block.id);
 s.$('file-blockly').append(node);block.getSvgRoot=()=>node;
 node.dispatchEvent(new s.window.MouseEvent('pointerdown',{bubbles:true,cancelable:true,shiftKey,button}));
 return node;
}

test('Shift-selecting a range extracts an editable function with arguments and return values and supports Undo',async()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  const source='value = 2\nresult = value * 3\nprint(result)\nprint(result + 1)\n';
  s.window.editorCallbacks.onChange('main.py',source);
  const ws=s.workspaces[1],first=ws.getAllBlocks(false).find(b=>b.type==='variables_set'&&b.getField('VAR').getVariable().name==='result'),last=first.getNextBlock();
  const a=pointAtBlock(s,first),b=pointAtBlock(s,last,{shiftKey:true});
  assert(a.classList.contains('pico-range-selected'));assert(b.classList.contains('pico-range-selected'));
  pointAtBlock(s,last,{button:2});
  const menu=Blockly.ContextMenuRegistry.registry.getItem('pico_extract_function');
  assert.equal(menu.preconditionFn({block:last}),'enabled');menu.callback({block:last});
  assert(s.$('extract-function-dialog').open);
  assert.match(s.$('extract-function-signature').textContent,/new_function\(value\) → result/);
  s.$('extract-function-name').value='triple';s.$('extract-function-apply').click();
  assert.equal(s.$('extract-function-error').textContent,'');assert.equal(s.$('extract-function-dialog').open,false);
  const extracted=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2')).files['main.py'];
  assert.match(extracted,/def triple\(value\):/);assert.match(extracted,/return result/);assert.match(extracted,/result = triple\(value\)/);
  const {spawnSync}=require('node:child_process');
  const run=code=>{const result=spawnSync('python3',['-c',code],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout;};
  assert.equal(run(extracted),run(source));
  await new Promise(resolve=>setTimeout(resolve,30));ws.undo(false);
  await new Promise(resolve=>setTimeout(resolve,100));
  const restored=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2')).files['main.py'];
  assert.equal(run(restored),run(source));assert(!restored.includes('def triple'));
 }finally{s.close();}
});

test('right-click highlights the current block and unsafe flow is rejected without modifying the source',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  const source='def original(value):\n    return value\n';s.window.editorCallbacks.onChange('main.py',source);
  const block=s.workspaces[1].getAllBlocks(false).find(b=>b.type==='pico_return');
  const node=pointAtBlock(s,block,{button:2});assert(node.classList.contains('pico-range-selected'));
  const menu=Blockly.ContextMenuRegistry.registry.getItem('pico_extract_function');menu.preconditionFn({block});menu.callback({block});
  assert.equal(s.$('extract-function-dialog').open,false);assert.match(s.$('studio-status').textContent,/return/);
  assert.equal(JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2')).files['main.py'],source);
 }finally{s.close();}
});

test('extracting multiple results from a method preserves execution and failed name validation keeps the selection',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  const source='class Calculator:\n    def run(self, value):\n        left = value + 1\n        right = value + 2\n        return left + right\nprint(Calculator().run(3))\n';
  s.window.editorCallbacks.onChange('main.py',source);
  const ws=s.workspaces[1],first=ws.getAllBlocks(false).find(b=>b.type==='variables_set'&&b.getField('VAR').getVariable().name==='left'),last=first.getNextBlock();
  pointAtBlock(s,first);pointAtBlock(s,last,{shiftKey:true});
  const menu=Blockly.ContextMenuRegistry.registry.getItem('pico_extract_function');menu.preconditionFn({block:first});menu.callback({block:first});
  assert(s.$('extract-function-dialog').open);
  s.$('extract-function-name').value='print';s.$('extract-function-apply').click();
  assert.match(s.$('extract-function-error').textContent,/使われています/);
  assert.equal(JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2')).files['main.py'],source);
  s.$('extract-function-name').value='pair';s.$('extract-function-apply').click();assert.equal(s.$('extract-function-dialog').open,false);
  const extracted=JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2')).files['main.py'];
  assert.match(extracted,/def pair\(value\):/);assert.match(extracted,/left, right = pair\(value\)/);
  const result=require('node:child_process').spawnSync('python3',['-c',extracted],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'9\n');
 }finally{s.close();}
});

test('a conditionally assigned value is not passed before its first definition',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  const source='flag = True\nif flag:\n    value=1\nprint(value)\n';s.window.editorCallbacks.onChange('main.py',source);
  const ws=s.workspaces[1],first=ws.getAllBlocks(false).find(b=>b.type==='controls_if'),last=first.getNextBlock();
  pointAtBlock(s,first);pointAtBlock(s,last,{shiftKey:true});
  const menu=Blockly.ContextMenuRegistry.registry.getItem('pico_extract_function');menu.preconditionFn({block:last});menu.callback({block:last});
  assert.equal(s.$('extract-function-dialog').open,false);assert.match(s.$('studio-status').textContent,/値を用意する部分/);
  assert.equal(JSON.parse(s.window.localStorage.getItem('pico-blocks-project-2')).files['main.py'],source);
 }finally{s.close();}
});
