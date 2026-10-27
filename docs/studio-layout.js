(() => {
  function attach(grid,consolePanel,onResize=()=>{}){
    const doc=grid.ownerDocument,win=doc.defaultView,code=grid.querySelector('.code-panel'),blocks=grid.querySelector('.blocks-panel');
    const divider=doc.createElement('div');divider.className='workspace-divider';divider.tabIndex=0;divider.setAttribute('role','separator');divider.setAttribute('aria-orientation','vertical');divider.setAttribute('aria-label','コードとブロックの表示幅');
    const restore=doc.createElement('button');restore.type='button';restore.textContent='↔';restore.title='コードとブロックを表示';restore.setAttribute('aria-label',restore.title);divider.append(restore);grid.insertBefore(divider,blocks);grid.classList.add('adjustable-workspace');
    const consoleDivider=doc.createElement('div');consoleDivider.className='console-divider';consoleDivider.tabIndex=0;consoleDivider.setAttribute('role','separator');consoleDivider.setAttribute('aria-orientation','horizontal');consoleDivider.setAttribute('aria-label','コンソールの高さ');
    const consoleRestore=doc.createElement('button');consoleRestore.type='button';consoleRestore.textContent='↕';consoleRestore.title='コンソールを開閉';consoleRestore.setAttribute('aria-label',consoleRestore.title);consoleDivider.append(consoleRestore);consolePanel.prepend(consoleDivider);
    let ratio=.6,height=Math.min(win.innerHeight*.3,260),lastRatio=ratio,lastHeight=height;
    try{const saved=JSON.parse(win.localStorage.getItem('pico-studio-layout'));if(saved){ratio=Number.isFinite(saved.ratio)?Math.max(0,Math.min(1,saved.ratio)):ratio;height=Number.isFinite(saved.height)?Math.max(12,Math.min(win.innerHeight,saved.height)):height;}}catch(_){}
    if(ratio>0&&ratio<1)lastRatio=ratio;if(height>12)lastHeight=height;
    function paint(){
      grid.style.setProperty('--code-share',ratio+'fr');grid.style.setProperty('--block-share',(1-ratio)+'fr');code.hidden=ratio===0;blocks.hidden=ratio===1;
      divider.setAttribute('aria-valuenow',Math.round(ratio*100));restore.hidden=ratio>0&&ratio<1;
      height=Math.min(win.innerHeight,Math.max(12,height));doc.body.style.setProperty('--console-height',height+'px');consolePanel.classList.toggle('console-collapsed',height<=12);consoleDivider.setAttribute('aria-valuemin','12');consoleDivider.setAttribute('aria-valuemax',win.innerHeight);consoleDivider.setAttribute('aria-valuenow',Math.round(height));onResize();
    }
    function save(){if(ratio>0&&ratio<1)lastRatio=ratio;if(height>12)lastHeight=height;try{win.localStorage.setItem('pico-studio-layout',JSON.stringify({ratio,height}));}catch(_){} }
    function snap(value,size,handle){const edge=Math.max(handle,8)*4;return value<edge?0:value>size-edge?size:value;}
    function drag(handle,change){let dragged=false,startedOnButton=false;handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;dragged=false;startedOnButton=event.target.tagName==='BUTTON';const startX=event.clientX,startY=event.clientY;if(!startedOnButton)event.preventDefault();event.target.setPointerCapture?.(event.pointerId);doc.body.classList.add('resizing-panels');const move=e=>{if(!dragged&&Math.hypot(e.clientX-startX,e.clientY-startY)<4)return;if(!dragged)handle.setPointerCapture?.(event.pointerId);dragged=true;change(e);paint();};const up=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',up);doc.body.classList.remove('resizing-panels');if(dragged)save();};handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',up);});handle.addEventListener('click',event=>{if(dragged&&startedOnButton){event.preventDefault();event.stopImmediatePropagation();dragged=false;}},true);}
    drag(divider,event=>{const rect=grid.getBoundingClientRect();ratio=snap(Math.max(0,Math.min(rect.width,event.clientX-rect.left)),rect.width,divider.offsetWidth)/rect.width;});
    drag(consoleDivider,event=>{height=Math.max(12,snap(Math.max(0,Math.min(win.innerHeight,win.innerHeight-event.clientY)),win.innerHeight,consoleDivider.offsetHeight));});
    restore.addEventListener('click',()=>{ratio=lastRatio;paint();save();});consoleRestore.addEventListener('click',()=>{height=height<=12?lastHeight:12;paint();save();});
    divider.addEventListener('keydown',event=>{if(event.target.tagName==='BUTTON')return;if(['ArrowLeft','ArrowRight','Home','End','Enter'].includes(event.key)){event.preventDefault();ratio=event.key==='Home'?0:event.key==='End'?1:event.key==='Enter'?lastRatio:Math.max(0,Math.min(1,ratio+(event.key==='ArrowRight' ? .05 : -.05)));paint();save();}});
    consoleDivider.addEventListener('keydown',event=>{if(event.target.tagName==='BUTTON')return;if(['ArrowUp','ArrowDown','Home','End','Enter'].includes(event.key)){event.preventDefault();height=event.key==='Home'?12:event.key==='End'?win.innerHeight:event.key==='Enter'?(height<=12?lastHeight:12):height+(event.key==='ArrowUp'?24:-24);paint();save();}});
    win.addEventListener('resize',paint);paint();return {refresh:paint};
  }
  const api={attach};if(typeof module!=='undefined')module.exports=api;if(typeof window!=='undefined')window.StudioLayout=api;
})();
