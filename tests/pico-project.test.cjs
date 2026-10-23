const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const P=require('../pico-project.js');
const files={'main.py':'from parts import infrared\ninfrared.send(65)\n','parts.py':'# 設定\n','lib/pico_parts.py':'# library\n'};
function run(body){const r=spawnSync('python3',['-c',`import sys,os,tempfile,json,types,binascii
sys.modules['ubinascii']=binascii
with tempfile.TemporaryDirectory() as directory:
 os.chdir(directory)
 chdir = os.chdir
 os.chdir = lambda path: chdir(directory if path == '/' else path)
${body.split('\n').map(l=>' '+l).join('\n')}`],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;}
const source=P.transfer(files),inspection=P.inspect(files);
test('transfer creates three files, preserves unrelated files and backs up overwritten data',()=>{
  const out=run(`open('main.py','w').write('original')
open('student.py','w').write('keep')
exec(${JSON.stringify(inspection)})
exec(${JSON.stringify(source)})
assert open('main.py').read() == ${JSON.stringify(files['main.py'])}
assert open('parts.py').read() == ${JSON.stringify(files['parts.py'])}
assert open('lib/pico_parts.py').read() == ${JSON.stringify(files['lib/pico_parts.py'])}
assert open('student.py').read() == 'keep'
assert open('.pico-studio-0/backup-0').read() == 'original'
exec(${JSON.stringify(source)})
assert not os.path.exists('.pico-studio-1')`);
  const lines=out.trim().split('\n').map(JSON.parse);assert.equal(lines[0][0].exists,true);assert.equal(lines[1].changed,3);assert.equal(lines[2].changed,0);
});
test('a failed installation restores every original file',()=>{
  run(`os.mkdir('lib')
for path in ${JSON.stringify(Object.keys(files))}: open(path,'w').write('original '+path)
rename=os.rename
failed=False
def fail_once(a,b):
 global failed
 if b == 'parts.py' and '/stage-' in a and not failed:
  failed=True
  raise OSError('injected failure')
 return rename(a,b)
os.rename=fail_once
try:
 exec(${JSON.stringify(source)})
 raise AssertionError('expected failure')
except OSError: pass
finally: os.rename=rename
for path in ${JSON.stringify(Object.keys(files))}: assert open(path).read() == 'original '+path`);
});
test('a failed staging write leaves target files intact',()=>{
  run(`open('main.py','w').write('original')
import builtins
original_open=builtins.open
def fail_stage(path,*args,**kwargs):
 if '/stage-1' in path: raise OSError('no space')
 return original_open(path,*args,**kwargs)
builtins.open=fail_stage
try:
 exec(${JSON.stringify(source)})
 raise AssertionError('expected failure')
except OSError: pass
finally: builtins.open=original_open
assert open('main.py').read() == 'original'
assert not os.path.exists('parts.py')`);
});
test('conflicting directories and unexpected paths are rejected before writes',()=>{
  assert.throws(()=>P.transfer({'../main.py':'bad'}));
  for(const cache of ['__pycache__/main.pyc','.mypy_cache/meta.json','lib/__pycache__/pico_parts.pyc'])assert.throws(()=>P.transfer({...files,[cache]:'cache'}));
  run(`open('lib','w').write('keep')
try:
 exec(${JSON.stringify(source)})
 raise AssertionError('expected failure')
except ValueError: pass
assert open('lib').read() == 'keep'
assert not os.path.exists('main.py')`);
});

test('launch runs the installed files, clears cached modules, and closes the driver',()=>{
  const first={'main.py':'from parts import value\nactivity_value = value * 10\nprint(value)\n','parts.py':'value = 1\n','lib/pico_parts.py':'def close():\n print("closed")\n'};
  const second={...first,'parts.py':'value = 2\n'};
  const out=run(`sys.dont_write_bytecode=True
sys.path.insert(0, os.getcwd() + '/lib')
exec(${JSON.stringify(P.transfer(first))})
exec(${JSON.stringify(P.launch)})
os.mkdir('data')
os.chdir('data')
exec(${JSON.stringify(P.transfer(second))})
exec(${JSON.stringify(P.launch)})
assert _studio_namespace['activity_value'] == 20
assert open('.pico-studio-1/backup-0').read() == 'value = 1\\n'`);
  const lines=out.trim().split('\n');assert.deepEqual(lines.slice(1,3),['1','closed']);assert.deepEqual(lines.slice(-2),['2','closed']);
});

test('invalid edited Python is rejected before overwriting Pico files',()=>{
  const invalid={...files,'main.py':'def broken(:\n'};
  run(`open('main.py','w').write('original')
try:
 exec(${JSON.stringify(P.transfer(invalid))})
 raise AssertionError('expected syntax error')
except SyntaxError: pass
assert open('main.py').read() == 'original'
assert not os.path.exists('.pico-studio-0')`);
});

test('browsing lists folders, compares bytes and reads content without modifying Pico files',()=>{
  const out=run(`import builtins
root=os.getcwd()
original_open=builtins.open
original_stat=os.stat
original_listdir=os.listdir
def mapped(path):
 return root + path if path.startswith('/') and not path.startswith(root + '/') else path
builtins.open=lambda path,*a,**k: original_open(mapped(path),*a,**k)
os.stat=lambda path: original_stat(mapped(path))
os.listdir=lambda path: original_listdir(mapped(path))
os.mkdir('lib')
open('main.py','w').write(${JSON.stringify(files['main.py'])})
open('boot.py','w').write('# boot\\n')
open('lib/pico_parts.py','w').write('# changed\\n')
exec(${JSON.stringify(P.directory('',files))})
exec(${JSON.stringify(P.directory('lib',files))})
exec(${JSON.stringify(P.read('boot.py'))})
exec(${JSON.stringify(P.directory('missing',files))})
assert open('boot.py').read() == '# boot\\n'
assert sorted(os.listdir('.')) == ['boot.py','lib','main.py']`);
  const [root,lib,read,missing]=out.trim().split('\n').map(JSON.parse);
  assert.deepEqual(missing,[]);
  assert(root.find(e=>e.name==='lib').dir);assert.equal(root.find(e=>e.name==='main.py').same,true);
  assert.equal(root.find(e=>e.name==='boot.py').same,null);assert.equal(lib[0].same,false);
  assert.equal(Buffer.from(read.data,'base64').toString(),'# boot\n');
  for(const path of ['../main.py','/main.py','a/../main.py','a\0b'])assert.throws(()=>P.read(path));
});

test('an optional editable SSD1306 driver is included in the verified transfer',()=>{
  const project={...files,'lib/ssd1306.py':'value = 42\n'};
  run(`exec(${JSON.stringify(P.transfer(project))})
assert open('lib/ssd1306.py').read() == 'value = 42\\n'`);
  assert.throws(()=>P.transfer({...files,'lib/../other.py':'bad'}));
});

test('successful transfers retain only their latest backup and leave failed and unmarked recovery folders intact',()=>{
  const second={...files,'parts.py':'# second\n'},third={...files,'parts.py':'# third\n'};
  run(`exec(${JSON.stringify(source)})
assert os.path.exists('.pico-studio-0/complete')
os.mkdir('.pico-studio-1')
open('.pico-studio-1/stage-0','w').write('failed staging data')
os.mkdir('.pico-studio-2')
open('.pico-studio-2/backup-0','w').write('legacy backup')
exec(${JSON.stringify(P.transfer(second))})
assert not os.path.exists('.pico-studio-0')
assert open('.pico-studio-3/backup-0').read() == ${JSON.stringify(files['parts.py'])}
exec(${JSON.stringify(P.transfer(third))})
assert not os.path.exists('.pico-studio-3')
assert open('.pico-studio-0/backup-0').read() == ${JSON.stringify(second['parts.py'])}
assert open('.pico-studio-1/stage-0').read() == 'failed staging data'
assert open('.pico-studio-2/backup-0').read() == 'legacy backup'
assert os.path.exists('.pico-studio-0/complete')`);
});

test('failed transfers preserve both the previous successful backup and their recovery data',()=>{
  const next={...files,'parts.py':'# next\n'};
  run(`exec(${JSON.stringify(source)})
rename=os.rename
def fail(a,b):
 if '/stage-' in a: raise OSError('injected failure')
 return rename(a,b)
os.rename=fail
try:
 exec(${JSON.stringify(P.transfer(next))})
 raise AssertionError('expected failure')
except OSError: pass
finally: os.rename=rename
assert os.path.exists('.pico-studio-0/complete')
assert not os.path.exists('.pico-studio-1/complete')
assert open('.pico-studio-1/stage-0').read() == ${JSON.stringify(next['parts.py'])}
assert open('parts.py').read() == ${JSON.stringify(files['parts.py'])}`);
});

test('cleanup errors are reported separately from a successful installation and unknown files are retained',()=>{
  const next={...files,'parts.py':'# next\n'};
  const out=run(`exec(${JSON.stringify(source)})
remove=os.remove
def fail(path):
 if path.startswith('.pico-studio-0/'): raise OSError('injected cleanup failure')
 return remove(path)
os.remove=fail
exec(${JSON.stringify(P.transfer(next))})
os.remove=remove
assert open('parts.py').read() == ${JSON.stringify(next['parts.py'])}
assert os.path.exists('.pico-studio-1/complete')
open('.pico-studio-1/student.txt','w').write('keep')
exec(${JSON.stringify(P.transfer(files))})
assert open('.pico-studio-1/student.txt').read() == 'keep'`);
  assert.deepEqual(JSON.parse(out.trim().split('\n')[1]).cleanupErrors,['.pico-studio-0']);
});

async function streamed(files,root='.pico-studio-0'){
  const commands=[];
  await P.upload({async exec(code){commands.push(code);return JSON.stringify(commands.length===2?{root}:{backup:root,changed:3});}},files);
  return commands;
}
const execute=commands=>commands.map(code=>`exec(${JSON.stringify(code)})`).join('\n');

test('streamed uploads send small commands, preserve UTF-8 and install the same bytes without retaining payloads in RAM',async()=>{
  const large={...files,'main.py':'# '+'教材'.repeat(6000)+'\nprint(65)\n'};
  const commands=await streamed(large);
  assert(commands.length>20);
  assert(Math.max(...commands.map(c=>Buffer.byteLength(c)))<10000);
  run(`_files={'legacy':'x'*20000}
_studio_namespace={'old_activity':'x'*20000}
open('main.py','w').write('original')
${execute(commands)}
assert '_files' not in globals()
assert '_studio_namespace' not in globals()
assert '_studio_fileop' not in globals()
assert '_data' not in globals()
assert open('main.py').read() == ${JSON.stringify(large['main.py'])}
assert open('.pico-studio-0/backup-0').read() == 'original'
assert os.path.exists('.pico-studio-0/complete')`);
});

test('streamed uploads keep one successful backup and leave no extra directory when files have no changes',async()=>{
  const initial=await streamed(files),next={...files,'parts.py':'# next\n'};
  const second=await streamed(next,'.pico-studio-1'),unchanged=await streamed(next,'.pico-studio-0');
  const out=run(`${execute(initial)}
${execute(second)}
assert not os.path.exists('.pico-studio-0')
assert open('.pico-studio-1/backup-0').read() == ${JSON.stringify(files['parts.py'])}
${execute(unchanged)}
assert not os.path.exists('.pico-studio-0')
assert os.path.exists('.pico-studio-1/complete')`);
  assert.equal(JSON.parse(out.trim().split('\n').at(-1)).changed,0);
});

test('an interrupted stream leaves originals intact and keeps its staging data',async()=>{
  const commands=await streamed(files);
  run(`open('main.py','w').write('original')
${execute(commands.slice(0,3))}
assert open('main.py').read() == 'original'
assert open('.pico-studio-0/stage-0').read() == ${JSON.stringify(files['main.py'])}
assert not os.path.exists('.pico-studio-0/complete')`);
});

test('streamed syntax errors are rejected before installation and failed commits restore originals',async()=>{
  const invalid=await streamed({...files,'main.py':'def broken(:\n'}),valid=await streamed(files);
  run(`open('main.py','w').write('original')
try:
 ${execute(invalid).split('\n').join('\n ')}
 raise AssertionError('expected syntax error')
except SyntaxError: pass
assert open('main.py').read() == 'original'
assert not os.path.exists('.pico-studio-0/complete')`);
  run(`os.mkdir('lib')
for path in ${JSON.stringify(Object.keys(files))}:open(path,'w').write('old '+path)
${execute(valid.slice(0,-1))}
rename=os.rename
def fail(a,b):
 if b == 'parts.py' and '/stage-' in a:raise OSError('injected failure')
 return rename(a,b)
os.rename=fail
try:
 exec(${JSON.stringify(valid.at(-1))})
 raise AssertionError('expected install error')
except OSError:pass
finally:os.rename=rename
for path in ${JSON.stringify(Object.keys(files))}:assert open(path).read() == 'old '+path
assert not os.path.exists('.pico-studio-0/complete')`);
});


test('streamed writes remove Python cache directories and preserve projects and recovery data',async()=>{
 const commands=await streamed(files);
 run(`os.mkdir('lib')
for path in ('__pycache__', '.mypy_cache', 'lib/__pycache__', 'lib/.mypy_cache'):
 os.mkdir(path)
 os.mkdir(path + '/nested')
 open(path + '/nested/data', 'w').write('cache')
os.mkdir('.pico-studio-99')
open('.pico-studio-99/backup-0', 'w').write('recover')
open('student.py', 'w').write('keep')
${execute(commands)}
for path in ('__pycache__', '.mypy_cache', 'lib/__pycache__', 'lib/.mypy_cache'):
 assert not os.path.exists(path)
assert open('student.py').read() == 'keep'
assert open('.pico-studio-99/backup-0').read() == 'recover'
assert open('main.py').read() == ${JSON.stringify(files['main.py'])}`);
});


test('custom packages transfer, import functions and classes, and re-execute updated modules',async()=>{
 const first={...files,'main.py':'from tools.calc import twice, Counter\nprint(twice(21))\nprint(Counter(10).add(5))\n','lib/pico_parts.py':'def close():\n pass\n','tools/__init__.py':'','tools/calc.py':'def twice(x):\n return x*2\nclass Counter:\n def __init__(self, x): self.x=x\n def add(self, n): return self.x+n\n'};
 const second={...first,'tools/calc.py':first['tools/calc.py'].replace('x*2','x*3')};
 const a=await streamed(first),b=await streamed(second,'.pico-studio-1');
 const out=run(`sys.dont_write_bytecode=True
sys.path.insert(0,os.getcwd())
sys.path.insert(0,os.getcwd()+'/lib')
${execute(a)}
exec(${JSON.stringify(P.launchFor(first))})
${execute(b)}
exec(${JSON.stringify(P.launchFor(second))})
assert open('.pico-studio-1/backup-0').read() == ${JSON.stringify(first['tools/calc.py'])}`);
 assert.match(out,/42\n15/);assert.match(out,/63\n15/);
});

test('unsafe upload paths and file parents are rejected before changing programs',async()=>{
 for(const path of ['../outside.py','/boot.py','tools/../../boot.py','tools//x.py','__pycache__/main.py','folder/name.txt'])assert.throws(()=>P.transfer({...files,[path]:'pass'}));
 const commands=await streamed({...files,'tools/calc.py':'pass\n'});
 run(`open('tools','w').write('keep')
try:
 ${execute(commands).split('\n').join('\n ')}
 raise AssertionError('expected parent conflict')
except ValueError: pass
assert open('tools').read() == 'keep'
assert not os.path.exists('main.py')
assert not os.path.exists('.pico-studio-0')`);
});
