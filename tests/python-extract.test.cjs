const {test,before}=require('node:test');
const assert=require('node:assert/strict');
let plan,name;
before(async()=>{({planExtraction:plan,validateFunctionName:name}=await import('../src/editor/python-extract.mjs'));});
test('extraction takes external values as arguments and returns values used afterwards',()=>{
 const selected='result = value * 3\nprint(result)\n',source='value=2\n'+selected+'print(result+1)\n';
 assert.deepEqual(plan(selected,source,source),{parameters:['value'],outputs:['result']});
 assert.deepEqual(plan('print(value)\n','print(value)\n','from parts import value\nprint(value)\n'),{parameters:[],outputs:[]});
});
test('augmented assignments, mutable containers and loop-local names are analyzed without extra return values',()=>{
 const selected='total += amount\nvalues[index] = total\nfor _ in range(2):\n    print(total)\n',source='total=0\n'+selected+'print(total)\n';
 assert.deepEqual(plan(selected,source,source),{parameters:['total','amount','values','index'],outputs:['total']});
});
test('both conditional branches can define a returned result, while an uncertain result is rejected',()=>{
 const selected='if flag:\n    value=1\nelse:\n    value=2\n',source=selected+'print(value)\n';
 assert.deepEqual(plan(selected,source,source),{parameters:['flag'],outputs:['value']});
 assert.throws(()=>plan('if flag:\n    value=1\n',source,source),/条件によって値が決まりません/);
});
test('return statements and nested closures in the remaining function require the extracted result',()=>{
 const selected='result = value*2\n';
 for(const rest of ['return result\n','def read():\n    return result\nreturn read()\n'])assert.deepEqual(plan(selected,selected+rest,'', ['value']),{parameters:['value'],outputs:['result']});
});
test('control flow escaping the selection and changes to Python scope are rejected before editing',()=>{
 for(const source of ['return value\n','break\n','continue\n','global value\n','nonlocal value\n','yield value\n','import time\n','def work():\n    pass\n','try:\n    work()\nfinally:\n    done()\n','print(locals())\n'])assert.throws(()=>plan(source,source,source),Error);
 assert.deepEqual(plan('while True:\n    break\n','while True:\n    break\n',''),{parameters:[],outputs:[]});
});
test('a function parameter can shadow a builtin and still becomes an argument',()=>{
 assert.deepEqual(plan('print(value)\n','print(value)\n','',['print','value']),{parameters:['print','value'],outputs:[]});
});
test('new function names accept Japanese identifiers and reject keywords, existing bindings and builtins',()=>{
 assert.equal(name('風量を変える','value=1\n'),'風量を変える');
 for(const value of ['while','bad name','1name','value','print'])assert.throws(()=>name(value,'value=1\n'),Error);
});

test('conditional writes carry the previous value and reject a new argument that would be uninitialized',()=>{
 const selected='if flag:\n    value = 1\n',source='value=0\n'+selected+'print(value)\n';
 assert.deepEqual(plan(selected,source,source,[],['value','flag']),{parameters:['flag','value'],outputs:['value']});
 const unsafe='if flag:\n    value=1\nprint(value)\n';
 assert.throws(()=>plan(unsafe,unsafe,unsafe,[],['flag']),/値を用意する部分/);
});

test('module and class assignments stay visible to callers outside the file',()=>{
 assert.deepEqual(plan('level = 3\n','level = 3\n','level = 3\n',[],[],true),{parameters:[],outputs:['level']});
 assert.throws(()=>plan('value=3\n','value=3\nprint(globals())\n',''),/globals/);
 for(const source of ['value = [x*2 for x in values]\n','fn = lambda x: x\n','if (value := read()):\n    print(value)\n','del value\n','value: int = 3\n'])assert.throws(()=>plan(source,source,source),Error);
});

test('docstrings and calls in a module with global rebinding are not moved into a new frame',()=>{
 assert.throws(()=>plan('"module docstring"\n','"module docstring"\n',''),/ドキュメント文字列/);
 const source='value=0\ndef change():\n    global value\n    value += 1\nprint(value)\nchange()\nprint(value)\n';
 assert.throws(()=>plan('print(value)\nchange()\nprint(value)\n',source,source),/global/);
});
