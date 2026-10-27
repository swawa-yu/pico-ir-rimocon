const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const {JSDOM}=require('jsdom');
const B=require('../docs/vendor/blockly/blockly_compressed.js');
require('../docs/vendor/blockly/blocks_compressed.js');
Object.assign(B.Msg,require('../docs/vendor/blockly/msg/ja.js'));
const {pythonGenerator:g}=require('../docs/vendor/blockly/python_compressed.js');
const dom=new JSDOM('');
B.utils.xml.injectDependencies({document:dom.window.document,DOMParser:dom.window.DOMParser,XMLSerializer:dom.window.XMLSerializer});
let api,fromSource,upgrade,testParts=[];
before(async()=>{const module=await import('../src/editor/python-blocks.mjs');fromSource=module.fromSource;upgrade=module.upgrade;require('../docs/pico-blocks.js').configure(B,g,()=>testParts);api=module.configure(B,g,()=>{});});
function workspace(source){const ws=new B.Workspace();B.serialization.workspaces.load(fromSource(source),ws);return ws;}

test('blank lines become connected blocks and survive saving and regeneration',()=>{
 const source='first = 1\n\nsecond = 2\n\n\nprint(first + second)\n',ws=new B.Workspace(),copy=new B.Workspace();
 try{
  B.serialization.workspaces.load(fromSource(source,[]),ws);assert.equal(ws.getAllBlocks(false).filter(b=>b.type==='pico_blank').length,3);
  let code=api.generate(ws);assert.equal(code,source);
  B.serialization.workspaces.load(B.serialization.workspaces.save(ws),copy);assert.equal(api.generate(copy),source);
  const restored=new B.Workspace();try{B.serialization.workspaces.load(fromSource(code,[]),restored);assert.equal(restored.getAllBlocks(false).filter(b=>b.type==='pico_blank').length,3);}finally{restored.dispose();}
 }finally{ws.dispose();copy.dispose();}
});

test('blank line blocks inside a condition preserve Python behavior',()=>{
 const source='if True:\n    first = 1\n\n    print(first)\n',ws=new B.Workspace();
 try{B.serialization.workspaces.load(fromSource(source,[]),ws);assert.equal(ws.getAllBlocks(false).filter(b=>b.type==='pico_blank').length,1);const result=spawnSync('python3',['-c',api.generate(ws)],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'1\n');}finally{ws.dispose();}
});

test('deleting a blank line block can be undone without disconnecting surrounding code',async()=>{
 const ws=new B.Workspace();try{
  B.serialization.workspaces.load(fromSource('a = 1\n\nb = 2\n',[]),ws);await new Promise(resolve=>setTimeout(resolve,20));ws.clearUndo();
  B.Events.setGroup(true);try{ws.getAllBlocks(false).find(b=>b.type==='pico_blank').dispose(true);}finally{B.Events.setGroup(false);}await new Promise(resolve=>setTimeout(resolve,20));assert.equal(api.generate(ws),'a = 1\nb = 2\n');
  ws.undo(false);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(api.generate(ws),'a = 1\n\nb = 2\n');
 }finally{ws.dispose();}
});

test('list addition remains editable across Python and block conversion',()=>{
 const source='a = [1, 2]\nb = [3]\nresult = a + (b + [4])\nprint(result)\n',ws=new B.Workspace(),copy=new B.Workspace();
 try{
  B.serialization.workspaces.load(fromSource(source,[]),ws);
  assert.equal(ws.getAllBlocks(false).filter(b=>b.type==='pico_add').length,2);
  const code=api.generate(ws),run=text=>spawnSync('python3',['-c',text],{encoding:'utf8'});
  assert.equal(run(code).stdout,'[1, 2, 3, 4]\n');
  B.serialization.workspaces.load(fromSource(code,[]),copy);
  assert.equal(copy.getAllBlocks(false).filter(b=>b.type==='pico_add').length,2);
  assert.equal(run(api.generate(copy)).stdout,'[1, 2, 3, 4]\n');
 }finally{ws.dispose();copy.dispose();}
});

test('while True uses the forever block and preserves code following a break',()=>{
 const source='while True:\n    print(1)\n    break\nprint(2)\n',ws=new B.Workspace();
 try{
  B.serialization.workspaces.load(fromSource(source,[]),ws);
  const loop=ws.getAllBlocks(false).find(b=>b.type==='pico_forever');assert(loop);assert.equal(loop.getNextBlock().type,'text_print');
  const result=spawnSync('python3',['-c',api.generate(ws)],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'1\n2\n');
 }finally{ws.dispose();}
});

