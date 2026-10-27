const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const samples=require('../docs/studio-samples.js');

const harness=`import ast,contextlib,io,json,sys,types
data=json.load(sys.stdin)
for sample in data['samples'].values():
 for path,source in sample['files'].items():ast.parse(source,filename=path)
namespace={}
tree=ast.parse(open('docs/programs/pico_parts.py').read())
infrared=next(node for node in tree.body if isinstance(node,ast.ClassDef) and node.name=='Infrared')
send=next(node for node in infrared.body if isinstance(node,ast.FunctionDef) and node.name=='send')
exec(compile(ast.Module(body=[send],type_ignores=[]),'<send>','exec'),namespace)
ir=types.ModuleType('ir_data');exec(open('docs/programs/ir_data.py').read(),ir.__dict__);sys.modules['ir_data']=ir
class Finished(Exception):pass
events=[];frames=[]
class Transmitter:
 def send(self,value):namespace['send'](self,value)
 def send_bits(self,bits):frames.append(bits)
clock=types.ModuleType('time');clock.sleep=lambda seconds:events.append(('sleep',seconds));sys.modules['time']=clock
parts=types.ModuleType('parts');parts.送信機=Transmitter();sys.modules['parts']=parts
entries=iter(data['messages'])
def read(prompt):
 assert prompt=='送る文: '
 try:return next(entries)
 except StopIteration:raise Finished
def run(source,input_=None):
 output=io.StringIO()
 with contextlib.redirect_stdout(output):
  try:exec(source,{'input':input_})
  except Finished:pass
 return output.getvalue().splitlines()
sender_output=run(data['samples'][data['send']]['files']['main.py'],read)
if data.get('corrupt'):frames[:0]=[[1]*8,[0,0,0,0,1,0,1,0]]
assert all(len(bits)==8 for bits in frames)
received=iter(frames)
class Receiver:
 def receive_bits(self,timeout):
  try:bits=next(received)
  except StopIteration:raise Finished
  times=[4480,2240]
  for bit in bits:times.extend([560,1680 if bit else 560])
  times.append(560)
  return ir.durations_to_bits(times)
class Power:
 def on(self):events.append(('power',2))
class Screen:
 def text(self,message,line):events.append(('screen',message,line))
parts.受信機=Receiver();parts.画面の電源=Power();parts.画面=Screen()
receiver_output=run(data['samples'][data['receive']]['files']['main.py'])
print(json.dumps({'sender':sender_output,'receiver':receiver_output,'events':events,'frames':len(frames)}))
`;
function exchange(send,receive,messages,corrupt=false){
 const modes=['ascii_send','ascii_receive','ascii_display','utf8_send','utf8_receive'];
 const result=spawnSync('python3',['-c',harness],{input:JSON.stringify({samples:Object.fromEntries(modes.map(mode=>[mode,samples.message(mode)])),send,receive,messages,corrupt}),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
test('ASCII console input becomes 8-bit IR frames and complete messages, rejecting non-ASCII before sending',()=>{
 const result=exchange('ascii_send','ascii_receive',['HELLO','日本語','','BYE']);
 assert.deepEqual(result.receiver,['受信待ち','HELLO','','BYE']);
 assert(result.sender.includes('ASCII文字で入力してください'));
 assert.equal(result.frames,11);
 assert(result.events.every(([kind,seconds])=>kind==='sleep'&&seconds===.02));
});
test('the ASCII display receiver powers GP2 before showing each complete message on line 1',()=>{
 const result=exchange('ascii_send','ascii_display',['HELLO','Pico']);
 const power=result.events.findIndex(event=>event[0]==='power');
 assert.deepEqual(result.events[power],['power',2]);
 assert.deepEqual(result.events[power+1],['sleep',.1]);
 assert.deepEqual(result.events.slice(power+2),[['screen','HELLO',1],['screen','Pico',1]]);
});
test('UTF-8 messages reassemble multibyte characters and recover after an invalid message',()=>{
 const result=exchange('utf8_send','utf8_receive',['こんにちは','A🙂B'],true);
 assert.deepEqual(result.receiver,['受信待ち','UTF-8として読めないデータです','こんにちは','A🙂B']);
});
