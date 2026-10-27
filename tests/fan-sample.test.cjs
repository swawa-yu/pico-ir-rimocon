const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const samples=require('../dist/studio-samples.js');

test('received 8-bit percentages control the fan; invalid signals are ignored and stopping turns it off',()=>{
  const source=samples.beginner('fan_receive').files['main.py'];
  const result=spawnSync('python3',['-c',`
import contextlib,io,json,sys,types
ir=types.ModuleType('ir_data')
exec(open('dist/programs/ir_data.py').read(),ir.__dict__)
sys.modules['ir_data']=ir
frames=iter([[],[1]*7,ir.int_to_bits(0),ir.int_to_bits(60),ir.int_to_bits(100),ir.int_to_bits(101),ir.int_to_bits(255),[1]*16])
events=[]
class Finished(BaseException):pass
def receive(timeout):
    try:return next(frames)
    except StopIteration:raise Finished
parts=types.ModuleType('parts')
parts.赤外線センサー=types.SimpleNamespace(receive_bits=receive)
parts.扇風機=types.SimpleNamespace(set=events.append)
sys.modules['parts']=parts
with contextlib.redirect_stdout(io.StringIO()):
    try:exec(json.load(sys.stdin),{})
    except Finished:pass
print(json.dumps(events))
`],{input:JSON.stringify(source),encoding:'utf8'});
  assert.equal(result.status,0,JSON.stringify(result));
  assert.deepEqual(JSON.parse(result.stdout),[0,60,100,0]);
});
