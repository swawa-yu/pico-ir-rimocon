"use strict";

function parseSignal(text) {
  const arrays = text.match(/\[[^\[\]]*\]/g);
  if (!arrays || arrays.length !== 1) throw new Error("時間配列を1つ貼り付けてください。");
  const body = arrays[0].slice(1, -1).trim().replace(/,\s*$/, "");
  const tokens = body.split(",").map(s => s.trim());
  if (tokens.length > 4096) throw new Error("区間は4096個までにしてください。");
  if (!tokens.every(s => /^[+-]?\d+$/.test(s))) throw new Error("時間は整数をカンマで区切ってください。");
  const values = tokens.map(Number);
  if (!values.every(n => Number.isSafeInteger(n) && n !== 0)) throw new Error("時間は0以外の安全な整数にしてください。");
  if (values.some(n => n < 0) && !values.every((n, i) => i % 2 ? n < 0 : n > 0)) {
    throw new Error("符号付き配列は +ON, -OFF の順に交互にしてください。");
  }
  const signal = values.map(Math.abs);
  if (!Number.isSafeInteger(signal.reduce((a, b) => a + b, 0))) throw new Error("時間の合計が大きすぎます。");
  return signal;
}

function splitFrames(signal, gap) {
  const frames = [];
  let current = [];
  signal.forEach((duration, i) => {
    if (i % 2 === 1 && duration >= gap) {
      if (current.length) frames.push(current);
      current = [];
    } else current.push(duration);
  });
  if (current.length) frames.push(current);
  return frames;
}

function decode(signal, start, order) {
  if (!Number.isInteger(start) || start < 0 || start % 2 || start >= signal.length) {
    throw new Error("データ開始位置はフレーム内の偶数にしてください。");
  }
  const bits = [];
  for (let i = start; i + 1 < signal.length; i += 2) {
    const ratio = signal[i + 1] / signal[i];
    bits.push(Number.isFinite(ratio) && ratio > 0 ? (ratio < 2 ? "0" : "1") : "?");
  }
  const bytes = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let byte = bits.slice(i, i + 8).join("");
    if (order === "lsb") byte = [...byte].reverse().join("");
    bytes.push(byte.includes("?") ? null : parseInt(byte, 2));
  }
  return { bits: bits.join(""), bytes, remainder: bits.length % 8 };
}

function sampleSignal() {
  const signal = [4480, 2240];
  for (const bit of "01000001") signal.push(560, bit === "1" ? 1680 : 560);
  return [...signal, 560];
}

function timeAxis(total, width) {
  const target = total / Math.max(1, Math.floor(width / 100));
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = Math.max(1, [1, 2, 5, 10].find(n => n * magnitude >= target) * magnitude);
  return { step, max: Math.ceil(total / step) * step };
}

if (typeof module !== "undefined") module.exports = { parseSignal, splitFrames, decode, sampleSignal, timeAxis };

