const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Files,definitions}=require('../studio-files.js');

test('block regeneration preserves manual edits in every file and reset affects only the selected file',()=>{
  const f=new Files(),first={'main.py':'print(1)\n','parts.py':'pin = 13\n','lib/pico_parts.py':'def send(): pass\n'};
  f.regenerate(first);f.edit('main.py','print(2)\n');f.edit('lib/pico_parts.py','def send(): return 3\n');
  f.regenerate({...first,'main.py':'print(4)\n','parts.py':'pin = 16\n'});
  assert.equal(f.all['main.py'],'print(2)\n');assert.equal(f.all['parts.py'],'pin = 16\n');
  const saved=JSON.parse(JSON.stringify(f.edits)),copy=new Files();copy.restore(saved);copy.regenerate(first);
  assert.equal(copy.all['lib/pico_parts.py'],'def send(): return 3\n');
  f.reset('main.py');assert.equal(f.all['main.py'],'print(4)\n');assert.equal(f.all['lib/pico_parts.py'],'def send(): return 3\n');
  assert.throws(()=>f.restore({'../main.py':'bad'}));
});

test('function outline includes class methods with accurate line numbers',()=>{
  assert.deepEqual(definitions('class IR:\n    def send(self):\n        pass\n\ndef close():\n    pass\n'),[
    {name:'IR',label:'IR',line:1},{name:'send',label:'IR.send',line:2},{name:'close',label:'close',line:5}
  ]);
});

test('directory comparison includes local-only files, nested folders and unknown comparisons',()=>{
  const {compare}=require('../studio-files.js');
  const files={'main.py':'x','parts.py':'y','lib/pico_parts.py':'z'};
  const entries=[{name:'main.py',dir:false,same:false},{name:'boot.py',dir:false,same:null}];
  assert.deepEqual(compare(files,'',entries).map(e=>[e.name,e.status]),[['lib','編集中のみ'],['boot.py','Pico内のみ'],['main.py','内容が異なる'],['parts.py','編集中のみ']]);
  assert.equal(compare(files,'lib',[{name:'pico_parts.py',dir:false,same:true}])[0].status,'同じ');
  assert.equal(compare(files,'',[{name:'main.py',dir:false,same:null}]).find(e=>e.name==='main.py').status,'未比較');
});
test('line differences align insertions and preserve empty files, trailing newlines and large replacements',()=>{
  const {diff}=require('../studio-files.js');
  const rows=diff('a\nb\nc\n','a\ninsert\nb\nc\n');
  assert.deepEqual(rows[1],{kind:'changed',local:null,remote:'insert',localLine:null,remoteLine:2});
  assert.equal(rows[2].localLine,2);assert.equal(rows[2].remoteLine,3);
  for(const [left,right] of [[null,''],['',null],['a\n','a'],['x\n'.repeat(600),'y\n'.repeat(600)]]){
    const result=diff(left,right);
    assert.equal(result.filter(r=>r.local!==null).map(r=>r.local).join('\n'),left??'');
    assert.equal(result.filter(r=>r.remote!==null).map(r=>r.remote).join('\n'),right??'');
  }
});


test('custom files and package folders survive regeneration and rename without collisions or data loss',()=>{
 const f=new Files();f.regenerate({'main.py':'pass\n','parts.py':'','lib/pico_parts.py':''});
 f.create('tools',true);f.create('tools/math_utils.py');f.edit('tools/math_utils.py','def twice(x): return x*2\n');
 assert.equal(f.all['tools/__init__.py'],'');
 assert.throws(()=>f.create('tools',true));assert.throws(()=>f.create('../outside.py'));
 assert.throws(()=>f.rename('main.py','app.py'));assert.throws(()=>f.rename('lib','library'));
 const mapping=f.rename('tools','helpers');assert.equal(mapping['tools/math_utils.py'],'helpers/math_utils.py');
 assert.equal(f.all['helpers/math_utils.py'],'def twice(x): return x*2\n');assert.equal(f.all['tools/math_utils.py'],undefined);
 f.create('occupied.py');assert.throws(()=>f.rename('helpers/math_utils.py','occupied.py'));
 assert.equal(f.all['helpers/math_utils.py'],'def twice(x): return x*2\n');
 const copy=new Files();copy.restore(JSON.parse(JSON.stringify(f.edits)));copy.regenerate(f.generated);
 assert.deepEqual(copy.all,f.all);
});
