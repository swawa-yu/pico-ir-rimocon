import {mkdir,readFile,writeFile} from 'node:fs/promises';

const parts=await readFile('pico/lib/pico_parts.py','utf8');
const ssd1306=await readFile('pico/lib/ssd1306.py','utf8');
const receiver=await readFile('pico/lib/live_receiver.py','utf8');
const irData=await readFile('pico/lib/ir_data.py','utf8');
const html=await readFile('src/templates/live-analyzer.html','utf8');
const analyzer=html.split('<main>')[1].split('</main>')[0].replace(/\s*<h1>.*?<\/h1>/,'');
await mkdir('dist',{recursive:true});
await writeFile('dist/pico-sources.js',`(() => {\nconst sources=${JSON.stringify({parts,receiver,analyzer,ssd1306,irData})};\nif(typeof module!=='undefined')module.exports=sources;\nif(typeof window!=='undefined')window.PicoSources=sources;\n})();\n`);
