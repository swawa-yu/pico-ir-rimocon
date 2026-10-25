"use strict";

const {Capture, decodeDurations, timeAxis, validateHistory, visibleEdges, signalKind,overviewLevels} = LiveIR;
const $ = id => document.getElementById(id);
const capture = new Capture();
let selectedRecording=null;
let continuousSpan=null;
let selected = null, armed = true, frozenLive = null, drawQueued = false;
let port = null, readTask = null, connecting = false, disconnecting = false;
let demoTimer = null, ranges = [], sourceState = "USB未接続", lastPacketAt = null;
let serialBuffer='',receiverError='',observedPin=null,receiverStopping=false;
const receiverOptions={
  onState(state){
    port=receiver.port;
    if(state==='disconnected'){sourceState='USB未接続';lastPacketAt=null;capture.active=null;}
    if(state==='connected'){sourceState='USB接続済み';if(!receiver.running){lastPacketAt=null;capture.active=null;}}
    controls();scheduleDraw();
  },
  onOutput(text,error){if(error){receiverError=(receiverError+text).slice(-2048);if(!receiverStopping&&!disconnecting)status(receiverError.trim());}else receiveText(text);},
  onIdleOutput:receiveText,
  onSelect(){startStream('USB');serialBuffer='';observedPin=null;}
};
const receiver=window.PicoDevices?window.PicoDevices.forRole('observer',receiverOptions):new PicoREPL(receiverOptions);
if(window.PicoDevices)window.PicoDevices.bindSelect($('observer-device'),'observer');
for(let pin=0;pin<=22;pin++){const option=document.createElement('option');option.value=pin;option.textContent=`GP${pin}`;$('receiver-pin').append(option);}
$('receiver-pin').value='15';
const auxiliaryOutputs=[],auxiliaryControls=[];
function addAuxiliaryPin(pin=null,level=1){
  if(receiver.busy||receiver.running)return;
  const used=new Set([Number($('receiver-pin').value),...auxiliaryOutputs.map(output=>output.pin)]);
  if(pin===null)pin=Array.from({length:23},(_,i)=>i).find(value=>!used.has(value));
  if(pin===undefined){status('追加できるGPIOがありません。');return;}
  const output={pin,level};auxiliaryOutputs.push(output);
  const row=document.createElement('div');row.className='auxiliary-pin';
  const gpio=document.createElement('select');gpio.setAttribute('aria-label','追加出力のGPIO');
  for(let number=0;number<=22;number++){const option=document.createElement('option');option.value=number;option.textContent=`GP${number}`;gpio.append(option);}gpio.value=String(pin);
  const state=document.createElement('select');state.setAttribute('aria-label','受信中の出力レベル');
  for(const [value,label] of [['1','HIGH（1）'],['0','LOW（0）']]){const option=document.createElement('option');option.value=value;option.textContent=label;state.append(option);}state.value=String(level);
  const remove=document.createElement('button');remove.className='secondary';remove.textContent='削除';
  const fields=[gpio,state,remove];auxiliaryControls.push(fields);
  gpio.addEventListener('change',()=>{output.pin=Number(gpio.value);});state.addEventListener('change',()=>{output.level=Number(state.value);});
  remove.addEventListener('click',()=>{auxiliaryOutputs.splice(auxiliaryOutputs.indexOf(output),1);auxiliaryControls.splice(auxiliaryControls.indexOf(fields),1);row.remove();});
  row.append(gpio,state,remove);$('auxiliary-pins').append(row);controls();
}
$('auxiliary-add').addEventListener('click',()=>addAuxiliaryPin());
function receiveText(text){
  serialBuffer+=text;
  if(serialBuffer.length>262144){serialBuffer='';status('受信行が長すぎます。受信プログラムを確認してください。');return;}
  let newline;
  while((newline=serialBuffer.indexOf('\n'))!==-1){
    const line=serialBuffer.slice(0,newline).trim();serialBuffer=serialBuffer.slice(newline+1);
    if(!line)continue;
    let packet;try{packet=JSON.parse(line);}catch(_){continue;}
    if(packet.ir!==1)continue;
    try{accept(packet);if(packet.pin!==undefined)observedPin=packet.pin;controls();}catch(error){status(error.message);}
  }
}

