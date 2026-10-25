const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function page(serial) {
  const elements = new Map(),blobs=[];let now=0;
  function element() {
    return {disabled:false, hidden:false, value:'', textContent:'', style:{}, parentElement:{clientWidth:600},
      listeners:{},children:[],addEventListener(name,callback){this.listeners[name]=callback;},setAttribute(){},replaceChildren(){this.children=[];},append(...items){this.children.push(...items);},click(){},
      getContext(){return new Proxy({},{get(){return ()=>{};},set(){return true;}});}};
  }
  const context = vm.createContext({
    PicoREPL:require('../pico-repl.js').PicoREPL,PicoSources:require('../pico-sources.js'),
    Blob,URL:{createObjectURL(blob){blobs.push(blob);return 'blob:test';},revokeObjectURL(){}},URLSearchParams, location:{search:'',origin:'http://localhost'}, LiveIR:require('../live-core.js'), navigator:serial?{serial}:{}, TextDecoder,
    performance:{now:()=>now}, requestAnimationFrame(){}, setInterval(){},setTimeout(){},clearInterval(){},
    window:{addEventListener(){}},
    document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element},
  });
  vm.runInContext(fs.readFileSync(require.resolve('../live-analyzer.js'),'utf8'),context);
  return {context,elements,blobs,setNow(value){now=value;}};
}
function serialPort() {
  const trace=[],queue=[];let resolve,reject,locked=false,code='';
  function push(value){const result=typeof value==='string'?{value:new TextEncoder().encode(value),done:false}:value;if(resolve){const yes=resolve;resolve=null;yes(result);}else queue.push(result);}
  const reader={read(){return queue.length?Promise.resolve(queue.shift()):new Promise((yes,no)=>{resolve=yes;reject=no;});},async cancel(){trace.push('cancel');push({done:true});},releaseLock(){trace.push('release');locked=false;}};
  const writer={async write(data){const text=new TextDecoder().decode(data);if(text==='\r\x03\x03\x02')push('>>> ');else if(text==='\x01')push('raw REPL; CTRL-B to exit\r\n>');else if(text==='\x04')push('OK');else if(text==='\x03\x03')push('\x04KeyboardInterrupt\n\x04>');else code+=text;},releaseLock(){trace.push('writer-release');}};
  const port={async open(){trace.push('open');},readable:{getReader(){locked=true;return reader;}},writable:{getWriter(){return writer;}},async close(){assert(!locked);trace.push('close');}};
  return {port,trace,get code(){return code;},fail(error){reject(error);},push};
}

test('disconnect waits for cancellation and releases the stream before closing USB',async()=>{
  const device=serialPort(),{context,elements}=page({requestPort:async()=>device.port});
  await context.connect();
  assert.equal(elements.get('disconnect').disabled,false);
  await context.disconnect();
  assert.deepEqual(device.trace,['open','cancel','release','writer-release','close']);
  assert.equal(elements.get('connection-state').textContent,'USB未接続');
  assert.equal(elements.get('connect').disabled,false);
  assert.equal(elements.get('disconnect').disabled,true);
});

test('failed open restores controls and offers the editor-disconnect instruction',async()=>{
  const {context,elements}=page({requestPort:async()=>({open:async()=>{throw Error('busy');}})});
  await context.connect();
  assert.equal(elements.get('connect').disabled,false);
  assert.equal(elements.get('disconnect').disabled,true);
  assert.match(elements.get('status').textContent,/エディタ/);
});

test('unplug and read failures release the reader and close the port',async()=>{
  const device=serialPort(),{context,elements}=page({requestPort:async()=>device.port});
  await context.connect();device.fail(Error('unplugged'));
  await vm.runInContext('readTask',context);
  assert.deepEqual(device.trace,['open','release','writer-release','close']);
  assert.match(elements.get('status').textContent,/unplugged/);
  assert.equal(elements.get('disconnect').disabled,true);
});

test('serial chunks are reassembled by newline without changing Pico timestamps',async()=>{
  const device=serialPort(),{context}=page({requestPort:async()=>device.port});
  await context.connect();
  device.push('{"ir":1,"seq":0,"time":0,"on":0,"ed');
  await new Promise(resolve=>setImmediate(resolve));
  device.push('ges":[],"lost":0}\n'+JSON.stringify({ir:1,seq:1,time:1000,on:0,edges:[[100,1],[200,0]],lost:0})+'\n');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(vm.runInContext('capture.frames.length',context),1);
  assert.equal(vm.runInContext('capture.frames[0].durations[0]',context),100);
  await context.disconnect();
  assert.equal(vm.runInContext('capture.frames.length',context),1);
  assert.equal(vm.runInContext('selected.durations[0]',context),100);
});


