const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PicoREPL}=require('../pico-repl.js');
function fakePort(result='OKhello\r\n\x04\x04>'){
  const trace=[],queue=[];let waiting,locked=false,writerLocked=false,code='';
  function push(text){const item=typeof text==='string'?{value:new TextEncoder().encode(text),done:false}:text;if(waiting){const resolve=waiting;waiting=null;resolve(item);}else queue.push(item);}
  const reader={read(){return queue.length?Promise.resolve(queue.shift()):new Promise(resolve=>waiting=resolve);},async cancel(){trace.push('cancel');push({done:true});},releaseLock(){trace.push('reader-release');locked=false;}};
  const writer={async write(data){const text=new TextDecoder().decode(data);trace.push(text);
    if(text==='\r\x03\x03\x02')push('MicroPython\r\n>>> ');
    else if(text==='\x01')push('raw REPL; CTRL-B to exit\r\n>');
    else if(text==='\x04')push(result);
    else if(text==='\x03\x03')push('\x04KeyboardInterrupt\r\n\x04>');
    else code+=text;
  },releaseLock(){trace.push('writer-release');writerLocked=false;}};
  const port={async open(){trace.push('open');},readable:{getReader(){locked=true;return reader;}},writable:{getWriter(){writerLocked=true;return writer;}},async close(){assert(!locked&&!writerLocked);trace.push('close');}};
  return {port,trace,push,get code(){return code;}};
}

test('raw REPL accepts the generated code and processes completion markers',async()=>{
  const output=[],states=[],d=fakePort();const p=new PicoREPL({onOutput:t=>output.push(t),onState:s=>states.push(s)});
  await p.connect(d.port);await p.run('print(123)\n');
  assert.equal(d.code,'print(123)\n');assert.equal(output.join(''),'hello\r\n');assert.equal(p.running,false);
  assert(states.includes('uploading')&&states.includes('running'));
  await p.disconnect();assert.equal(d.trace.at(-1),'close');
});

test('stop interrupts the running program, then disconnect releases both USB locks',async()=>{
  const d=fakePort('OK');const p=new PicoREPL();await p.connect(d.port);await p.run('while True: pass\n');
  assert.equal(p.running,true);await p.disconnect();
  assert(d.trace.includes('\x03\x03'));assert.equal(p.port,null);
  assert(d.trace.indexOf('reader-release')<d.trace.indexOf('close'));
  assert(d.trace.indexOf('writer-release')<d.trace.indexOf('close'));
});

test('MicroPython errors are shown as errors, rather than mistaken for success output',async()=>{
  const messages=[],d=fakePort('OK\x04SyntaxError: invalid syntax\r\n\x04>');
  const p=new PicoREPL({onOutput:(text,error)=>messages.push([text,error])});
  await p.connect(d.port);await p.run('invalid\n');
  assert.equal(messages.filter(x=>x[1]).map(x=>x[0]).join(''),'SyntaxError: invalid syntax\r\n');
  assert.equal(p.running,false);await p.disconnect();
});

test('opening a busy port leaves no retained connection',async()=>{
  const p=new PicoREPL();await assert.rejects(p.connect({open:async()=>{throw Error('busy');}}),/busy/);assert.equal(p.port,null);
});

test('filesystem commands return captured output and reject MicroPython errors',async()=>{
  const d=fakePort('OK{"changed":3}\r\n\x04\x04>'),p=new PicoREPL();await p.connect(d.port);
  assert.deepEqual(JSON.parse(await p.exec('print(123)\n')),{changed:3});await p.disconnect();
  const e=fakePort('OK\x04OSError: full\r\n\x04>'),q=new PicoREPL();await q.connect(e.port);
  await assert.rejects(q.exec('raise OSError()\n'),/full/);await q.disconnect();
});

test('console evaluates expressions, executes statements, and retains variables between commands',async()=>{
  const {spawnSync}=require('node:child_process');
  const p=new PicoREPL(),commands=[];
  p.run=async code=>commands.push(code);
  await p.repl('x = [1, 2, 3]');await p.repl('sum(x)');await p.repl('def double(n):\n    return n * 2');await p.repl('double(x[1])');
  const result=spawnSync('python3',['-c',commands.join('\n')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'6\n4\n');
});

test('running input receives a UTF-8 line without restarting raw REPL and remains interruptible',async()=>{
  const d=fakePort('OK名前は？ '),output=[],p=new PicoREPL({onOutput:text=>output.push(text)});
  await assert.rejects(p.sendInput('test'),/実行中/);
  await p.connect(d.port);await p.repl('print(input("名前は？ "))');
  const before=d.trace.length;
  for(const text of ['bad\nline','\x03','\x04'])await assert.rejects(p.sendInput(text),/制御文字/);
  assert.equal(d.trace.length,before);
  await p.sendInput('ピコ');assert.equal(d.trace.at(-1),'ピコ\r');
  assert.equal(d.trace.filter(item=>item==='\x01').length,1);
  d.push('ピコ\r\n\x04\x04>');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(p.running,false);assert.equal(output.join(''),'名前は？ ピコ\r\n');
  await assert.rejects(p.sendInput('late'),/実行中/);await p.disconnect();
  const next=fakePort('OK'),q=new PicoREPL();await q.connect(next.port);await q.repl('input()');await q.sendInput('');
  assert.equal(next.trace.at(-1),'\r');await q.stop();assert.equal(q.running,false);await q.disconnect();
});