function status(text = "") { $("status").textContent = text; }
function scheduleDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; drawLive(); });
}
function controls() {
  $("connect").disabled = connecting || Boolean(port) || demoTimer !== null;
  $("disconnect").disabled = !port || disconnecting;
  $("demo-fast").disabled = $("demo-slow").disabled = connecting || Boolean(port) || demoTimer !== null;
  $("demo-stop").hidden = demoTimer === null;
  $('receiver-start').disabled=!port||receiver.busy||receiver.running||connecting||disconnecting;
  $('receiver-stop').disabled=!port||receiver.busy||(!receiver.running&&lastPacketAt===null)||disconnecting;
  $('receiver-pin').disabled=receiver.busy||receiver.running;
  $('auxiliary-add').disabled=receiver.busy||receiver.running;
  for(const fields of auxiliaryControls)for(const field of fields)field.disabled=receiver.busy||receiver.running;
  $('observer-device').disabled=receiver.busy;
  updateLiveState();
  $("connection-state").textContent = connecting ? "USB接続中…" : disconnecting ? "USB切断中…" : sourceState;
}
function accept(packet) {
  const previousId = capture.nextId;
  capture.ingest(packet);
  lastPacketAt = performance.now();
  if (capture.message) { status(capture.message); capture.message = ""; }
  if (capture.nextId !== previousId) {
    for(const frame of capture.frames.filter(f=>f.id>=previousId))if(capture.source!=='USB'&&!frame.name)frame.name=capture.source==='サンプル'?'サンプルの信号':'ブロック送信の信号（模擬）';
    if (armed) {
      selected = capture.frames.find(f => f.id >= previousId) || capture.frames.at(-1);
      capture.protectedId = selected.id;
      armed = false;
      updateArm();
      drawCapture();
    }
    renderHistory();
  }
  syncTimeline();$('save').disabled=!capture.frames.length&&!capture.recordings.length;updateLiveState();scheduleDraw();
}
function updateArm() {
  $("arm").setAttribute("aria-pressed", String(armed));
  $("arm").textContent = armed ? "次の信号を待機中" : "次の信号を固定";
}
function startStream(source) {
  capture.resetStream();
  capture.source = source;
  frozenLive = null;selectedRecording=null;$("live-follow").checked=true;
  $("pause").textContent = "表示を一時停止";
  lastPacketAt = null;
  status();
  scheduleDraw();
}

function updateLiveState(){
  const fresh=lastPacketAt!==null&&performance.now()-lastPacketAt<=3000;
  const live=fresh&&(Boolean(port)||demoTimer!==null);
  const sim=demoTimer!==null;
  $('receiver-state').textContent=sim?'サンプル再生中':!port?'未接続':receiver.busy?'起動・停止処理中':fresh?'受信中':receiver.running&&receiver.task==='program'?'プログラム実行中':receiver.running?'受信プログラム実行中・データ未受信':'受信停止・データなし';
  const recorded=capture.recordings.length>0;
  $('live-empty').hidden=recorded;$('live-wave').hidden=!recorded;
  $('live-overview').hidden=!recorded;
  $('pause').disabled=!recorded;
  $('live-empty').textContent=!port&&!sim?'USB接続して受信を開始するか、サンプルを再生してください。':receiver.running?'受信データが届いていません。':'受信を開始してください。';
  const pin=observedPin===null?'GPIO':`GP${observedPin}`;
  $('signal-state').textContent=live?`${sim?'模擬入力':pin}: ${capture.on?'LOW（0）':'HIGH（1）'} · ${capture.on?'赤外線あり':'赤外線なし'}`:'ピンレベル —（未観測）';
}
async function connect(){
  if(!('serial' in navigator)){status('USB接続にはPC版Chromeを使ってください。サンプル再生はこのブラウザで試せます。');return;}
  connecting=true;controls();
  try{
    const chosen=window.PicoDevices?await window.PicoDevices.requestPort(navigator.serial):await navigator.serial.requestPort();
    startStream('USB');serialBuffer='';observedPin=null;receiverError='';
    await receiver.connect(chosen);readTask=receiver.readTask;port=chosen;sourceState='USB接続済み';
  }catch(error){if(error.name!=='NotFoundError')status('USBに接続できません。エディタや別のタブで接続している場合は、そちらを切断してください。');}
  finally{connecting=false;controls();}
}
async function disconnect(){
  if(!port||disconnecting)return;
  disconnecting=true;controls();
  try{await receiver.disconnect();}catch(error){status(error.message);}
  finally{port=receiver.port;disconnecting=false;controls();scheduleDraw();}
}
async function startReceiver(){
  const pin=Number($('receiver-pin').value);
  if(!Number.isInteger(pin)||pin<0||pin>22){status('受信ピンをGP0〜GP22から選んでください。');return;}
  const used=new Set([pin]);
  for(const output of auxiliaryOutputs){
    if(!Number.isInteger(output.pin)||output.pin<0||output.pin>22||![0,1].includes(output.level)){status('追加出力はGP0〜GP22とHIGH／LOWを指定してください。');return;}
    if(used.has(output.pin)){status('受信ピンと追加出力には、重複しないGPIOを指定してください。');return;}
    used.add(output.pin);
  }
  startStream('USB');serialBuffer='';receiverError='';observedPin=pin;
  try{await receiver.run(PicoSources.receiver.replace('RECEIVER_PIN = 15',`RECEIVER_PIN = ${pin}`).replace('AUXILIARY_OUTPUTS = []',`AUXILIARY_OUTPUTS = ${JSON.stringify(auxiliaryOutputs.map(output=>[output.pin,output.level]))}`));}
  catch(error){status(error.message);}
  controls();
}
async function stopReceiver(){
  receiverStopping=true;status();
  try{await receiver.interrupt();lastPacketAt=null;capture.active=null;}catch(error){status(error.message);}
  finally{receiverStopping=false;controls();scheduleDraw();}
}

