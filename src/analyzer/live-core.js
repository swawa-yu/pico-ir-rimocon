(() => {
"use strict";

class Capture {
  constructor({ratio = 8, maxFrames = 2000, maxDurations = 262144, maxLiveEdges = 262144} = {}) {
    this.ratio = ratio;
    this.maxFrames = maxFrames;
    this.maxDurations = maxDurations;
    this.frames = [];
    this.archives=[];this.recordingId=0;this.maxLiveEdges=maxLiveEdges;this.droppedEdges=0;
    this.protectedId = null;
    this.nextId = 1;
    this.source = "USB";
    this.resetStream();
  }

  archiveLive(){
    if(this.live?.length)this.archives.push({id:this.recordingId,source:this.source,recordedAt:this.recordingAt,end:this.time,edges:this.live});
  }
  get recordings(){return [...this.archives,...(this.live?.length?[{id:this.recordingId,source:this.source,recordedAt:this.recordingAt,end:this.time,edges:this.live}]:[])];}
  trimLive(){
    let extra=this.recordings.reduce((n,r)=>n+r.edges.length,0)-this.maxLiveEdges;
    while(extra>0&&this.archives.length){const first=this.archives[0],drop=Math.min(extra,first.edges.length);first.edges.splice(0,drop);extra-=drop;this.droppedEdges+=drop;if(!first.edges.length)this.archives.shift();}
    if(extra>0){this.live.splice(0,extra);this.droppedEdges+=extra;}
  }
  importStreams(streams){
    const records=streams.map((r,i)=>({id:'file-'+Date.now()+'-'+i,source:r.source||'ファイル',recordedAt:r.recordedAt??null,end:r.end,edges:r.edges.map(([time,on])=>({time,on}))}));
    this.archives.push(...records);this.trimLive();return records;
  }
  resetStream() {
    this.archiveLive();this.recordingId++;this.recordingAt=Date.now();
    this.sequence = null;
    this.time = null;
    this.on = 0;
    this.changed = 0;
    this.active = null;
    this.live = [];
    this.message = "";
    this.recovering = false;
  }

  ingest(packet) {
    validatePacket(packet);
    const {seq, time, on, edges, lost} = packet;
    if (this.sequence === null) {
      this.sequence = seq;
      this.time = this.changed = time;
      this.on = on;
      this.live = [{time, on}];
      this.recovering = Boolean(on);
      return;
    }
    let previous = this.time, level = this.on;
    const discontinuous = seq !== this.sequence + 1 || time < previous || lost > 0 || edges.some(([t, next]) => {
      const bad = t <= previous || next === level;
      previous = t;
      level = next;
      return bad;
    }) || level !== on;
    this.sequence = seq;
    if (discontinuous) {
      this.active = null;
      this.archiveLive();this.recordingId++;this.recordingAt=Date.now();
      this.live = [{time, on}];
      this.time = this.changed = time;
      this.on = on;
      this.message = "データの欠落または時刻の不連続を検出しました。途中の信号は保存していません。";
      this.recovering = true;
      this.trimLive();return;
    }
    for (const [t, next] of edges) {
      this.finishIfIdle(t);
      if (this.active) {
        const duration = t - this.changed;
        this.active.durations.push(duration);
        if (this.active.durations.length > 4096) {
          this.active = null;
          this.recovering = true;
          this.message = "信号が4096区間を超えたため、途中の記録を破棄しました。";
        }
      }
      if (!this.active && next === 1) {
        this.active = {start: t, durations: [], incomplete: Boolean(this.recovering)};
      }
      this.on = next;
      this.changed = t;
      this.live.push({time: t, on: next});
    }
    this.time = time;
    this.finishIfIdle(time);
    this.trimLive();
  }

  finishIfIdle(t) {
    if (!this.active || this.on || !this.active.durations.length) return;
    const lastOn = this.active.durations[this.active.durations.length - 1];
    if (t - this.changed < lastOn * this.ratio) return;
    const {durations, start, incomplete} = this.active;
    this.active = null;
    if (incomplete) {
      this.recovering = false;
      return;
    }
    const previous=this.lastCompleted;
    const intervalUs=previous?.session===this.recordingId?start-previous.start:null;
    const frame=this.addFrame({start, durations, source:this.source,session:this.recordingId,intervalUs});
    this.lastCompleted={session:this.recordingId,start,id:frame.id};
  }

  addFrame(frame) {
    const record = {name:"", recordedAt:Date.now(), ...frame, durations: [...frame.durations], id: this.nextId++};
    this.frames.push(record);
    while (this.frames.length > this.maxFrames || this.frames.reduce((n, f) => n + f.durations.length, 0) > this.maxDurations) {
      const index = this.frames.findIndex(f => f.id !== this.protectedId);
      if (index === -1) break;
      this.frames.splice(index, 1);
    }
    return record;
  }
}

function validatePacket(p) {
  const integer = n => Number.isSafeInteger(n) && n >= 0;
  if (!p || p.ir !== 1 || !integer(p.seq) || !integer(p.time) || ![0, 1].includes(p.on) || !integer(p.lost) || !Array.isArray(p.edges) || p.edges.length > 4096) throw new Error("受信データの形式が違います。");
  if(p.pin!==undefined&&(!Number.isInteger(p.pin)||p.pin<0||p.pin>22))throw new Error("受信ピンが不正です。");
  let last = -1;
  for (const edge of p.edges) {
    if (!Array.isArray(edge) || edge.length !== 2 || !integer(edge[0]) || edge[0] < last || edge[0] > p.time || ![0, 1].includes(edge[1])) throw new Error("信号の時刻または状態が不正です。");
    last = edge[0];
  }
}

function decodeDurations(signal, start = 2, lsb = false) {
  const bits = [];
  for (let i = start; i + 1 < signal.length; i += 2) {
    const ratio = signal[i + 1] / signal[i];
    bits.push(Number.isFinite(ratio) && ratio > 0 ? (ratio < 2 ? "0" : "1") : "?");
  }
  const bytes = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let group = bits.slice(i, i + 8);
    if (lsb) group.reverse();
    bytes.push(group.includes("?") ? null : parseInt(group.join(""), 2));
  }
  return {bits, bytes};
}

function timeAxis(total, width) {
  const target = Math.max(1, total) / Math.max(1, Math.floor(width / 100));
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = Math.max(1, [1, 2, 5, 10].find(n => n * magnitude >= target) * magnitude);
  return {step, max: Math.max(step, Math.ceil(total / step) * step)};
}

function validateHistory(data) {
  if (!data || !["pico-ir-history-1","pico-ir-history-2"].includes(data.format) || !Array.isArray(data.frames) || data.frames.length > 2000) throw new Error("このツールの履歴ファイルを選んでください（最大2,000件）。");
  let count = 0;
  for (const f of data.frames) {
    if (!f || !Array.isArray(f.durations) || !f.durations.length || f.durations.length % 2 !== 1 || f.durations.length > 4096 || !f.durations.every(n => Number.isSafeInteger(n) && n > 0) || !Number.isSafeInteger(f.durations.reduce((a, b) => a + b, 0))) throw new Error("履歴の時間配列が不正です。");
    if (f.name !== undefined && (typeof f.name !== "string" || f.name.length > 80)) throw new Error("履歴の名前が不正です。");
    if (f.recordedAt !== undefined && f.recordedAt !== null && (!Number.isSafeInteger(f.recordedAt) || f.recordedAt < 0 || !Number.isFinite(new Date(f.recordedAt).getTime()))) throw new Error("履歴の記録時刻が不正です。");
    if (f.source !== undefined && (typeof f.source !== "string" || f.source.length > 80)) throw new Error("履歴の記録元が不正です。");
    for(const key of ['start','session','intervalUs'])if(f[key]!==undefined&&f[key]!==null&&(!Number.isSafeInteger(f[key])||f[key]<0))throw new Error('履歴の時刻・間隔が不正です。');
    count += f.durations.length;
  }
  if (count > 262144) throw new Error("履歴ファイルの区間数が多すぎます。");
  if(data.streams!==undefined){
    if(!Array.isArray(data.streams)||data.streams.length>2000)throw new Error('ライブ記録の形式が不正です。');
    let edges=0;
    for(const r of data.streams){
      if(!r||!Array.isArray(r.edges)||!r.edges.length||!Number.isSafeInteger(r.end)||r.end<0||typeof r.source!=='string'||r.source.length>80)throw new Error('ライブ記録の形式が不正です。');
      let previous=-1,level=null;
      for(const edge of r.edges){if(!Array.isArray(edge)||edge.length!==2||!Number.isSafeInteger(edge[0])||edge[0]<=previous||edge[0]>r.end||![0,1].includes(edge[1])||edge[1]===level)throw new Error('ライブ記録の時刻・レベルが不正です。');previous=edge[0];level=edge[1];}
      if(r.recordedAt!==undefined&&r.recordedAt!==null&&(!Number.isSafeInteger(r.recordedAt)||r.recordedAt<0||!Number.isFinite(new Date(r.recordedAt).getTime())))throw new Error('ライブ記録の記録時刻が不正です。');
      edges+=r.edges.length;
    }
    if(edges>262144)throw new Error('ライブ記録が262,144変化を超えています。');
  }
  return data.frames;
}

function visibleEdges(edges,begin,end){
  let lo=0,hi=edges.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(edges[mid].time<=begin)lo=mid+1;else hi=mid;}
  const start=Math.max(0,lo-1);hi=edges.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(edges[mid].time<=end)lo=mid+1;else hi=mid;}
  return edges.slice(start,Math.min(edges.length,lo+1));
}
function signalKind(durations){
  const unit=durations.at(-1),leader=durations[0]/unit,space=durations[1]/unit;
  if(durations.length===3&&leader>=12&&leader<=20&&space>=3&&space<=5)return 'リピート候補';
  const decoded=decodeDurations(durations);
  if(decoded.bits.length===32&&!decoded.bits.includes('?')&&leader>=12&&leader<=20&&space>=6&&space<=10)return 'NEC候補';
  return '信号';
}
function overviewLevels(edges,begin,end,width){
  const count=Math.max(1,Math.floor(width)),levels=new Uint8Array(count),last=new Uint8Array(count),extent=Math.max(1,end-begin);
  let level=edges[0]?.on||0;
  let initial=level;
  for(const edge of edges){
    if(edge.time<begin){level=edge.on;initial=level;continue;}
    if(edge.time>end)break;
    const column=Math.min(count-1,Math.floor((edge.time-begin)/extent*count));
    levels[column]|=(1<<level)|(1<<edge.on);last[column]=edge.on+1;level=edge.on;
  }
  level=initial;
  for(let i=0;i<count;i++){if(!levels[i])levels[i]=1<<level;if(last[i])level=last[i]-1;}
  return levels;
}

const LiveIR = {Capture, decodeDurations, timeAxis, validateHistory, visibleEdges, signalKind,overviewLevels};
if (typeof module !== "undefined") module.exports = LiveIR;

if (typeof window !== "undefined") window.LiveIR = LiveIR;
})();
