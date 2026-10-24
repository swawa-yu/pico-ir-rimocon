const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const Blockly=require('../vendor/blockly/blockly_compressed.js');
require('../vendor/blockly/blocks_compressed.js');
Object.assign(Blockly.Msg,require('../vendor/blockly/msg/ja.js'));
const {pythonGenerator}=require('../vendor/blockly/python_compressed.js');

function studio(exec){
  const dom=new JSDOM(fs.readFileSync('block-studio.html','utf8'),{url:'http://localhost/',runScripts:'outside-only'});
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
  w.PicoBlocks=require('../pico-blocks.js');w.StudioFiles=require('../studio-files.js');
  w.PicoSources=require('../pico-sources.js');w.PicoProject={...require('../pico-project.js'),async upload(device,files){calls.push(['write',files]);return JSON.parse(await exec(files));}};
  w.PicoDevices={listeners:new Set(),forRole:(_role,watcher)=>{w.deviceWatcher=watcher;return device;},bindSelect(){},changed(){},entry:()=>({id:'2',state:'connected',link:device})};
  w.eval(fs.readFileSync('vendor/codemirror/editor.js','utf8'));
  w.structuredClone=global.structuredClone;
  w.PicoEditor={blocks:w.PicoEditor.blocks,step:w.PicoEditor.step,create:(_element,callbacks)=>{w.editorCallbacks=callbacks;return {setFile(){},setReadOnly(value){calls.push(['readonly',value]);},highlightLines(range){calls.push(['highlight',range]);},goLine(line){calls.push(['line',line]);}};}};
  w.LiveAnalyzer={show(){}};
  w.ResizeObserver=class{observe(){}};
  w.HTMLElement.prototype.scrollIntoView=function(){calls.push(['scroll',this.id]);};
  w.eval(fs.readFileSync('block-studio.js','utf8'));
  return {window:w,device,calls,workspaces,$:id=>w.document.getElementById(id),close(){for(const ws of workspaces)ws.dispose();dom.window.close();for(const type of Object.keys(Blockly.Blocks))if(type.startsWith('pico_'))delete Blockly.Blocks[type];}};
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
  const fileButton=name=>[...s.$('file-tree').querySelectorAll('button')].find(b=>b.textContent===name);
  fileButton('parts.py').click();
  assert.equal(s.$('blockly').hidden,true);assert.equal(s.$('file-blockly').hidden,false);
  s.window.editorCallbacks.onChange('parts.py','import time\n\nclass Custom:\n    pass\n');
  const ws=s.workspaces[1];
  const klass=ws.getAllBlocks(false).find(b=>b.type==='pico_class');assert(klass);
  klass.setFieldValue('Renamed','HEADER');
  fileButton('main.py').click();
  assert.equal(s.$('blockly').hidden,false);assert.equal(s.$('file-blockly').hidden,true);
  fileButton('parts.py •').click();
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
  assert.equal(s.$('file-title').textContent,'helpers/calc.py');
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
  assert.equal(s.$('file-title').textContent,'scratch.py');
  s.window.confirm=()=>true;
  Object.defineProperty(s.$('project-file'),'files',{value:[{size:original.length,async text(){return original;}}]});
  s.$('project-file').dispatchEvent(new s.window.Event('change'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(s.$('file-title').textContent,'main.py');assert.doesNotMatch(s.$('file-tree').textContent,/scratch/);
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