function playDemo(scale) {
  const durations = [4480,2240];
  for (const bit of "01000001") durations.push(560, bit === "1" ? 1680 : 560);
  durations.push(560);
  return playSignal(durations, scale, "サンプル");
}
function playSignal(durations, scale, source) {
  if (port || connecting || demoTimer !== null) return false;
  startStream(source);
  sourceState = `${source}再生中`;
  let t = 100000;
  const events = [];
  durations.forEach((d, i) => { events.push([t, i % 2 === 0 ? 1 : 0]); t += d * scale; });
  events.push([t, 0]);
  const end = t + durations[durations.length - 1] * scale * capture.ratio + 100000;
  let seq = 0, index = 0, on = 0;
  const started = performance.now();
  accept({ir:1, seq:seq++, time:0, on:0, edges:[], lost:0});
  demoTimer = setInterval(() => {
    const now = Math.min(end, Math.floor((performance.now() - started) * 1000));
    const edges = [];
    while (index < events.length && events[index][0] <= now) {
      const edge = events[index++]; edges.push(edge); on = edge[1];
    }
    accept({ir:1, seq:seq++, time:now, on, edges, lost:0});
    if (now >= end) stopDemo();
  }, 20);
  controls();
  return true;
}
function stopDemo() {
  if (demoTimer === null) return;
  clearInterval(demoTimer); demoTimer = null;
  capture.active = null;
  sourceState = `${capture.source}停止 · USB未接続`;
  controls(); scheduleDraw();
}

