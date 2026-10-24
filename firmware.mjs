import { Picoboot } from './vendor/picoflash/picoboot.js';

export const firmwareModels = {
  pico: {
    name: 'Pico / Pico H',
    file: 'RPI_PICO-20260824-v1.29.0.uf2',
    sha256: 'e1160e602e277d85920adb5fe741435edccba9ba6ecadc85fdab75252eeff4e9',
  },
  picoW: {
    name: 'Pico W / Pico WH',
    file: 'RPI_PICO_W-20260824-v1.29.0.uf2',
    sha256: 'f918c0a082c6daf53e27998b7f990ba5f065db2e298b21a34024532a20786794',
  },
};
export function downloadUrl(model) {
  return `https://micropython.org/resources/firmware/${firmwareModels[model].file}`;
}

const flashStart = 0x10000000;
const flashEnd = flashStart + 2 * 1024 * 1024; // Pico and Pico W both have 2 MiB of flash.
const pageSize = 256;
const sectorSize = 4096;
const chunkSize = 65536; // PICOBOOT library FLASH_CHUNK_SIZE.

export function parseUf2(bytes) {
  if (!bytes.length || bytes.length % 512 || bytes.length > 2 * (flashEnd - flashStart)) {
    throw new Error('UF2ファイルのサイズが正しくありません。');
  }
  const count = bytes.length / 512;
  const pages = new Map();
  const numbers = new Set();
  for (let offset = 0; offset < bytes.length; offset += 512) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 512);
    const word = index => view.getUint32(index, true);
    if (word(0) !== 0x0a324655 || word(4) !== 0x9e5d5157 || word(508) !== 0x0ab16f30 ||
        word(8) !== 0x2000 || word(28) !== 0xe48bff56 || word(16) !== pageSize ||
        word(24) !== count || word(20) >= count || numbers.has(word(20))) {
      throw new Error('Pico／Pico W用のUF2として読み取れません。');
    }
    const address = word(12);
    if (address < flashStart || address + pageSize > flashEnd || address % pageSize || pages.has(address)) {
      throw new Error('UF2の書き込み先が正しくありません。');
    }
    numbers.add(word(20));
    pages.set(address, bytes.slice(offset + 32, offset + 32 + pageSize));
  }
  // Only contiguous official firmware is accepted, so holes must never erase user files.
  if (Math.min(...pages.keys()) !== flashStart || Math.max(...pages.keys()) + pageSize !== flashStart + count * pageSize) {
    throw new Error('UF2のページが連続していません。');
  }
  const data = new Uint8Array(count * pageSize);
  for (const [address, payload] of pages) data.set(payload, address - flashStart);
  return { address: flashStart, data };
}

export async function prepareFirmware(bytes, model) {
  if (!firmwareModels[model]) throw new Error('基板を選んでください。');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== firmwareModels[model].sha256) {
    const other = Object.values(firmwareModels).find(item => item.sha256 === hash);
    throw new Error(other ? `${other.name}用のUF2です。基板の選択を確認してください。` : '上のリンクからMicroPython v1.29.0のUF2をダウンロードして選んでください。');
  }
  return parseUf2(bytes);
}

export function requestBootDevice() {
  return navigator.usb.requestDevice({ filters: [{ vendorId: 0x2e8a, productId: 0x0003 }] });
}

export async function flashFirmware(device, image, onProgress = () => {}, createBoot = Picoboot.fromDevice) {
  if (device.vendorId !== 0x2e8a || device.productId !== 0x0003) throw new Error('BOOTSELで接続したPico／Pico Wを選んでください。');
  const { address, data } = image;
  if (address !== flashStart || !data.length || data.length % pageSize || data.length > flashEnd - flashStart) throw new Error('書き込みデータが正しくありません。');
  const boot = createBoot(device);
  let connection;
  let verified = false;
  try {
    connection = await boot.connect();
    await connection.resetInterface();
    await connection.setExclusiveAccess(2);
    await connection.exitXip();
    onProgress('消去中', 0);
    await connection.flashErase(address, Math.ceil(data.length / sectorSize) * sectorSize);
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const chunk = data.subarray(offset, offset + chunkSize);
      await connection.flashWrite(address + offset, chunk);
      onProgress('書き込み中', (offset + chunk.length) / data.length / 2);
    }
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const expected = data.subarray(offset, offset + chunkSize);
      const actual = await connection.flashRead(address + offset, expected.length);
      if (actual.length !== expected.length || !expected.every((value, index) => value === actual[index])) throw new Error('書き込んだ内容が一致しません。BOOTSELでつなぎ直して、もう一度書き込んでください。');
      onProgress('確認中', 0.5 + (offset + expected.length) / data.length / 2);
    }
    verified = true;
    try {
      await connection.reboot(100);
    } catch {
      return { rebooted: false };
    }
    return { rebooted: true };
  } finally {
    if (connection && !verified && device.opened) {
      try { await connection.resetInterface(); await connection.setExclusiveAccess(0); } catch {}
    }
    await boot.disconnect();
    // connect() can fail after opening the device but before constructing a connection.
    if (device.opened) { try { await device.close(); } catch {} }
  }
}