if (typeof document !== "undefined") {
  const $ = id => document.getElementById(id);
  let frames = [], ranges = [];
  const canvas = $("wave"), ctx = canvas.getContext("2d");
  function integer(id) {
    const value = Number($(id).value);
    if (!$(id).value.trim() || !Number.isSafeInteger(value) || value < 1) throw new Error("区切り時間は正の整数にしてください。");
    return value;
  }
  function clearDecode() {
    for (const id of ["bits", "hex", "ascii"]) $(id).textContent = "—";
    $("decode-note").textContent = "";
  }
  function renderDecode() {
    clearDecode();
    if (!frames.length) return;
    try {
      if (!$("start").value.trim()) throw new Error("データ開始位置を入力してください。");
      const result = decode(frames[Number($("frame").value)], Number($("start").value), $("order").value);
      $("bits").replaceChildren();
      for (const bit of result.bits) {
        const span = document.createElement("span");
        span.className = bit === "0" ? "bit-zero" : bit === "1" ? "bit-one" : "bit-unknown";
        span.textContent = bit;
        $("bits").append(span);
      }
      if (!result.bits) $("bits").textContent = "—";
      $("hex").textContent = result.bytes.map(b => b === null ? "??" : b.toString(16).padStart(2, "0").toUpperCase()).join(" ") || "—";
      $("ascii").textContent = result.bytes.map(b => b !== null && b >= 32 && b <= 126 ? String.fromCharCode(b) : "·").join("") || "—";
      $("decode-note").textContent = result.remainder ? `末尾 ${result.remainder}ビットはバイト未満` : "";
      $("status").textContent = "";
    } catch (e) { $("status").textContent = e.message; }
  }
  function draw() {
    const signal = frames[Number($("frame").value)];
    if (!signal) return;
    const width = Math.min(16000, Math.max(280, $("wave-wrap").clientWidth) * Number($("zoom").value));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = 210 * dpr;
    canvas.style.width = `${width}px`; canvas.style.height = "210px";
    ctx.scale(dpr, dpr);
    const left = 50, right = width - 28, total = signal.reduce((a,b) => a+b, 0);
    const axis = timeAxis(total, right - left);
    const x = t => left + t / axis.max * (right - left);
    ctx.font = '12px sans-serif';
    let bits = "", start = Number($("start").value);
    try {
      if ($("start").value.trim()) bits = decode(signal, start, $("order").value).bits;
    } catch (_) { /* Invalid settings leave the waveform available for inspection. */ }
    let offset = signal.slice(0, start).reduce((a,b) => a+b, 0);
    for (let i = 0; i < bits.length; i++) {
      const duration = signal[start + 2*i] + signal[start + 2*i + 1];
      const a = x(offset), b = x(offset + duration), bit = bits[i];
      ctx.fillStyle = bit === "0" ? "#dcebf9" : bit === "1" ? "#fce6d1" : "#edf0f2";
      ctx.fillRect(a, 38, b-a, 112);
      ctx.strokeStyle="#8799a677";ctx.lineWidth=.75;ctx.beginPath();ctx.moveTo(a,38);ctx.lineTo(a,150);ctx.moveTo(b,38);ctx.lineTo(b,150);ctx.stroke();
      if (b-a > 14) {
        ctx.fillStyle = bit === "0" ? "#185b91" : bit === "1" ? "#914809" : "#586874";
        ctx.textAlign = "center"; ctx.fillText(bit, (a+b)/2, 26);
      }
      offset += duration;
    }
    for (let i = 0; i <= Math.round(axis.max / axis.step); i++) {
      const t = i * axis.step, px = x(t);
      ctx.strokeStyle = "#e1e8ed"; ctx.beginPath(); ctx.moveTo(px,38); ctx.lineTo(px,150); ctx.stroke();
      ctx.fillStyle = "#667d89"; ctx.textAlign = i === 0 ? "left" : "center";
      ctx.fillText(t.toLocaleString("en-US", {maximumFractionDigits: 0}),px,178);
    }
    ctx.textAlign = "right"; ctx.fillText("µs",right,202);
    ctx.textAlign = "left"; ctx.fillStyle = "#445e6c";
    const physical = $("polarity").value === "receiver";
    ctx.fillText(physical ? "HIGH" : "ON", 0, 66); ctx.fillText(physical ? "LOW" : "OFF", 0, 136);
    let time = 0, previousY;
    ranges = [];
    signal.forEach((duration, i) => {
      const a = x(time), b = x(time + duration), on = i % 2 === 0;
      const y = (physical ? !on : on) ? 62 : 132;
      ctx.strokeStyle = "#334b5c"; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(a, previousY === undefined ? y : previousY); ctx.lineTo(a,y); ctx.lineTo(b,y); ctx.stroke();
      const label = String(duration);
      ctx.save();
      ctx.font = "9px sans-serif";
      ctx.fillStyle = "#334b5c";
      ctx.textAlign = "center";
      ctx.fillText(label, (a + b) / 2, y + (on ? -12 : 22));
      ctx.restore();
      ranges.push({a,b,i,duration,time,on}); time += duration; previousY = y;
    });
  }

  function renderFrame() {
    const signal = frames[Number($("frame").value)];
    if (!signal) return;
    $("summary").textContent = `${(signal.reduce((a,b)=>a+b,0)/1000).toFixed(3)} ms · ${signal.length}区間`;
    $("selection").textContent = "";
    $("intervals").replaceChildren();
    let time = 0;
    const fragment = document.createDocumentFragment();
    signal.forEach((duration,i) => {
      const row = document.createElement("tr");
      for (const text of [i, i%2 ? "OFF" : "ON", time, duration]) {
        const cell = document.createElement("td"); cell.textContent = text; row.append(cell);
      }
      fragment.append(row); time += duration;
    });
    $("intervals").append(fragment); renderDecode(); draw();
  }
  function analyze() {
    try {
      frames = splitFrames(parseSignal($("signal").value), integer("gap"));
      $("frame").replaceChildren(...frames.map((s,i) => new Option(`${i+1} / ${frames.length}`, i)));
      $("frame").disabled = false; $("status").textContent = ""; renderFrame();
    } catch(e) {
      frames = []; ranges = []; ctx.clearRect(0,0,canvas.width,canvas.height); clearDecode();
      $("intervals").replaceChildren(); $("frame").replaceChildren(new Option("—")); $("frame").disabled = true;
      $("summary").textContent = "入力を確認してください。"; $("selection").textContent = ""; $("status").textContent = e.message;
    }
  }
  $("analyze").addEventListener("click", analyze);
  $("sample").addEventListener("click", () => { $("signal").value = JSON.stringify(sampleSignal()); $("gap").value=20000; $("start").value=2; $("order").value="msb"; analyze(); });
  $("frame").addEventListener("change",renderFrame);
  $("gap").addEventListener("change",analyze);
  for (const id of ["start","order"]) $(id).addEventListener("change",() => { renderDecode(); draw(); });
  for (const id of ["zoom","polarity"]) $(id).addEventListener("input",draw);
  window.addEventListener("resize",draw);
  canvas.addEventListener("click",event => {
    const x = event.clientX - canvas.getBoundingClientRect().left;
    const r = ranges.find(r => x >= r.a && x < r.b);
    if (r) $("selection").textContent = `#${r.i} · ${r.on ? "ON" : "OFF"} · ${r.duration.toLocaleString()} µs · 開始 ${r.time.toLocaleString()} µs`;
  });
}
