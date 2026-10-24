const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const {JSDOM}=require('jsdom');
const B=require('../vendor/blockly/blockly_compressed.js');
require('../vendor/blockly/blocks_compressed.js');
Object.assign(B.Msg,require('../vendor/blockly/msg/ja.js'));
const {pythonGenerator:g}=require('../vendor/blockly/python_compressed.js');
const dom=new JSDOM('');
B.utils.xml.injectDependencies({document:dom.window.document,DOMParser:dom.window.DOMParser,XMLSerializer:dom.window.XMLSerializer});
let api,fromSource,upgrade;
before(async()=>{const module=await import('../python-blocks.mjs');fromSource=module.fromSource;upgrade=module.upgrade;require('../pico-blocks.js').configure(B,g,()=>[]);api=module.configure(B,g,()=>{});});
function workspace(source){const ws=new B.Workspace();B.serialization.workspaces.load(fromSource(source),ws);return ws;}

test('opening and saving Python preserves every byte, including unsupported syntax and incomplete edits',()=>{
 const samples=[fs.readFileSync('programs/pico_parts.py','utf8'),fs.readFileSync('programs/ssd1306.py','utf8'),
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
  ws.clear();B.serialization.workspaces.load(upgrade(old),ws);assert.equal(api.generate(ws),'');
 }finally{ws.dispose();}
});

test('previously inactive detached Python remains disabled during migration',()=>{
 const ws=new B.Workspace();
 try{
  B.serialization.workspaces.load(upgrade({blocks:{languageVersion:0,blocks:[{type:'pico_python',extraState:{code:'print("detached")\n'},disabledReasons:['PICO_UNCONNECTED']}]}}),ws);
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
  const raw=ws.getAllBlocks(false).filter(b=>b.type==='pico_python');assert.equal(raw.length,2);
  assert(raw.every(b=>b.pythonCode.trim().split('\n').length===1));
  const expression=ws.getAllBlocks(false).find(b=>b.type==='pico_expression');expression.setFieldValue('b + 5','CODE');
  const result=spawnSync('python3',['-c',api.generate(ws)],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'7\n');
 }finally{ws.dispose();}
});

test('cached raw source migrates into connected structured blocks and retains disabled content',()=>{
 const state={blocks:{languageVersion:0,blocks:[{type:'pico_import',fields:{MODULE:'time'},extraState:{eol:'\n'},x:24,y:24},{type:'pico_python',extraState:{code:'while True:\n    result = decode(42)\n    if result:\n        break\n'},x:24,y:80},{type:'pico_python',extraState:{code:'print("disabled")\n'},disabledReasons:['MANUALLY_DISABLED'],x:24,y:200}]}};
 const ws=new B.Workspace();
 try{
  B.serialization.workspaces.load(upgrade(state,[]),ws);
  assert.equal(ws.getTopBlocks(false).length,1);
  assert(ws.getAllBlocks(false).some(b=>b.type==='controls_whileUntil'));
  const disabled=ws.getAllBlocks(false).find(b=>b.type==='text_print');
  assert(disabled.hasDisabledReason('MANUALLY_DISABLED'));
  assert.doesNotMatch(api.generate(ws),/disabled/);
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
 for(const name of fs.readdirSync('programs').filter(name=>name.endsWith('.py'))){
  const ws=new B.Workspace();
  try{
   B.serialization.workspaces.load(fromSource(fs.readFileSync('programs/'+name,'utf8'),[]),ws);
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
