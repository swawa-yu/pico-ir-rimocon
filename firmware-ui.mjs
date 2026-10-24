import { firmwareModels, downloadUrl, prepareFirmware, requestBootDevice, flashFirmware } from './firmware.mjs';

const model = document.querySelector('#firmware-model');
const download = document.querySelector('#firmware-download');
const file = document.querySelector('#firmware-file');
const write = document.querySelector('#firmware-write');
const status = document.querySelector('#firmware-status');
const progress = document.querySelector('#firmware-progress');
const supported = !!navigator.usb && window.isSecureContext;
let image = null;
let busy = false;
let generation = 0;

function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}
function selectModel() {
  generation++;
  image = null;
  file.value = '';
  download.href = downloadUrl(model.value);
  download.textContent = `${firmwareModels[model.value].name}用UF2をダウンロード`;
  write.disabled = true;
  progress.hidden = true;
  message(supported ? 'UF2ファイルを選んでください。' : '直接書き込むにはPC版Chrome／Edgeで開いてください。UF2をRPI-RP2へコピーする方法も使えます。');
}
model.addEventListener('change', selectModel);
file.addEventListener('change', async () => {
  const current = ++generation;
  image = null;
  write.disabled = true;
  const selected = file.files[0];
  if (!selected) return;
  message('UF2を確認中…');
  try {
    if (selected.size > 4 * 1024 * 1024) throw new Error('Pico／Pico W用のUF2を選んでください。');
    const prepared = await prepareFirmware(new Uint8Array(await selected.arrayBuffer()), model.value);
    if (current !== generation) return;
    image = prepared;
    write.disabled = !supported;
    message(supported ? 'UF2を確認しました。BOOTSELでつないだPicoに書き込めます。' : 'UF2を確認しました。RPI-RP2へコピーしてください。');
  } catch (error) {
    if (current === generation) message(error.message, true);
  }
});
write.addEventListener('click', async () => {
  if (!image || busy || !supported) return;
  busy = true;
  model.disabled = file.disabled = write.disabled = true;
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
    model.disabled = file.disabled = false;
    write.disabled = !image || !supported;
  }
});
window.addEventListener('beforeunload', event => {
  if (busy) { event.preventDefault(); event.returnValue = ''; }
});
selectModel();
