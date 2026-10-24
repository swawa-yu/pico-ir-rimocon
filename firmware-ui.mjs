import { firmwareModels, loadFirmware, requestBootDevice, flashFirmware } from './firmware.mjs?v=auto-uf2';

const model = document.querySelector('#firmware-model');
const retry = document.querySelector('#firmware-retry');
const write = document.querySelector('#firmware-write');
const status = document.querySelector('#firmware-status');
const progress = document.querySelector('#firmware-progress');
const supported = !!navigator.usb && window.isSecureContext;
let image = null;
let busy = false;
let generation = 0;
let loading = null;

function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}
async function selectModel() {
  const current = ++generation;
  loading?.abort();
  loading = new AbortController();
  image = null;
  write.disabled = true;
  progress.hidden = true;
  retry.hidden = true;
  if (!supported) {
    message('直接書き込むにはPC版Chrome／Edgeで開いてください。UF2をRPI-RP2へコピーする方法も使えます。');
    return;
  }
  message(`${firmwareModels[model.value].name}用の公式ファームウェアを準備中…`);
  try {
    const prepared = await loadFirmware(model.value, { signal: loading.signal });
    if (current !== generation) return;
    image = prepared;
    write.disabled = false;
    message(`${firmwareModels[model.value].name}用 MicroPython v1.29.0 · 準備完了`);
  } catch (error) {
    if (current !== generation) return;
    retry.hidden = false;
    message(`準備できませんでした。${error.message}`, true);
  }
}
model.addEventListener('change', selectModel);
retry.addEventListener('click', selectModel);
write.addEventListener('click', async () => {
  if (!image || busy || !supported) return;
  busy = true;
  model.disabled = write.disabled = true;
  progress.hidden = false;
  progress.value = 0;
  let started = false;
  try {
    message('BOOTSELで接続したPicoを選んでください。');
    const device = await requestBootDevice();
    started = true;
    const result = await flashFirmware(device, image, (phase, value) => {
      progress.value = value;
      message(`${phase} ${Math.round(value * 100)}%`);
    });
    message(result.rebooted ? '書き込み・内容の確認が完了しました。StudioでUSB接続してください。' : '書き込み・内容の確認は完了しました。USBを抜き差ししてから、Studioで接続してください。');
  } catch (error) {
    if (!started && error.name === 'NotFoundError') message('USBの選択をキャンセルしました。');
    else message(`書き込めませんでした。${error.message} BOOTSELでつなぎ直して再試行するか、UF2をRPI-RP2へコピーしてください。`, true);
  } finally {
    busy = false;
    model.disabled = false;
    write.disabled = !image || !supported;
  }
});
window.addEventListener('beforeunload', event => {
  if (busy) { event.preventDefault(); event.returnValue = ''; }
});
selectModel();
