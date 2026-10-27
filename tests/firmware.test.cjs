const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const firmware = import('../docs/firmware.mjs');

function uf2(count = 2) {
  const bytes = new Uint8Array(count * 512);
  for (let index = 0; index < count; index++) {
    const view = new DataView(bytes.buffer, index * 512, 512);
    [0x0a324655, 0x9e5d5157, 0x2000, 0x10000000 + index * 256, 256, index, count, 0xe48bff56].forEach((word, i) => view.setUint32(i * 4, word, true));
    view.setUint32(508, 0x0ab16f30, true);
    bytes.fill(index + 1, index * 512 + 32, index * 512 + 288);
  }
  return bytes;
}

test('UF2 parser reconstructs pages by address and rejects corrupt, duplicate, sparse and non-RP2040 data', async () => {
  const { parseUf2 } = await firmware;
  const bytes = uf2();
  const swapped = new Uint8Array([...bytes.slice(512), ...bytes.slice(0, 512)]);
  assert.deepEqual(parseUf2(swapped), { address: 0x10000000, data: new Uint8Array([...new Uint8Array(256).fill(1), ...new Uint8Array(256).fill(2)]) });
  for (const [offset, value] of [[0, 0], [8, 0], [12, 0x20000000], [12, 0x10000001], [16, 255], [20, 2], [24, 3], [28, 0xe48bff59], [508, 0], [512 + 12, 0x10000000], [512 + 12, 0x10000300], [512 + 20, 0]]) {
    const broken = bytes.slice(); new DataView(broken.buffer).setUint32(offset, value, true);
    assert.throws(() => parseUf2(broken), Error);
  }
  assert.throws(() => parseUf2(bytes.slice(1)), Error);
  assert.throws(() => parseUf2(new Uint8Array()), Error);
});

test('firmware preparation rejects unapproved images before USB access', async () => {
  const { prepareFirmware } = await firmware;
  await assert.rejects(prepareFirmware(uf2(), 'pico'), /公式/);
  await assert.rejects(prepareFirmware(uf2(), 'other'), /基板/);
});

test('bundled official firmware matches each board hash and rejects the other board', async () => {
  const { firmwareModels, prepareFirmware } = await firmware;
  for (const model of ['pico', 'picoW']) {
    const bytes = new Uint8Array(fs.readFileSync(`docs/firmware/${firmwareModels[model].file}`));
    const image = await prepareFirmware(bytes, model);
    assert.equal(image.address, 0x10000000);
    assert.equal(image.data.length, bytes.length / 2);
    await assert.rejects(prepareFirmware(bytes, model === 'pico' ? 'picoW' : 'pico'), /基板の選択/);
  }
});

test('automatic loading fetches the selected same-origin image and rejects failed or corrupt downloads', async () => {
  const { loadFirmware, firmwareModels } = await firmware;
  const originalFetch = global.fetch;
  const signal = new AbortController().signal;
  try {
    global.fetch = async (url, options) => {
      assert.equal(url, `firmware/${firmwareModels.picoW.file}`);
      assert.equal(options.signal, signal);
      return { ok: true, arrayBuffer: async () => fs.readFileSync('docs/'+url) };
    };
    assert.equal((await loadFirmware('picoW', { signal })).data.length, 905728);
    global.fetch = async () => ({ ok: false });
    await assert.rejects(loadFirmware('pico'), /取得/);
    global.fetch = async () => ({ ok: true, arrayBuffer: async () => uf2() });
    await assert.rejects(loadFirmware('pico'), /一致/);
  } finally { global.fetch = originalFetch; }
});

function board({ corrupt = false, failWrite = false, failConnect = false, failReboot = false } = {}) {
  const trace = [];
  const memory = new Uint8Array(2 * 1024 * 1024).fill(0x79);
  const device = { vendorId: 0x2e8a, productId: 3, opened: true, async close() { trace.push('close'); this.opened = false; } };
  const connection = {
    async resetInterface() { trace.push('reset'); },
    async setExclusiveAccess(mode) { trace.push(`exclusive:${mode}`); },
    async exitXip() { trace.push('exitXip'); },
    async flashErase(address, size) { trace.push(['erase', address, size]); memory.fill(255, address - 0x10000000, address - 0x10000000 + size); },
    async flashWrite(address, bytes) { trace.push(['write', address, bytes.length]); if (failWrite) throw Error('unplugged'); memory.set(bytes, address - 0x10000000); },
    async flashRead(address, size) { trace.push(['read', address, size]); const bytes = memory.slice(address - 0x10000000, address - 0x10000000 + size); if (corrupt) bytes[0] ^= 1; return bytes; },
    async reboot() { trace.push('reboot'); if (failReboot) throw Error('disconnected'); },
  };
  const boot = { async connect() { trace.push('connect'); if (failConnect) throw Error('claim failed'); return connection; }, async disconnect() { trace.push('disconnect'); } };
  return { device, memory, trace, createBoot: () => boot };
}

test('flash erases only the image sectors, writes in chunks, verifies bytes and then reboots', async () => {
  const { flashFirmware } = await firmware;
  const b = board(); const data = new Uint8Array(65536 + 256).fill(0x42); const progress = [];
  assert.deepEqual(await flashFirmware(b.device, { address: 0x10000000, data }, (phase, value) => progress.push([phase, value]), b.createBoot), { rebooted: true });
  assert.deepEqual(b.trace.slice(0, 5), ['connect', 'reset', 'exclusive:2', 'exitXip', ['erase', 0x10000000, 69632]]);
  assert.deepEqual(b.memory.slice(0, data.length), data);
  assert(b.memory.slice(69632).every(value => value === 0x79));
  assert.deepEqual(b.trace.slice(-3), ['reboot', 'disconnect', 'close']);
  assert(b.trace.findIndex(item => item === 'reboot') > b.trace.findIndex(item => Array.isArray(item) && item[0] === 'read'));
  assert.equal(progress.at(-1)[1], 1);
});

