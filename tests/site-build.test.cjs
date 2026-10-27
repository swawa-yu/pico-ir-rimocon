const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');

test('built pages retain local links, scripts, styles and license destinations',()=>{
  for(const file of fs.readdirSync('docs').filter(name=>name.endsWith('.html'))){
    const page=new JSDOM(fs.readFileSync('docs/'+file,'utf8'),{url:'https://ir.swawa.dev/'+file});
    for(const element of page.window.document.querySelectorAll('a[href],link[href],script[src]')){
      const value=element.getAttribute(element.hasAttribute('src')?'src':'href');
      const url=new URL(value,page.window.location.href);
      if(url.origin!=='https://ir.swawa.dev')continue;
      const path='docs'+(url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname);
      assert(fs.existsSync(path),`${file}: ${value}`);
    }
    page.window.close();
  }
});

test('legacy root panel links keep the query and open the corresponding Studio tab',()=>{
  const page=new JSDOM(fs.readFileSync('docs/index.html','utf8'));
  const script=page.window.document.querySelector('script:not([src])').textContent;
  for(const hash of ['', '#program','#analyzer','#conversion']){
    let target=null;
    vm.runInNewContext(script,{location:{hash,search:'?preview=layout',replace(value){target=value;}}});
    assert.equal(target,hash?'studio.html?preview=layout'+hash:null);
  }
  page.window.close();
});

test('the publish artifact excludes development files and preserves downloadable projects and domain metadata',()=>{
  for(const path of ['src','tests','scripts','node_modules','.git','package.json','pnpm-lock.yaml'])assert(!fs.existsSync('docs/'+path),path);
  for(const path of ['index.html','studio.html','docs.html','analyzer.html','block-studio.html','live-analyzer.html','examples/ssd1306-gp2-power.json','programs/pico_parts.py','vendor/codemirror/LICENSES.txt','firmware/SOURCE.txt'])assert(fs.existsSync('docs/'+path),path);
  assert.equal(fs.readFileSync('docs/CNAME','utf8').trim(),'ir.swawa.dev');
});
