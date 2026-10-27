const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
let find;
before(async()=>{({findDefinition:find}=await import('../src/editor/python-definitions.mjs'));});
function lookup(files,target,path='main.py'){return find(files,path,files[path].lastIndexOf(target)+target.length-1);}

test('definition lookup respects the current function scope and never picks an unrelated file',()=>{
 const files={'main.py':'def work():\n    pass\ndef outer():\n    def work():\n        pass\n    work()\nwork()\n','other.py':'def missing():\n    pass\n'};
 assert.equal(lookup(files,'work').line,1);
 assert.equal(find(files,'main.py',files['main.py'].indexOf('    work()')+6).line,4);
 assert.equal(find(files,'main.py',0,'missing'),null);
});

test('from-import aliases and module aliases navigate to the imported implementation',()=>{
 const files={'main.py':'from tools import twice as double\nimport tools as t\ndouble(2)\nt.twice(3)\n','tools.py':'# helpers\ndef twice(value):\n    return value*2\n'};
 for(const target of ['double','t.twice'])assert.deepEqual(find(files,'main.py',files['main.py'].length,target),{path:'tools.py',line:2,from:10});
 assert.equal(lookup(files,'twice').path,'tools.py');
});

test('Japanese component aliases resolve through parts.py to the correct library class method',()=>{
 const files={'main.py':'from parts import 赤外線LED as 送信機\n送信機.send(65)\n','parts.py':'from pico_parts import Infrared\n赤外線LED = Infrared(16)\n','lib/pico_parts.py':fs.readFileSync('pico/lib/pico_parts.py','utf8')};
 const target=lookup(files,'send');assert.equal(target.path,'lib/pico_parts.py');
 assert.match(files[target.path].slice(target.from),/^def send\(self, value\)/);
});

test('instances, self calls and inherited methods distinguish classes sharing a method name',()=>{
 const files={'main.py':'class A:\n    def run(self):\n        pass\nclass B(A):\n    def test(self):\n        self.run()\nclass Other:\n    def run(self):\n        pass\nitem = B()\nitem.run()\n'};
 assert.equal(lookup(files,'item.run').line,2);
 assert.equal(find(files,'main.py',files['main.py'].indexOf('self.run')+7).line,2);
});

test('relative and package imports follow package files including implicit packages',()=>{
 const files={'main.py':'import package.tools as tools\ntools.work()\n','package/tools.py':'from .helper import work\n','package/helper.py':'def work():\n    pass\n'};
 assert.equal(lookup(files,'tools.work').path,'package/helper.py');
 files['main.py']='import package.tools\npackage.tools.work()\n';
 assert.equal(lookup(files,'package.tools.work').path,'package/helper.py');
});

test('parameters shadow imports; builtins, comments, strings and cyclic aliases do not produce false destinations',()=>{
 const files={'main.py':'from tools import work\ndef run(work):\n    work()\nprint("work")\n# work()\nfirst = second\nsecond = first\n','tools.py':'def work():\n    pass\n'};
 assert.equal(find(files,'main.py',files['main.py'].indexOf('    work()')+6),null);
 for(const target of ['print','second.run'])assert.equal(find(files,'main.py',files['main.py'].length,target),null);
 assert.equal(find(files,'main.py',files['main.py'].indexOf('"work"')+2),null);
 assert.equal(find(files,'main.py',files['main.py'].indexOf('# work')+4),null);
});

test('definition lookup uses current edited file contents',()=>{
 const files={'main.py':'from tools import work\nwork()\n','tools.py':'def work():\n    pass\n'};
 assert.equal(lookup(files,'work').line,1);
 files['tools.py']='\n\ndef work():\n    pass\n';assert.equal(lookup(files,'work').line,3);
});

test('block references match calls inside their enclosing class and function',async()=>{
 const {callPositions}=await import('../src/editor/python-definitions.mjs');
 const source='class First:\n    def run(self):\n        self.show()\nclass Second:\n    def run(self):\n        self.show()\n';
 const first=callPositions(source,'self.show',['First','run']),second=callPositions(source,'self.show',['Second','run']);
 assert.equal(first.length,1);assert.equal(second.length,1);assert(first[0]<second[0]);
 assert.deepEqual(callPositions(source,'self.show'),[]);
});
