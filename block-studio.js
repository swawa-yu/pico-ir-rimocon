(() => {
  'use strict';
  const $=id=>document.getElementById(id), generator=python.pythonGenerator;
  let parts=PicoBlocks.defaults(),files={},runtime='',deploying=false,partsDirty=false;
  let browsing=false,picoSnapshot=null,picoSelected=null,picoContents=new Map();
  let activeRole='program';
  runtime=PicoSources.parts;
  const fileStore=new StudioFiles.Files();let activeFile='main.py';
  const sourceMap=new Map();
  let debugSession=null,debugStarting=false,debugStopping=false,debugLocked=[];
  let treeSelection='main.py',fileOperation=null;
  const consoleHistory=[];let consoleHistoryIndex=0,consoleDraft='';
  let fileWorkspace=null,fileWorkspacePath=null,fileWorkspaceDirty=false,fileRefreshTimer,fileModels={},editingPythonBlock=null;
  PicoBlocks.configure(Blockly,generator,()=>parts);
  const pythonBlocks=PicoEditor.blocks.configure(Blockly,generator,block=>{
    editingPythonBlock=block;$('python-block-code').value=block.pythonCode;
    $('python-block-dialog').showModal();$('python-block-code').focus();
  });
  const number=value=>({shadow:{type:'math_number',fields:{NUM:value}}});
  const toolbox={kind:'categoryToolbox',contents:[
    {kind:'category',name:'Python',colour:210,contents:['pico_import','pico_from_import','pico_import_as','pico_class','pico_def','pico_python'].map(type=>({kind:'block',type}))},
    {kind:'category',name:'制御',colour:45,contents:[
      {kind:'block',type:'pico_start'},{kind:'block',type:'pico_forever'},
      {kind:'block',type:'controls_if'},{kind:'block',type:'controls_repeat_ext',inputs:{TIMES:number(10)}},
      {kind:'block',type:'controls_whileUntil'},{kind:'block',type:'controls_for',inputs:{FROM:number(0),TO:number(63),BY:number(1)}},
      {kind:'block',type:'pico_wait',inputs:{SECONDS:number(.5)}}]},
    {kind:'category',name:'入力',colour:200,contents:[{kind:'block',type:'pico_bootsel'},{kind:'block',type:'pico_button',fields:{PART:'send_button'}},{kind:'block',type:'pico_dip_on',inputs:{NUMBER:number(1)}},{kind:'block',type:'pico_dip_value'}]},
    {kind:'category',name:'出力',colour:150,contents:[{kind:'block',type:'pico_pwm',inputs:{PERCENT:number(0)}},{kind:'block',type:'pico_led',fields:{PART:'status_led'}},{kind:'block',type:'pico_speaker_on',inputs:{HZ:number(880)}},{kind:'block',type:'pico_speaker_off'}]},
    {kind:'category',name:'画面',colour:150,contents:[
      {kind:'block',type:'pico_display_pixel',inputs:{X:number(0),Y:number(0),COLOR:number(1)}},
      {kind:'block',type:'pico_display_get_pixel',inputs:{X:number(0),Y:number(0)}},
      {kind:'block',type:'pico_display_fill',inputs:{COLOR:number(0)}},
      {kind:'block',type:'pico_display_text_at',inputs:{X:number(0),Y:number(0),TEXT:{shadow:{type:'text',fields:{TEXT:'Hello!'}}}}},
      {kind:'block',type:'pico_display_show'},
      {kind:'block',type:'pico_display_text',inputs:{LINE:number(1),TEXT:{shadow:{type:'text',fields:{TEXT:'Hello!'}}}}},
      {kind:'block',type:'pico_display_clear'}]},
    {kind:'category',name:'コンソール',colour:160,contents:[
      {kind:'block',type:'text_print',inputs:{TEXT:{shadow:{type:'text',fields:{TEXT:'こんにちは'}}}}},
      {kind:'block',type:'text_prompt_ext',fields:{TYPE:'TEXT'},inputs:{TEXT:{shadow:{type:'text',fields:{TEXT:'名前は？ '}}}}}]},
    {kind:'category',name:'赤外線',colour:285,contents:[{kind:'block',type:'pico_send',fields:{PART:'infrared'},inputs:{VALUE:number(65)}},{kind:'block',type:'pico_carrier',fields:{ON:'1'}},{kind:'block',type:'pico_carrier',fields:{ON:'0'}}]},
    {kind:'category',name:'計算・条件',colour:210,contents:[{kind:'block',type:'text'},{kind:'block',type:'math_number'},{kind:'block',type:'math_arithmetic'},{kind:'block',type:'logic_compare'},{kind:'block',type:'logic_boolean'},{kind:'block',type:'logic_operation'},{kind:'block',type:'logic_negate'}]},
    {kind:'category',name:'変数',colour:330,custom:'VARIABLE'},
    {kind:'category',name:'関数',colour:290,custom:'PROCEDURE'},
    {kind:'category',name:'リスト',colour:260,contents:[{kind:'block',type:'lists_create_with'},{kind:'block',type:'lists_getIndex'},{kind:'block',type:'lists_setIndex'},{kind:'block',type:'lists_length'},{kind:'block',type:'controls_forEach'}]}
  ]};
  const theme=Blockly.Theme.defineTheme('pico',{base:Blockly.Themes.Classic,fontStyle:{family:'system-ui, sans-serif',weight:'normal',size:12},componentStyles:{workspaceBackgroundColour:'#f7fafc',toolboxBackgroundColour:'#edf2f7',flyoutBackgroundColour:'#e4edf4'}});
  const workspace=Blockly.inject('blockly',{toolbox,theme,renderer:'zelos',media:'vendor/blockly/media/',sounds:false,trashcan:true,grid:{spacing:20,length:2,colour:'#dbe4ed',snap:true},zoom:{controls:true,wheel:true,startScale:.95,maxScale:2,minScale:.4}});
  workspace.registerToolboxCategoryCallback('VARIABLE',ws=>Blockly.Variables.flyoutCategory(ws).filter(item=>item.type!=='math_change'));
  let dirty=false,codeValid=false,connecting=false,deviceState='disconnected',selectedId=null,refreshTimer;

  const notify=text=>{$('studio-status').textContent=text||'';};
  const displaySurfaces=new Map(),displayValues={};let displayConfig='';
  function displaySurface(){
    const screen=parts.find(p=>p.id===$('display-device').value&&p.kind==='ssd1306');if(!screen)return null;
    let surface=displaySurfaces.get(screen.id);
    if(!surface||surface.width!==screen.width||surface.height!==screen.height){surface=new DisplayPreview.Surface(screen.width,screen.height,PicoFont8x8);displaySurfaces.set(screen.id,surface);}
    return surface;
  }
  function paintDisplay(){
    const screen=parts.find(p=>p.id===$('display-device').value&&p.kind==='ssd1306');if(!screen)return;
    const surface=displaySurface(),canvas=$('display-canvas');canvas.width=screen.width;canvas.height=screen.height;
    const context=canvas.getContext('2d');context.fillStyle='#080e13';context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle='#d5faff';
    surface.visible.forEach((value,i)=>{if(value)context.fillRect(i%screen.width,Math.floor(i/screen.width),1,1);});
    const count=surface.visible.reduce((a,b)=>a+b,0);
    canvas.setAttribute('aria-label',`${screen.name} ${screen.width}×${screen.height}：${count}ピクセル点灯`);
    $('display-status').textContent=surface.dirty?'未反映':'';
  }
  function renderDisplay(){
    const screens=parts.filter(p=>p.kind==='ssd1306');$('display-preview').hidden=!screens.length;
    const config=JSON.stringify(parts.filter(p=>['ssd1306','dip'].includes(p.kind)));
    if(config!==displayConfig){
      displayConfig=config;const current=$('display-device').value;$('display-device').replaceChildren();
      for(const p of screens){const option=document.createElement('option');option.value=p.id;option.textContent=`${p.name} · ${p.width}×${p.height}`;$('display-device').append(option);}
      if(screens.some(p=>p.id===current))$('display-device').value=current;
      $('display-inputs').replaceChildren();
      for(const p of parts.filter(p=>p.kind==='dip')){
        const label=document.createElement('label');label.textContent=p.name+'（0〜255）';
        const input=document.createElement('input');input.type='number';input.min=0;input.max=255;input.step=1;input.value=displayValues[p.id]??0;
        input.setAttribute('aria-label',p.name+' の模擬値');
        input.addEventListener('input',()=>{displayValues[p.id]=input.value===''?NaN:Number(input.value);});
        label.append(input);$('display-inputs').append(label);
      }
      paintDisplay();
    }
    $('display-apply').disabled=partsDirty||!codeValid;
  }
  $('display-device').addEventListener('change',()=>{paintDisplay();$('display-status').textContent='';});
  $('display-reset').addEventListener('click',()=>{displaySurface()?.apply({clear:true});paintDisplay();});
  $('display-show').addEventListener('click',()=>{displaySurface()?.show();paintDisplay();});
  $('display-apply').addEventListener('click',()=>{
    try{
      const id=$('display-device').value,surface=displaySurface();
      surface.apply(DisplayPreview.command(workspace,selectedId,parts,id,displayValues,surface));
      paintDisplay();
      if(Object.hasOwn(fileStore.edits,'main.py'))$('display-status').textContent+=' ブロックを表示しました。手書きのPythonは反映しません。';
    }catch(error){$('display-status').textContent=error.message;}
  });
  const device=PicoDevices.forRole('program',{
    onState(state){deviceState=state;updateDevice();},
    onSelect(){clearPicoFiles();},
    onOutput(text,error){
      if(device.task==='observer')return;
      if(debugSession){if(error)debugSession.failed=true;text=error?debugSession.output.flush()+text:debugSession.output.feed(text);if(!text)return;}
      const output=$('output');
      output.textContent=(output.textContent==='—'?'':output.textContent)+text;
      if(output.textContent.length>8192)output.textContent=output.textContent.slice(-8192);
      if(error&&deviceState!=='stopping'){
        notify('Picoでエラーが発生しました。実行出力を確認してください。');
      }
      output.scrollTop=output.scrollHeight;
    }
  });
  PicoDevices.bindSelect($('program-device'),()=>activeRole);
  PicoDevices.listeners.add(updateDevice);
  const editor=PicoEditor.create($('code-editor'),{
    onChange(path,text){clearTimeout(fileRefreshTimer);fileWorkspaceDirty=false;fileStore.edit(path,text);files=fileStore.all;dirty=true;renderFiles();renderFileBlocks();renderPicoFiles();saveProject();updateDevice();},
    onDefinition:goDefinition,
    onSave(){download(activeFile.split('/').pop(),files[activeFile]||'','text/x-python');}
  });
  function saveProject(){try{localStorage.setItem('pico-blocks-project-2',JSON.stringify(project()));}catch(_){} }
  function openFile(path,line){commitFileBlocks();activeFile=path;editor.setFile(path,files[path]||'');editor.setReadOnly?.(Boolean(debugSession||debugStarting));editor.highlightLines?.(null);renderFiles();renderFileBlocks();if(line)editor.goLine(line);}
  function updateFileActions(){
    $('file-rename').disabled=!treeSelection||fileStore.protected(treeSelection)||Boolean(debugSession||debugStarting);
    for(const summary of document.querySelectorAll('#file-tree summary'))summary.classList.toggle('selected',summary.parentElement.dataset.path===treeSelection);
  }
  function startFileOperation(kind){
    commitFileBlocks();fileOperation={kind,path:treeSelection};
    const folder=treeSelection&&!Object.hasOwn(files,treeSelection)?treeSelection:activeFile.includes('/')?activeFile.slice(0,activeFile.lastIndexOf('/')):'';
    $('file-dialog-title').textContent=kind==='rename'?'名前を変更':kind==='folder'?'フォルダを作成':'ファイルを作成';
    $('file-path-input').value=kind==='rename'?treeSelection:(folder?folder+'/':'')+(kind==='folder'?'new_folder':'new_file.py');
    $('file-dialog-apply').textContent=kind==='rename'?'変更':'作成';$('file-dialog-message').textContent='';
    $('file-dialog').showModal();$('file-path-input').focus();$('file-path-input').select();
  }
  $('file-create').addEventListener('click',()=>startFileOperation('file'));
  $('folder-create').addEventListener('click',()=>startFileOperation('folder'));
  $('file-rename').addEventListener('click',()=>startFileOperation('rename'));
  $('file-path-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();$('file-dialog-apply').click();}});
  $('file-dialog-apply').addEventListener('click',()=>{
    try{
      commitFileBlocks();const target=$('file-path-input').value.trim();let next;
      if(fileOperation.kind==='rename'){
        const mapping=fileStore.rename(fileOperation.path,target);
        const models={};for(const [path,model] of Object.entries(fileModels))models[mapping[path]||path]=model;fileModels=models;
        next=mapping[activeFile]||activeFile;treeSelection=target;
      }else{next=fileStore.create(target,fileOperation.kind==='folder');treeSelection=fileOperation.kind==='folder'?target:next;}
      fileWorkspacePath=null;fileWorkspaceDirty=false;files=fileStore.all;dirty=true;openFile(next);saveProject();renderPicoFiles();
      $('file-dialog').close();notify();
    }catch(error){$('file-dialog-message').textContent=error.message;}
  });
  function highlightBlock(){
    if(debugSession)return;
    const range=codeValid&&!Object.hasOwn(fileStore.edits,'main.py')?sourceMap.get(selectedId):null;
    if(activeFile!=='main.py')return;
    editor.highlightLines?.(range||null);
  }
  $('python-block-dialog').addEventListener('close',()=>{
    if($('python-block-dialog').returnValue==='apply'&&editingPythonBlock&&!editingPythonBlock.isDeadOrDying()){
      editingPythonBlock.setCode($('python-block-code').value);commitFileBlocks();
    }
    editingPythonBlock=null;
  });
  function ensureFileWorkspace(){
    if(fileWorkspace)return;
    fileWorkspace=Blockly.inject('file-blockly',{toolbox,theme,renderer:'zelos',media:'vendor/blockly/media/',sounds:false,trashcan:true,zoom:{controls:true,wheel:true,startScale:.8,maxScale:2,minScale:.3}});
    fileWorkspace.registerToolboxCategoryCallback('VARIABLE',ws=>Blockly.Variables.flyoutCategory(ws).filter(item=>item.type!=='math_change'));
    new ResizeObserver(()=>Blockly.svgResize(fileWorkspace)).observe($('file-blockly'));
    fileWorkspace.addChangeListener(event=>{
      if(event.type===Blockly.Events.SELECTED){
        const block=fileWorkspace.getBlockById(event.newElementId);
        if(block){const text=block.type==='pico_python'?block.pythonCode:['pico_import','pico_import_as','pico_from_import'].includes(block.type)?block.getFieldValue('MODULE'):block.getField('HEADER')?.getValue();
          const offset=text?files[activeFile]?.indexOf(text):-1;
          if(offset>=0){const line=files[activeFile].slice(0,offset).split('\n').length;editor.highlightLines?.({from:line,to:line});}}
        return;
      }
      if(event.isUiEvent)return;
      fileWorkspaceDirty=true;dirty=true;clearTimeout(fileRefreshTimer);fileRefreshTimer=setTimeout(commitFileBlocks,60);
    });
  }
  function commitFileBlocks(){
    clearTimeout(fileRefreshTimer);
    if(!fileWorkspacePath)return;
    const state=Blockly.serialization.workspaces.save(fileWorkspace);
    if(!fileWorkspaceDirty&&JSON.stringify(fileModels[fileWorkspacePath]?.state)===JSON.stringify(state))return;
    try{
      const source=pythonBlocks.generate(fileWorkspace,parts,fileWorkspacePath);
      fileModels[fileWorkspacePath]={source,version:2,state:Blockly.serialization.workspaces.save(fileWorkspace)};
      fileStore.edit(fileWorkspacePath,source);files=fileStore.all;fileWorkspaceDirty=false;
      if(activeFile===fileWorkspacePath)editor.setFile(activeFile,source);
      codeValid=true;renderFiles();renderPicoFiles();saveProject();notify();updateDevice();
    }catch(error){notify(error.message);codeValid=false;updateDevice();}
  }
  function renderFileBlocks(){
    const textual=activeFile!=='main.py'||Object.hasOwn(fileStore.edits,'main.py');
    $('blockly').hidden=textual;$('file-blockly').hidden=!textual;
    if(!textual){fileWorkspacePath=null;Blockly.svgResize(workspace);return;}
    ensureFileWorkspace();
    const source=files[activeFile]||'',model=fileModels[activeFile];
    if(fileWorkspacePath!==activeFile||!model||model.source!==source){
      Blockly.Events.disable();
      try{
        const cached=model?.source===source;
        const state=cached?(model.version===2?model.state:PicoEditor.blocks.upgrade(model.state)):PicoEditor.blocks.fromSource(source);
        Blockly.serialization.workspaces.load(state,fileWorkspace);
        if(!cached||model.version!==2)PicoEditor.blocks.layout(fileWorkspace);
        fileWorkspace.clearUndo();
      }finally{Blockly.Events.enable();}
      fileWorkspacePath=activeFile;fileWorkspaceDirty=false;
      fileModels[activeFile]={source,version:2,state:Blockly.serialization.workspaces.save(fileWorkspace)};
    }
    Blockly.svgResize(fileWorkspace);
  }
  function renderFiles(){
    $('file-title').textContent=activeFile;
    const edited=Object.hasOwn(fileStore.edits,activeFile);
    $('file-origin').textContent=edited?'編集済み':activeFile==='lib/pico_parts.py'?'ライブラリ':'ブロックから生成';
    $('file-reset').disabled=!edited||!Object.hasOwn(fileStore.generated,activeFile)||Boolean(debugSession||debugStarting);
    const tree=$('file-tree'),opened=new Map([...tree.querySelectorAll('details')].map(e=>[e.dataset.path,e.open]));tree.replaceChildren();
    function branch(parent,prefix=''){
      const children=new Map();
      for(const path of Object.keys(files).filter(path=>path.startsWith(prefix))){const rest=path.slice(prefix.length),name=rest.split('/')[0];children.set(name,rest.includes('/'));}
      for(const [name,directory] of [...children].sort((a,b)=>Number(b[1])-Number(a[1])||a[0].localeCompare(b[0]))){
        const path=prefix+name;
        if(directory){const folder=document.createElement('details'),summary=document.createElement('summary');folder.dataset.path=path;folder.open=opened.get(path)??true;summary.textContent=name;summary.title=path;summary.classList.toggle('selected',treeSelection===path);summary.addEventListener('click',()=>{treeSelection=path;updateFileActions();});folder.append(summary);parent.append(folder);branch(folder,path+'/');}
        else{const button=document.createElement('button');button.textContent=name+(Object.hasOwn(fileStore.edits,path)?' •':'');button.title=path;button.setAttribute('aria-current',String(path===activeFile));button.addEventListener('click',()=>{treeSelection=path;openFile(path);});parent.append(button);}
      }
    }
    branch(tree);updateFileActions();
    const outline=$('file-outline');outline.replaceChildren();
    for(const def of StudioFiles.definitions(files[activeFile]||'')){const button=document.createElement('button');button.textContent=def.label;button.title=`${activeFile}:${def.line}`;button.addEventListener('click',()=>editor.goLine(def.line));outline.append(button);}
    outline.parentElement.hidden=!outline.childElementCount;
  }
  function goDefinition(){
    const word=editor.word();if(!word)return;
    const paths=[activeFile,...Object.keys(files).filter(p=>p!==activeFile)];
    for(const path of paths){const def=StudioFiles.definitions(files[path]||'').find(d=>d.name===word);if(def){openFile(path,def.line);return;}}
    if(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(word))for(const path of paths){const line=(files[path]||'').split('\n').findIndex(text=>new RegExp('^'+word+'\\s*=').test(text));if(line>=0){openFile(path,line+1);return;}}
    notify('定義が見つかりません。ライブラリのファイルから関数を選べます。');
  }
  function clearPicoFiles(){
    picoSnapshot=null;picoSelected=null;picoContents.clear();
    $('pico-file-tree').replaceChildren();$('pico-directory').replaceChildren();$('pico-diff').hidden=true;
    $('pico-file-title').textContent='ファイルを選択';$('pico-file-status').textContent='';$('pico-file-message').textContent='';
    $('pico-files-state').textContent='USB接続して取得してください。';renderPicoFiles();
  }
  function renderPicoFiles(){
    const {path,entries,local}=picoSnapshot||{path:'',entries:[],local:{}};
    const compared=entries.map(e=>{
      const name=(path?path+'/':'')+e.name;
      const remote=picoContents.get(name);
      return {...e,same:remote!==undefined?remote===files[name]:files[name]!==local[name]?null:e.same};
    });
    const tree=$('pico-file-tree'),pc=$('pc-file-tree');tree.replaceChildren();pc.replaceChildren();
    for(const entry of StudioFiles.compare(files,path,compared)){
      const inPC=entry.dir?Object.keys(files).some(p=>p.startsWith(entry.path+'/')):Object.hasOwn(files,entry.path);
      for(const [pane,present] of [[pc,inPC],[tree,picoSnapshot&&entry.exists!==false]]){
        if(!present)continue;
        const button=document.createElement('button'),name=document.createElement('span'),state=document.createElement('span');
        name.textContent=entry.dir?entry.name+'/':entry.name;state.className='file-status';state.textContent=picoSnapshot?entry.status:'';
        button.append(name,state);button.setAttribute('aria-current',String(picoSelected?.path===entry.path));
        button.title=entry.dir?entry.path:entry.path+(entry.size!==undefined?` · ${entry.size} bytes`:'');
        button.addEventListener('click',()=>{if(entry.dir)loadPicoDirectory(entry.path,entry.exists!==false);else if(picoSnapshot)selectPicoFile(entry);else openFile(entry.path);});pane.append(button);
      }
    }
    const directory=$('pico-directory');directory.replaceChildren();
    for(const [label,target] of [['/', ''],...path.split('/').filter(Boolean).map((part,index,all)=>[part,all.slice(0,index+1).join('/')])]){
      const button=document.createElement('button');button.textContent=label;button.disabled=browsing;button.addEventListener('click',()=>loadPicoDirectory(target));directory.append(button);
    }
    if(picoSelected)renderPicoDiff();
  }
  function renderPicoDiff(){
    const entry=picoSelected,remote=entry.exists===false?null:picoContents.get(entry.path),local=files[entry.path]??null;
    $('pico-file-title').textContent=entry.path;
    $('pico-file-status').textContent=remote===undefined?'':local===null?'Pico内のみ':remote===null?'編集中のみ':local===remote?'同じ':'内容が異なる';
    $('pico-diff').hidden=remote===undefined;
    const rows=$('pico-diff-rows');rows.replaceChildren();if(remote===undefined)return;
    for(const line of StudioFiles.diff(local,remote)){
      const row=document.createElement('tr');row.className=line.kind;
      for(const side of ['local','remote']){
        const cell=document.createElement('td'),number=document.createElement('span');number.className='line-number';number.textContent=line[side+'Line']??'';
        cell.append(number,document.createTextNode(line[side]??''));row.append(cell);
      }
      rows.append(row);
    }
  }
  async function loadPicoDirectory(path='',exists=true){
    if(browsing||deploying||device.busy||!device.port)return;
    browsing=true;updateDevice();$('pico-file-message').textContent='';
    try{
      const local={...files};
      if(exists)await device.interrupt();
      const entries=exists?JSON.parse((await device.exec(PicoProject.directory(path,local))).trim()):[];
      picoContents.clear();picoSelected=null;
      picoSnapshot={path,entries,local,id:device.id,port:device.port};
      for(const entry of entries)if(entry.same===true)picoContents.set((path?path+'/':'')+entry.name,local[(path?path+'/':'')+entry.name]);
      $('pico-files-state').textContent=`Pico ${device.id} · ${new Date().toLocaleTimeString('ja-JP',{hour12:false})} 取得`;
      $('pico-file-title').textContent='ファイルを選択';$('pico-file-status').textContent='';$('pico-diff').hidden=true;renderPicoFiles();
    }catch(error){$('pico-file-message').textContent=error.message;}
    finally{browsing=false;renderPicoFiles();updateDevice();}
  }
  async function selectPicoFile(entry){
    if(browsing||deploying||device.busy)return;
    picoSelected=entry;$('pico-file-message').textContent='';
    if(entry.exists!==false&&!picoContents.has(entry.path)){
      if(!device.port||device.running){$('pico-file-message').textContent='プログラムを停止してから取得してください。';return;}
      browsing=true;updateDevice();
      try{
        if(entry.size>32768)throw Error('内容の表示は32 KiB以内のファイルに対応しています。');
        const result=JSON.parse((await device.exec(PicoProject.read(entry.path))).trim());
        const bytes=Uint8Array.from(atob(result.data),c=>c.charCodeAt(0));
        if(bytes.includes(0))throw Error('バイナリファイルです。');
        let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(_){throw Error('UTF-8のテキストファイルではありません。');}
        picoContents.set(entry.path,text);
      }catch(error){$('pico-file-message').textContent=error.message;}
      finally{browsing=false;}
    }
    renderPicoFiles();updateDevice();
  }
  $('pico-files-refresh').addEventListener('click',()=>loadPicoDirectory(picoSnapshot?.path||''));
  function updateDevice(){
    if(debugSession&&device.running)debugSession.started=true;
    if(debugSession?.started&&!device.running&&!device.busy&&!deploying)endDebug();
    const current=PicoDevices.entry(activeRole),link=current.link;
    if(picoSnapshot&&(picoSnapshot.id!==device.id||picoSnapshot.port!==device.port))clearPicoFiles();
    $('program-state').textContent=browsing?'ファイルを取得中…':deploying?'書き込み中…':connecting?'USB接続中…':({disconnected:'USB未接続',connected:'USB接続済み',uploading:'書き込み中…',running:current.task==='observer'?'受信中':'実行中',stopping:'停止中…','close-error':'USB切断未完了'}[current.state]||current.state);
    $('program-device').disabled=browsing||deploying||connecting||link.busy;
    $('program-connect').disabled=browsing||deploying||connecting||Boolean(link.port);
    $('program-disconnect').disabled=browsing||deploying||connecting||!link.port||link.busy;
    $('run').disabled=browsing||partsDirty||deploying||!codeValid||!device.port||device.busy||device.running;
    $('write-only').disabled=$('run').disabled;
    $('stop').disabled=browsing||deploying||!device.port||!device.running||device.busy;
    $('step-start').disabled=$('run').disabled||Boolean(debugSession||debugStarting);
    $('step-next').hidden=!debugSession;
    $('step-next').disabled=!debugSession?.paused||device.busy||deploying;
    $('python-save').disabled=partsDirty||!codeValid;
    const canConsole=Boolean(device.port)&&!connecting&&!deploying&&!browsing&&!device.busy&&(!device.running||device.task==='program');
    $('console-input').disabled=!canConsole||Boolean(debugSession?.paused);
    $('console-prompt').textContent=canConsole&&!device.running?'>>>':'';
    const label=!device.port?'USB未接続':deploying?'書き込み中':device.running?(device.task==='observer'?'観測中':'実行中'):device.busy?'処理中':'USB接続済み';
    $('console-state').textContent=`Pico ${device.id} · ${label}`;
    $('console-state').dataset.connected=String(Boolean(device.port));
    $('console-input').placeholder=deploying?'書き込み中…':browsing?'ファイルを取得中…':device.busy?'処理中…':debugSession?.paused?'「次へ」で進めてください':!device.port?'USB接続してください':device.task==='observer'&&device.running?'ロジアナで観測中':device.running?'入力を送る':'';
    $('project-save').disabled=partsDirty;
    $('pico-files-refresh').disabled=!device.port||connecting||deploying||browsing||device.busy;
    $('pico-files-refresh').textContent=browsing?'取得中…':device.running?'停止して一覧を更新':picoSnapshot?'一覧を更新':'一覧を取得';
    for(const button of document.querySelectorAll('#pico-file-tree button, #pc-file-tree button, #pico-directory button'))button.disabled=browsing||deploying||device.busy||device.running;
  }
  function refresh(){
    try {
      files=fileStore.regenerate(PicoBlocks.generateProject(Blockly,generator,workspace,parts,runtime,PicoSources.ssd1306,sourceMap));codeValid=true;
      if(!Object.hasOwn(files,activeFile))activeFile='main.py';
      if(!Object.keys(files).some(path=>path===treeSelection||path.startsWith(treeSelection+'/')))treeSelection=activeFile;
      editor.setFile(activeFile,files[activeFile]);renderFiles();renderFileBlocks();renderPicoFiles();saveProject();notify();
    }catch(error){codeValid=false;notify(error.message);}
    highlightBlock();renderDisplay();updateDevice();
  }
  function project(){commitFileBlocks();return {format:'pico-blocks-4',parts,workspace:Blockly.serialization.workspaces.save(workspace),edits:{...fileStore.edits},fileWorkspaces:{...fileModels}};}
  function loadWorkspace(state,ask=true,nextParts=parts,nextEdits=fileStore.edits,nextModels=fileModels){
    if(ask&&(dirty||Object.keys(fileStore.edits).some(path=>nextEdits[path]!==fileStore.edits[path]))&&!confirm('編集中のプロジェクトを置き換えます。保存していない変更は失われます。続けますか？'))return false;
    state=PicoEditor.blocks.upgrade(PicoBlocks.migrateSpeaker(state));
    PicoBlocks.validateParts(nextParts);PicoBlocks.validateWorkspace(state,nextParts);const restoredEdits=StudioFiles.validateEdits(nextEdits);
    if(!nextModels||typeof nextModels!=='object'||Array.isArray(nextModels)||Object.entries(nextModels).some(([path,model])=>!StudioFiles.validPath(path)||typeof model?.source!=='string'||!model.state))throw Error('ファイルのブロック形式が不正です。');
    for(const model of Object.values(nextModels)){const check=new Blockly.Workspace();try{Blockly.serialization.workspaces.load(model.version===2?model.state:PicoEditor.blocks.upgrade(model.state),check);}finally{check.dispose();}}
    const previous=Blockly.serialization.workspaces.save(workspace),oldParts=parts;parts=nextParts;
    generator.addReservedWords(parts.map(p=>p.id).join(','));
    Blockly.Events.disable();
    try {Blockly.serialization.workspaces.load(state,workspace);}
    catch(error){parts=oldParts;Blockly.serialization.workspaces.load(previous,workspace);throw error;}
    finally {Blockly.Events.enable();}
    clearTimeout(fileRefreshTimer);fileWorkspaceDirty=false;fileWorkspacePath=null;fileModels=structuredClone(nextModels);fileStore.restore(restoredEdits);workspace.scrollCenter();selectedId=null;dirty=false;partsDirty=false;renderParts();refresh();return true;
  }
  function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  workspace.addChangeListener(event=>{
    if(event.type===Blockly.Events.SELECTED){selectedId=event.newElementId;highlightBlock();return;}
    if(event.isUiEvent)return;
    dirty=true;clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,60);
  });
  $('example-load').addEventListener('click',()=>{try{if($('example').value==='modules'){
      commitFileBlocks();
      const edits={...fileStore.edits,'my_tools.py':'def twice(value):\n    return value * 2\n\nclass Counter:\n    def __init__(self, value=0):\n        self.value = value\n\n    def add(self, amount):\n        self.value += amount\n        return self.value\n','main.py':'from my_tools import twice, Counter\n\nprint(twice(21))\ncounter = Counter(10)\nprint(counter.add(5))\n'};
      if(loadWorkspace(Blockly.serialization.workspaces.save(workspace),true,parts,edits))openFile('main.py');return;
    }if($('example').value==='bootsel'&&!parts.some(p=>p.kind==='infrared')){
      const next=[...parts];let infrared;
      for(const pin of [16,17,18,19,20,21,22,26,27,28,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]){
        const candidate={id:'infrared',name:'赤外線LED',kind:'infrared',pin,unit:560};
        while(next.some(p=>p.id===candidate.id))candidate.id+='_';
        try{PicoBlocks.validateParts([...next,candidate]);infrared=candidate;break;}catch(_){}
      }
      if(!infrared)throw Error('赤外線LED用の空きピンがありません。部品設定を確認してください。');
      next.push(infrared);const state=PicoBlocks.examples.bootsel();
      function remapInfrared(value){if(!value||typeof value!=='object')return;if(value.fields?.PART==='infrared')value.fields.PART=infrared.id;Object.values(value).forEach(remapInfrared);}remapInfrared(state);
      const edits={...fileStore.edits};delete edits['main.py'];delete edits['parts.py'];loadWorkspace(state,true,next,edits);return;
    }if(['peripherals','pixels'].includes($('example').value)){const edits={...fileStore.edits};delete edits['main.py'];delete edits['parts.py'];const name=$('example').value;loadWorkspace(PicoBlocks.examples[name](),true,PicoBlocks.peripheralParts().filter(p=>name!=='pixels'||p.kind==='ssd1306'),edits);return;}const state=PicoBlocks.examples[$('example').value]();const mapping={send_button:'button',status_led:'led',infrared:'infrared'};function remap(value){if(!value||typeof value!=='object')return;const id=value.fields?.PART;if(id&&!parts.some(p=>p.id===id)){const replacement=parts.find(p=>p.kind===mapping[id]);if(replacement)value.fields.PART=replacement.id;}Object.values(value).forEach(remap);}remap(state);const edits={...fileStore.edits};delete edits['main.py'];loadWorkspace(state,true,parts,edits);}catch(error){notify(error.message);}});
  $('project-save').addEventListener('click',()=>{download('pico-blocks.json',JSON.stringify(project(),null,2),'application/json');dirty=false;});
  $('python-save').addEventListener('click',()=>{if(codeValid)download(activeFile.split('/').pop(),files[activeFile],'text/x-python');});
  $('project-load').addEventListener('click',()=>$('project-file').click());
  $('project-file').addEventListener('change',async()=>{
    const file=$('project-file').files[0];if(!file)return;
    try{if(file.size>1048576)throw Error('ブロックのファイルは1MB以内にしてください。');let data=JSON.parse(await file.text());if(data.format==='pico-blocks-1')data=PicoBlocks.migrate(data.workspace);if(!['pico-blocks-2','pico-blocks-3','pico-blocks-4'].includes(data.format)||!data.workspace)throw Error('このツールで保存したブロックを選んでください。');loadWorkspace(data.workspace,true,data.parts,data.edits||{},data.fileWorkspaces||{});}
    catch(error){notify(error.message);}finally{$('project-file').value='';}
  });
  $('program-connect').addEventListener('click',async()=>{
    if(!('serial' in navigator)){notify('USB接続にはPC版Chromeを使ってください。ブロックとコードの編集は、このブラウザでも試せます。');return;}
    connecting=true;updateDevice();notify();
    try{if(activeRole==='observer')await window.LiveAnalyzer.connect();else{const port=await PicoDevices.requestPort(navigator.serial);await device.connect(port);}}
    catch(error){if(error.name!=='NotFoundError')notify('USBに接続できません。エディタや観測画面で使っているPicoとは別のPicoを選んでください。');}
    finally{connecting=false;updateDevice();}
  });
  $('program-disconnect').addEventListener('click',async()=>{notify();try{if(debugSession&&PicoDevices.entry(activeRole).id===device.id)await stopProgram();if(activeRole==='observer')await window.LiveAnalyzer.disconnect();else await device.disconnect();}catch(error){notify(error.message);}updateDevice();});
  function lockDebug(value){
    editor.setReadOnly?.(value);document.querySelector('.blocks-panel').inert=value;
    if(value){debugLocked=[...document.querySelectorAll('.project-bar button,.project-bar select,.parts-settings input,.parts-settings select,.parts-settings button,.file-actions button,#file-reset')].map(element=>[element,element.disabled]);for(const [element] of debugLocked)element.disabled=true;}
    else{for(const [element,disabled] of debugLocked)element.disabled=disabled;debugLocked=[];}
  }
  function endDebug(){
    const session=debugSession;debugSession=null;debugStarting=false;debugStopping=false;
    if(session){const pending=session.output.flush();if(pending)consoleAppend(pending);if(!session.failed)editor.highlightLines?.(null);}
    $('step-position').textContent='';lockDebug(false);
  }
  async function startProgram(mode='run'){
    const stepped=mode==='step',writeOnly=mode==='write';
    if(deploying||browsing||connecting||partsDirty||!device.port||device.busy||device.running)return;
    commitFileBlocks();refresh();if(!codeValid)return;
    const snapshot={...files};let prepared,token,launch;
    try{
      if(stepped){prepared=PicoEditor.step.prepare(snapshot['main.py']);token=Date.now().toString(36)+Math.random().toString(36).slice(2);launch=PicoProject.launchStepped(snapshot,prepared,token);}
      else if(!writeOnly)launch=PicoProject.launchFor(snapshot);
    }catch(error){notify(error.message);return;}
    deploying=true;debugStarting=stepped;if(stepped)lockDebug(true);updateDevice();notify();consoleAppend(($('output').textContent==='—'?'':'\n')+'書き込み中…\n');
    try{
      const result=await PicoProject.upload(device,snapshot);clearPicoFiles();
      const message=result.backup?`退避先: ${result.backup}/（manifest.json に元のファイル名を記録）`:'ファイルの変更なし';
      consoleAppend('書き込み完了\n'+message+'\n'+(result.cleanupErrors?.length?`古い退避フォルダを削除できませんでした: ${result.cleanupErrors.join(', ')}\n`:''));
      if(writeOnly)return;
      if(stepped){
        const session={paused:false,started:false,failed:false,line:null};
        session.output=new PicoEditor.step.Output(token,line=>{
          if(debugSession!==session||line<1||line>prepared.lines)return;
          if(debugStopping){device.write('!continue:'+token+'\r').catch(error=>consoleAppend(error.message+'\n'));return;}
          session.paused=true;session.line=line;session.started=true;
          if(activeFile!=='main.py')openFile('main.py');
          editor.highlightLines?.({from:line,to:line});editor.goLine(line);
          $('step-position').textContent=`main.py:${line}（実行前）`;updateDevice();
        });
        debugSession=session;debugStarting=false;
      }
      await device.run(launch);
      if(!$('console-input').disabled)$('console-input').focus({preventScroll:true});
    }catch(error){if(stepped)endDebug();notify(error.message);consoleAppend(error.message+'\n');}
    finally{deploying=false;updateDevice();}
  }
  async function stopProgram(){
    notify();debugStopping=Boolean(debugSession);
    try{await device.stop();}catch(error){notify(error.message);}finally{debugStopping=false;updateDevice();}
  }
  $('run').addEventListener('click',()=>startProgram());
  $('write-only').addEventListener('click',()=>startProgram('write'));
  $('step-start').addEventListener('click',()=>startProgram('step'));
  $('step-next').addEventListener('click',async()=>{
    const session=debugSession;if(!session?.paused||device.busy)return;
    session.paused=false;updateDevice();
    try{await device.sendInput('');}catch(error){if(debugSession===session)session.paused=true;notify(error.message);updateDevice();}
  });
  $('stop').addEventListener('click',stopProgram);
  function showPanel(name){
    const analyzing=name==='analyzer';
    activeRole=analyzing?'observer':'program';PicoDevices.changed();
    history.replaceState(null,'','#'+name);
    $('program-panel').hidden=analyzing;$('observer-panel').hidden=!analyzing;
    $('program-tab').setAttribute('aria-selected',String(!analyzing));$('analyzer-tab').setAttribute('aria-selected',String(analyzing));
    $('program-tab').tabIndex=analyzing?-1:0;$('analyzer-tab').tabIndex=analyzing?0:-1;
    if(analyzing)window.LiveAnalyzer.show();else Blockly.svgResize(workspace);
    updateDevice();
  }
  for(const name of ['program','analyzer'])$(name+'-tab').addEventListener('click',()=>showPanel(name));
  for(const name of ['program','analyzer'])$(name+'-tab').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const next=name==='program'?'analyzer':'program';showPanel(next);$(next+'-tab').focus();}});
  new ResizeObserver(()=>Blockly.svgResize(workspace)).observe($('blockly'));
  function renderParts(){
    const body=$('parts-rows');body.replaceChildren();
    const names={button:'ボタン',led:'LED',infrared:'赤外線送信',speaker:'圧電スピーカー',ssd1306:'SSD1306',dip:'8連DIPスイッチ',pwm:'PWM出力'};
    for(const part of parts){
      const row=document.createElement('tr');row.dataset.id=part.id;row.dataset.kind=part.kind;
      const name=document.createElement('input');name.value=part.name;name.maxLength=40;name.setAttribute('aria-label',part.name+' の名前');name.dataset.field='name';
      const connection=document.createElement('div');connection.className='part-connections';
      function number(parent,label,field,value,min,max){const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement('input');input.type='number';input.min=min;if(max!==undefined)input.max=max;input.value=value;input.dataset.field=field;input.setAttribute('aria-label',part.name+' '+label);wrap.append(input);parent.append(wrap);return input;}
      if(part.kind==='ssd1306'){number(connection,'SDA','sda',part.sda,0,22);number(connection,'SCL','scl',part.scl,0,22);}
      else if(part.kind==='dip')part.pins.forEach((pin,i)=>number(connection,String(i+1),'pin'+i,pin,0,22));
      else number(connection,'GP','pin',part.pin,0,22);
      const settings=document.createElement('div');settings.className='part-options';
      if(part.kind==='pwm')number(settings,'Hz','frequency',part.frequency,1);
      if(part.kind==='infrared')number(settings,'µs','unit',part.unit,100,100000);
      if(part.kind==='ssd1306'){
        for(const [field,label,options] of [['height','画面',[[32,'128 × 32'],[64,'128 × 64']]],['address','アドレス',[[60,'0x3C'],[61,'0x3D']]]]){const wrap=document.createElement('label');wrap.textContent=label;const select=document.createElement('select');select.dataset.field=field;select.setAttribute('aria-label',part.name+' '+label);for(const [value,text] of options){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}select.value=part[field];wrap.append(select);settings.append(wrap);}
      }
      if(part.kind==='dip'){const hint=document.createElement('span');hint.className='hint';hint.textContent='ONでGND・1が最下位ビット';settings.append(hint);}
      const remove=document.createElement('button');remove.textContent='削除';remove.className='secondary';remove.setAttribute('aria-label',part.name+' を削除');remove.addEventListener('click',()=>{row.remove();markPartsDirty();});
      for(const item of [name,names[part.kind],connection,settings,remove]){const cell=document.createElement('td');if(typeof item==='string')cell.textContent=item;else cell.append(item);row.append(cell);}body.append(row);
    }
  }
  function markPartsDirty(){partsDirty=true;dirty=true;renderDisplay();updateDevice();}
  $('parts-rows').addEventListener('input',markPartsDirty);
  $('parts-rows').addEventListener('change',markPartsDirty);
  function draftParts(){return Array.from($('parts-rows').children,row=>{
    const value=field=>{const input=row.querySelector('[data-field='+field+']');return input.value===''?NaN:Number(input.value);};
    const part={id:row.dataset.id,kind:row.dataset.kind,name:row.querySelector('[data-field=name]').value.trim()};
    if(part.kind==='ssd1306')Object.assign(part,{sda:value('sda'),scl:value('scl'),width:128,height:value('height'),address:value('address')});
    else if(part.kind==='dip')part.pins=Array.from({length:8},(_,i)=>value('pin'+i));
    else{part.pin=value('pin');if(part.kind==='infrared')part.unit=value('unit');if(part.kind==='pwm')part.frequency=value('frequency');}
    return part;
  });}
  $('part-add').addEventListener('click',()=>{
    const draft=draftParts(),kind=$('new-part-kind').value,used=draft.flatMap(PicoBlocks.pinsFor);
    const free=Array.from({length:23},(_,i)=>i).filter(pin=>!used.includes(pin)&&(!['speaker','infrared','pwm'].includes(kind)||!draft.some(p=>['speaker','infrared','pwm'].includes(p.kind)&&(kind==='speaker'||p.kind==='speaker'||kind==='pwm'||p.kind==='pwm')&&((p.pin>>1)%8===(pin>>1)%8))));
    const count=kind==='dip'?8:kind==='ssd1306'?2:1;
    if(free.length<count){notify('必要なGPIOが足りません。部品設定を確認してください。');return;}
    let n=1;while(draft.some(p=>p.id===`${kind}_${n}`)||parts.some(p=>p.id===`${kind}_${n}`))n++;
    const names={led:'LED',button:'ボタン',infrared:'赤外線LED',speaker:'スピーカー',ssd1306:'画面',dip:'DIPスイッチ',pwm:'PWM出力'};
    const part={id:`${kind}_${n}`,name:`${names[kind]} ${n}`,kind};
    if(kind==='ssd1306')Object.assign(part,{sda:free[0],scl:free[1],width:128,height:64,address:60});
    else if(kind==='dip')part.pins=free.slice(0,8);
    else{part.pin=free[0];if(kind==='infrared')part.unit=560;if(kind==='pwm')part.frequency=1000;}
    const previous=parts;parts=[...draft,part];renderParts();parts=previous;markPartsDirty();
  });
  $('parts-apply').addEventListener('click',()=>{
    try{
      commitFileBlocks();
      const next=draftParts();PicoBlocks.validateParts(next);
      for(const [path,model] of Object.entries(fileModels))if(files[path]===model.source)PicoBlocks.validateWorkspace(model.state,next);
      const state=Blockly.serialization.workspaces.save(workspace);
      const used=workspace.getAllBlocks(false).filter(b=>b.getField('PART')).map(b=>b.getFieldValue('PART'));
      if(used.some(id=>!next.some(p=>p.id===id)))throw Error('使用中の部品は削除できません。対応するブロックを変更・削除してください。');
      const edits={...fileStore.edits};
      if(Object.hasOwn(edits,'parts.py')){if(!confirm('部品設定の反映で、parts.pyの編集を置き換えます。続けますか？'))return;delete edits['parts.py'];}
      loadWorkspace(state,false,next,edits);dirty=true;
    }catch(error){notify(error.message);}
  });
  $('file-reset').addEventListener('click',()=>{
    if(!Object.hasOwn(fileStore.edits,activeFile)||!confirm(`${activeFile}の編集を取り消し、生成されたコードに戻しますか？`))return;
    fileWorkspaceDirty=false;delete fileModels[activeFile];fileWorkspacePath=null;fileStore.reset(activeFile);dirty=true;refresh();
  });
  function consoleAppend(text){const output=$('output');output.textContent=(output.textContent==='—'?'':output.textContent)+text;if(output.textContent.length>8192)output.textContent=output.textContent.slice(-8192);output.scrollTop=output.scrollHeight;}
  async function submitConsole(){
    const input=$('console-input'),source=input.value;if(input.disabled||!source.trim()&&!device.running)return;
    const running=device.running;
    try{
      if(running)await device.sendInput(source);
      else{consoleHistory.push(source);consoleHistoryIndex=consoleHistory.length;consoleDraft='';}
      consoleAppend((running?'':'>>> ')+source.replace(/\n/g,'\n... ')+'\n');input.value='';input.style.height='';notify();
      if(!running)await device.repl(source);
    }catch(error){consoleAppend(error.message+'\n');}
    updateDevice();
  }
  $('console-input').addEventListener('keydown',async event=>{
    if(event.isComposing)return;
    if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();await submitConsole();}
    else if(event.ctrlKey&&event.key.toLowerCase()==='c'&&event.target.selectionStart===event.target.selectionEnd){event.preventDefault();if(device.running&&device.task==='program'){await stopProgram();}else event.target.value='';updateDevice();}
    else if(!device.running&&!event.target.value.includes('\n')&&['ArrowUp','ArrowDown'].includes(event.key)){
      event.preventDefault();if(consoleHistoryIndex===consoleHistory.length)consoleDraft=event.target.value;
      consoleHistoryIndex=Math.max(0,Math.min(consoleHistory.length,consoleHistoryIndex+(event.key==='ArrowUp'?-1:1)));event.target.value=consoleHistoryIndex===consoleHistory.length?consoleDraft:consoleHistory[consoleHistoryIndex];
    }
  });
  $('console-input').addEventListener('input',event=>{event.target.style.height='auto';event.target.style.height=Math.min(event.target.scrollHeight,100)+'px';});
  $('terminal-surface').addEventListener('click',event=>{if(event.target.id!=='console-input'&&!window.getSelection()?.toString())$('console-input').focus();});
  try {
    const saved=localStorage.getItem('pico-blocks-project-2'),legacy=localStorage.getItem('pico-blocks-workspace-1');
    const data=saved?JSON.parse(saved):legacy?PicoBlocks.migrate(JSON.parse(legacy)):project();
    loadWorkspace(saved||legacy?data.workspace:PicoBlocks.examples.send(),false,data.parts,data.edits||{},data.fileWorkspaces||{});
  }catch(error){loadWorkspace(PicoBlocks.examples.send(),false,PicoBlocks.defaults(),{});notify('保存されていた内容を読み込めなかったため、サンプルを表示しました。');}
  updateDevice();
  if(location.hash==='#analyzer')showPanel('analyzer');
})();
