const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Capture,decodeDurations,validateHistory} = require('../docs/live-core.js');

function source(capture) {
  let seq = 0, on = 0;
  return (time, edges = [], lost = 0) => {
    if (edges.length) on = edges.at(-1)[1];
    capture.ingest({ir:1,seq:seq++,time,on,edges,lost});
  };
}

test('OFF reaches exactly 8x the preceding ON; terminal OFF is omitted',()=>{
  const c = new Capture(), send = source(c);
  send(0); send(200,[[100,1],[200,0]]);
  send(999); assert.equal(c.frames.length,0);
  send(1000); assert.deepEqual(c.frames[0].durations,[100]);
  send(2000); assert.equal(c.frames.length,1);
});

test('frame boundaries inside a batch match progressive delivery',()=>{
  const edges = [[100,1],[200,0],[300,1],[400,0],[1300,1],[1400,0]];
  const a = new Capture(), batch = source(a); batch(0);batch(2200,edges);
  const b = new Capture(), incremental = source(b);incremental(0);
  for(const e of edges)incremental(e[0],[e]);incremental(2200);
  const timing=frames=>frames.map(({recordedAt,...frame})=>frame);
  assert.deepEqual(timing(a.frames),timing(b.frames));
  assert.deepEqual(a.frames.map(f=>f.durations),[[100,100,100],[100]]);
});

test('a long ON remains active and uses the measured ON to set the end threshold',()=>{
  const c = new Capture(), send = source(c);
  send(0);send(100,[[100,1]]);send(5000000);
  assert(c.active);assert.equal(c.frames.length,0);
  send(5000100,[[5000100,0]]);send(45000099);
  assert.equal(c.frames.length,0);send(45000100);
  assert.deepEqual(c.frames[0].durations,[5000000]);
});

test('samples decode to A at normal and slow speeds',()=>{
  for(const scale of [1,100]) {
    const durations = [4480,2240];
    for(const bit of '01000001')durations.push(560,bit==='1'?1680:560);
    durations.push(560);
    const c = new Capture(), send=source(c);send(0);
    let time=100, on=1, edges=[];
    for(const d of durations){edges.push([time,on]);time+=d*scale;on=1-on;}
    edges.push([time,0]);send(time+560*scale*8,edges);
    assert.deepEqual(decodeDurations(c.frames[0].durations).bytes,[65]);
    assert.deepEqual(c.frames[0].durations,durations.map(n=>n*scale));
  }
});

test('buffer loss discards an incomplete capture and recovery never joins across a gap',()=>{
  const c=new Capture(),send=source(c);
  send(0);send(200,[[100,1],[200,0]]);send(300,[],2);
  assert.equal(c.active,null);assert.match(c.message,/欠落/);
  send(1200,[[400,1],[500,0]]);send(1300);
  assert.equal(c.frames.length,0);
  send(3000,[[2000,1],[2100,0]]);
  assert.deepEqual(c.frames.map(f=>f.durations),[[100]]);
});

test('a reset or missing packet invalidates the current signal',()=>{
  const c=new Capture();c.ingest({ir:1,seq:10,time:1000,on:0,edges:[],lost:0});
  c.ingest({ir:1,seq:12,time:500,on:0,edges:[],lost:0});
  assert.match(c.message,/不連続/);assert.equal(c.frames.length,0);
  c.resetStream();assert.equal(c.recovering,false);
});

test('history limits preserve an externally selected record without unbounded growth',()=>{
  const c=new Capture({maxFrames:2,maxDurations:4});
  const selected=c.addFrame({durations:[100],source:'USB'});
  c.addFrame({durations:[200],source:'USB'});c.addFrame({durations:[300],source:'USB'});
  assert.equal(c.frames.length,2);assert.deepEqual(selected.durations,[100]);
  c.addFrame({durations:[1,1,1],source:'USB'});
  assert(c.frames.reduce((n,f)=>n+f.durations.length,0)<=4);
});

test('invalid input is rejected before updating the stream or importing history',()=>{
  const c=new Capture();
  assert.throws(()=>c.ingest({ir:1,seq:0,time:1,on:0,edges:[[2,1]],lost:0}));
  assert.equal(c.time,null);
  for(const durations of [[1,2],[0],[-1],[true],[Infinity]])assert.throws(()=>validateHistory({format:'pico-ir-history-1',frames:[{durations}]}));
  assert.deepEqual(validateHistory({format:'pico-ir-history-1',frames:[{durations:[100,100,100]}]})[0].durations,[100,100,100]);
});