function canvasContext(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr); ctx.font = "11px sans-serif";
  return ctx;
}
function liveView(){
  if(frozenLive)return frozenLive;
  if(selectedRecording!==null){const record=capture.recordings.find(r=>String(r.id)===String(selectedRecording));if(record)return {time:record.end,on:record.edges.at(-1).on,live:record.edges};selectedRecording=null;}
  return capture;
}
function liveBounds(){
  const view=liveView(),span=$('window').value==='custom'?continuousSpan:Number($('window').value);
  const end=frozenLive?frozenLive.end:$('live-follow').checked?(view.time||0):Math.min(view.time||0,Number($('live-position').value)*1000);
  return {view,span,end,begin:Math.max(0,end-span)};
}
function moveLive(end){
  const view=liveView();
  frozenLive=null;$('live-follow').checked=false;$('pause').textContent='表示を一時停止';
  syncTimeline();$('live-position').value=Math.max(Number($('live-position').min),Math.min(view.time||0,end)/1000);
  scheduleDraw();
}
function zoomLive(direction,anchor=.5){
  const {span}=liveBounds(),values=Array.from($('window').options,o=>Number(o.value)).filter(Number.isFinite);
  const next=direction<0?values.filter(v=>v<span).at(-1):values.find(v=>v>span);
  if(next)setLiveSpan(next,anchor);
}
function setLiveSpan(value,anchor=.5){
  const {span,begin}=liveBounds(),nextSpan=Math.max(1000,Math.min(300000000,value)),time=begin+span*anchor;
  continuousSpan=nextSpan;
  const exact=Array.from($('window').options).some(o=>Number(o.value)===nextSpan);
  let custom=$('window-custom');
  if(!exact&&!custom){custom=document.createElement('option');custom.id='window-custom';custom.value='custom';$('window').append(custom);}
  if(custom){custom.hidden=exact;if(!exact)custom.textContent=nextSpan<1000000?`${(nextSpan/1000).toFixed(2)} ms`:`${(nextSpan/1000000).toFixed(3)} 秒`;}
  $('window').value=exact?String(nextSpan):'custom';moveLive(Math.max(0,time-nextSpan*anchor)+nextSpan);
}
function selectedRecord(){return selected&&capture.recordings.find(r=>String(r.id)===String(selected.recording??selected.session));}
function locateSelected(){
  const record=selectedRecord();if(!record)return;
  selectedRecording=String(record.id)===String(capture.recordingId)?null:record.id;frozenLive=null;
  const total=selected.durations.reduce((a,b)=>a+b,0),options=Array.from($('window').options).filter(o=>Number.isFinite(Number(o.value)));
  const span=Number((options.find(o=>Number(o.value)>=total*1.4)||options.at(-1)).value);
  $('window').value=String(span);moveLive(selected.start+total+(span-total)/2);
}
function syncTimeline(){
  const records=capture.recordings,select=$('live-record');
  const signature=records.map(r=>r.id).join(',');
  if(select.dataset?.records!==signature){
    select.replaceChildren();for(const record of records){const option=document.createElement('option');option.value=record.id;option.textContent=`記録 ${records.indexOf(record)+1} · ${record.source}`;select.append(option);}
    if(select.dataset)select.dataset.records=signature;
  }
  select.value=selectedRecording===null?String(capture.recordingId):String(selectedRecording);
  const view=liveView(),position=$('live-position');
  position.min=(view.live[0]?.time||0)/1000;position.max=Math.max(Number(position.min),(view.time||0)/1000);
  if(frozenLive)position.value=frozenLive.end/1000;
  else if($('live-follow').checked)position.value=position.max;
  else position.value=Math.max(Number(position.min),Math.min(Number(position.max),Number(position.value)));
  $('live-retained').textContent=`${records.reduce((n,r)=>n+r.edges.length,0).toLocaleString()}変化${capture.droppedEdges?' · 古い変化を除外済み':''}`;
}
function drawLive() {
  const view = liveView();
  syncTimeline();
  const canvas = $("live-wave"), padding = getComputedStyle(canvas.parentElement);
  const width = Math.max(240, canvas.parentElement.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight));
  const ctx = canvasContext(canvas, width, 140), left = 38, right = width - 14;
  const {span,end,begin}=liveBounds();
  const x = t => left + (t - begin) / span * (right - left);
  ctx.fillStyle = "#667d89"; ctx.fillText("ON",0,36); ctx.fillText("OFF",0,91);
  ctx.strokeStyle = "#e1e8ed";
  const axis=timeAxis(span,right-left),unit=span<1000000?1000:1000000,unitName=unit===1000?'ms':'s';
  for (let tick=Math.ceil(begin/axis.step)*axis.step;tick<=begin+span;tick+=axis.step) {
    const px=x(tick);
    ctx.beginPath(); ctx.moveTo(px,12); ctx.lineTo(px,108); ctx.stroke();
    ctx.textAlign=px<left+30?'left':px>right-30?'right':'center';
    ctx.fillText(`${(tick/unit).toLocaleString('en-US',{maximumFractionDigits:3})} ${unitName}`,px,130);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(left,0,right-left,110); ctx.clip();
  if(selectedRecord()&&String(selectedRecord().id)===String(selectedRecording??capture.recordingId)){
    const a=x(selected.start),b=x(selected.start+selected.durations.reduce((n,d)=>n+d,0));
    ctx.fillStyle='#e5f0f6';ctx.fillRect(a,12,b-a,96);
    const start=Number($('start').value),decoded=decodeDurations(selected.durations,start,$('order').value==='lsb');
    let offset=selected.start+selected.durations.slice(0,start).reduce((n,d)=>n+d,0);
    ctx.strokeStyle='#8799a677';ctx.lineWidth=.75;ctx.beginPath();
    decoded.bits.forEach((_,i)=>{const duration=selected.durations[start+i*2]+selected.durations[start+i*2+1];if(x(offset+duration)-x(offset)>=3){ctx.moveTo(x(offset),12);ctx.lineTo(x(offset),108);ctx.moveTo(x(offset+duration),12);ctx.lineTo(x(offset+duration),108);}offset+=duration;});ctx.stroke();
  }
  ctx.strokeStyle = "#334b5c"; ctx.lineWidth = 1.5;
  const segments = visibleEdges(view.live,begin,end);
  for (let i = 0; i < segments.length; i++) {
    const item = segments[i], next = segments[i+1];
    const stop = next ? next.time : end;
    if (stop < begin || item.time > end) continue;
    const y = item.on ? 32 : 87;
    ctx.beginPath(); ctx.moveTo(x(Math.max(begin,item.time)),y); ctx.lineTo(x(Math.min(stop,end)),y);
    if (next&&stop<=end) ctx.lineTo(x(stop),next.on ? 32 : 87);
    ctx.stroke();
  }
  ctx.restore();
  updateLiveState();
  $("live-time").textContent = view.time === null ? "—" : `${frozenLive||!$("live-follow").checked ? "記録表示 · " : ""}${(end/1e6).toFixed(3)} s`;
  drawOverview(width);
}
function overviewBounds(){
  const {view,begin,span}=liveBounds(),start=view.live[0]?.time||0,finish=Math.max(start+1,view.time||0);
  return {view,start,finish,begin,end:Math.min(finish,begin+span),extent:finish-start};
}
function drawOverview(width){
  const canvas=$('live-overview'),ctx=canvasContext(canvas,width,76),left=38,right=width-14;
  const {view,start,finish,begin,end,extent}=overviewBounds(),x=t=>left+(t-start)/extent*(right-left);
  ctx.fillStyle='#f1f5f8';ctx.fillRect(left,8,right-left,44);
  const levels=overviewLevels(view.live,start,finish,right-left);
  ctx.beginPath();ctx.strokeStyle='#667d89';ctx.lineWidth=1;
  levels.forEach((level,i)=>{const px=left+i;ctx.moveTo(px,level&2?16:44);ctx.lineTo(px+(level===3?0:1),level&1?44:16);});ctx.stroke();
  if(view.live.length){
    const a=Math.max(left,x(begin)),b=Math.min(right,x(end)),marker=Math.max(3,b-a);
    const markerLeft=Math.min(right-marker,Math.max(left,a-(marker-(b-a))/2));
    ctx.fillStyle='#075b8122';ctx.fillRect(markerLeft,7,marker,46);
    ctx.strokeStyle='#075b81';ctx.lineWidth=1.5;ctx.strokeRect(markerLeft,7,marker,46);
  }
  ctx.fillStyle='#667d89';ctx.textAlign='left';ctx.fillText(`${(start/1e6).toFixed(3)} s`,left,71);
  ctx.textAlign='right';ctx.fillText(`${(finish/1e6).toFixed(3)} s`,right,71);
}