test('write or verification failure releases USB and never reboots incomplete firmware', async () => {
  const { flashFirmware } = await firmware;
  for (const failure of [{ corrupt: true }, { failWrite: true }, { failConnect: true }]) {
    const b = board(failure);
    await assert.rejects(flashFirmware(b.device, { address: 0x10000000, data: new Uint8Array(256) }, undefined, b.createBoot));
    assert(!b.trace.includes('reboot'));
    assert.equal(b.trace.at(-1), 'close');
    if (!failure.failConnect) assert(b.trace.includes('exclusive:0'));
  }
});

test('a reboot error is reported separately after successful verification', async () => {
  const { flashFirmware } = await firmware;
  const b = board({ failReboot: true });
  assert.deepEqual(await flashFirmware(b.device, { address: 0x10000000, data: new Uint8Array(256) }, undefined, b.createBoot), { rebooted: false });
});

test('non-BOOTSEL devices and invalid memory ranges cannot reach erase', async () => {
  const { flashFirmware } = await firmware;
  const b = board();
  await assert.rejects(flashFirmware({ ...b.device, productId: 15 }, { address: 0x10000000, data: new Uint8Array(256) }, undefined, b.createBoot), /BOOTSEL/);
  for (const image of [{ address: 0x10001000, data: new Uint8Array(256) }, { address: 0x10000000, data: new Uint8Array(257) }, { address: 0x10000000, data: new Uint8Array(0x200100) }]) {
    await assert.rejects(flashFirmware(b.device, image, undefined, b.createBoot), /データ/);
  }
  assert.deepEqual(b.trace, []);
});

function ui(supported = true, load = async model => ({ board: model, data: new Uint8Array(256) })) {
  const dom = new JSDOM(fs.readFileSync('docs/docs.html', 'utf8'), { url: 'http://localhost/docs.html', runScripts: 'outside-only' });
  const w = dom.window; const trace = [];
  if (supported) Object.defineProperty(w.navigator, 'usb', { value: {} });
  w.isSecureContext = true;
  Object.assign(w, {
    AbortController,
    firmwareModels: { pico: { name: 'Pico' }, picoW: { name: 'Pico W' } },
    loadFirmware: async (model, options) => { trace.push(`load:${model}`); return load(model, options); },
    requestBootDevice: async () => { trace.push('choose'); return {}; },
    flashFirmware: async (device, image) => { trace.push(`flash:${image.board}`); return { rebooted: true }; },
  });
  vm.runInContext(fs.readFileSync('docs/firmware-ui.mjs', 'utf8').replace(/^import[^\n]+\n/, ''), dom.getInternalVMContext());
  return { w, dom, trace, get: id => w.document.getElementById(`firmware-${id}`) };
}

test('installer automatically prepares each board and opens USB only on a write click', async () => {
  const p = ui();
  try {
    assert(p.get('write').disabled);
    await new Promise(setImmediate);
    assert.equal(p.get('write').disabled, false);
    assert.deepEqual(p.trace, ['load:pico']);
    p.get('model').value = 'picoW'; p.get('model').dispatchEvent(new p.w.Event('change'));
    assert(p.get('write').disabled);
    await new Promise(setImmediate);
    p.get('write').click(); await new Promise(setImmediate);
    assert.deepEqual(p.trace, ['load:pico', 'load:picoW', 'choose', 'flash:picoW']);
    assert.match(p.get('status').textContent, /完了/);
    assert.equal(p.w.document.querySelector('input[type=file]'), null);
  } finally { p.dom.window.close(); }
});

test('late downloads for the previous board cannot enable or replace the selected firmware', async () => {
  const loads = [];
  const p = ui(true, (model, { signal }) => new Promise(resolve => loads.push({ model, signal, resolve })));
  try {
    p.get('model').value = 'picoW'; p.get('model').dispatchEvent(new p.w.Event('change'));
    assert(loads[0].signal.aborted);
    loads[0].resolve({ board: 'pico' }); await new Promise(setImmediate);
    assert(p.get('write').disabled);
    loads[1].resolve({ board: 'picoW' }); await new Promise(setImmediate);
    assert.equal(p.get('write').disabled, false);
    p.get('write').click(); await new Promise(setImmediate);
    assert.equal(p.trace.at(-1), 'flash:picoW');
  } finally { p.dom.window.close(); }
});

test('failed automatic preparation offers retry and cannot write until recovery', async () => {
  let fail = true;
  const p = ui(true, async model => { if (fail) throw Error('offline'); return { board: model }; });
  try {
    await new Promise(setImmediate);
    assert(p.get('write').disabled); assert.equal(p.get('retry').hidden, false);
    assert.match(p.get('status').textContent, /offline/);
    fail = false; p.get('retry').click(); await new Promise(setImmediate);
    assert.equal(p.get('write').disabled, false); assert(p.get('retry').hidden);
  } finally { p.dom.window.close(); }
});

test('unsupported browsers show the UF2 copy route without opening USB', () => {
  const p = ui(false);
  try { assert(p.get('write').disabled); assert.match(p.get('status').textContent, /RPI-RP2/); assert.deepEqual(p.trace, []); }
  finally { p.dom.window.close(); }
});
