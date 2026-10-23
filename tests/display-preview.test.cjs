const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const {Surface}=require('../display-preview.js');
const font=vm.runInNewContext(fs.readFileSync('vendor/petme128.js','utf8')+';Array.from(PicoFont8x8)');

test('pixel preview buffers edits, returns their values, and publishes only on show',()=>{
  const s=new Surface(128,64,font);
  for(let x=0;x<64;x++)s.apply({op:'pixel',x,y:x,value:1});
  assert.equal(s.pixel(63,63),1);assert.equal(s.pixel(62,63),0);
  assert.equal(s.visible.reduce((a,b)=>a+b),0);assert(s.dirty);
  s.apply({op:'show'});assert(!s.dirty);assert.equal(s.visible.reduce((a,b)=>a+b),64);
  s.apply({op:'pixel',x:63,y:63,value:0});assert.equal(s.visible[63*128+63],1);
  s.apply({op:'fill',value:0});assert.equal(s.buffer.reduce((a,b)=>a+b),0);
  s.apply({clear:true});assert.equal(s.visible.reduce((a,b)=>a+b),0);
  for(const args of [[128,0,1],[0,64,1],[.5,0,1],[0,0,2]])assert.throws(()=>s.pixel(...args));
});

test('coordinate text uses the MicroPython font, clips at edges, and row text still replaces and shows immediately',()=>{
  const s=new Surface(128,32,font);
  s.apply({op:'text',x:10,y:9,text:'A'});
  for(let x=0;x<8;x++)for(let y=0;y<8;y++)assert.equal(s.pixel(10+x,9+y),Boolean(font[(65-32)*8+x]&(1<<y))?1:0);
  assert(s.dirty);s.apply({op:'text',x:127,y:31,text:'A'});
  s.apply({row:2,text:'Pico'});assert(!s.dirty);
  s.apply({row:2,text:''});assert.equal(s.buffer.slice(8*128,16*128).reduce((a,b)=>a+b),0);
});
