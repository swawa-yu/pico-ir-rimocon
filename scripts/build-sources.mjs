import {readFile,writeFile} from 'node:fs/promises';
const parts=await readFile('programs/pico_parts.py','utf8');
const ssd1306=await readFile('programs/ssd1306.py','utf8');
const receiver=await readFile('programs/live_receiver.py','utf8');
const irData=await readFile('programs/ir_data.py','utf8');
const html=await readFile('live-analyzer.html','utf8');
const analyzer=html.split('<main>')[1].split('</main>')[0].replace(/\s*<h1>.*?<\/h1>/,'');
await writeFile('pico-sources.js',`(() => {\nconst sources=${JSON.stringify({parts,receiver,analyzer,ssd1306,irData})};\nif(typeof module!=='undefined')module.exports=sources;\nif(typeof window!=='undefined')window.PicoSources=sources;\n})();\n`);
