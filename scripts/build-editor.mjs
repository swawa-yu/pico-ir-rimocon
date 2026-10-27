import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

await mkdir('dist/vendor/codemirror',{recursive:true});
const result=await build({entryPoints:['src/editor/code-editor.js'],bundle:true,format:'iife',globalName:'PicoEditor',outfile:'dist/vendor/codemirror/editor.js',minify:true,metafile:true,legalComments:'inline'});
const roots=new Set();
for(const input of Object.keys(result.metafile.inputs)){
  if(!input.startsWith('node_modules/'))continue;
  const start=input.lastIndexOf('/node_modules/')+1;
  const segments=input.slice(start).split('/');
  roots.add(input.slice(0,start)+segments.slice(0,segments[1].startsWith('@')?3:2).join('/'));
}
let licenses='';
for(const root of [...roots].sort()){
  const info=JSON.parse(await readFile(root+'/package.json','utf8'));
  licenses+=`${info.name} ${info.version}\n${await readFile(root+'/LICENSE','utf8')}\n\n`;
}
await writeFile('dist/vendor/codemirror/LICENSES.txt',licenses);
