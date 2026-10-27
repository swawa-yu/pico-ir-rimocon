const {test}=require('node:test');const assert=require('node:assert/strict');
test('functions are grouped by file, resolve import aliases and expose return values and sentence parameters',async()=>{
 const {catalog,sentenceParts}=await import('../src/editor/python-symbols.mjs');
 const files={'main.py':'from tools import twice as double\nvalue = double(2)\n','tools.py':'# ブロック: {value} の2倍\ndef twice(value):\n    return value*2\n\ndef output(value):\n    print(value)\n'};
 const list=catalog(files,'main.py'),fn=list.find(f=>f.target==='double');assert.equal(fn.group,'tools.py');assert.equal(fn.returns,true);assert.deepEqual(fn.params,['value']);assert.equal(fn.sentence,'{value} の2倍');
 assert.equal(list.find(f=>f.target==='tools.output').returns,false);assert.equal(list.find(f=>f.target==='tools.output').module,'tools');assert(list.some(f=>f.group.startsWith('組み込み /')));
 assert.deepEqual(sentenceParts('{value} の2倍',['value']),['',' の2倍']);assert.equal(sentenceParts('{other} の2倍',['value']),null);
});
test('syntax errors and missing names are located while definitions, parameters and comprehension bindings are accepted',async()=>{
 const {inspect}=await import('../src/editor/python-symbols.mjs');
 const good='def twice(value):\n    return value*2\nnumbers = [n*2 for n in range(3)]\nprint(twice(numbers[0]))\n';assert.deepEqual(inspect(good).issues,[]);
 const bad='value = missing(1)\n';const issues=inspect(bad).issues;assert.equal(issues.length,1);assert.equal(bad.slice(issues[0].from,issues[0].to),'missing');assert(inspect('if True\n    pass\n').issues.some(i=>i.message.includes('構文')));
});
