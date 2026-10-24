(() => {
  'use strict';
  const $=id=>document.getElementById(id),panel=$('signal-converter');
  if(!panel)return;
  let current=null,captured=null,ranges=[],focused=-1;
  const labels={times:'時間配列（µs）',bits:'0・1の配列',binary:'2進数の文字列',text:'文字列（UTF-8）',number:'数値'};
  function options(){return {unit:Number($('conversion-unit').value),leader:$('conversion-leader').value,lsb:$('conversion-order').value==='lsb',width:Number($('conversion-width').value),start:Number($('conversion-start').value)};}
  function output(kind){return !current?'':kind==='times'||kind==='bits'?JSON.stringify(current[kind]):kind==='binary'?JSON.stringify(current.binary):kind==='text'&&current.text!==null?JSON.stringify(current.text):current[kind]??'';}
  function selectBit(index){
    focused=index>=0&&index<current.bits.length?index:-1;
    for(const button of $('conversion-bit-buttons').children)button.setAttribute('aria-pressed',String(Number(button.dataset.index)===focused));
    let message='';
    if(focused>=0){const offset=current.start+focused*2;message=`ビット ${focused}：${current.bits[focused]} · ON ${current.times[offset].toLocaleString()} µs / OFF ${current.times[offset+1].toLocaleString()} µs`;}
    $('conversion-selection').textContent=message;draw();
  }
  function draw(){if(current&&panel.open)ranges=window.LiveAnalyzer.drawSignal($('conversion-wave'),Math.min(16000,Math.max(240,$('conversion-wave-wrap').clientWidth)*Number($('conversion-zoom').value)),current.times,{start:current.start,bits:current.bits.map(String)},focused);}
  function render(){
    for(const kind of ['times','bits','binary','number','text']){
      $('conversion-'+kind).value=output(kind);
      $('conversion-'+kind).placeholder=current?.[kind]===null?'—':'';
      document.querySelector(`[data-copy-conversion="${kind}"]`).disabled=current[kind]===null;
    }
    $('conversion-text-state').textContent=current.textReason;
    $('conversion-copy-state').textContent='';$('conversion-bit-buttons').replaceChildren();
    current.bits.forEach((bit,index)=>{const button=document.createElement('button');button.type='button';button.textContent=bit;button.dataset.index=index;button.className='bit-'+(bit?'one':'zero');button.setAttribute('aria-label',`ビット ${index}：${bit}`);button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>selectBit(index));$('conversion-bit-buttons').append(button);});
    $('conversion-result').hidden=false;selectBit(-1);
  }
  function convert(){
    try{current=window.SignalConversion.convert($('conversion-kind').value,$('conversion-input').value,options());$('conversion-error').textContent='';$('conversion-input').removeAttribute('aria-invalid');render();}
    catch(error){current=null;$('conversion-result').hidden=true;$('conversion-error').textContent=error.message;$('conversion-input').setAttribute('aria-invalid','true');}
  }
  function inputKind(){
    const kind=$('conversion-kind').value;$('conversion-input-label').textContent=labels[kind];$('conversion-width-wrap').hidden=kind!=='number';
    $('conversion-start-wrap').hidden=kind!=='times';$('conversion-unit').disabled=kind==='times';
    const examples={times:'[560, 560, 560, 1680, 560]',bits:'[0, 1, 0, 0, 0, 0, 0, 1]',binary:'01000001',text:'A',number:'65'};
    $('conversion-input').value=current?(kind==='binary'?current.binary:kind==='text'?current.text??'':output(kind)):examples[kind];
    $('conversion-error').textContent='';$('conversion-input').removeAttribute('aria-invalid');
  }
  function setCapture(times,start,lsb){captured={times:[...times],start,lsb};$('conversion-capture').disabled=false;}
  function loadCapture(){
    if(!captured)return;
    $('conversion-kind').value='times';inputKind();$('conversion-input').value=JSON.stringify(captured.times);
    const ons=captured.times.filter((_,i)=>i%2===0).slice(captured.start?1:0),unit=ons.length?Math.min(...ons):560;
    $('conversion-unit').value=unit;
    $('conversion-leader').value=captured.start===2?(captured.times[0]/unit>=12?'long':'short'):'none';
    $('conversion-start').value=captured.start;
    $('conversion-order').value=captured.lsb?'lsb':'msb';panel.open=true;convert();
  }
  $('conversion-apply').addEventListener('click',convert);
  $('conversion-kind').addEventListener('change',inputKind);
  $('conversion-capture').addEventListener('click',loadCapture);
  $('capture-convert').addEventListener('click',()=>{loadCapture();$('conversion-tab')?.click();});
  panel.addEventListener('toggle',()=>{if(panel.open){if(!current)convert();else draw();}});
  $('conversion-zoom').addEventListener('input',draw);
  $('conversion-leader').addEventListener('change',()=>{$('conversion-start').value=$('conversion-leader').value==='none'?0:2;convert();});
  for(const id of ['conversion-unit','conversion-start','conversion-order','conversion-width'])$(id).addEventListener('change',convert);
  $('conversion-wave').addEventListener('click',event=>{
    if(!current)return;
    const x=event.clientX-$('conversion-wave').getBoundingClientRect().left,segment=ranges.find(r=>x>=r.a&&x<r.b);
    if(segment)selectBit(Math.floor((segment.index-current.start)/2));
  });
  for(const button of document.querySelectorAll('[data-copy-conversion]'))button.addEventListener('click',async()=>{
    const target=$('conversion-'+button.dataset.copyConversion);
    try{await navigator.clipboard.writeText(target.value);$('conversion-copy-state').textContent='コピーしました。';}
    catch(_){target.focus({preventScroll:true});target.select();$('conversion-copy-state').textContent='選択した値を Ctrl+C / ⌘C でコピーできます。';}
  });
  window.addEventListener('resize',draw);
  window.SignalConverter={setCapture,show(){panel.open=true;if(!current)convert();else draw();}};
  inputKind();
  const frame=window.LiveAnalyzer.currentCapture();if(frame)setCapture(frame.times,frame.start,frame.lsb);
})();
