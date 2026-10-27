const {test}=require('node:test');const assert=require('node:assert/strict');const {JSDOM}=require('jsdom');const {attach}=require('../docs/studio-layout.js');
test('panel handles resize, snap closed, restore, and persist their positions',()=>{
 const dom=new JSDOM('<body><div id="grid"><section class="code-panel"></section><section class="blocks-panel"></section></div><section id="console"><header class="console-header"></header><div class="terminal-surface"></div></section></body>',{url:'http://localhost/'}),w=dom.window,d=w.document,grid=d.getElementById('grid'),consolePanel=d.getElementById('console');
 try{
  grid.getBoundingClientRect=()=>({left:0,width:1000});w.localStorage.setItem('pico-studio-layout',JSON.stringify({ratio:.45,height:180}));let resized=0;attach(grid,consolePanel,()=>resized++);
  const divider=grid.querySelector('[role=separator]'),consoleDivider=consolePanel.querySelector('[role=separator]');
  const drag=(target,x,y)=>{target.dispatchEvent(new w.MouseEvent('pointerdown',{button:0,bubbles:true}));target.dispatchEvent(new w.MouseEvent('pointermove',{clientX:x,clientY:y,bubbles:true}));target.dispatchEvent(new w.MouseEvent('pointerup',{bubbles:true}));};
  divider.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home',bubbles:true}));divider.querySelector('button').click();assert.equal(grid.style.getPropertyValue('--code-share'),'0.45fr');
  consoleDivider.querySelector('button').click();consoleDivider.querySelector('button').click();assert.equal(consoleDivider.getAttribute('aria-valuenow'),'180');
  drag(divider,700,0);assert.equal(grid.style.getPropertyValue('--code-share'),'0.7fr');
  drag(divider,999,0);assert.equal(grid.querySelector('.blocks-panel').hidden,true);divider.querySelector('button').click();assert.equal(grid.querySelector('.blocks-panel').hidden,false);
  drag(divider,1,0);assert.equal(grid.querySelector('.code-panel').hidden,true);divider.querySelector('button').click();assert.equal(grid.querySelector('.code-panel').hidden,false);
  drag(consoleDivider,0,w.innerHeight-2);assert(consolePanel.classList.contains('console-collapsed'));consoleDivider.querySelector('button').click();assert(!consolePanel.classList.contains('console-collapsed'));
  assert.equal(JSON.parse(w.localStorage.getItem('pico-studio-layout')).ratio,.7);assert(resized>4);
 }finally{dom.window.close();}
});