test('the selected capture stays available in saved history when old captures expire',()=>{
  const c=new Capture({maxFrames:2,maxDurations:4});
  const selected=c.addFrame({durations:[100],source:'USB'});c.protectedId=selected.id;
  c.addFrame({durations:[200],source:'USB'});c.addFrame({durations:[300],source:'USB'});
  assert.deepEqual(c.frames.map(f=>f.durations),[[100],[300]]);
});

test('named signals retain recording metadata and older history files remain valid',()=>{
  const {Capture,validateHistory}=require('../docs/live-core.js');
  const capture=new Capture(),frame=capture.addFrame({durations:[100,100,100],source:'USB'});
  assert(Number.isSafeInteger(frame.recordedAt));frame.name='電源';
  const saved=JSON.parse(JSON.stringify({format:'pico-ir-history-1',frames:[frame]}));
  assert.equal(validateHistory(saved)[0].name,'電源');assert.equal(validateHistory(saved)[0].recordedAt,frame.recordedAt);
  assert.equal(validateHistory({format:'pico-ir-history-1',frames:[{durations:[100]}]}).length,1);
  assert.throws(()=>validateHistory({format:'pico-ir-history-1',frames:[{durations:[100],name:3}]}));
  assert.throws(()=>validateHistory({format:'pico-ir-history-1',frames:[{durations:[100],recordedAt:-1}]}));
});

test('live transitions remain beyond twenty seconds and old sessions survive stream resets',()=>{
  const c=new Capture(),send=source(c);send(0);send(1000,[[100,1],[200,0]]);send(60000000);
  assert(c.live.some(e=>e.time===100));c.resetStream();assert.equal(c.recordings[0].end,60000000);
  assert.deepEqual(c.recordings[0].edges.map(e=>e.time),[0,100,200]);
  const bounded=new Capture({maxLiveEdges:3}),push=source(bounded);push(0);push(1000,[[100,1],[200,0],[300,1],[400,0]]);
  assert.equal(bounded.live.length,3);assert.equal(bounded.droppedEdges,2);
});

test('repeat candidates keep their own raw frame and the start-to-start interval',()=>{
  const {signalKind,visibleEdges}=require('../docs/live-core.js'),c=new Capture(),send=source(c);send(0);
  const full=[9000,4500];for(let i=0;i<32;i++)full.push(560,i%2?1690:560);full.push(560);
  let start=100,on=1,edges=[];for(const d of full){edges.push([start,on]);start+=d;on=1-on;}edges.push([start,0]);send(start+5000,edges);
  const repeat=[9000,2250,560],repeatStart=110100;start=repeatStart;on=1;edges=[];for(const d of repeat){edges.push([start,on]);start+=d;on=1-on;}edges.push([start,0]);send(start+5000,edges);
  assert.equal(c.frames.length,2);assert.equal(signalKind(c.frames[0].durations),'NEC候補');assert.equal(signalKind(c.frames[1].durations),'リピート候補');assert.equal(c.frames[1].intervalUs,110000);
  assert.deepEqual(c.frames[1].durations,repeat);
  assert.deepEqual(visibleEdges([{time:0,on:0},{time:100,on:1},{time:200,on:0},{time:300,on:1}],150,250).map(e=>e.time),[100,200,300]);
});

test('live recordings round-trip with frames and reject unordered edges before import',()=>{
  const data={format:'pico-ir-history-2',frames:[],streams:[{source:'USB',recordedAt:0,end:100,edges:[[0,0],[50,1],[100,0]]}]};
  validateHistory(data);const c=new Capture();c.importStreams(data.streams);assert.equal(c.recordings[0].edges[1].time,50);
  data.streams[0].edges[1][0]=101;assert.throws(()=>validateHistory(data));
});

test('overview preserves sub-pixel pulses and carries levels across empty columns',()=>{
  const {overviewLevels}=require('../docs/live-core.js');
  const edges=[{time:0,on:0},{time:501,on:1},{time:502,on:0}];
  const levels=overviewLevels(edges,0,1000,10);
  assert.equal(levels[5],3);assert.equal(levels[0],1);assert.equal(levels[9],1);
  assert.deepEqual(Array.from(overviewLevels([{time:0,on:1},{time:900,on:0}],100,800,4)),[2,2,2,2]);
});

test('IR decoding separates zero and one at the midpoint ratio of two',()=>{
  for(const [ratio,bit] of [[.4,'0'],[.61,'0'],[1.6,'0'],[1.8,'0'],[1.999,'0'],[2,'1'],[2.19,'1'],[4.2,'1'],[4.3,'1'],[0,'?']])assert.equal(decodeDurations([8000,4000,1000,ratio*1000,1000]).bits[0],bit);
});
