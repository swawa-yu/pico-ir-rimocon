import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const result=await build({entryPoints:['code-editor.js'],bundle:true,format:'iife',globalName:'PicoEditor',outfile:'vendor/codemirror/editor.js',minify:true,metafile:true,legalComments:'inline'});
const packages=new Set(Object.keys(result.metafile.inputs).filter(p=>p.startsWith('node_modules/')).map(p=>p.split('/').slice(1,p.split('/')[1].startsWith('@')?3:2).join('/')));
let licenses='';
for(const name of [...packages].sort()){
  const root='node_modules/'+name,info=JSON.parse(await readFile(root+'/package.json','utf8'));
  const license=await readFile(root+'/LICENSE','utf8');
  licenses+=`${name} ${info.version}\n${license}\n\n`;
}
await writeFile('vendor/codemirror/LICENSES.txt',licenses);
let html=await readFile('index.html','utf8');
for(const match of [...html.matchAll(/(<(?:script|link)\b[^>]*?\b(?:src|href)=")([^"?]+)(?:\?[^"\s]*)?("[^>]*>)/g)]){
  const version=createHash('sha256').update(await readFile(match[2])).digest('hex').slice(0,12);
  html=html.replace(match[0],`${match[1]}${match[2]}?v=${version}${match[3]}`);
}
await writeFile('index.html',html);
