const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Selection,between}=require('../src/studio/block-selection.js');
function blocks(){const workspace={},list=[0,1,2].map(id=>({id,workspace,previousConnection:{},classes:new Set(),getSvgRoot(){return {classList:{add:name=>this.classes.add(name),remove:name=>this.classes.delete(name)}};}}));list.forEach((block,i)=>block.getNextBlock=()=>list[i+1]||null);return list;}
test('Shift selection covers a contiguous range in either direction and keeps the anchor',()=>{
 const [a,b,c]=blocks(),selection=new Selection();selection.select(a);selection.select(c,true);
 assert.deepEqual(selection.blocks,[a,b,c]);assert.equal(selection.anchor,a);
 selection.ensure(b);assert.deepEqual(selection.blocks,[a,b,c]);
 selection.select(b,true);assert.deepEqual(selection.blocks,[a,b]);assert.equal(c.classes.size,0);
 selection.select(c);selection.select(a,true);assert.deepEqual(selection.blocks,[a,b,c]);
});
test('right-clicking a different block highlights it and invalid ranges preserve the existing selection',()=>{
 const [a,b]=blocks(),[other]=blocks(),selection=new Selection();selection.select(a);selection.ensure(b);
 assert.equal(a.classes.size,0);assert(b.classes.has('pico-range-selected'));
 assert.equal(selection.select(other,true),false);assert.deepEqual(selection.blocks,[b]);
 assert.equal(between(a,other),null);selection.clear();assert.equal(b.classes.size,0);
});