test('history names and recording timestamps survive the actual save and import handlers',async()=>{
  const {context,elements,blobs}=page();
  vm.runInContext("selected=capture.addFrame({durations:[100,100,100],source:'USB'});drawCapture();renderHistory()",context);
  elements.get('capture-name').value='電源';elements.get('capture-name').listeners.input();
  elements.get('save').listeners.click();
  const saved=JSON.parse(await blobs[0].text());
  assert.equal(saved.frames[0].name,'電源');assert.equal(saved.frames[0].source,'USB');
  assert(Number.isSafeInteger(saved.frames[0].recordedAt));
  elements.get('history-file').files=[{size:100,text:async()=>JSON.stringify(saved)}];
  await elements.get('history-file').listeners.change();
  assert.equal(vm.runInContext('selected.name',context),'電源');
  assert.equal(vm.runInContext('selected.recordedAt',context),saved.frames[0].recordedAt);
});

test('receiver starts in RAM with the selected GPIO and reports live levels independently of paused drawing',async()=>{
  const device=serialPort(),{context,elements,setNow}=page({requestPort:async()=>device.port});
  await context.connect();elements.get('receiver-pin').value='20';
  await context.startReceiver();assert.match(device.code,/RECEIVER_PIN = 20/);
  assert.equal(elements.get('receiver-pin').disabled,true);
  device.push(JSON.stringify({ir:1,pin:20,seq:0,time:0,on:0,edges:[],lost:0})+'\n');
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(elements.get('signal-state').textContent,/GP20: HIGH（1）/);
  elements.get('pause').listeners.click();
  device.push(JSON.stringify({ir:1,pin:20,seq:1,time:200,on:1,edges:[[100,1]],lost:0})+'\n');
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(elements.get('signal-state').textContent,/LOW（0）/);
  setNow(4000);context.controls();assert.equal(elements.get('live-empty').hidden,true);
  assert.match(elements.get('signal-state').textContent,/未観測/);
  await context.stopReceiver();assert.equal(elements.get('receiver-pin').disabled,false);
  assert.equal(elements.get('status').textContent,'');await context.disconnect();
});

test('a previously running receiver can be interrupted without reopening USB',async()=>{
  const device=serialPort(),{context,elements}=page({requestPort:async()=>device.port});
  await context.connect();device.push(JSON.stringify({ir:1,pin:15,seq:0,time:0,on:0,edges:[],lost:0})+'\n');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get('receiver-stop').disabled,false);
  await context.stopReceiver();assert.match(elements.get('receiver-state').textContent,/受信停止/);
  assert.equal(device.trace.filter(x=>x==='open').length,1);await context.disconnect();
});

test('additional GPIO outputs are injected before reception and locked until it stops',async()=>{
  const device=serialPort(),{context,elements}=page({requestPort:async()=>device.port});
  await context.connect();
  context.addAuxiliaryPin(2,1);context.addAuxiliaryPin(5,0);
  await context.startReceiver();
  assert.match(device.code,/AUXILIARY_OUTPUTS = \[\[2,1\],\[5,0\]\]/);
  assert(elements.get('auxiliary-add').disabled);
  for(const row of elements.get('auxiliary-pins').children)assert(row.children.every(field=>field.disabled));
  await context.stopReceiver();
  assert.equal(elements.get('auxiliary-add').disabled,false);
  for(const row of elements.get('auxiliary-pins').children)assert(row.children.every(field=>!field.disabled));
  await context.disconnect();
});

test('duplicate output pins and conflicts with the receiver are rejected before starting hardware',async()=>{
  for(const pins of [[15],[2,2]]){
    const device=serialPort(),{context,elements}=page({requestPort:async()=>device.port});
    await context.connect();for(const pin of pins)context.addAuxiliaryPin(pin,1);
    await context.startReceiver();assert.equal(device.code,'');
    assert.match(elements.get('status').textContent,/重複しないGPIO/);
    await context.disconnect();
  }
});