function analysis() {
  const start = Number($("start").value);
  if (!$("start").value.trim() || !Number.isInteger(start) || start < 0 || start % 2) throw new Error("データ開始位置は0以上の偶数にしてください。");
  return {start, ...decodeDurations(selected.durations, start, $("order").value === "lsb")};
}
function drawCapture() {
  $("empty-capture").hidden = Boolean(selected);
  $("capture-content").hidden = !selected;
  if (!selected) return;
  $("capture-title").textContent = selected.name || `受信した信号 ${selected.id}`;
  if($("capture-name").value!== (selected.name||""))$("capture-name").value=selected.name||"";
  const signal = selected.durations, total = signal.reduce((a,b) => a+b,0);
  $("summary").textContent = `${(total/1000).toFixed(3)} ms · ${signal.length}区間 · ${selected.source}`;
  $('capture-locate').disabled=!selectedRecord();
  let result;
  try { result = analysis(); }
  catch (error) { status(error.message); result = {start:signal.length, bits:[], bytes:[]}; }
  $("bits").replaceChildren();
  for (const bit of result.bits) {
    const element = document.createElement("span"); element.textContent = bit;
    element.className = bit === "0" ? "bit-zero" : bit === "1" ? "bit-one" : "bit-unknown";
    $("bits").append(element);
  }
  if (!result.bits.length) $("bits").textContent = "—";
  $("hex").textContent = result.bytes.map(b => b === null ? "??" : b.toString(16).padStart(2,"0").toUpperCase()).join(" ") || "—";
  $("ascii").textContent = result.bytes.map(b => b !== null && b >=32 && b<=126 ? String.fromCharCode(b) : "·").join("") || "—";
  const width = Math.min(16000, Math.max(240,$("capture-wrap").clientWidth) * Number($("zoom").value));
  ranges=drawSignal($("capture-wave"),width,signal,result);
  window.SignalConverter?.setCapture(signal,result.start,$('order').value==='lsb');
}
function drawSignal(canvas,width,signal,result,focusedBit=-1){
  const ctx = canvasContext(canvas,width,210), left=42, right=width-28;
  const total=signal.reduce((a,b)=>a+b,0),ranges=[];
  const axis = timeAxis(total,right-left), x = t => left + t / axis.max * (right-left);
  const unit = total >= 1000000 ? 1000 : 1;
  const unitName = unit === 1000 ? "ms" : "µs";
  let offset = signal.slice(0,result.start).reduce((a,b)=>a+b,0);
  result.bits.forEach((bit,i) => {
    const duration = signal[result.start+i*2]+signal[result.start+i*2+1], a=x(offset), b=x(offset+duration);
    ctx.fillStyle = bit === "0" ? "#dcebf9" : bit === "1" ? "#fce6d1" : "#edf0f2";
    ctx.fillRect(a,38,b-a,112);
    if(i===focusedBit){ctx.strokeStyle="#075b81";ctx.lineWidth=2;ctx.strokeRect(a,38,b-a,112);}
    ctx.strokeStyle="#8799a677";ctx.lineWidth=.75;ctx.beginPath();ctx.moveTo(a,38);ctx.lineTo(a,150);ctx.moveTo(b,38);ctx.lineTo(b,150);ctx.stroke();
    if(b-a>14) {ctx.fillStyle="#334b5c";ctx.textAlign="center";ctx.fillText(bit,(a+b)/2,26);}
    offset+=duration;
  });
  for(let i=0;i<=Math.round(axis.max/axis.step);i++) {
    const px=x(i*axis.step);ctx.strokeStyle="#e1e8ed";ctx.beginPath();ctx.moveTo(px,38);ctx.lineTo(px,150);ctx.stroke();
    ctx.fillStyle="#667d89";ctx.textAlign=i===0?"left":"center";ctx.fillText((i*axis.step/unit).toLocaleString("en-US"),px,178);
  }
  ctx.textAlign="right";ctx.fillText(unitName,right,202);ctx.textAlign="left";ctx.fillText("ON",0,66);ctx.fillText("OFF",0,136);
  let t=0, previousY;
  signal.forEach((d,i)=>{
    const a=x(t),b=x(t+d),on=i%2===0,y=on?62:132;
    ctx.strokeStyle="#334b5c";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(a,previousY===undefined?y:previousY);ctx.lineTo(a,y);ctx.lineTo(b,y);if(on&&i===signal.length-1)ctx.lineTo(b,132);ctx.stroke();
    ctx.save();ctx.font="9px sans-serif";ctx.fillStyle="#334b5c";ctx.textAlign="center";ctx.fillText((d/unit).toLocaleString("en-US", {maximumFractionDigits:3}),(a+b)/2,y+(on?-12:22));ctx.restore();
    ranges.push({a,b,on,d,time:t,index:i});t+=d;previousY=y;
  });
  return ranges;
}
function renderHistory(){
  $('history-count').textContent=capture.frames.length;
  $('save').disabled=!capture.frames.length&&!capture.recordings.length;
  $('history-empty').hidden=Boolean(capture.frames.length);$('history-table').hidden=!capture.frames.length;
  const rows=$('history-rows');rows.replaceChildren();
  for(const frame of [...capture.frames].reverse()){
    const row=document.createElement('tr');row.setAttribute('aria-selected',String(selected===frame));
    const decoded=decodeDurations(frame.durations,Number($('start').value),$('order').value==='lsb'),kind=signalKind(frame.durations);
    const hex=decoded.bytes.map(b=>b===null?'??':b.toString(16).padStart(2,'0').toUpperCase()).join(' ');
    const binary=decoded.bits.join('').match(/.{1,8}/g)?.join(' ')||'—';
    let time='—';if(frame.recordedAt!==undefined&&frame.recordedAt!==null)time=new Date(frame.recordedAt).toLocaleTimeString('ja-JP',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3});
    const name=document.createElement('button');name.textContent=frame.name||`信号 ${frame.id}`;name.className='history-name';name.title=`#${frame.id} · ${frame.source}`;
    const values=[name,kind,`${(frame.durations.reduce((a,b)=>a+b,0)/1000).toFixed(2)} ms`,kind==='リピート候補'?'—':String(decoded.bits.length),hex||'—',binary,time,frame.intervalUs==null?'—':`${(frame.intervalUs/1000).toFixed(2)} ms`];
    values.forEach((value,index)=>{const cell=document.createElement('td');if(index===5)cell.className='history-binary';if(typeof value==='string'){cell.textContent=value;cell.title=value;}else cell.append(value);row.append(cell);});
    row.addEventListener('click',()=>{selected=frame;capture.protectedId=frame.id;armed=false;updateArm();$('selection').textContent='';drawCapture();locateSelected();renderHistory();});
    rows.append(row);
  }
}

