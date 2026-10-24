const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const Blockly=require('../vendor/blockly/blockly_compressed.js');
require('../vendor/blockly/blocks_compressed.js');
Object.assign(Blockly.Msg,require('../vendor/blockly/msg/ja.js'));
const {pythonGenerator}=require('../vendor/blockly/python_compressed.js');

function studio(exec,stored={}){
  const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'http://localhost/',runScripts:'outside-only'});
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
  w.StudioSamples=require('../studio-samples.js');w.PicoSources=require('../pico-sources.js');w.PicoProject={...require('../pico-project.js'),async upload(device,files){calls.push(['write',files]);return JSON.parse(await exec(files));}};
  const links={};let linkNumber=0;
  w.PicoREPL=function(callbacks){const id=String(++linkNumber),link=id==='2'?device:{...device,id};Object.assign(link,callbacks);links[id]=link;return link;};
  w.eval(fs.readFileSync('pico-devices.js','utf8'));
  for(const entry of w.PicoDevices.devices){entry.state='connected';entry.task='program';}
  w.PicoDevices.select('program','2');w.PicoDevices.select('observer','2');
  const forRole=w.PicoDevices.forRole.bind(w.PicoDevices);w.PicoDevices.forRole=(role,watcher)=>{if(role==='program')w.deviceWatcher=watcher;return forRole(role,watcher);};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};

  w.eval(fs.readFileSync('vendor/codemirror/editor.js','utf8'));
  w.structuredClone=global.structuredClone;
  w.PicoEditor={blocks:w.PicoEditor.blocks,step:w.PicoEditor.step,create:(_element,callbacks)=>{w.editorCallbacks=callbacks;return {setFile(){},setReadOnly(value){calls.push(['readonly',value]);},highlightLines(range){calls.push(['highlight',range]);},goLine(line){calls.push(['line',line]);}};}};
  w.LiveAnalyzer={show(){}};
  w.ResizeObserver=class{observe(){}};
  w.HTMLElement.prototype.scrollIntoView=function(){calls.push(['scroll',this.id]);};
  for(const [key,value] of Object.entries(stored))w.localStorage.setItem(key,value);
  w.eval(fs.readFileSync('block-studio.js','utf8'));
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
  assert.equal(s.$('parts-empty').hidden,false);
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
  s.$('project-save-close').click();assert.deepEqual(downloaded,['変数の値を表示.json']);
  const tabs=JSON.parse(s.window.localStorage.getItem('pico-studio-tabs-1'));assert.equal(tabs.projects.length,1);assert.equal(tabs.projects[0].data.name,'ビット配列を送信する');assert.equal(tabs.closed.data.name,'変数の値を表示');assert.equal(tabs.closed.dirty,false);
 }finally{s.close();}
});

test('save-and-close waits if the targeted project Pico is busy without replacing the other tab',()=>{
 const s=studio(async()=>JSON.stringify({changed:0}));
 try{
  s.window.PicoDevices.select('program','1');s.$('example').value='basic_send';s.$('example-load').click();s.window.PicoDevices.select('program','2');
  s.$('project-tabs').querySelector('.project-close').click();assert(s.$('project-close-dialog').open);s.links['1'].busy=true;
  s.$('project-save-close').click();assert.equal(s.$('project-tabs').querySelectorAll('[role=tab]').length,2);assert(s.$('project-close-dialog').open);
  const tabs=JSON.parse(s.window.localStorage.getItem('pico-studio-tabs-1'));assert.equal(tabs.projects[0].data.name,'変数の値を表示');assert.equal(tabs.projects[1].data.name,'ビット配列を送信する');
 }finally{s.close();}
});
