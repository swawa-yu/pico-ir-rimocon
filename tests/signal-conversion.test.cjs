const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {convert,maxBits}=require('../signal-conversion.js');

test('handwritten timings remain exact and decode each ON/OFF pair with the same threshold as the analyzer',()=>{
 const times=[560,560,560,1120,560],result=convert('times',JSON.stringify(times));
 assert.deepEqual(result.times,times);assert.deepEqual(result.bits,[0,1]);assert.equal(result.binary,'01');assert.equal(result.number,'1');assert.equal(result.text,null);
 const withLeader=[9000,4500,...times];assert.deepEqual(convert('times',JSON.stringify(withLeader),{leader:'long'}).bits,[0,1]);
 assert.deepEqual(convert('times','[560, 560,]',{}).bits,[0]);
 assert.equal(convert('times','[560]').number,null);
});

test('bits, binary strings, UTF-8 and fixed-width numbers convert to the same waveform and keep leading zeroes',()=>{
 const fromText=convert('text','A'),fromBits=convert('bits','[0,1,0,0,0,0,0,1]'),fromString=convert('binary','"0100_0001"'),fromNumber=convert('number','65',{width:8});
 for(const value of [fromText,fromBits,fromString,fromNumber]){
  assert.equal(value.binary,'01000001');assert.equal(value.number,'65');assert.equal(value.text,'A');assert.deepEqual(value.times,fromText.times);
  assert.deepEqual(convert('times',JSON.stringify(value.times)).bits,value.bits);
 }
 assert.equal(convert('number','0',{width:8}).binary,'00000000');
 assert.equal(convert('number','0b01001011_01001011',{width:16}).binary,'0100101101001011');
 assert.equal(convert('number','18446744073709551615',{width:64}).number,'18446744073709551615');
 assert.equal(convert('text','あ').text,'あ');assert.equal(convert('text','\uFEFFA').text,'\uFEFFA');
 assert.equal(convert('bits','[1,1,1,1,1,1,1,1]').text,null);
});

test('byte bit order and headers round-trip independently of chronological waveform bits',()=>{
 for(const leader of ['none','short','long'])for(const text of ['A','あ']){
  const encoded=convert('text',text,{lsb:true,leader});
  assert.equal(encoded.text,text);
  assert.deepEqual(convert('times',JSON.stringify(encoded.times),{lsb:true,leader}).bits,encoded.bits);
 }
 assert.equal(convert('text','A',{lsb:true}).binary,'10000010');
 const custom=[100,100,200,200,560,1680,560];assert.equal(convert('times',JSON.stringify(custom),{start:4}).binary,'1');
});

test('malformed, overflowing and excessive inputs fail without guessing a conversion',()=>{
 for(const [kind,text,settings] of [
  ['times','[560, 0]'],['times','[560, 0.5]'],['times','[9007199254740991, 1]'],['times','alert(1)'],
  ['bits','[0,2]'],['bits','[]'],['binary','0102'],['text',''],['number','-1'],['number','1.5'],['number','0b_1'],['number','256',{width:8}],
  ['number','1',{width:0}],['number','1',{width:maxBits+1}],['bits',JSON.stringify(Array(maxBits+1).fill(0))],
  ['text','あ'.repeat(86)],['times','[560,560]',{start:1}],['times','[560]',{start:2}],['bits','[1]',{unit:0}]
 ])assert.throws(()=>convert(kind,text,settings),kind+': '+text.slice(0,24));
});

function page(){
 const dom=new JSDOM(fs.readFileSync('live-analyzer.html','utf8'),{runScripts:'outside-only',url:'https://example.test/'}),w=dom.window,draws=[];
 w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
 w.LiveAnalyzer={currentCapture:()=>null,drawSignal(canvas,width,times,result,focused){draws.push({times,result,focused});return times.map((d,i)=>({a:i*10,b:(i+1)*10,index:i}));}};
 w.eval(fs.readFileSync('signal-conversion.js','utf8'));w.eval(fs.readFileSync('signal-converter.js','utf8'));
 return {w,draws,$:id=>w.document.getElementById(id),close:async()=>{await new Promise(resolve=>setTimeout(resolve,0));w.close();}};
}

test('converter switches input representations, links a selected bit to the waveform and clears stale output on error',async()=>{
 const p=page();try{
  p.$('signal-converter').open=true;p.$('conversion-apply').click();assert.equal(p.$('conversion-bits').value,'[0,1]');
  p.$('conversion-kind').value='text';p.$('conversion-kind').dispatchEvent(new p.w.Event('change'));p.$('conversion-input').value='A';p.$('conversion-apply').click();
  assert.equal(p.$('conversion-number').value,'65');assert.equal(p.$('conversion-text').value,'"A"');
  p.$('conversion-bit-buttons').children[1].click();assert.equal(p.draws.at(-1).focused,1);assert.match(p.$('conversion-selection').textContent,/ビット 1：1.*OFF 1,680/);
  p.$('conversion-kind').value='number';p.$('conversion-kind').dispatchEvent(new p.w.Event('change'));assert.equal(p.$('conversion-input').value,'65');assert.equal(p.$('conversion-width-wrap').hidden,false);
  p.$('conversion-input').value='256';p.$('conversion-apply').click();assert.equal(p.$('conversion-result').hidden,true);assert.match(p.$('conversion-error').textContent,/収まりません/);
 }finally{await p.close();}
});

test('a fixed capture loads exact timings, bit order and data position without changing captured data',async()=>{
 const p=page();try{
  const times=convert('text','A',{leader:'long',lsb:true}).times;times[0]=9000;times[1]=4500;
  p.w.SignalConverter.setCapture(times,2,true);p.$('capture-convert').click();
  assert.equal(p.$('signal-converter').open,true);assert.equal(p.$('conversion-start').value,'2');assert.equal(p.$('conversion-order').value,'lsb');
  assert.deepEqual(JSON.parse(p.$('conversion-times').value),times);assert.equal(p.$('conversion-number').value,'65');
  p.$('conversion-input').value='[100,100]';p.$('conversion-start').value=0;p.$('conversion-apply').click();
  p.$('conversion-capture').click();assert.deepEqual(JSON.parse(p.$('conversion-times').value),times);
 }finally{await p.close();}
});
