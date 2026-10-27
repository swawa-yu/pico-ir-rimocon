(() => {
'use strict';
function between(first,last){
 if(!first||!last||first.workspace!==last.workspace||!first.previousConnection||!last.previousConnection)return null;
 for(const [start,end] of [[first,last],[last,first]]){
  const blocks=[];
  for(let block=start;block;block=block.getNextBlock()){blocks.push(block);if(block===end)return blocks;}
 }
 return null;
}
class Selection {
 constructor(){this.anchor=null;this.blocks=[];}
 clear(){for(const block of this.blocks)block.getSvgRoot?.()?.classList.remove('pico-range-selected');this.anchor=null;this.blocks=[];}
 select(block,extend=false){
  const blocks=extend?between(this.anchor,block):[block];if(!blocks)return false;
  const anchor=extend?this.anchor:block;
  this.clear();this.anchor=anchor;this.blocks=blocks;
  this.highlight();return true;
 }
 ensure(block){if(this.blocks.includes(block)){this.highlight();return;}this.select(block);}
 highlight(){for(const block of this.blocks)block.getSvgRoot?.()?.classList.add('pico-range-selected');}
}
const api={Selection,between};
if(typeof module!=='undefined')module.exports=api;
if(typeof window!=='undefined')window.StudioBlockSelection=api;
})();
