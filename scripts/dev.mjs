import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {watch} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {spawn} from 'node:child_process';

const root=resolve('dist');
const port=Number(process.env.PORT||8043);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.gif':'image/gif','.mp3':'audio/mpeg','.txt':'text/plain; charset=utf-8'};
createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    let path=resolve(root,'.'+pathname);
    if(path!==root&&!path.startsWith(root+sep)){response.writeHead(403).end();return;}
    if((await stat(path)).isDirectory())path=resolve(path,'index.html');
    const body=await readFile(path);
    response.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});
    response.end(body);
  }catch{response.writeHead(404).end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Pico Studio: http://127.0.0.1:${port}/`));

let building=false,pending=false;
async function rebuild(){
  if(building){pending=true;return;}
  building=true;
  do{
    pending=false;
    const child=spawn(process.execPath,['scripts/build.mjs'],{stdio:'inherit'});
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    if(code!==0)console.error('Build failed; fix the source and save again.');
  }while(pending);
  building=false;
}
for(const folder of ['src','public','pico'])watch(folder,{recursive:true},()=>rebuild().catch(error=>{building=false;console.error(error);}));
