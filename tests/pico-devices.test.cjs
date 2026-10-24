const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Connections}=require('../pico-devices.js');
class REPL{
  constructor(callbacks){Object.assign(this,callbacks);this.port=null;this.busy=false;this.running=false;this.opens=0;}
  async connect(port){this.port=port;this.opens++;this.onState('connected');}
  async run(){this.running=true;this.onState('running');}
  async stop(){this.running=false;this.onState('connected');}
  async disconnect(){this.port=null;this.onState('disconnected');}
}
test('one Pico connection is shared by both roles and a second board can be selected independently',async()=>{
  const pool=new Connections(REPL),events=[],program=pool.forRole('program',{onState:s=>events.push(['program',s])}),observer=pool.forRole('observer',{onState:s=>events.push(['observer',s])});
  const first={id:1},second={id:2};await observer.connect(first);
  assert.equal(program.port,first);assert.equal(observer.port,first);assert.equal(pool.devices[0].link.opens,1);
  await program.connect(first);assert.equal(pool.devices[0].link.opens,1);
  await observer.run('receiver');assert.equal(program.running,true);assert.equal(program.task,'observer');
  await program.stop();assert.equal(observer.running,false);
  pool.select('program','2');await program.connect(second);
  assert.equal(observer.port,first);assert.equal(program.port,second);
  await observer.disconnect();assert.equal(program.port,second);assert(events.some(([role,s])=>role==='program'&&s==='running'));
});
test('busy port selection is rejected and output only follows the selected board',()=>{
  const pool=new Connections(REPL),output=[];pool.forRole('observer',{onOutput:t=>output.push(t)});
  pool.devices[0].link.busy=true;assert.throws(()=>pool.select('observer','2'),/待って/);
  pool.devices[0].link.busy=false;pool.select('observer','2');
  pool.devices[0].link.onOutput('other');pool.devices[1].link.onOutput('selected');assert.deepEqual(output,['selected']);
});
test('both roles are notified after an asynchronous operation releases the port',async()=>{
  class BusyREPL extends REPL{
    async run(){this.busy=true;try{this.running=true;this.onState('running');await Promise.resolve();}finally{this.busy=false;}}
  }
  const pool=new Connections(BusyREPL),states=[];
  const program=pool.forRole('program',{onState:()=>states.push(program.busy)});
  const observer=pool.forRole('observer',{});
  await observer.run();
  assert.deepEqual(states,[true,false]);
});

test('the shared selector follows the active tab while keeping each role assignment',()=>{
  const {JSDOM}=require('jsdom'),dom=new JSDOM('<select></select>');
  const previous=global.document;global.document=dom.window.document;
  try{
    const pool=new Connections(REPL),select=document.querySelector('select');let role='program';
    pool.bindSelect(select,()=>role);pool.select('program','2');assert.equal(select.value,'2');
    assert.equal(select.options[1].textContent,'Pico 2 · 未接続');
    pool.devices[1].link.port={};pool.changed();assert.equal(select.options[1].textContent,'Pico 2 · 接続済み');
    role='observer';pool.changed();assert.equal(select.value,'1');
    select.value='2';select.dispatchEvent(new dom.window.Event('change'));assert.equal(pool.roles.observer,'2');
    role='program';pool.changed();select.value='1';select.dispatchEvent(new dom.window.Event('change'));
    assert.equal(pool.roles.program,'1');assert.equal(pool.roles.observer,'2');
  }finally{global.document=previous;dom.window.close();}
});

test('program output from an unselected Pico can be retained while ordinary role output stays selected',()=>{
 const pool=new Connections(REPL),background=[],selected=[];
 pool.forRole('program',{onOutput:text=>selected.push(text),onDeviceOutput:(id,event,text)=>background.push([id,event,text])});
 pool.devices[1].link.onOutput('two');pool.devices[0].link.onOutput('one');
 assert.deepEqual(selected,['one']);assert.deepEqual(background,[['2','onOutput','two']]);
 pool.select('program','2');pool.devices[0].link.onIdleOutput('idle one');assert.deepEqual(background.at(-1),['1','onIdleOutput','idle one']);
});
