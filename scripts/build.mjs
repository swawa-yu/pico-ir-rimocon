import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

await rm('docs',{recursive:true,force:true});
await cp('public','docs',{recursive:true});
await mkdir('docs/programs',{recursive:true});
for(const group of ['lib','examples'])await cp(`pico/${group}`,'docs/programs',{recursive:true});
const copied=new Set();
for(const group of ['pages','styles','studio','analyzer','conversion','device','firmware','templates']){
  for(const name of await readdir(`src/${group}`)){
    if(copied.has(name))throw Error(`Duplicate public filename: ${name}`);
    copied.add(name);
    let source=await readFile(`src/${group}/${name}`,'utf8');
    if(group==='firmware')source=source.replace('../../public/vendor/','./vendor/');
    await writeFile(`docs/${name}`,source);
  }
}
await import('./build-sources.mjs');
await import('./build-editor.mjs');
for(const name of [...copied].filter(name=>name.endsWith('.html'))){
  let html=await readFile(`docs/${name}`,'utf8');
  for(const match of [...html.matchAll(/(<(?:script|link)\b[^>]*?\b(?:src|href)=")([^"?]+)(?:\?[^"\s]*)?("[^>]*>)/g)]){
    if(/^(?:https?:|\/\/)/.test(match[2]))continue;
    const hash=createHash('sha256').update(await readFile(`docs/${match[2]}`)).digest('hex').slice(0,12);
    html=html.replace(match[0],`${match[1]}${match[2]}?v=${hash}${match[3]}`);
  }
  await writeFile(`docs/${name}`,html);
}
console.log('Built site in docs/');