$("connect").addEventListener("click",connect);
$("receiver-start").addEventListener("click",startReceiver);
$("receiver-stop").addEventListener("click",stopReceiver);
$("disconnect").addEventListener("click",disconnect);
$("demo-fast").addEventListener("click",()=>playDemo(1));
$("demo-slow").addEventListener("click",()=>playDemo(100));
$("demo-stop").addEventListener("click",stopDemo);
$("pause").addEventListener("click",()=>{
  const {view,end}=liveBounds();frozenLive=frozenLive?null:{time:view.time,end,on:view.on,live:view.live.map(item=>({...item}))};
  $("pause").textContent=frozenLive?"表示を再開":"表示を一時停止";scheduleDraw();
});
$("window").addEventListener("change",scheduleDraw);
$('live-zoom-in').addEventListener('click',()=>zoomLive(-1));
$('live-zoom-out').addEventListener('click',()=>zoomLive(1));
$('capture-locate').addEventListener('click',locateSelected);
let liveDrag=null;
let overviewDrag=null;
$('live-overview').addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  const rect=$('live-overview').getBoundingClientRect(),width=Math.max(1,rect.width-52),{start,extent,begin,end}=overviewBounds();
  const at=start+Math.max(0,Math.min(1,(event.clientX-rect.left-38)/width))*extent;
  if(at<begin||at>end)moveLive(at+liveBounds().span/2);
  overviewDrag={x:event.clientX,end:liveBounds().end,extent,width};
  $('live-overview').setPointerCapture(event.pointerId);
});
$('live-overview').addEventListener('pointermove',event=>{if(overviewDrag)moveLive(overviewDrag.end+(event.clientX-overviewDrag.x)/overviewDrag.width*overviewDrag.extent);});
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('live-overview').addEventListener(event,()=>{overviewDrag=null;});
$('live-overview').addEventListener('keydown',event=>{
  if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const {end,span}=liveBounds();moveLive(end+(event.key==='ArrowLeft'?-1:1)*span/5);}
  if(['Home','End'].includes(event.key)){event.preventDefault();const {start,finish}=overviewBounds();moveLive(event.key==='Home'?start+liveBounds().span:finish);}
});
$('live-wave').addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  liveDrag={x:event.clientX,end:liveBounds().end,span:liveBounds().span};
  $('live-wave').setPointerCapture(event.pointerId);
});
$('live-wave').addEventListener('pointermove',event=>{
  if(!liveDrag)return;
  const width=Math.max(1,$('live-wave').getBoundingClientRect().width-52);
  moveLive(liveDrag.end-(event.clientX-liveDrag.x)/width*liveDrag.span);
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('live-wave').addEventListener(event,()=>{liveDrag=null;});
$('live-wave').addEventListener('wheel',event=>{
  event.preventDefault();
  if(event.ctrlKey||event.metaKey){
    const rect=$('live-wave').getBoundingClientRect();
    const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?rect.width:1);
    setLiveSpan(liveBounds().span*Math.exp(Math.max(-1,Math.min(1,delta*.002))),Math.max(0,Math.min(1,(event.clientX-rect.left-38)/Math.max(1,rect.width-52))));
  }else{
    const {end,span}=liveBounds(),width=Math.max(1,$('live-wave').getBoundingClientRect().width-52);
    const delta=(Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY)*(event.deltaMode===1?16:event.deltaMode===2?width:1);
    moveLive(end+delta/width*span);
  }
},{passive:false});
$('live-wave').addEventListener('keydown',event=>{
  if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const {end,span}=liveBounds();moveLive(end+(event.key==='ArrowLeft'?-1:1)*span/5);}
  if(['+','=','-'].includes(event.key)){event.preventDefault();zoomLive(event.key==='-'?1:-1);}
});
$('live-follow').addEventListener('change',()=>{if($('live-follow').checked){selectedRecording=null;frozenLive=null;$('pause').textContent='表示を一時停止';}scheduleDraw();});
$('live-position').addEventListener('input',()=>{frozenLive=null;$('live-follow').checked=false;$('pause').textContent='表示を一時停止';scheduleDraw();});
$('live-record').addEventListener('change',()=>{selectedRecording=String($('live-record').value)===String(capture.recordingId)?null:$('live-record').value;frozenLive=null;$('live-follow').checked=false;syncTimeline();$('live-position').value=$('live-position').max;scheduleDraw();});
$("arm").addEventListener("click",()=>{armed=!armed;updateArm();});
$("zoom").addEventListener("input",drawCapture);
for(const id of ["start","order"]) $(id).addEventListener("change",()=>{status();drawCapture();renderHistory();});
$("ratio").addEventListener("change",()=>{
  const ratio=Number($("ratio").value);
  if(!Number.isInteger(ratio)||ratio<4||ratio>100) {$("ratio").value=capture.ratio;status("終了比は4〜100の整数にしてください。");return;}
  capture.ratio=ratio;status();
});
$("capture-wave").addEventListener("click",event=>{
  const x=event.clientX-$("capture-wave").getBoundingClientRect().left, r=ranges.find(r=>x>=r.a&&x<r.b);
  if(r) $("selection").textContent=`#${r.index} · ${r.on?"ON":"OFF"} · ${r.d.toLocaleString()} µs · 開始 ${r.time.toLocaleString()} µs`;
});
$("capture-name").addEventListener("input",()=>{
  if(!selected)return;
  selected.name=$("capture-name").value.slice(0,80);
  $("capture-title").textContent=selected.name||`受信した信号 ${selected.id}`;
  renderHistory();
});
$("save").addEventListener("click",()=>{
  const records=capture.recordings,sessionFor=f=>{const index=records.findIndex(r=>String(r.id)===String(f.recording??f.session));return index<0?undefined:index;};
  const data={format:"pico-ir-history-2",frames:capture.frames.map(f=>({durations:f.durations,name:f.name||"",recordedAt:f.recordedAt??null,source:f.source,start:f.start,session:sessionFor(f),intervalUs:f.intervalUs})),streams:records.map((r,session)=>({session,source:r.source,recordedAt:r.recordedAt,end:r.end,edges:r.edges.map(e=>[e.time,e.on])}))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download="pico-ir-history.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$("load").addEventListener("click",()=>$("history-file").click());
$("history-file").addEventListener("change",async()=>{
  const file=$("history-file").files[0];if(!file)return;
  try {
    if(file.size>33554432)throw new Error("履歴ファイルは32MB以内にしてください。");
    const data=JSON.parse(await file.text()),frames=validateHistory(data);
    const importedFrames=[];
    for(const frame of frames){selected=capture.addFrame({start:frame.start??0,durations:frame.durations,name:frame.name||"",recordedAt:frame.recordedAt??null,source:frame.source||"ファイル",session:frame.session,intervalUs:frame.intervalUs});importedFrames.push(selected);}
    if(data.streams?.length){
      const imported=capture.importStreams(data.streams);
      for(const frame of importedFrames){let index=data.streams.findIndex(r=>r.session!==undefined&&r.session===frame.session);if(index<0&&data.streams.length===1&&data.streams[0].session===undefined)index=0;if(index>=0)frame.recording=imported[index].id;}
      selectedRecording=imported.at(-1).id;$('live-follow').checked=false;syncTimeline();$('live-position').value=$('live-position').max;scheduleDraw();
    }
    if(frames.length){capture.protectedId=selected.id;armed=false;updateArm();drawCapture();}renderHistory();status();
  } catch(error){status(error.message);}
  finally{$("history-file").value="";}
});
setInterval(()=>{if(port){controls();if(lastPacketAt!==null&&performance.now()-lastPacketAt>3000)scheduleDraw();}},250);
window.addEventListener("resize",()=>{scheduleDraw();drawCapture();});
controls();scheduleDraw();

window.LiveAnalyzer={
  connect,disconnect,drawSignal,
  currentCapture(){return selected?{times:[...selected.durations],start:Number($("start").value),lsb:$("order").value==='lsb'}:null;},
  preview(durations,scale){
    const ok=playSignal(durations,scale,'ブロックの波形（模擬）');
    if(ok){armed=true;updateArm();}return ok;
  },
  show(){scheduleDraw();drawCapture();}
};