test('sample control flow and expressions retain their Python meaning',()=>{
 const samples=require('../docs/studio-samples.js');
 const groups={beginner:'zero32 one_bit byte long receive_one receive_byte receive_long continuous times button_times receive_times number rgb console binary send button_send receive carrier fan fan_receive',basic:'console bits button carrier pwm level times decode send receive',organized:'send receive',message:'ascii_send ascii_receive ascii_display utf8_send utf8_receive'};
 for(const [group,names] of Object.entries(groups))for(const name of names.split(' ')){
  const sample=samples[group](name);testParts=sample.parts;
  for(const [path,source] of Object.entries(sample.files)){const ws=new B.Workspace();try{
   B.serialization.workspaces.load(fromSource(source,sample.parts,path),ws);
   const raw=ws.getAllBlocks(false).filter(b=>b.type==='pico_expression'||b.type==='pico_python'&&!/^\s*#/.test(b.pythonCode));
   assert.deepEqual(raw.map(b=>b.type==='pico_expression'?b.getFieldValue('CODE'):b.pythonCode),[],`${group}_${name} ${path}`);
   const generated=api.generate(ws,sample.parts,path);
   const result=spawnSync('python3',['-c',`import ast,sys\nclass Normalize(ast.NodeTransformer):\n def visit_Call(self,n):\n  self.generic_visit(n)\n  if isinstance(n.func,ast.Name) and n.func.id == 'range' and len(n.args) == 1: n.args=[ast.Constant(0),n.args[0],ast.Constant(1)]\n  return n\na=ast.dump(Normalize().visit(ast.parse(${JSON.stringify(source)})))\nb=ast.dump(Normalize().visit(ast.parse(sys.stdin.read())))\nassert a == b`],{input:generated,encoding:'utf8'});
   assert.equal(result.status,0,`${group}_${name} ${path}: ${result.stderr}\n${generated}`);
  }finally{ws.dispose();}}
 }
});

test('opening and saving Python preserves every byte, including unsupported syntax and incomplete edits',()=>{
 const samples=[fs.readFileSync('docs/programs/pico_parts.py','utf8'),fs.readFileSync('docs/programs/ssd1306.py','utf8'),
  '# comment\nfrom foo import (\n a, b\n)\n\n@decorator\ndef f(x):\n    return x\n',
  'import time', 'import a; print("a")\n','class Empty: pass\n',
  'class Tabbed:\r\n\tx = """class Fake:\nimport fake\n"""\r\n',
  'class Outer:\n    class Inner:\n        def f(self):\n            return [x for x in range(3)]\n\nprint("done")\n',
  'class Broken(:\n    unfinished(', '', '\n\n'];
 for(const source of samples){const ws=workspace(source),copy=new B.Workspace();try{
  assert.equal(api.generate(ws),source.trim()?source:'');
  B.serialization.workspaces.load(B.serialization.workspaces.save(ws),copy);
  assert.equal(api.generate(copy),source.trim()?source:'');
 }finally{ws.dispose();copy.dispose();}}
});

test('class and function headers, imports and raw bodies remain editable after reload',()=>{
 const ws=workspace('import time\n\nclass Light:\n    def value(self):\n        return 1\n');
 try{
  ws.getAllBlocks(false).find(b=>b.type==='pico_import').setFieldValue('math','MODULE');
  ws.getAllBlocks(false).find(b=>b.type==='pico_class').setFieldValue('Lamp','HEADER');
  ws.getAllBlocks(false).find(b=>b.type==='pico_def').setFieldValue('read(self)','HEADER');
  ws.getAllBlocks(false).find(b=>b.type==='pico_python'&&b.pythonCode.includes('return')).setCode('return 2\n');
  const code=api.generate(ws);
  assert.match(code,/import math/);assert.match(code,/class Lamp:/);assert.match(code,/def read\(self\):\n        return 2/);
  const result=spawnSync('python3',['-c','import ast,sys;ast.parse(sys.stdin.read())'],{input:code,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 }finally{ws.dispose();}
});

test('ordinary blocks compose within a function and detached blocks stay inactive',()=>{
 const ws=workspace('def hello():\n    pass\n');
 try{
  const fn=ws.getAllBlocks(false).find(b=>b.type==='pico_def');fn.getInputTargetBlock('DO').dispose();
  const print=ws.newBlock('text_print'),value=ws.newBlock('text');value.setFieldValue('hello','TEXT');
  print.getInput('TEXT').connection.connect(value.outputConnection);fn.getInput('DO').connection.connect(print.previousConnection);
  const detached=ws.newBlock('text_print'),text=ws.newBlock('text');text.setFieldValue('forbidden','TEXT');detached.getInput('TEXT').connection.connect(text.outputConnection);
  const code=api.generate(ws);assert.match(code,/def hello\(\):\n    print\('hello'\)/);assert.doesNotMatch(code,/forbidden/);
 }finally{ws.dispose();}
});

test('a block appended after a file with no final newline starts on its own line',()=>{
 const ws=workspace('print(1)');
 try{
  const code=ws.getAllBlocks(false).find(b=>b.type==='pico_python');const next=ws.newBlock('pico_import');next.setFieldValue('time','MODULE');
  code.nextConnection.connect(next.previousConnection);
  assert.equal(api.generate(ws),'print(1)\nimport time\n');
 }finally{ws.dispose();}
});

test('editing a class preserves multiline string contents, including unindented literal lines',()=>{
 const source='class Example:\n    value = """first\nno indent\n    literal spaces\n"""\n';
 const ws=workspace(source);
 try{
  ws.getAllBlocks(false).find(b=>b.type==='pico_class').setFieldValue('Renamed','HEADER');
  assert.equal(api.generate(ws),source.replace('class Example:','class Renamed:'));
  const raw=ws.getAllBlocks(false).find(b=>b.type==='pico_python'&&b.pythonCode.includes('value'));
  raw.setCode(raw.pythonCode+'extra = 1\n');
  const code=api.generate(ws);
  assert.match(code,/"""first\nno indent\n    literal spaces\n"""/);
  const result=spawnSync('python3',['-c',code+'\nassert Renamed.value == "first\\nno indent\\n    literal spaces\\n"\nassert Renamed.extra == 1'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
 }finally{ws.dispose();}
});

test('file statements and definitions form one connected sequence without blank blocks',()=>{
 const source='import time\n\ndef first():\n    pass\n\nclass Counter:\n    def value(self):\n        return 1\n\nprint(first())\n';
 const ws=workspace(source);
 try{
  assert.equal(ws.getTopBlocks(false).length,1);
  const types=[];for(let b=ws.getTopBlocks(false)[0].getInputTargetBlock('DO');b;b=b.getNextBlock())types.push(b.type);
  assert.deepEqual(types,['pico_import','pico_def','pico_class','pico_python']);
  assert(!ws.getAllBlocks(false).some(b=>b.type==='pico_module'||b.type==='pico_python'&&!b.pythonCode.trim()));
  assert.equal(ws.getAllBlocks(false).find(b=>b.type==='pico_def'&&b.getFieldValue('HEADER')==='value(self)').getSurroundParent().type,'pico_class');
  assert.equal(api.generate(ws),source);
 }finally{ws.dispose();}
});

test('structured import fields generate imports, imported names and aliases',()=>{
 const source='import time\nimport machine as hw\nfrom my_tools import Counter, twice\n';
 const ws=workspace(source);
 try{
  assert.equal(api.generate(ws),source);
  ws.getAllBlocks(false).find(b=>b.type==='pico_import').setFieldValue('math','MODULE');
  ws.getAllBlocks(false).find(b=>b.type==='pico_import_as').setFieldValue('board','ALIAS');
  const from=ws.getAllBlocks(false).find(b=>b.type==='pico_from_import');from.setFieldValue('tools.helpers','MODULE');from.setFieldValue('twice as double','NAMES');
  assert.equal(api.generate(ws),'import math\nimport machine as board\nfrom tools.helpers import twice as double\n');
 }finally{ws.dispose();}
});

test('old file containers migrate without losing native blocks, whitespace or manual disabling',()=>{
 const print={type:'text_print',inputs:{TEXT:{block:{type:'text',fields:{TEXT:'hello'}}}}};
 const fn={type:'pico_def',fields:{HEADER:'hello()'},inputs:{DO:{block:print}}};
 const blank={type:'pico_python',extraState:{code:'\n'},next:{block:fn}};
 const imported={type:'pico_import',fields:{CODE:'from math import sqrt'},next:{block:blank}};
 const old={blocks:{languageVersion:0,blocks:[{type:'pico_module',inputs:{DO:{block:imported}}}]}};
 const ws=new B.Workspace();
 try{
  B.serialization.workspaces.load(upgrade(old),ws);
  assert(!ws.getAllBlocks(false).some(b=>b.type==='pico_module'));assert(ws.getAllBlocks(false).some(b=>b.type==='text_print'));
  assert.equal(api.generate(ws),"from math import sqrt\n\ndef hello():\n    print('hello')\n");
  old.blocks.blocks[0].disabledReasons=['MANUALLY_DISABLED'];
  ws.clear();B.serialization.workspaces.load(upgrade(old),ws);assert.match(api.generate(ws),/^# from math import sqrt/m);
 }finally{ws.dispose();}
});

test('previously inactive detached Python remains disabled during migration',()=>{
 const ws=new B.Workspace();
 try{
  B.serialization.workspaces.load(upgrade({blocks:{languageVersion:0,blocks:[{type:'pico_python',extraState:{code:'print("detached")\n'},disabledReasons:['PICO_UNCONNECTED']}]}}),ws);
  assert.equal(api.generate(ws),'');
  ws.clear();B.serialization.workspaces.load(upgrade({blocks:{languageVersion:0,blocks:[{type:'controls_whileUntil',fields:{MODE:'WHILE'},inputs:{BOOL:{block:{type:'logic_boolean',fields:{BOOL:'TRUE'}}},DO:{block:{type:'text_print',inputs:{TEXT:{block:{type:'text',fields:{TEXT:'detached'}}}}}}},disabledReasons:['PICO_UNCONNECTED']}]}}),ws);
  assert.equal(api.generate(ws),'');
 }finally{ws.dispose();}
});

test('supported source statements become blocks without dropping unsupported code or creating globals',()=>{
 const source='def answer():\n    bits = [0, 1]\n    for i in range(2):\n        bits.append(i)\n    return bits\n\nprint("prefix: " + str(answer()))\nprint(len("abc"))\n';
 const ws=new B.Workspace(),copy=new B.Workspace();
 try{
  B.serialization.workspaces.load(fromSource(source,[]),ws);
  assert(ws.getAllBlocks(false).some(b=>b.type==='variables_set'));
  assert(ws.getAllBlocks(false).some(b=>b.type==='controls_forEach'));
  assert(ws.getAllBlocks(false).some(b=>b.type==='pico_call'&&b.getFieldValue('TARGET')==='bits.append'));
  const code=api.generate(ws);
  assert.doesNotMatch(code,/bits = None/);
  const result=spawnSync('python3',['-c',code],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'prefix: [0, 1, 0, 1]\n3\n');
  B.serialization.workspaces.load(B.serialization.workspaces.save(ws),copy);
  assert.equal(api.generate(copy),code);
 }finally{ws.dispose();copy.dispose();}
});

test('receiver code becomes connected statements, nested conditions, variables and function calls',()=>{
 const source='def decode_signal(times):\n    return len(times)\n\ntimes = [10, 20]\nwhile times:\n    bits = decode_signal(times)\n    if not bits:\n        break\n    elif bits == 2:\n        print("bits:", bits)\n    else:\n        print("other")\n    times = []\nprint("done")\n';
 const ws=new B.Workspace();
 try{
  B.serialization.workspaces.load(fromSource(source,[]),ws);
  assert.equal(ws.getTopBlocks(false).length,1);
  const blocks=ws.getAllBlocks(false);
  for(const type of ['pico_def','pico_return','variables_set','controls_whileUntil','controls_if','pico_call','pico_call_value','pico_flow'])assert(blocks.some(b=>b.type===type),type);
  assert(!blocks.some(b=>b.type==='pico_python'));
  const call=blocks.find(b=>b.type==='pico_call_value');assert.equal(call.getFieldValue('TARGET'),'decode_signal');
  assert.equal(call.getInputTargetBlock('ARG0').type,'variables_get');
  const branch=blocks.find(b=>b.type==='controls_if');assert(branch.getInput('IF1'));assert(branch.getInput('ELSE'));
  const result=spawnSync('python3',['-c',api.generate(ws)],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'bits: 2\ndone\n');
 }finally{ws.dispose();}
});

test('unsupported statements remain separate and unknown expressions stay editable within assignment blocks',()=>{
 const ws=new B.Workspace();
 try{
  B.serialization.workspaces.load(fromSource('a, b = (1, 2)\nassert a < b\nvalue = {"a": a}["a"]\nprint(value)\n',[]),ws);
  const raw=ws.getAllBlocks(false).filter(b=>b.type==='pico_python');assert.equal(raw.length,1);
  assert(raw.every(b=>b.pythonCode.trim().split('\n').length===1));
  const expression=ws.getAllBlocks(false).find(b=>b.type==='pico_expression'&&b.getFieldValue('CODE').includes('{'));expression.setFieldValue('{"a": b + 5}','CODE');
  const result=spawnSync('python3',['-c',api.generate(ws)],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'7\n');
 }finally{ws.dispose();}
});

test('cached raw source migrates into connected structured blocks and retains disabled content',()=>{
 const state={blocks:{languageVersion:0,blocks:[{type:'pico_import',fields:{MODULE:'time'},extraState:{eol:'\n'},x:24,y:24},{type:'pico_python',extraState:{code:'while True:\n    result = decode(42)\n    if result:\n        break\n'},x:24,y:80},{type:'pico_python',extraState:{code:'print("disabled")\n'},disabledReasons:['MANUALLY_DISABLED'],x:24,y:200}]}};
 const ws=new B.Workspace();
 try{
  B.serialization.workspaces.load(upgrade(state,[]),ws);
  assert.equal(ws.getTopBlocks(false).length,1);
  assert(ws.getAllBlocks(false).some(b=>b.type==='pico_forever'));
  const disabled=ws.getAllBlocks(false).find(b=>b.type==='text_print');
  assert(disabled.hasDisabledReason('MANUALLY_DISABLED'));
  assert.match(api.generate(ws),/# print\(['"]disabled['"]\)/);
 }finally{ws.dispose();}
});

test('disabled connected statements stay visible as comments and can be re-enabled',()=>{
 const source='if True:\n    print("hidden")\nprint("shown")\n',ws=new B.Workspace(),copy=new B.Workspace();
 try{
  B.serialization.workspaces.load(fromSource(source,[]),ws);const hidden=ws.getAllBlocks(false).find(b=>b.type==='text_print'&&b.getInputTargetBlock('TEXT').getFieldValue('TEXT')==='hidden');
  hidden.setDisabledReason(true,'MANUALLY_DISABLED');const code=api.generate(ws);assert.match(code,/# print\(['"]hidden['"]\)/);
  let run=spawnSync('python3',['-c',code],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'shown\n');
  B.serialization.workspaces.load(B.serialization.workspaces.save(ws),copy);const restored=copy.getAllBlocks(false).find(b=>b.type==='text_print'&&b.hasDisabledReason('MANUALLY_DISABLED'));assert(restored);
  restored.setDisabledReason(false,'MANUALLY_DISABLED');run=spawnSync('python3',['-c',api.generate(copy)],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'hidden\nshown\n');
 }finally{ws.dispose();copy.dispose();}
});

test('disabled multi-line blocks are fully commented while later statements still run',()=>{
 const ws=new B.Workspace();try{
  B.serialization.workspaces.load(fromSource('if True:\n    print("hidden")\nprint("shown")\n',[]),ws);
  ws.getAllBlocks(false).find(b=>b.type==='controls_if').setDisabledReason(true,'MANUALLY_DISABLED');
  const code=api.generate(ws);assert.match(code,/# if True:/);assert.match(code,/#\s+print\(['"]hidden['"]\)/);
  const run=spawnSync('python3',['-c',code],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'shown\n');
 }finally{ws.dispose();}
});

test('commented Python statements become disabled blocks and ordinary comments remain comments',()=>{
 const source='# 説明\n# value = 2\n# print(value)\nprint("active")\n',ws=new B.Workspace();
 try{
  B.serialization.workspaces.load(fromSource(source,[]),ws);
  const blocks=ws.getAllBlocks(false),value=blocks.find(b=>b.type==='variables_set'),print=blocks.find(b=>b.type==='text_print'&&b.hasDisabledReason('MANUALLY_DISABLED'));
  assert(value?.hasDisabledReason('MANUALLY_DISABLED'));assert(print);assert(blocks.some(b=>b.type==='pico_python'&&b.pythonCode.includes('説明')));
  let code=api.generate(ws),run=spawnSync('python3',['-c',code],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'active\n');
  value.setDisabledReason(false,'MANUALLY_DISABLED');print.setDisabledReason(false,'MANUALLY_DISABLED');code=api.generate(ws);
  run=spawnSync('python3',['-c',code],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'2\nactive\n');
 }finally{ws.dispose();}
});

test('commented nested control blocks and inline comments preserve execution',()=>{
 const source='# if True:\n#     print("hidden")\nprint("active")  # note\n',ws=new B.Workspace();
 try{
  B.serialization.workspaces.load(fromSource(source,[]),ws);const condition=ws.getAllBlocks(false).find(b=>b.type==='controls_if');assert(condition?.hasDisabledReason('MANUALLY_DISABLED'));
  const code=api.generate(ws);assert.match(code,/# note/);const run=spawnSync('python3',['-c',code],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'active\n');
 }finally{ws.dispose();}
});


test('function parameters, keyword arguments and generator expressions preserve their Python meaning',()=>{
 const source='def f(input):\n    result = max(input, 1)\n    print(result, end="!")\n    return sum(x for x in range(result))\nprint(f(4))\n';
 const ws=new B.Workspace();
 try{
  B.serialization.workspaces.load(fromSource(source,[]),ws);
  const code=api.generate(ws),result=spawnSync('python3',['-c',code],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'4!6\n');
 }finally{ws.dispose();}
});


test('all bundled Python files still parse after conversion into structured blocks',()=>{
 for(const name of fs.readdirSync('docs/programs').filter(name=>name.endsWith('.py'))){
  const ws=new B.Workspace();
  try{
   B.serialization.workspaces.load(fromSource(fs.readFileSync('docs/programs/'+name,'utf8'),[]),ws);
   const result=spawnSync('python3',['-c','import ast,sys;ast.parse(sys.stdin.read())'],{input:api.generate(ws,[],'lib/'+name),encoding:'utf8'});
   assert.equal(result.status,0,name+': '+result.stderr);
  }finally{ws.dispose();}
 }
});


test('main and imported modules enclose all statements in their execution event and keep detached code inactive',()=>{
 const source='def twice(value):\n    return value * 2\nprint(twice(3))\n';
 for(const path of ['main.py','tools.py']){
  const ws=new B.Workspace();
  try{
   B.serialization.workspaces.load(fromSource(source,[],path),ws);
   const root=ws.getTopBlocks(false)[0];assert.equal(root.type,path==='main.py'?'pico_start':'pico_module');
   assert.equal(root.getInputTargetBlock('DO').type,'pico_def');
   const detached=ws.newBlock('pico_def');detached.setFieldValue('unused()','HEADER');
   const code=api.generate(ws,[],path);assert.doesNotMatch(code,/unused/);
   const result=spawnSync('python3',['-c',code],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'6\n');
  }finally{ws.dispose();}
 }
});

test('range and numeric conversions are editable blocks and retain Python values through save and migration',()=>{
 const source='values = list(range(5, -1, -2))\nnumber = int("41", 16)\ntext = str(number)\ninteger = int(3.9)\nreal = float("3.5")\nbinary = bin(number)\nhexadecimal = hex(number)\nprint(values, number, text, integer, real, binary, hexadecimal)\n';
 const ws=new B.Workspace(),copy=new B.Workspace();
 try{
  B.serialization.workspaces.load(fromSource(source,[]),ws);
  for(const type of ['pico_range','pico_parse_int','pico_to_text','pico_to_int','pico_to_float','pico_base_text'])assert(ws.getAllBlocks(false).some(b=>b.type===type),type);
  const code=api.generate(ws),result=spawnSync('python3',['-c',code],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,"[5, 3, 1] 65 65 3 3.5 0b1000001 0x41\n");
  B.serialization.workspaces.load(B.serialization.workspaces.save(ws),copy);assert.equal(api.generate(copy),code);
  const old={blocks:{languageVersion:0,blocks:[{type:'variables_set',fields:{VAR:{name:'values'}},inputs:{VALUE:{block:{type:'pico_call_value',fields:{TARGET:'range'},extraState:{argumentCount:1},inputs:{ARG0:{block:{type:'math_number',fields:{NUM:5}}}}}}}}]}};
  copy.clear();B.serialization.workspaces.load(upgrade(old,[],'tools.py'),copy);
  assert.equal(copy.getTopBlocks(false)[0].type,'pico_module');assert(copy.getAllBlocks(false).some(b=>b.type==='pico_range'));
 }finally{ws.dispose();copy.dispose();}
});


test('Python indexing edits the collection and zero-based index independently, including assignment and migration',()=>{
 const source='times = [10, 20, 30]\ni = 1\nvalue = times[i + 1]\ntimes[i] = value + 5\nprint(times, times[-1])\n';
 const ws=new B.Workspace(),copy=new B.Workspace();
 try{
  B.serialization.workspaces.load(fromSource(source,[]),ws);
  assert.equal(ws.getAllBlocks(false).filter(b=>b.type==='pico_index').length,2);assert(ws.getAllBlocks(false).some(b=>b.type==='pico_set_index'));
  const code=api.generate(ws),result=spawnSync('python3',['-c',code],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'[10, 35, 30] 30\n');
  const value={type:'pico_expression',fields:{CODE:'times[i]'}},assignment={type:'variables_set',fields:{VAR:{name:'x'}},inputs:{VALUE:{block:value}}};
  const old={blocks:{languageVersion:0,blocks:[{type:'pico_start',inputs:{DO:{block:assignment}}}]}};
  B.serialization.workspaces.load(upgrade(old,[]),copy);assert(copy.getAllBlocks(false).some(b=>b.type==='pico_index'));
 }finally{ws.dispose();copy.dispose();}
});

test('plus buttons preserve connected arguments and list items through save and reload',()=>{
 const ws=new B.Workspace(),copy=new B.Workspace();
 try{
  B.serialization.workspaces.load(fromSource('values = [1, 2]\nprint(values, "done")\n',[]),ws);
  const call=ws.getAllBlocks(false).find(b=>b.type==='pico_call');
  const first=call.getInputTargetBlock('ARG0');call.getField('ADD').showEditor_();assert.equal(call.argumentCount,3);assert.equal(call.getInputTargetBlock('ARG0'),first);
  call.getField('REMOVE2').showEditor_();assert.equal(call.argumentCount,2);
  const list=ws.getAllBlocks(false).find(b=>b.type==='lists_create_with'),item=list.getInputTargetBlock('ADD0');
  list.getField('ADD_ITEM').showEditor_();assert.equal(list.itemCount_,3);assert.equal(list.getInputTargetBlock('ADD0'),item);
  B.serialization.workspaces.load(B.serialization.workspaces.save(ws),copy);assert.equal(copy.getAllBlocks(false).find(b=>b.type==='lists_create_with').itemCount_,3);
  assert.equal(copy.getAllBlocks(false).find(b=>b.type==='pico_call').argumentCount,2);
 }finally{ws.dispose();copy.dispose();}
});

test('removing a middle list item or call argument keeps the other connected values',async()=>{
 const ws=new B.Workspace();
 try{
  B.serialization.workspaces.load(fromSource('values = [1, 2, 3]\nprint(4, 5, 6)\n',[]),ws);await new Promise(resolve=>setTimeout(resolve,20));ws.clearUndo();
  const list=ws.getAllBlocks(false).find(b=>b.type==='lists_create_with'),removed=list.getInputTargetBlock('ADD1'),last=list.getInputTargetBlock('ADD2');
  list.getField('REMOVE1').showEditor_();assert.equal(list.itemCount_,2);assert.equal(list.getInputTargetBlock('ADD1'),last);assert.equal(removed.getParent(),null);
  await new Promise(resolve=>setTimeout(resolve,20));ws.undo(false);assert.equal(list.itemCount_,3);assert.equal(list.getInputTargetBlock('ADD1'),removed);assert.equal(list.getInputTargetBlock('ADD2'),last);
  await new Promise(resolve=>setTimeout(resolve,20));ws.undo(true);assert.equal(list.itemCount_,2);assert.equal(list.getInputTargetBlock('ADD1'),last);
  const call=ws.getAllBlocks(false).find(b=>b.type==='pico_call'),argument=call.getInputTargetBlock('ARG1'),third=call.getInputTargetBlock('ARG2');
  call.getField('REMOVE1').showEditor_();assert.equal(call.argumentCount,2);assert.equal(call.getInputTargetBlock('ARG1'),third);assert.equal(argument.getParent(),null);
  await new Promise(resolve=>setTimeout(resolve,20));ws.undo(false);assert.equal(call.argumentCount,3);assert.equal(call.getInputTargetBlock('ARG1'),argument);assert.equal(call.getInputTargetBlock('ARG2'),third);
 }finally{ws.dispose();}
});

test('removing a list item keeps the following shadow values',()=>{
 const ws=new B.Workspace();try{
  const state={blocks:{languageVersion:0,blocks:[{type:'lists_create_with',extraState:{itemCount:3},inputs:Object.fromEntries([1,2,3].map((n,i)=>['ADD'+i,{shadow:{type:'math_number',fields:{NUM:n}}}]))}]}};
  B.serialization.workspaces.load(state,ws);const list=ws.getTopBlocks(false)[0];list.getField('REMOVE1').showEditor_();
  assert.equal(list.getInputTargetBlock('ADD0').getFieldValue('NUM'),1);assert.equal(list.getInputTargetBlock('ADD1').getFieldValue('NUM'),3);
 }finally{ws.dispose();}
});

test('sentence-defined functions remain ordinary Python and selection retains the value-returning call shape',async()=>{
 const {catalog}=await import('../src/editor/python-symbols.mjs');
 const source='# ブロック: {value} を2倍にする\ndef twice(value):\n    return value * 2\n\nprint(twice(21))\n',ws=new B.Workspace();
 try{
  B.serialization.workspaces.load(fromSource(source,[]),ws);
  const def=ws.getAllBlocks(false).find(b=>b.type==='pico_def');assert.equal(def.pythonSentence,'{value} を2倍にする');
  def.setSentence('{value} の2倍');assert.throws(()=>def.setSentence('{missing} の2倍'));
  const code=api.generate(ws),result=spawnSync('python3',['-c',code],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'42\n');assert.match(code,/# ブロック: \{value\} の2倍/);
  const fn=catalog({'main.py':source},'main.py').find(fn=>fn.target==='twice');assert.equal(fn.returns,true);
  const call=ws.getAllBlocks(false).find(b=>b.type==='pico_call_value');const value=call.getInputTargetBlock('ARG0');call.chooseFunction(fn);assert.equal(call.getInputTargetBlock('ARG0'),value);assert.equal(call.outputConnection!==null,true);assert.equal(call.callSentence,'{value} を2倍にする');
 }finally{ws.dispose();}
});


test('missing call targets and missing arguments produce block diagnostics without executing code',()=>{
 const ws=new B.Workspace();
 try{
  const source='value = unknown_function(1)\n';B.serialization.workspaces.load(fromSource(source,[]),ws);const call=ws.getAllBlocks(false).find(b=>b.type==='pico_call_value');
  const issues=api.diagnose(ws,source);assert(issues.some(i=>i.message.includes('unknown_function')));assert.match(call.picoDiagnostic,/見つかりません/);
  call.updateArguments(2);api.diagnose(ws,source);assert.match(call.picoDiagnostic,/接続されていない/);
 }finally{ws.dispose();}
});

test('minimal infrared samples use main.py and their transmitted timings decode to 65 with English or Japanese names',()=>{
 const samples=require('../docs/studio-samples.js');
 for(const jp of [false,true]){
  const generated={};
  for(const mode of ['send','receive']){
   const sample=samples.infrared(jp,mode);assert.deepEqual(Object.keys(sample.files),['main.py']);
   const ws=new B.Workspace();B.serialization.workspaces.load(fromSource(sample.files['main.py'],[]),ws);try{generated[mode]=api.generate(ws);}finally{ws.dispose();}
  }
  const py=`import sys, types, time
machine = types.ModuleType('machine')
sys.modules['machine'] = machine
class Output:
    def __init__(self, *args, **kwargs): self.values = []; self.closed = False
    def duty_u16(self, value): self.values.append(value)
    def deinit(self): self.closed = True
machine.PWM = Output
machine.Pin = lambda n: n
time.sleep_us = lambda n: None
ns = {}
exec(${JSON.stringify(generated.send)}, ns)
times = ns[${JSON.stringify(jp?'時間配列':'times')}]
pwm = ns[${JSON.stringify(jp?'出力':'output')}]
assert pwm.values[0] == 21845 and pwm.closed
clock = [0]
time.ticks_us = lambda: clock.__setitem__(0, clock[0] + 5) or clock[0]
time.ticks_diff = lambda a,b: a-b
class Input:
    IN = 0
    def __init__(self, *args): pass
    def value(self):
        clock[0] += 5
        elapsed = clock[0] - 1000
        if elapsed < 0: return 1
        for index, duration in enumerate(times):
            if elapsed < duration: return index % 2
            elapsed -= duration
        return 1
machine.Pin = Input
messages = []
def capture(*values):
    messages.append(values)
    if len(messages) == 3: raise StopIteration
try:
    exec(${JSON.stringify(generated.receive)}, {'print':capture})
except StopIteration:
    pass
assert messages[-1][1] == 65, messages
assert messages[-2][1] == [1,0,0,0,0,0,1,0], messages
`;
  const result=spawnSync('python3',['-c',py],{encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);
 }
});

test('None stays a literal block, and bracketed list inputs preserve items when resized',()=>{
 const ws=new B.Workspace();B.serialization.workspaces.load(fromSource('values = [None, 1]\n',[]),ws);
 try{
  const list=ws.getAllBlocks(false).find(b=>b.type==='lists_create_with');
  assert.equal(list.getInputTargetBlock('ADD0').type,'logic_null');
  assert.equal(list.getInput('OPEN').fieldRow[0].getText(),'[');assert.equal(list.getInput('CLOSE').fieldRow.at(-1).getText(),']');
  const none=list.getInputTargetBlock('ADD0');list.getField('ADD_ITEM').showEditor_();assert.equal(list.getInputTargetBlock('ADD0'),none);
  assert.match(api.generate(ws),/\[None, 1, None\]/);
 }finally{ws.dispose();}
});

test('imports required by a new wait block appear in main as connected import blocks',()=>{
 const ws=new B.Workspace();
 try{
  B.serialization.workspaces.load(fromSource('time.sleep(0.01)\n',[]),ws);
  assert.equal(api.generate(ws),'import time\ntime.sleep(0.01)\n');
  const root=ws.getTopBlocks(false)[0];assert.equal(root.getInputTargetBlock('DO').type,'pico_import');
  assert.equal(api.generate(ws),'import time\ntime.sleep(0.01)\n');
 }finally{ws.dispose();}
});

test('foundation programs are editable main-only code and organized transmission preserves PWM and timings',()=>{
 const samples=require('../docs/studio-samples.js');
 for(const name of ['console','bits','button','carrier','pwm','level','times','decode','send','receive']){
  const sample=samples.basic(name);assert.deepEqual(Object.keys(sample.files),['main.py']);assert.doesNotMatch(sample.files['main.py'],/from (parts|pico_parts|ir_data) import/);
  const ws=new B.Workspace();try{B.serialization.workspaces.load(fromSource(sample.files['main.py'],[]),ws);const code=api.generate(ws);const result=spawnSync('python3',['-c',`compile(${JSON.stringify(code)}, 'main.py', 'exec')`],{encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);}finally{ws.dispose();}
 }
 const organized=samples.organized('send').files,receiver=samples.organized('receive').files;
 const py=`import sys, types, time
machine = types.ModuleType('machine')
sys.modules['machine'] = machine
records = []
class Output:
    def __init__(self, pin, **settings): records.append(('open', pin, settings))
    def duty_u16(self, n): records.append(('duty', n))
    def deinit(self): records.append(('close',))
machine.Pin = lambda *args: args[0]
machine.Pin.IN = 0
machine.PWM = Output
time.sleep_us = lambda n: records.append(('wait', n))
time.ticks_us = lambda: 0
time.ticks_diff = lambda a,b: a-b
exec(${JSON.stringify(samples.basic('send').files['main.py'])}, {})
expected = records[:]
records.clear()
module = types.ModuleType('ir_signal')
sys.modules['ir_signal'] = module
exec(${JSON.stringify(organized['ir_signal.py'])}, module.__dict__)
exec(${JSON.stringify(organized['main.py'])}, {})
assert records == expected
exec(${JSON.stringify(receiver['ir_signal.py'])}, module.__dict__)
assert module.decode([9000,4500,560,1680,560,560,560]) == ([1,0],1)
`;
 const result=spawnSync('python3',['-c',py],{encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);
});

test('beginner samples expose editable binary, receive and send blocks and regenerate changed digits',()=>{
 const samples=require('../docs/studio-samples.js');
 for(const name of ['zero32','one_bit','byte','long','receive_one','receive_byte','receive_long','continuous','times','button_times','receive_times','console','binary','number','send','receive','button_send','carrier','fan','rgb']){
  const sample=samples.beginner(name),source=sample.files['main.py'],ws=new B.Workspace();testParts=sample.parts;
  B.serialization.workspaces.load(fromSource(source,sample.parts),ws);
  try{
   const original=spawnSync('python3',['-c',`import ast,sys
assert ast.dump(ast.parse(sys.stdin.read())) == ast.dump(ast.parse(${JSON.stringify(source)}))`],{input:api.generate(ws,sample.parts),encoding:'utf8'});
   assert.equal(original.status,0,original.stderr);
   if(['binary','send','button_send'].includes(name)){
    const list=ws.getAllBlocks(false).find(b=>b.type==='lists_create_with');
    assert.equal(list.itemCount_,16);
    list.getInputTargetBlock('ADD0').setFieldValue(1,'NUM');
    assert.match(api.generate(ws,sample.parts),/信号 = \[\s*1,/);
    assert(!ws.getAllBlocks(false).some(b=>b.type==='pico_set_bits'));
   }
   if(name==='times'){
    const send=ws.getAllBlocks(false).find(b=>b.type==='pico_send_times');assert(send);
    const list=ws.getAllBlocks(false).find(b=>b.type==='lists_create_with');list.getInputTargetBlock('ADD3').setFieldValue(1120,'NUM');
    assert.match(api.generate(ws,sample.parts),/1120/);
   }
   if(name==='rgb'){
    const color=ws.getAllBlocks(false).find(b=>b.type==='pico_rgb');assert(color);
    color.getInputTargetBlock('RED').setFieldValue(25,'NUM');assert.match(api.generate(ws,sample.parts),/color_led\.set\(25, 0, 0\)/);
    assert(ws.getAllBlocks(false).some(b=>b.type==='pico_rgb_off'));
   }
   if(['byte','long'].includes(name))assert.equal(ws.getAllBlocks(false).find(b=>b.type==='pico_send_bits').getFieldValue('LEADER'),'0');
   if(name==='zero32'){
    assert.equal(ws.getAllBlocks(false).filter(b=>b.type==='lists_repeat').length,1);
    assert(!ws.getAllBlocks(false).some(b=>b.type==='pico_bootsel'||b.type==='controls_if'));
    assert.equal(ws.getAllBlocks(false).find(b=>b.type==='pico_send_bits').getFieldValue('LEADER'),'0');
   }
   if(name==='continuous'){
    assert.equal(ws.getAllBlocks(false).filter(b=>b.type==='lists_repeat').length,2);
    assert(ws.getAllBlocks(false).find(b=>b.type==='controls_if').getInput('ELSE'));
    assert.equal(ws.getAllBlocks(false).find(b=>b.type==='pico_send_bits').getFieldValue('LEADER'),'0');
   }
   if(name==='send')assert(ws.getAllBlocks(false).some(b=>b.type==='pico_send_bits'));
   if(name==='receive')assert(ws.getAllBlocks(false).some(b=>b.type==='pico_receive_bits'));
   const code=api.generate(ws,sample.parts);
   const result=spawnSync('python3',['-c','import ast,sys;ast.parse(sys.stdin.read())'],{input:code,encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);
  }finally{ws.dispose();testParts=[];}
 }
});
