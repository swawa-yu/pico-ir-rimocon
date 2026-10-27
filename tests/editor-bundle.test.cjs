const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {JSDOM}=require('jsdom');

test('the page loads the current editor bundle and its public highlight API works',async()=>{
  const bundle=fs.readFileSync('docs/vendor/codemirror/editor.js','utf8');
  const dom=new JSDOM(fs.readFileSync('docs/studio.html','utf8'),{runScripts:'outside-only',pretendToBeVisual:true});
  try{
    const {window}=dom;
    for(const asset of window.document.querySelectorAll('script[src],link[rel="stylesheet"]')){
      const reference=asset.getAttribute(asset.tagName==='SCRIPT'?'src':'href'),[path,query]=reference.split('?');
      const version=createHash('sha256').update(fs.readFileSync('docs/'+path)).digest('hex').slice(0,12);
      assert.equal(query,'v='+version,'stale asset reference: '+path);
    }
    window.eval(bundle);
    const parent=window.document.createElement('div');window.document.body.append(parent);
    const editor=window.PicoEditor.create(parent,{onChange(){},onDefinition(){},onSave(){}});
    editor.setFile('main.py','first = 1\nsecond = 2\n');
    const scroller=parent.querySelector('.cm-scroller');scroller.scrollTop=70;
    editor.setFile('main.py','first = 1\nsecond = 2\n');assert.equal(scroller.scrollTop,70);
    editor.highlightLines({from:2,to:2});assert.equal(scroller.scrollTop,70);
    assert.equal(parent.querySelector('.cm-block-source').textContent,'second = 2');
    editor.setErrors([{from:0,to:5,message:'定義を確認'}]);await Promise.resolve();
    assert.equal(parent.querySelector('.cm-source-error').getAttribute('title'),'定義を確認');
    editor.setReadOnly(true);
    assert.equal(parent.querySelector('.cm-content').getAttribute('contenteditable'),'false');
    editor.setFile('other.py','pass\n');editor.setReadOnly(true);
    assert.equal(parent.querySelector('.cm-content').getAttribute('contenteditable'),'false');
    editor.setReadOnly(false);
    assert.equal(parent.querySelector('.cm-content').getAttribute('contenteditable'),'true');
    editor.setFile('main.py','first = 1\nsecond = 2\n');assert.equal(scroller.scrollTop,70);
    editor.highlightLines(null);
    assert.equal(parent.querySelector('.cm-block-source'),null);
  }finally{dom.window.close();}
});

test('F12 passes the precise cursor position to the definition handler',()=>{
 const dom=new JSDOM('<div id="editor"></div>',{runScripts:'outside-only',pretendToBeVisual:true});
 try{
  const w=dom.window;w.eval(fs.readFileSync('docs/vendor/codemirror/editor.js','utf8'));
  const positions=[];
  const editor=w.PicoEditor.create(w.document.getElementById('editor'),{onChange(){},onSave(){},onDefinition(position){positions.push(position);}});
  const source='from parts import infrared\ninfrared.send(65)\n',position=source.lastIndexOf('send')+2;
  editor.setFile('main.py',source);editor.goTo(position);
  assert.equal(editor.cursor(),position);
  w.document.querySelector('.cm-content').dispatchEvent(new w.KeyboardEvent('keydown',{key:'F12',bubbles:true,cancelable:true}));
  assert.deepEqual(positions,[position]);
 }finally{dom.window.close();}
});
