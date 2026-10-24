const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sources=require('../pico-sources.js');
test('bundled Python and analyzer markup match the editable source files',()=>{
  assert.equal(sources.parts,fs.readFileSync(require.resolve('../programs/pico_parts.py'),'utf8'));
  assert.equal(sources.ssd1306,fs.readFileSync(require.resolve('../programs/ssd1306.py'),'utf8'));
  assert.equal(sources.receiver,fs.readFileSync(require.resolve('../programs/live_receiver.py'),'utf8'));
  assert.equal(sources.irData,fs.readFileSync(require.resolve('../programs/ir_data.py'),'utf8'));
  const page=fs.readFileSync(require.resolve('../live-analyzer.html'),'utf8');
  assert.equal(sources.analyzer,page.split('<main>')[1].split('</main>')[0].replace(/\s*<h1>.*?<\/h1>/,''));
});
