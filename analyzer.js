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
    bits.push(ratio >= .5 && ratio <= 1.5 ? "0" : ratio >= 2.5 && ratio <= 3.5 ? "1" : "?");
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

if (typeof module !== "undefined") module.exports = { parseSignal, splitFrames, decode, sampleSignal };

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
      $("bits").textContent = result.bits || "（完全なON/OFFペアがありません）";
      $("hex").textContent = result.bytes.map(b => b === null ? "??" : b.toString(16).padStart(2, "0").toUpperCase()).join(" ") || "—";
      $("ascii").textContent = result.bytes.map(b => b !== null && b >= 32 && b <= 126 ? String.fromCharCode(b) : "·").join("") || "—";
      $("decode-note").textContent = `${result.bits.length}ビット / ${result.bytes.length}バイト / 末尾の未変換 ${result.remainder}ビット。?を含むバイトは??、表示できない文字は·です。`;
      $("status").textContent = "";
    } catch (e) { $("status").textContent = e.message; }
  }
  function draw() {
    const signal = frames[Number($("frame").value)];
    if (!signal) return;
    const width = Math.min(16000, Math.max(600, $("wave-wrap").clientWidth - 2) * Number($("zoom").value));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = 210 * dpr;
    canvas.style.width = `${width}px`; canvas.style.height = "210px";
    ctx.scale(dpr, dpr);
    const left = 64, right = width - 24, total = signal.reduce((a,b) => a+b, 0);
    const x = t => left + t / total * (right - left);
    ctx.font = '12px sans-serif'; ctx.fillStyle = "#445e6c";
    const physical = $("polarity").value === "receiver";
    ctx.fillText(physical ? "HIGH" : "ON", 10, 66); ctx.fillText(physical ? "LOW" : "OFF", 10, 136);
    for (let i = 0; i <= 5; i++) {
      const t = total * i / 5, px = x(t);
      ctx.strokeStyle = "#dce5eb"; ctx.beginPath(); ctx.moveTo(px, 38); ctx.lineTo(px, 150); ctx.stroke();
      ctx.fillStyle = "#445e6c"; ctx.textAlign = i === 5 ? "right" : "left";
      ctx.fillText(`${Math.round(t).toLocaleString()} µs`, px, 182);
    }
    ctx.textAlign = "left";
    let time = 0, previousY;
    ranges = [];
    signal.forEach((duration, i) => {
      const a = x(time), b = x(time + duration), on = i % 2 === 0;
      const y = (physical ? !on : on) ? 62 : 132;
      ctx.fillStyle = on ? "#dceff7" : "#f1f4f6"; ctx.fillRect(a, 38, Math.max(.5,b-a), 112);
      ctx.strokeStyle = "#075b81"; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(a, previousY === undefined ? y : previousY); ctx.lineTo(a,y); ctx.lineTo(b,y); ctx.stroke();
      if (b-a > 50) { ctx.fillStyle = "#172c3c"; ctx.fillText(`${duration}`, a+4, 26); }
      ranges.push({a,b,i,duration,time,on}); time += duration; previousY = y;
    });
  }
  function renderFrame() {
    const signal = frames[Number($("frame").value)];
    if (!signal) return;
    $("summary").textContent = `${signal.length}区間 / ${(signal.reduce((a,b)=>a+b,0)/1000).toFixed(3)} ms（区切りのOFF時間を除く）`;
    $("selection").textContent = "区間をクリックするか、下の数値表を確認してください。";
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
    $("intervals").append(fragment); draw(); renderDecode();
  }
  function analyze() {
    try {
      frames = splitFrames(parseSignal($("signal").value), integer("gap"));
      $("frame").replaceChildren(...frames.map((s,i) => new Option(`フレーム ${i+1}（${s.length}区間）`, i)));
      $("frame").disabled = false; $("status").textContent = ""; renderFrame();
    } catch(e) {
      frames = []; ranges = []; ctx.clearRect(0,0,canvas.width,canvas.height); clearDecode();
      $("intervals").replaceChildren(); $("frame").replaceChildren(new Option("解析後に選択できます")); $("frame").disabled = true;
      $("summary").textContent = "入力を確認してください。"; $("selection").textContent = ""; $("status").textContent = e.message;
    }
  }
  $("analyze").addEventListener("click", analyze);
  $("sample").addEventListener("click", () => { $("signal").value = JSON.stringify(sampleSignal()); $("gap").value=20000; $("start").value=2; $("order").value="msb"; analyze(); });
  $("frame").addEventListener("change",renderFrame);
  $("gap").addEventListener("change",analyze);
  for (const id of ["start","order"]) $(id).addEventListener("change",renderDecode);
  for (const id of ["zoom","polarity"]) $(id).addEventListener("input",draw);
  window.addEventListener("resize",draw);
  canvas.addEventListener("click",event => {
    const x = event.clientX - canvas.getBoundingClientRect().left;
    const r = ranges.find(r => x >= r.a && x < r.b);
    if (r) $("selection").textContent = `位置 ${r.i} / ${r.on ? "ON（受信出力LOW）" : "OFF（受信出力HIGH）"} / 開始 ${r.time} µs / 長さ ${r.duration} µs`;
  });
}