test('history selection locates the imported recording, and zoom and pan retain microsecond precision',async()=>{
  const {context,elements,blobs}=page();
  elements.get('window').options=[1000,2000,5000,10000,20000,50000,100000,200000,500000,1000000,5000000].map(n=>({value:String(n)}));
  elements.get('window').value='5000000';
  const data={format:'pico-ir-history-2',frames:[{start:500000,durations:[9000,2250,560],session:3,source:'USB'}],streams:[{source:'USB',end:1000000,edges:[[0,0],[500000,1],[509000,0],[511250,1],[511810,0]]}]};
  elements.get('history-file').files=[{size:100,text:async()=>JSON.stringify(data)}];
  await elements.get('history-file').listeners.change();
  context.locateSelected();
  assert.equal(elements.get('window').value,'20000');
  assert.equal(elements.get('live-follow').checked,false);
  assert.equal(vm.runInContext('liveBounds().end',context),515905);
  context.zoomLive(-1);
  assert.equal(elements.get('window').value,'10000');
  assert.equal(vm.runInContext('liveBounds().end',context),510905);
  context.moveLive(510906);
  assert.equal(vm.runInContext('liveBounds().end',context),510906);
  elements.get('pause').listeners.click();assert.equal(vm.runInContext('liveBounds().end',context),510906);
  assert.equal(vm.runInContext('overviewBounds().finish',context),1000000);
  elements.get('pause').listeners.click();assert.equal(vm.runInContext('liveBounds().end',context),510906);
  context.moveLive(2000000);assert.equal(vm.runInContext('liveBounds().end',context),1000000);
  context.moveLive(-100);assert.equal(vm.runInContext('liveBounds().end',context),0);
  elements.get('save').listeners.click();
  const saved=JSON.parse(await blobs[0].text());
  assert.equal(saved.frames[0].session,saved.streams[0].session);
  const again=page();again.elements.get('history-file').files=[{size:100,text:async()=>JSON.stringify(saved)}];
  await again.elements.get('history-file').listeners.change();
  assert.equal(vm.runInContext('selectedRecord().source',again.context),'USB');
});

test('overview clicks and drags navigate the full recording without changing the zoom',()=>{
  const {context,elements}=page();
  vm.runInContext("capture.ingest({ir:1,seq:0,time:0,on:0,edges:[],lost:0});capture.ingest({ir:1,seq:1,time:10000000,on:0,edges:[],lost:0});",context);
  elements.get('window').value='1000000';elements.get('live-follow').checked=true;
  const canvas=elements.get('live-overview');canvas.getBoundingClientRect=()=>({left:0,width:1052});canvas.setPointerCapture=()=>{};
  canvas.listeners.pointerdown({button:0,clientX:538,pointerId:1});
  assert.equal(vm.runInContext('liveBounds().end',context),5500000);assert.equal(elements.get('live-follow').checked,false);
  canvas.listeners.pointermove({clientX:638});assert.equal(vm.runInContext('liveBounds().end',context),6500000);
  canvas.listeners.pointerup();canvas.listeners.pointermove({clientX:738});assert.equal(vm.runInContext('liveBounds().end',context),6500000);
  assert.equal(elements.get('window').value,'1000000');
});

test('wheel zoom changes scale continuously and preserves the time under the pointer',()=>{
  const {context,elements}=page();
  elements.get('window').options=[1000,10000,100000,1000000,5000000].map(n=>({value:String(n)}));
  elements.get('window').value='1000000';
  vm.runInContext('capture.ingest({ir:1,seq:0,time:0,on:0,edges:[],lost:0});capture.ingest({ir:1,seq:1,time:10000000,on:0,edges:[],lost:0})',context);
  context.moveLive(5000000);
  const before=vm.runInContext('liveBounds().begin+liveBounds().span*.25',context);
  const canvas=elements.get('live-wave');canvas.getBoundingClientRect=()=>({left:0,width:1052});
  canvas.listeners.wheel({preventDefault(){},ctrlKey:true,deltaMode:0,deltaY:-5,clientX:288});
  const span=vm.runInContext('liveBounds().span',context);
  assert(span>980000&&span<1000000);assert.equal(elements.get('window').value,'custom');
  assert(Math.abs(vm.runInContext('liveBounds().begin+liveBounds().span*.25',context)-before)<.001);
  context.zoomLive(-1);assert.equal(elements.get('window').value,'100000');
});

test('history places binary beside HEX and the previous-signal interval after the recording time',()=>{
 const {context,elements}=page();
 const durations=require('../pico-blocks.js').signalForByte(65,560);
 elements.get('start').value='2';elements.get('order').value='msb';
 vm.runInContext(`capture.addFrame({durations:${JSON.stringify(durations)},source:'USB',intervalUs:108000,recordedAt:1700000000000});renderHistory()`,context);
 const cells=elements.get('history-rows').children[0].children;
 assert.equal(cells[4].textContent,'41');assert.equal(cells[5].textContent,'01000001');assert.equal(cells[5].className,'history-binary');
 assert.match(cells[6].textContent,/:/);assert.equal(cells[7].textContent,'108.00 ms');
});
