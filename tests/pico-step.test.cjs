const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const P=require('../docs/pico-project.js');
let prepare,Output;
before(async()=>{({prepare,Output}=await import('../src/editor/pico-step.mjs'));});
function run(script){const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,JSON.stringify({stderr:r.stderr,stdout:r.stdout,signal:r.signal}));return r.stdout;}

test('instrumentation preserves classes, functions, docstrings, inline branches and multiline literals',()=>{
 const source='"""module doc"""\nclass Counter:\n    """class doc"""\n    def value(self, x):\n        """function doc"""\n        if x: return x + 1\n        return 0\n\ntext = """first\nclass fake:\n"""\nx = 1; x += 1\nfor i in range(2):\n    x += i\nassert Counter().value(x) == 4\nassert Counter.__doc__ == "class doc"\nassert Counter.value.__doc__ == "function doc"\n';
 const prepared=prepare(source);
 const out=run(`events=[]\n${prepared.hook}=lambda line: events.append(line)\nexec(${JSON.stringify(prepared.code)})\nprint(events)\n`);
 assert.match(out,/2, 4/);assert(!out.includes('10,'));
 assert.throws(()=>prepare('if broken(:\n'),/構文/);
});

test('step markers survive character delivery and never hide unrelated output',()=>{
 const lines=[],stream=new Output('token',line=>lines.push(line));let visible='';
 for(const char of 'hello\x1ePICO_STEP:token:5\x1fworld\x1eOTHER\x1f')visible+=stream.feed(char);
 assert.deepEqual(lines,[5]);assert.equal(visible,'helloworld\x1eOTHER\x1f');
 stream.feed('\x1eunfinished');assert.equal(stream.flush(),'\x1eunfinished');
});

test('stepped launch executes in memory, closes outputs after interruption and leaves installed main.py intact',()=>{
 const files={'main.py':'x = 1\nprint(x + 1)\n','parts.py':'','lib/pico_parts.py':'def close():\n print("closed")\n'};
 const prepared=prepare(files['main.py']),code=P.launchStepped(files,prepared,'test');
 const out=run(`import tempfile,os,sys,builtins\nwith tempfile.TemporaryDirectory() as root:\n os.chdir(root)\n original_chdir=os.chdir\n os.chdir=lambda path: original_chdir(root if path=='/' else path)\n os.mkdir('lib')\n for name,text in ${JSON.stringify(files)}.items():\n  open(name,'w').write(text)\n sys.path.insert(0,root+'/lib')\n builtins.input=lambda: ''\n exec(${JSON.stringify(code)})\n assert open('main.py').read() == ${JSON.stringify(files['main.py'])}\n assert '${prepared.hook}' not in globals()\n _studio_namespace['${prepared.hook}'](1)\n`);
 assert.match(out,/PICO_STEP:test:1/);assert.match(out,/PICO_STEP:test:2/);assert.match(out,/2\nclosed/);
});

test('interrupting a pause lets user finally and driver cleanup run without waiting again',()=>{
 const files={'main.py':'try:\n    value = 1\nfinally:\n    print("cleanup")\n','parts.py':'','lib/pico_parts.py':'def close():\n print("closed")\n'};
 const prepared=prepare(files['main.py']),code=P.launchStepped(files,prepared,'stop');
 const out=run(`import tempfile,os,sys,builtins\ncount=0\ndef next_input():\n global count\n count+=1\n if count==2: raise KeyboardInterrupt\n return ''\nwith tempfile.TemporaryDirectory() as root:\n os.chdir(root)\n original_chdir=os.chdir\n os.chdir=lambda path: original_chdir(root if path=='/' else path)\n os.mkdir('lib')\n for name,text in ${JSON.stringify(files)}.items():open(name,'w').write(text)\n sys.path.insert(0,root+'/lib')\n builtins.input=next_input\n try:\n  exec(${JSON.stringify(code)})\n except KeyboardInterrupt: pass\n assert count==2\n assert '${prepared.hook}' not in globals()\nsys.exit(0)\n`);
 assert.match(out,/cleanup\nclosed/);
});
