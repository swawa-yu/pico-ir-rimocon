(() => {
  'use strict';
  const $=id=>document.getElementById(id), generator=python.pythonGenerator;
  let parts=PicoBlocks.defaults(),files={},runtime='',deploying=false,partsDirty=false,projectName='無題',projectDialogMode='new';
  let openedProjects=[],activeProject=0,switchingProjects=false,projectMenuIndex=0,closingProjectIndex=null,lastClosedProject=null;
  const consoleBuffers=new Map();
  let browsing=false,picoSnapshot=null,picoSelected=null,picoContents=new Map();
  let activeRole='program';
  runtime=PicoSources.parts;
  const fileStore=new StudioFiles.Files();let activeFile='main.py';
  const sourceMap=new Map();
  let debugSession=null,debugStarting=false,debugStopping=false,debugLocked=[];
  let treeSelection='main.py',fileOperation=null;
  const consoleHistory=[];let consoleHistoryIndex=0,consoleDraft='';
  let fileWorkspace=null,fileWorkspacePath=null,fileWorkspaceDirty=false,fileRefreshTimer,fileModels={},editingPythonBlock=null,editingFunctionBlock=null;
  PicoBlocks.configure(Blockly,generator,()=>parts);
  const pythonBlocks=PicoEditor.blocks.configure(Blockly,generator,block=>{
    editingPythonBlock=block;$('python-block-code').value=block.pythonCode;
    $('python-block-dialog').showModal();$('python-block-code').focus({preventScroll:true});
  },{getFiles:()=>files,getPath:()=>activeFile,editFunction:block=>{editingFunctionBlock=block;const info=PicoEditor.symbols.headerInfo(block.getFieldValue('HEADER'));$('function-phrase').value=block.pythonSentence||'';$('function-parameters').textContent=info?.params.map(n=>'{'+n+'}').join(' · ')||'引数なし';$('function-message').textContent='';$('function-dialog').showModal();},showHelp:fn=>{$('function-help-title').textContent=fn.target||fn.name;$('function-help-text').textContent=fn.help+(fn.returns===undefined?'':fn.returns?'\n値を返します。':'\n値を返さない関数です。');$('function-help-dialog').showModal();}});
  $('function-apply').addEventListener('click',()=>{try{editingFunctionBlock.setSentence($('function-phrase').value.trim());$('function-dialog').close();commitFileBlocks();}catch(error){$('function-message').textContent=error.message;}});
  const number=value=>({shadow:{type:'math_number',fields:{NUM:value}}});
  const toolbox={kind:'categoryToolbox',contents:[
    {kind:'category',name:'Python',colour:210,contents:['pico_import','pico_from_import','pico_import_as','pico_class','pico_def','pico_python'].map(type=>({kind:'block',type}))},
    {kind:'category',name:'制御',colour:45,contents:[
      {kind:'block',type:'pico_start'},{kind:'block',type:'pico_module'},{kind:'block',type:'pico_forever'},
      {kind:'block',type:'controls_if'},{kind:'block',type:'controls_repeat_ext',inputs:{TIMES:number(10)}},
      {kind:'block',type:'controls_whileUntil'},{kind:'block',type:'controls_for',inputs:{FROM:number(0),TO:number(63),BY:number(1)}},
      {kind:'block',type:'pico_wait',inputs:{SECONDS:number(.5)}},{kind:'block',type:'pico_time_us'},{kind:'block',type:'pico_time_diff'}]},
    {kind:'category',name:'入力',colour:200,contents:[{kind:'block',type:'pico_bootsel'},{kind:'block',type:'pico_button',fields:{PART:'send_button'}},{kind:'block',type:'pico_dip_on',inputs:{NUMBER:number(1)}},{kind:'block',type:'pico_dip_value'}]},
    {kind:'category',name:'出力',colour:150,contents:[{kind:'block',type:'pico_rgb',inputs:{RED:number(100),GREEN:number(0),BLUE:number(0)}},{kind:'block',type:'pico_rgb_off'},{kind:'block',type:'pico_pwm',inputs:{PERCENT:number(0)}},{kind:'block',type:'pico_led',fields:{PART:'status_led'}},{kind:'block',type:'pico_speaker_on',inputs:{HZ:number(880)}},{kind:'block',type:'pico_speaker_off'}]},
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
    {kind:'category',name:'赤外線',colour:285,contents:[
      {kind:'label',text:'時間配列'},
      {kind:'block',type:'pico_send_times',inputs:{TIMES:{block:{type:'lists_create_with',extraState:{itemCount:5},inputs:Object.fromEntries([560,560,560,1680,560].map((value,i)=>['ADD'+i,number(value)]))}}}},
      {kind:'block',type:'pico_receive',inputs:{TIMEOUT:number(1000)}},{kind:'block',type:'pico_ir_level'},
      {kind:'block',type:'pico_carrier',fields:{ON:'1'}},{kind:'block',type:'pico_carrier',fields:{ON:'0'}},
      {kind:'sep'},{kind:'label',text:'0・1の配列'},
      {kind:'block',type:'pico_send_bits',fields:{LEADER:'0'}},{kind:'block',type:'pico_receive_bits',inputs:{TIMEOUT:number(1000)}},
      {kind:'sep'},{kind:'label',text:'数値（8ビット）'},
      {kind:'block',type:'pico_send',fields:{PART:'infrared'},inputs:{VALUE:number(65)}}]},
    {kind:'category',name:'2進数・文字',colour:260,contents:[{kind:'block',type:'pico_decode_bits',inputs:{SKIP:number(2),THRESHOLD:number(2)}},{kind:'block',type:'text_join'},{kind:'block',type:'text_length'},{kind:'block',type:'text_getSubstring'},{kind:'block',type:'pico_to_text',inputs:{VALUE:number(65)}},{kind:'block',type:'pico_to_int',inputs:{VALUE:{shadow:{type:'text',fields:{TEXT:'65'}}}}},{kind:'block',type:'pico_to_float',inputs:{VALUE:{shadow:{type:'text',fields:{TEXT:'3.5'}}}}},{kind:'block',type:'pico_parse_int',inputs:{VALUE:{shadow:{type:'text',fields:{TEXT:'01000001'}}},BASE:number(2)}},{kind:'block',type:'pico_base_text',inputs:{VALUE:number(65)}},{kind:'block',type:'pico_bits_text'},{kind:'block',type:'pico_text_bits',inputs:{VALUE:{shadow:{type:'text',fields:{TEXT:'01000001'}}}}},{kind:'block',type:'pico_bits_int'},{kind:'block',type:'pico_int_bits',inputs:{VALUE:number(65),WIDTH:number(8)}},{kind:'block',type:'pico_bitwise',inputs:{A:number(65),B:number(1)}},{kind:'block',type:'pico_char',inputs:{VALUE:number(65)}},{kind:'block',type:'pico_ord',inputs:{VALUE:{shadow:{type:'text',fields:{TEXT:'A'}}}}}]},
    {kind:'category',name:'計算・条件',colour:210,contents:[{kind:'block',type:'text'},{kind:'block',type:'math_number'},{kind:'block',type:'math_arithmetic'},{kind:'block',type:'logic_compare'},{kind:'block',type:'logic_boolean'},{kind:'block',type:'logic_operation'},{kind:'block',type:'logic_negate'},{kind:'block',type:'logic_null'}]},
    {kind:'category',name:'変数',colour:330,custom:'VARIABLE'},
    {kind:'category',name:'関数',colour:290,custom:'STUDIO_FUNCTION'},
    {kind:'category',name:'リスト',colour:260,contents:[{kind:'block',type:'pico_range',inputs:{START:number(0),STOP:number(10),STEP:number(1)}},{kind:'block',type:'lists_create_with'},{kind:'block',type:'pico_index',inputs:{INDEX:number(0)}},{kind:'block',type:'pico_set_index',inputs:{INDEX:number(0),ITEM:number(1)}},{kind:'block',type:'lists_getIndex'},{kind:'block',type:'lists_setIndex'},{kind:'block',type:'lists_length'},{kind:'block',type:'lists_getSublist'},{kind:'block',type:'lists_reverse'},{kind:'block',type:'lists_split'},{kind:'block',type:'controls_forEach'}]}
  ]};
  const categoryOrder=['Python','変数','計算・条件','制御','関数','リスト','2進数・文字','コンソール','入力','出力','赤外線','画面'];
  toolbox.contents.sort((a,b)=>categoryOrder.indexOf(a.name)-categoryOrder.indexOf(b.name));
  const theme=Blockly.Theme.defineTheme('pico',{base:Blockly.Themes.Classic,fontStyle:{family:'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',weight:'normal',size:12},componentStyles:{workspaceBackgroundColour:'#f7fafc',toolboxBackgroundColour:'#edf2f7',flyoutBackgroundColour:'#e4edf4'}});
  const workspace=Blockly.inject('blockly',{toolbox,theme,renderer:'zelos',media:'vendor/blockly/media/',sounds:false,trashcan:true,grid:{spacing:20,length:2,colour:'#dbe4ed',snap:true},zoom:{controls:true,wheel:true,startScale:.95,maxScale:2,minScale:.4}});
  workspace.registerToolboxCategoryCallback('STUDIO_FUNCTION',functionCategory);
  workspace.registerToolboxCategoryCallback('VARIABLE',ws=>Blockly.Variables.flyoutCategory(ws).filter(item=>item.type!=='math_change'));
  if(window.StudioLayout)StudioLayout.attach(document.querySelector('.editor-grid'),$('console-panel'),()=>{Blockly.svgResize(workspace);if(fileWorkspace)Blockly.svgResize(fileWorkspace);});
  let dirty=false,codeValid=false,connecting=false,deviceState='disconnected',selectedId=null,refreshTimer;

  const notify=text=>{$('studio-status').textContent=text||'';};
  function deviceOutput(id,text,error=false){
    const item=PicoDevices.devices?.find(item=>item.id===id);
    if(item?.task==='observer'||id===device.id&&device.task==='observer')return;
    if(debugSession&&id===device.id){if(error)debugSession.failed=true;text=error?debugSession.output.flush()+text:debugSession.output.feed(text);if(!text)return;}
    consoleAppend(text,id);
    if(error&&id===PicoDevices.entry(activeRole).id&&item?.state!=='stopping')notify('Picoでエラーが発生しました。実行出力を確認してください。');
  }
  const device=PicoDevices.forRole('program',{
    onState(state){deviceState=state;updateDevice();},
    onSelect(){clearPicoFiles();if(!switchingProjects&&openedProjects.length)saveProject();renderConsole();},
    onOutput(text,error){deviceOutput(device.id,text,error);},
    onIdleOutput(text){deviceOutput(device.id,text);},
    onDeviceOutput(id,event,text,error){deviceOutput(id,text,error);}
  });
  PicoDevices.bindSelect($('program-device'),()=>activeRole);
  $('program-device').addEventListener('device-error',event=>notify(event.detail));
  PicoDevices.listeners.add(()=>{updateDevice();renderConsole();});
  const editor=PicoEditor.create($('code-editor'),{
    onChange(path,text){clearTimeout(fileRefreshTimer);fileWorkspaceDirty=false;fileStore.edit(path,text);files=fileStore.regenerate(generatedProject());dirty=true;renderFiles();renderFileBlocks();renderPicoFiles();saveProject();updateDevice();},
    onDefinition:goDefinition,
    onSave(){download(activeFile.split('/').pop(),files[activeFile]||'','text/x-python');}
  });
  function projectSignature(data){return JSON.stringify({name:data.name,pico:data.pico,parts:data.parts,files:Object.fromEntries(Object.entries(data.files).sort(([a],[b])=>a.localeCompare(b)))});}
  function projectLocked(){return partsDirty||browsing||deploying||connecting||device.busy||Boolean(debugSession||debugStarting);}
  function renderProjectTabs(){
    const tabs=$('project-tabs');tabs.replaceChildren();
    openedProjects.forEach((entry,index)=>{
      const wrap=document.createElement('span'),button=document.createElement('button');button.type='button';button.setAttribute('role','tab');button.setAttribute('aria-selected',String(index===activeProject));button.tabIndex=index===activeProject?0:-1;button.setAttribute('aria-label',(entry.data.name||'無題')+' · Pico '+(entry.data.pico||'1')+(entry.dirty?' · ローカル未保存':''));
      const name=document.createElement('span');name.className='project-tab-name';name.textContent=entry.data.name||'無題';
      const badge=document.createElement('span');badge.className='project-pico';badge.textContent='Pico '+(entry.data.pico||'1');button.append(name,badge);
      if(entry.dirty){const dot=document.createElement('span');dot.className='project-unsaved';dot.textContent='●';dot.title='ローカル未保存';dot.setAttribute('aria-label','ローカル未保存');button.append(dot);}
      button.disabled=projectLocked();button.addEventListener('click',()=>switchProject(index));button.addEventListener('contextmenu',event=>{event.preventDefault();if(!projectLocked())showProjectMenu(index,event.clientX,event.clientY);});
      button.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();switchProject((index+(event.key==='ArrowRight'?1:-1)+openedProjects.length)%openedProjects.length);$('project-tabs').querySelector('[aria-selected=true]')?.focus({preventScroll:true});}else if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();const rect=button.getBoundingClientRect();showProjectMenu(index,rect.left,rect.bottom);}});
      const close=document.createElement('button');close.type='button';close.textContent='×';close.className='project-close';close.setAttribute('aria-label',(entry.data.name||'無題')+' を閉じる');close.disabled=button.disabled;close.addEventListener('click',()=>closeProject(index));wrap.append(button,close);tabs.append(wrap);
    });
    const add=document.createElement('button');add.type='button';add.textContent='＋';add.id='project-add';add.className='secondary';add.setAttribute('aria-label','プロジェクトを追加');add.title='プロジェクトを追加';add.disabled=projectLocked();add.addEventListener('click',()=>{$('project-reopen').hidden=!lastClosedProject;$('project-add-dialog').showModal();});tabs.append(add);
  }
  function saveProject(){
    if(switchingProjects)return;
    const data=project(),previous=openedProjects[activeProject];
    const savedSignature=previous&&Object.hasOwn(previous,'savedSignature')?previous.savedSignature:null;
    dirty=savedSignature===null||projectSignature(data)!==savedSignature;
    openedProjects[activeProject]={data,file:activeFile,dirty,savedSignature};renderProjectTabs();
    try{localStorage.setItem('pico-blocks-project-2',JSON.stringify(data));localStorage.setItem('pico-studio-tabs-1',JSON.stringify({active:activeProject,projects:openedProjects,closed:lastClosedProject}));}catch(_){notify('ブラウザに保存できません。プロジェクトをファイルに保存してください。');}
  }
  function openProject(load,saved=false){
    if(projectLocked())return false;
    saveProject();switchingProjects=true;
    try{if(!load())return false;activeProject=openedProjects.length;const data=project();dirty=!saved;openedProjects.push({data,file:activeFile,dirty,savedSignature:saved?projectSignature(data):null});return true;}
    finally{switchingProjects=false;saveProject();}
  }
  function switchProject(index){
    if(index===activeProject||projectLocked())return;
    saveProject();const next=openedProjects[index];switchingProjects=true;
    try{restoreProject(next.data,false);activeProject=index;dirty=next.dirty;openFile(Object.hasOwn(files,next.file)?next.file:'main.py');}
    catch(error){notify(error.message);}
    finally{switchingProjects=false;saveProject();}
  }
  function closeProject(index){
    if(projectLocked())return;saveProject();if(openedProjects.length===1){notify('最後のプロジェクトは閉じられません。');return;}
    closingProjectIndex=index;
    if(openedProjects[index].dirty){$('project-close-name').textContent=openedProjects[index].data.name||'無題';$('project-close-dialog').showModal();return;}
    finishClosingProject();
  }
  function finishClosingProject(){
    const index=closingProjectIndex;if(index===null)return;
    if(projectLocked()){notify('処理が終わるまで待ってください。');return;}
    const closed=openedProjects[index];
    if(index===activeProject){switchProject(index?index-1:1);if(index===activeProject)return;}
    lastClosedProject=closed;
    openedProjects.splice(index,1);if(index<activeProject)activeProject--;closingProjectIndex=null;saveProject();
  }
  $('project-discard-close').addEventListener('click',()=>{$('project-close-dialog').close();finishClosingProject();});
  $('project-save-close').addEventListener('click',()=>{if(projectLocked())return;if(closingProjectIndex!==activeProject)switchProject(closingProjectIndex);if(closingProjectIndex!==activeProject||projectLocked())return;saveProjectFile();$('project-close-dialog').close();finishClosingProject();});
  $('project-reopen').addEventListener('click',()=>{const entry=lastClosedProject;if(!entry)return;if(openProject(()=>restoreProject(entry.data,false))){openedProjects[activeProject].savedSignature=entry.savedSignature??null;lastClosedProject=null;saveProject();$('project-add-dialog').close();}});
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
    $('file-dialog').showModal();$('file-path-input').focus({preventScroll:true});$('file-path-input').select();
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
  function functionCategory(){return ['pico_def','pico_call','pico_call_value','pico_return'].map(type=>({kind:'block',type}));}
  function diagnoseProgram(){const ws=fileWorkspacePath===activeFile?fileWorkspace:workspace;editor.setErrors?.(pythonBlocks.diagnose(ws,files[activeFile]||''));}
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
    fileWorkspace.registerToolboxCategoryCallback('STUDIO_FUNCTION',functionCategory);
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
      fileModels[fileWorkspacePath]={source,version:5,state:Blockly.serialization.workspaces.save(fileWorkspace)};
      fileStore.edit(fileWorkspacePath,source);files=fileStore.regenerate(generatedProject());fileWorkspaceDirty=false;
      if(activeFile===fileWorkspacePath)editor.setFile(activeFile,source);
      codeValid=true;diagnoseProgram();fileModels[fileWorkspacePath].state=Blockly.serialization.workspaces.save(fileWorkspace);renderFiles();renderPicoFiles();saveProject();notify();updateDevice();
    }catch(error){notify(error.message);codeValid=false;updateDevice();}
  }
  function renderFileBlocks(){
    $('blockly').hidden=true;$('file-blockly').hidden=false;
    ensureFileWorkspace();
    const source=files[activeFile]||'',model=fileModels[activeFile];
    if(fileWorkspacePath!==activeFile||!model||model.source!==source){
      Blockly.Events.disable();
      try{
        const cached=model?.source===source;
        const state=cached?(model.version===5?model.state:PicoEditor.blocks.upgrade(model.state,parts,activeFile)):PicoEditor.blocks.fromSource(source,parts,activeFile);
        Blockly.serialization.workspaces.load(state,fileWorkspace);
        if(!cached||model.version!==5)PicoEditor.blocks.layout(fileWorkspace);
        fileWorkspace.clearUndo();
      }finally{Blockly.Events.enable();}
      fileWorkspacePath=activeFile;fileWorkspaceDirty=false;
      fileModels[activeFile]={source,version:5,state:Blockly.serialization.workspaces.save(fileWorkspace)};
    }
    Blockly.svgResize(fileWorkspace);diagnoseProgram();fileModels[activeFile].state=Blockly.serialization.workspaces.save(fileWorkspace);
  }
  function renderFiles(){
    const tree=$('file-tree'),treeScroll=tree.scrollTop,opened=new Map([...tree.querySelectorAll('details')].map(e=>[e.dataset.path,e.open]));tree.replaceChildren();
    function branch(parent,prefix=''){
      const children=new Map();
      for(const path of Object.keys(files).filter(path=>path.startsWith(prefix))){const rest=path.slice(prefix.length),name=rest.split('/')[0];children.set(name,rest.includes('/'));}
      for(const [name,directory] of [...children].sort((a,b)=>Number(b[1])-Number(a[1])||a[0].localeCompare(b[0]))){
        const path=prefix+name;
        if(directory){const folder=document.createElement('details'),summary=document.createElement('summary');folder.dataset.path=path;folder.open=opened.get(path)??true;summary.textContent=name;summary.title=path;summary.classList.toggle('selected',treeSelection===path);summary.addEventListener('click',()=>{treeSelection=path;updateFileActions();});folder.append(summary);parent.append(folder);branch(folder,path+'/');}
        else{const button=document.createElement('button');button.textContent=name+(Object.hasOwn(fileStore.edits,path)?' •':'');button.title=path;button.setAttribute('aria-current',String(path===activeFile));button.addEventListener('click',()=>{treeSelection=path;openFile(path);});parent.append(button);}
      }
    }
    branch(tree);tree.scrollTop=treeScroll;updateFileActions();
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
    $('pico-file-title').textContent='';$('pico-file-status').textContent='';$('pico-file-message').textContent='';
    $('pico-files-state').textContent='USB未接続';renderPicoFiles();
  }
  function renderPicoFiles(){
    const {path,entries,local}=picoSnapshot||{path:'',entries:[],local:{}};
    const compared=entries.map(e=>{
      const name=(path?path+'/':'')+e.name;
      const remote=picoContents.get(name);
      return {...e,same:remote!==undefined?remote===files[name]:files[name]!==local[name]?null:e.same};
    });
    const tree=$('pico-file-tree'),pc=$('pc-file-tree'),pane=pc.parentElement,paneScroll=pane.scrollTop;tree.replaceChildren();pc.replaceChildren();
    for(const entry of StudioFiles.compare(files,path,compared)){
      const inPC=entry.dir?Object.keys(files).some(p=>p.startsWith(entry.path+'/')):Object.hasOwn(files,entry.path);
      for(const [pane,present] of [[pc,inPC],[tree,picoSnapshot&&entry.exists!==false]]){
        if(!present){const empty=document.createElement('div');empty.className='file-placeholder';empty.dataset.path=entry.path;empty.setAttribute('aria-hidden','true');pane.append(empty);continue;}
        const button=document.createElement('button'),name=document.createElement('span'),state=document.createElement('span');
        name.textContent=entry.dir?entry.name+'/':entry.name;state.className='file-status';
        const status=picoSnapshot?entry.status:'';
        const style={'同じ':['same','='],'内容が異なる':['changed','≠'],'編集中のみ':['local-only','+'],'Pico内のみ':['remote-only','+'],'未比較':['unknown','?']}[status]||['',''];
        button.dataset.state=style[0];button.dataset.path=entry.path;state.textContent=style[1];state.setAttribute('aria-hidden','true');
        button.setAttribute('aria-label',entry.path+(status?' · '+status:''));
        button.append(name,state);button.setAttribute('aria-current',String(picoSelected?.path===entry.path));
        button.title=entry.path+(status?' · '+status:'')+(entry.size!==undefined?` · ${entry.size} bytes`:'');
        button.addEventListener('click',()=>{if(entry.dir)loadPicoDirectory(entry.path,entry.exists!==false);else if(picoSnapshot)selectPicoFile(entry);else openFile(entry.path);});pane.append(button);
      }
    }
    pane.scrollTop=paneScroll;
    const directory=$('pico-directory');directory.replaceChildren();
    for(const [label,target] of [['/', ''],...path.split('/').filter(Boolean).map((part,index,all)=>[part,all.slice(0,index+1).join('/')])]){
      const button=document.createElement('button');button.textContent=label;button.disabled=browsing;button.addEventListener('click',()=>loadPicoDirectory(target));directory.append(button);
    }
    if(picoSelected)renderPicoDiff();
  }
  function renderPicoDiff(){
    const entry=picoSelected,remote=entry.exists===false?null:picoContents.get(entry.path),local=files[entry.path]??null;
    $('pico-file-title').textContent=entry.path;
    const status=remote===undefined?'未比較':local===null?'Pico内のみ':remote===null?'編集中のみ':local===remote?'同じ':'内容が異なる';
    $('pico-file-status').textContent=remote===undefined?'?':local===null||remote===null?'+':local===remote?'=':'≠';
    $('pico-file-status').title=status;$('pico-file-status').setAttribute('aria-label',status);
    $('pico-file-status').dataset.changed=String(status==='内容が異なる');
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
      $('pico-file-title').textContent='';$('pico-file-status').textContent='';$('pico-diff').hidden=true;renderPicoFiles();
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
    $('program-state').textContent=browsing?'ファイルを取得中…':deploying?'書き込み中…':connecting?'USB接続中…':({disconnected:'',connected:'',uploading:'書き込み中…',running:current.task==='observer'?'受信中':'実行中',stopping:'停止中…','close-error':'USB切断未完了'}[current.state]??current.state);
    $('program-state').hidden=!$('program-state').textContent;
    $('program-device').disabled=browsing||deploying||connecting||link.busy||Boolean(debugSession||debugStarting);
    $('program-device').setAttribute('aria-label',activeRole==='program'?'このプロジェクトで使うPico':'ロジアナで使うPico');
    $('program-connect').disabled=browsing||deploying||connecting||Boolean(link.port);
    $('program-disconnect').disabled=browsing||deploying||connecting||!link.port||link.busy;
    $('run').disabled=browsing||partsDirty||deploying||!codeValid||!device.port||device.busy||device.running;
    $('write-only').disabled=$('run').disabled;
    $('stop').disabled=browsing||deploying||!device.port||!device.running||device.busy;
    $('step-start').disabled=$('run').disabled||Boolean(debugSession||debugStarting);
    $('step-next').hidden=!debugSession;
    $('step-next').disabled=!debugSession?.paused||device.busy||deploying;
    const canConsole=Boolean(link.port)&&!connecting&&!deploying&&!browsing&&!link.busy&&(!link.running||current.task==='program');
    $('console-input').disabled=!canConsole||Boolean(debugSession?.paused&&current.id===device.id);
    $('console-prompt').textContent=canConsole&&!link.running?'>>>':'';
    const label=!link.port?'USB未接続':deploying&&current.id===device.id?'書き込み中':link.running?(current.task==='observer'?'観測中':'実行中'):link.busy?'処理中':'USB接続済み';
    $('console-state').textContent=`Pico ${current.id} · ${label}`;
    $('console-state').dataset.connected=String(Boolean(link.port));
    $('console-input').placeholder=deploying&&current.id===device.id?'書き込み中…':!link.port?'USB接続してください':link.busy?'処理中…':current.task==='observer'&&link.running?'ロジアナで観測中':debugSession?.paused?'「次へ」で進めてください':'';
    $('project-save').disabled=partsDirty;
    $('project-save-as').disabled=partsDirty;
    for(const id of ['project-new','project-load','example-load','example','sample-topic'])$(id).disabled=projectLocked();
    renderProjectTabs();
    $('pico-files-refresh').disabled=!device.port||connecting||deploying||browsing||device.busy;
    $('pico-files-refresh').textContent=browsing?'取得中…':device.running?'停止して一覧を更新':picoSnapshot?'一覧を更新':'一覧を取得';
    for(const button of document.querySelectorAll('#pico-file-tree button, #pc-file-tree button, #pico-directory button'))button.disabled=browsing||deploying||device.busy||device.running;
  }
  function generatedProject(){
    const generated=PicoBlocks.generateProject(Blockly,generator,workspace,parts,runtime,PicoSources.ssd1306,sourceMap,PicoSources);
    const edited=Object.values(fileStore.edits);
    if(edited.some(text=>/^(?:import ir_data\b|from ir_data import\b)/m.test(text)))generated['lib/ir_data.py']=PicoSources.irData;
    if(edited.some(text=>/ir_data\.Receiver\b|^from ir_data import.*\bReceiver\b/m.test(text)))generated['lib/live_receiver.py']=PicoSources.receiver;
    return generated;
  }
  function refresh(){
    try {
      files=fileStore.regenerate(generatedProject());codeValid=true;
      if(!Object.hasOwn(files,activeFile))activeFile='main.py';
      if(!Object.keys(files).some(path=>path===treeSelection||path.startsWith(treeSelection+'/')))treeSelection=activeFile;
      editor.setFile(activeFile,files[activeFile]);renderFiles();renderFileBlocks();renderPicoFiles();saveProject();notify();
    }catch(error){codeValid=false;notify(error.message);}
    highlightBlock();updateDevice();
  }
  function project(){commitFileBlocks();return {format:'pico-blocks-5',name:projectName,pico:device.id,parts,files:{...files},workspace:Blockly.serialization.workspaces.save(workspace),fileWorkspaces:{...fileModels}};}
  function loadWorkspace(state,ask=true,nextParts=parts,nextEdits=fileStore.edits,nextModels=fileModels,projectFiles=null,nextName=projectName){
    if(ask&&dirty&&!confirm('編集中のプロジェクトを置き換えます。保存していない変更は失われます。続けますか？'))return false;
    state=PicoEditor.blocks.upgrade(PicoBlocks.migrateSpeaker(state));
    PicoBlocks.validateParts(nextParts);PicoBlocks.validateWorkspace(state,nextParts);let restoredEdits=StudioFiles.validateEdits(nextEdits);
    const snapshot=projectFiles===null?null:StudioFiles.validateEdits(projectFiles);
    if(snapshot&&['main.py','parts.py','lib/pico_parts.py'].some(path=>!Object.hasOwn(snapshot,path)))throw Error('プロジェクトのファイルが不足しています。');
    if(!nextModels||typeof nextModels!=='object'||Array.isArray(nextModels)||Object.entries(nextModels).some(([path,model])=>!StudioFiles.validPath(path)||typeof model?.source!=='string'||!model.state))throw Error('ファイルのブロック形式が不正です。');
    for(const [path,model] of Object.entries(nextModels)){const check=new Blockly.Workspace();try{Blockly.serialization.workspaces.load(model.version===5?model.state:PicoEditor.blocks.upgrade(model.state,nextParts,path),check);}finally{check.dispose();}}
    const previous=Blockly.serialization.workspaces.save(workspace),oldParts=parts;parts=nextParts;
    generator.addReservedWords(parts.map(p=>p.id).join(','));
    Blockly.Events.disable();
    try {
      Blockly.serialization.workspaces.load(state,workspace);
      if(snapshot){
        const generated=PicoBlocks.generateProject(Blockly,generator,workspace,parts,runtime,PicoSources.ssd1306,null,PicoSources);
        if(Object.keys(generated).some(path=>!Object.hasOwn(snapshot,path)))throw Error('プロジェクトのライブラリが不足しています。');
        restoredEdits=Object.fromEntries(Object.entries(snapshot).filter(([path,text])=>generated[path]!==text));
      }
    }
    catch(error){parts=oldParts;Blockly.serialization.workspaces.load(previous,workspace);throw error;}
    finally {Blockly.Events.enable();}
    projectName=nextName;clearTimeout(fileRefreshTimer);fileWorkspaceDirty=false;fileWorkspacePath=null;fileModels=structuredClone(nextModels);fileStore.restore(restoredEdits);workspace.scrollCenter();selectedId=null;dirty=false;partsDirty=false;renderParts();refresh();return true;
  }
  function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  workspace.addChangeListener(event=>{
    if(event.type===Blockly.Events.SELECTED){selectedId=event.newElementId;highlightBlock();return;}
    if(event.isUiEvent)return;
    dirty=true;clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,60);
  });
  function loadSample(name,ask=true){
    let nextParts=[],state,edits={};
    if(name.startsWith('message_')){const sample=StudioSamples.message(name.slice(8));nextParts=sample.parts;edits=sample.files;state={blocks:{languageVersion:0,blocks:[]}};
    }else if(name.startsWith('beginner_')){const sample=StudioSamples.beginner(name.slice(9));nextParts=sample.parts;edits=sample.files;state={blocks:{languageVersion:0,blocks:[]}};
    }else if(name.startsWith('basic_')){const sample=StudioSamples.basic(name.slice(6));nextParts=sample.parts;edits=sample.files;state={blocks:{languageVersion:0,blocks:[]}};
    }else if(name.startsWith('organized_')){const sample=StudioSamples.organized(name.slice(10));nextParts=sample.parts;edits=sample.files;state={blocks:{languageVersion:0,blocks:[]}};
    }else if(['infrared_raw','infrared_jp','infrared_send','infrared_send_jp'].includes(name)){
      const sample=StudioSamples.infrared(name.endsWith('_jp'),name.includes('_send')?'send':'receive');nextParts=sample.parts;edits=sample.files;state={blocks:{languageVersion:0,blocks:[]}};
    }else if(name==='display'){
      nextParts=PicoBlocks.displayParts();state=PicoBlocks.examples.display();
    }else if(['receive','receive_custom'].includes(name)){
      nextParts=[{id:'receiver',name:'赤外線受信',kind:'receiver',pin:15}];state=PicoBlocks.examples.receive();
      if(name==='receive_custom'){
        edits['decode_signal.py']='def decode_signal(times):\n    bits = []\n    for i in range(2, len(times) - 1, 2):\n        on = times[i]\n        off = times[i + 1]\n        if off >= on * 2:\n            bits.append(1)\n        else:\n            bits.append(0)\n    return bits\n';
        edits['main.py']='from parts import receiver\nfrom decode_signal import decode_signal\nimport ir_data\n\nwhile True:\n    times = receiver.receive(1000)\n    if not times:\n        continue\n    bits = decode_signal(times)\n    print("times us:", times)\n    print("bits:", bits)\n    print("binary:", ir_data.bits_to_text(bits))\n    if bits:\n        print("integer:", ir_data.bits_to_int(bits))\n';
      }
    }else if(name==='modules'){
      state={blocks:{languageVersion:0,blocks:[]}};
      edits={'my_tools.py':'# ブロック: {value} の2倍\ndef twice(value):\n    return value * 2\n\nclass Counter:\n    def __init__(self, value=0):\n        self.value = value\n\n    def add(self, amount):\n        self.value += amount\n        return self.value\n','main.py':'from my_tools import twice, Counter\n\nprint(twice(21))\ncounter = Counter(10)\nprint(counter.add(5))\n'};
    }else{
      state=PicoBlocks.examples[name]();
      if(['pixels','peripherals'].includes(name))nextParts=PicoBlocks.peripheralParts().filter(p=>name!=='pixels'||p.kind==='ssd1306');
      else if(name==='fan')nextParts=[{id:'fan',name:'扇風機',kind:'pwm',pin:20,frequency:25000}];
      else if(['send','bootsel','blink','button','button_send'].includes(name))nextParts=PicoBlocks.defaults().filter(p=>name==='blink'?p.kind==='led':name==='button'?p.kind!=='infrared':['send','bootsel'].includes(name)?p.kind==='infrared':true);
    }
    if(!loadWorkspace(state,ask,nextParts,edits,{},null,$('example').querySelector(`option[value="${name}"]`)?.textContent||name))return false;openFile('main.py');return true;
  }
  function filterSamples(topic){
    for(const group of $('example').querySelectorAll('optgroup'))group.hidden=group.dataset.topic!==topic;
  }
  $('sample-topic').addEventListener('change',()=>{
    const topic=$('sample-topic').value;filterSamples(topic);
    $('example').value=$('example').querySelector(`optgroup[data-topic="${topic}"] option`).value;
  });
  $('example').addEventListener('change',()=>{
    $('sample-topic').value=$('example').selectedOptions[0].parentElement.dataset.topic;
    filterSamples($('sample-topic').value);
  });
  filterSamples($('sample-topic').value);
  function restoreProject(data,ask=true){
    if(data.format==='pico-blocks-1')data=PicoBlocks.migrate(data.workspace);
    if(!['pico-blocks-2','pico-blocks-3','pico-blocks-4','pico-blocks-5'].includes(data.format)||!data.workspace)throw Error('Pico Studioのプロジェクトを選んでください。');
    if(data.format==='pico-blocks-5'&&!data.files)throw Error('プロジェクトのファイルがありません。');
    const restored=loadWorkspace(data.workspace,ask,data.parts,data.edits||{},data.fileWorkspaces||{},data.format==='pico-blocks-5'?data.files:null,typeof data.name==='string'?data.name.slice(0,80):'無題');
    if(restored){PicoDevices.select('program',['1','2'].includes(data.pico)?data.pico:'1');saveProject();}
    return restored;
  }
  $('example-load').addEventListener('click',()=>{try{if(openProject(()=>loadSample($('example').value,false)))$('project-add-dialog').close();}catch(error){notify(error.message);}});
  function showProjectMenu(index,x,y){
    projectMenuIndex=index;const menu=$('project-menu');menu.hidden=false;const rect=menu.getBoundingClientRect();menu.style.left=Math.max(0,Math.min(x,innerWidth-rect.width))+'px';menu.style.top=Math.max(0,Math.min(y,innerHeight-rect.height))+'px';menu.querySelector('button').focus({preventScroll:true});
  }
  function targetMenuProject(action){$('project-menu').hidden=true;if(projectLocked())return;if(projectMenuIndex!==activeProject)switchProject(projectMenuIndex);action();}
  $('project-menu-save').addEventListener('click',()=>targetMenuProject(saveProjectFile));
  $('project-duplicate').addEventListener('click',()=>targetMenuProject(()=>openProjectDialog('duplicate')));
  $('project-menu-close').addEventListener('click',()=>{$('project-menu').hidden=true;closeProject(projectMenuIndex);});
  document.addEventListener('pointerdown',event=>{if(!$('project-menu').contains(event.target))$('project-menu').hidden=true;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')$('project-menu').hidden=true;});
  function saveProjectFile(){const data=project();download(projectName.replace(/[\\/:*?"<>|]/g,'_')+'.json',JSON.stringify(data,null,2),'application/json');openedProjects[activeProject].savedSignature=projectSignature(data);dirty=false;saveProject();}
  $('project-save').addEventListener('click',saveProjectFile);
  function openProjectDialog(mode){projectDialogMode=mode;$('project-dialog-title').textContent=mode==='new'?'新規プロジェクト':mode==='duplicate'?'プロジェクトを複製':'別名でローカルに保存';$('project-apply').textContent=mode==='new'?'作成':mode==='duplicate'?'複製':'保存';$('project-name-input').value=mode==='new'?'無題':mode==='duplicate'?projectName+' のコピー':projectName;$('project-dialog').showModal();$('project-name-input').select();}
  $('project-new').addEventListener('click',()=>{$('project-add-dialog').close();openProjectDialog('new');});
  $('project-save-as').addEventListener('click',()=>targetMenuProject(()=>openProjectDialog('save')));
  $('project-apply').addEventListener('click',()=>{
    const name=$('project-name-input').value.trim();$('project-name-input').value=name;if(!name){$('project-name-input').reportValidity();return;}
    if(projectDialogMode==='new'){
      if(!openProject(()=>{if(!loadWorkspace({blocks:{languageVersion:0,blocks:[]}},false,parts,{'main.py':''},{},null,name))return false;openFile('main.py');return true;}))return;
    }else if(projectDialogMode==='duplicate'){const copy=project();copy.name=name;if(!openProject(()=>restoreProject(copy,false)))return;}else{projectName=name;saveProjectFile();}
    $('project-dialog').close();
  });
  $('project-dialog').querySelector('form').addEventListener('submit',event=>{if(event.submitter?.value!=='cancel'){event.preventDefault();$('project-apply').click();}});
  $('project-load').addEventListener('click',()=>$('project-file').click());
  $('project-file').addEventListener('change',async()=>{
    const file=$('project-file').files[0];if(!file)return;
    try{if(file.size>1048576)throw Error('プロジェクトは1MB以内にしてください。');const data=JSON.parse(await file.text());if(openProject(()=>restoreProject(data,false),true))$('project-add-dialog').close();}
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
    if(value){debugLocked=[...document.querySelectorAll('.project-bar button,.project-bar select,.parts-settings input,.parts-settings select,.parts-settings button,.file-actions button')].map(element=>[element,element.disabled]);for(const [element] of debugLocked)element.disabled=true;}
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
  const panelNames=['program','analyzer','conversion'];
  const panelIds={program:'program-panel',analyzer:'observer-panel',conversion:'conversion-panel'};
  function showPanel(name){
    if(!panelNames.includes(name))return;
    activeRole=name==='program'?'program':'observer';PicoDevices.changed();
    history.replaceState(null,'','#'+name);
    for(const item of panelNames){
      const active=item===name;$(panelIds[item]).hidden=!active;
      $(item+'-tab').setAttribute('aria-selected',String(active));$(item+'-tab').tabIndex=active?0:-1;
    }
    if(name==='analyzer')window.LiveAnalyzer.show();
    else if(name==='conversion')window.SignalConverter?.show();
    else Blockly.svgResize(workspace);
    updateDevice();
  }
  for(const name of panelNames)$(name+'-tab').addEventListener('click',()=>showPanel(name));
  for(const name of panelNames)$(name+'-tab').addEventListener('keydown',event=>{
    if(['ArrowLeft','ArrowRight'].includes(event.key)){
      event.preventDefault();const next=panelNames[(panelNames.indexOf(name)+(event.key==='ArrowLeft'?-1:1)+panelNames.length)%panelNames.length];
      showPanel(next);$(next+'-tab').focus({preventScroll:true});
    }
  });
  new ResizeObserver(()=>Blockly.svgResize(workspace)).observe($('blockly'));
  function renderParts(){
    const body=$('parts-rows');body.replaceChildren();
    $('parts-empty').hidden=parts.length>0;body.closest('table').hidden=parts.length===0;
    const names={button:'デジタル入力',led:'デジタル出力',infrared:'赤外線LED',speaker:'圧電スピーカー',ssd1306:'SSD1306',dip:'8連DIPスイッチ',pwm:'PWM出力',receiver:'赤外線センサー',rgb:'フルカラーLED'};
    for(const part of parts){
      const partLabel=PicoBlocks.variableFor(part);
      const row=document.createElement('tr');row.dataset.id=part.id;row.dataset.kind=part.kind;
      const name=document.createElement('input');name.value=partLabel;name.maxLength=40;name.setAttribute('aria-label',partLabel+' の変数名');name.dataset.field='name';
      const connection=document.createElement('div');connection.className='part-connections';
      function number(parent,label,field,value,min,max){const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement('input');input.type='number';input.min=min;if(max!==undefined)input.max=max;input.value=value;input.dataset.field=field;input.setAttribute('aria-label',partLabel+' '+label);wrap.append(input);parent.append(wrap);return input;}
      if(part.kind==='ssd1306'){number(connection,'SDA','sda',part.sda,0,22);number(connection,'SCL','scl',part.scl,0,22);}
      else if(part.kind==='rgb')for(const [label,field] of [['R','red'],['G','green'],['B','blue']])number(connection,label,field,part[field],0,22);
      else if(part.kind==='dip')part.pins.forEach((pin,i)=>number(connection,String(i+1),'pin'+i,pin,0,22));
      else number(connection,'GP','pin',part.pin,0,22);
      const settings=document.createElement('div');settings.className='part-options';
      if(['pwm','rgb'].includes(part.kind))number(settings,'Hz','frequency',part.frequency,1);
      if(part.kind==='rgb'){
        const wrap=document.createElement('label');wrap.textContent='共通端子';const select=document.createElement('select');select.dataset.field='common_anode';select.setAttribute('aria-label',partLabel+' 共通端子');
        for(const [value,label] of [['0','GND（カソード）'],['1','3.3V（アノード）']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}select.value=part.common_anode?'1':'0';wrap.append(select);settings.append(wrap);
      }
      if(part.kind==='infrared')number(settings,'µs','unit',part.unit,100,100000);
      if(part.kind==='ssd1306'){
        for(const [field,label,options] of [['height','画面',[[32,'128 × 32'],[64,'128 × 64']]],['address','アドレス',[[60,'0x3C'],[61,'0x3D']]]]){const wrap=document.createElement('label');wrap.textContent=label;const select=document.createElement('select');select.dataset.field=field;select.setAttribute('aria-label',partLabel+' '+label);for(const [value,text] of options){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}select.value=part[field];wrap.append(select);settings.append(wrap);}
      }
      if(part.kind==='dip'){const hint=document.createElement('span');hint.className='hint';hint.textContent='ONでGND・1が最下位ビット';settings.append(hint);}
      const remove=document.createElement('button');remove.textContent='削除';remove.className='secondary';remove.setAttribute('aria-label',partLabel+' を削除');remove.addEventListener('click',()=>{row.remove();markPartsDirty();});
      for(const item of [name,names[part.kind],connection,settings,remove]){const cell=document.createElement('td');if(typeof item==='string')cell.textContent=item;else cell.append(item);row.append(cell);}body.append(row);
    }
  }
  function markPartsDirty(){partsDirty=true;dirty=true;$('parts-empty').hidden=$('parts-rows').childElementCount>0;$('parts-rows').closest('table').hidden=$('parts-rows').childElementCount===0;updateDevice();}
  $('parts-rows').addEventListener('input',markPartsDirty);
  $('parts-rows').addEventListener('change',markPartsDirty);
  function draftParts(){return Array.from($('parts-rows').children,row=>{
    const value=field=>{const input=row.querySelector('[data-field='+field+']');return input.value===''?NaN:Number(input.value);};
    const previous=parts.find(p=>p.id===row.dataset.id);
    const variable=row.querySelector('[data-field=name]').value.trim().normalize('NFKC');
    const part={id:row.dataset.id,kind:row.dataset.kind,name:variable,variable,aliases:[...new Set([...(previous?.aliases||[]),...(previous?[PicoBlocks.variableFor(previous)]:[])])].filter(alias=>alias!==variable)};
    if(part.kind==='ssd1306')Object.assign(part,{sda:value('sda'),scl:value('scl'),width:128,height:value('height'),address:value('address')});
    else if(part.kind==='rgb')Object.assign(part,{red:value('red'),green:value('green'),blue:value('blue'),common_anode:value('common_anode')===1,frequency:value('frequency')});
    else if(part.kind==='dip')part.pins=Array.from({length:8},(_,i)=>value('pin'+i));
    else{part.pin=value('pin');if(part.kind==='infrared')part.unit=value('unit');if(part.kind==='pwm')part.frequency=value('frequency');}
    return part;
  });}
  $('part-add').addEventListener('click',()=>{
    const draft=draftParts(),kind=$('new-part-kind').value,used=draft.flatMap(PicoBlocks.pinsFor);
    const channels=draft.flatMap(p=>p.kind==='rgb'?PicoBlocks.pinsFor(p).map(pin=>({...p,pin})):['speaker','infrared','pwm'].includes(p.kind)?[p]:[]);
    const free=[];
    for(let pin=0;pin<=22;pin++){
      if(used.includes(pin))continue;
      if(['speaker','infrared','pwm','rgb'].includes(kind)&&channels.some(p=>(p.pin>>1)%8===(pin>>1)%8&&(kind==='speaker'||p.kind==='speaker'||p.pin%16===pin%16||(p.kind==='infrared'?38000:p.frequency)!==(kind==='infrared'?38000:1000))))continue;
      if(kind==='rgb'&&free.some(other=>other%16===pin%16))continue;
      free.push(pin);
    }
    const count=kind==='dip'?8:kind==='ssd1306'?2:kind==='rgb'?3:1;
    if(free.length<count){notify('必要なGPIOが足りません。部品設定を確認してください。');return;}
    let n=1;while(draft.some(p=>p.id===`${kind}_${n}`)||parts.some(p=>p.id===`${kind}_${n}`))n++;
    const names={led:'デジタル出力',button:'デジタル入力',infrared:'赤外線LED',speaker:'スピーカー',ssd1306:'画面',dip:'DIPスイッチ',pwm:'PWM出力',receiver:'赤外線センサー',rgb:'フルカラーLED'};
    const part={id:`${kind}_${n}`,name:`${names[kind]}${n}`,variable:`${names[kind]}${n}`,kind};
    if(kind==='ssd1306')Object.assign(part,{sda:used.includes(3)||used.includes(4)?free[0]:4,scl:used.includes(3)||used.includes(4)?free[1]:3,width:128,height:64,address:60});
    else if(kind==='rgb')Object.assign(part,{red:free[0],green:free[1],blue:free[2],common_anode:false,frequency:1000});
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
      const renamed=next.some(p=>{const previous=parts.find(old=>old.id===p.id);return previous&&PicoBlocks.variableFor(previous)!==PicoBlocks.variableFor(p);});
      loadWorkspace(state,false,next,edits);dirty=true;
      if(renamed&&fileWorkspacePath&&fileWorkspace.getAllBlocks(false).some(block=>block.getField('PART'))){fileWorkspaceDirty=true;commitFileBlocks();}
    }catch(error){notify(error.message);}
  });
  function renderConsole(){const id=PicoDevices.entry(activeRole).id,text=consoleBuffers.get(id)||'—',output=$('output');if(output.dataset.pico!==id){$('console-input').value='';output.dataset.pico=id;}if(output.textContent!==text){output.textContent=text;output.scrollTop=output.scrollHeight;}}
  function consoleAppend(text,id=device.id){const previous=consoleBuffers.get(id)??((PicoDevices.entry(activeRole).id===id&&$('output').textContent!=='—')?$('output').textContent:'');consoleBuffers.set(id,(previous+text).slice(-8192));renderConsole();}
  async function submitConsole(){
    const entry=PicoDevices.entry(activeRole),target=entry.link;const input=$('console-input'),source=input.value;if(input.disabled||!source.trim()&&!target.running)return;
    const running=target.running;
    try{
      if(running)await target.sendInput(source);
      else{consoleHistory.push(source);consoleHistoryIndex=consoleHistory.length;consoleDraft='';}
      consoleAppend((running?'':'>>> ')+source.replace(/\n/g,'\n... ')+'\n',entry.id);input.value='';input.style.height='';notify();
      if(!running){entry.task='program';await target.repl(source);}
    }catch(error){consoleAppend(error.message+'\n',entry.id);}
    updateDevice();
  }
  $('console-input').addEventListener('keydown',async event=>{
    if(event.isComposing)return;
    const consoleEntry=PicoDevices.entry(activeRole),consoleLink=consoleEntry.link;
    if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();await submitConsole();}
    else if(event.ctrlKey&&event.key.toLowerCase()==='c'&&event.target.selectionStart===event.target.selectionEnd){event.preventDefault();if(consoleLink.running&&consoleEntry.task==='program'){if(consoleEntry.id===device.id)await stopProgram();else await consoleLink.stop();}else event.target.value='';updateDevice();}
    else if(!consoleLink.running&&!event.target.value.includes('\n')&&['ArrowUp','ArrowDown'].includes(event.key)){
      event.preventDefault();if(consoleHistoryIndex===consoleHistory.length)consoleDraft=event.target.value;
      consoleHistoryIndex=Math.max(0,Math.min(consoleHistory.length,consoleHistoryIndex+(event.key==='ArrowUp'?-1:1)));event.target.value=consoleHistoryIndex===consoleHistory.length?consoleDraft:consoleHistory[consoleHistoryIndex];
    }
  });
  $('console-input').addEventListener('input',event=>{event.target.style.height='auto';event.target.style.height=Math.min(event.target.scrollHeight,100)+'px';});
  $('terminal-surface').addEventListener('click',event=>{if(event.target.id!=='console-input'&&!window.getSelection()?.toString())$('console-input').focus({preventScroll:true});});
  window.addEventListener('beforeunload',event=>{commitFileBlocks();if(dirty||openedProjects.some(entry=>entry.dirty)){event.preventDefault();event.returnValue='';}});
  switchingProjects=true;
  try {
    const tabs=JSON.parse(localStorage.getItem('pico-studio-tabs-1')||'null');
    if(tabs&&Array.isArray(tabs.projects)&&tabs.projects.length&&Number.isInteger(tabs.active)&&tabs.projects[tabs.active]?.data){lastClosedProject=tabs.closed||null;openedProjects=tabs.projects.map(entry=>Object.hasOwn(entry,'savedSignature')?entry:{...entry,savedSignature:null,dirty:true});activeProject=tabs.active;restoreProject(openedProjects[activeProject].data,false);dirty=Boolean(openedProjects[activeProject].dirty);openFile(Object.hasOwn(files,openedProjects[activeProject].file)?openedProjects[activeProject].file:'main.py');}
    else{const saved=localStorage.getItem('pico-blocks-project-2'),legacy=localStorage.getItem('pico-blocks-workspace-1');if(saved||legacy)restoreProject(saved?JSON.parse(saved):PicoBlocks.migrate(JSON.parse(legacy)),false);else{loadSample('beginner_zero32',false);projectName='無題';dirty=true;}}
  }catch(error){openedProjects=[];activeProject=0;loadSample('beginner_zero32',false);projectName='無題';notify('保存されていた内容を読み込めませんでした。保存ファイルから開いてください。');}
  if(projectName==='無題'){
    const compact=(files['main.py']||'').replace(/\s/g,'');
    const infrared=parts.find(part=>part.kind==='infrared'&&(compact===`frompartsimport${part.id}${part.id}.send(65)`||compact===StudioSamples.beginner('continuous').files['main.py'].replace(/\binfrared\b/g,part.id).replace(/\s/g,'')));
    if(infrared){
      if(!/def send_bits\s*\(\s*self\s*,\s*bits\s*,\s*leader\s*=/.test(files['lib/pico_parts.py']||'')){
        let previous='lib/pico_parts_previous.py',number=2;while(Object.hasOwn(files,previous))previous=`lib/pico_parts_previous_${number++}.py`;
        fileStore.edit(previous,files['lib/pico_parts.py']);fileStore.edit('lib/pico_parts.py',PicoSources.parts);delete fileModels['lib/pico_parts.py'];
      }
      fileStore.edit('main.py',StudioSamples.beginner('zero32').files['main.py'].replace(/\binfrared\b/g,infrared.id));
      delete fileModels['main.py'];fileWorkspacePath=null;fileWorkspaceDirty=false;activeFile='main.py';refresh();dirty=true;
    }
  }
  switchingProjects=false;saveProject();
  updateDevice();
  if(['#analyzer','#conversion'].includes(location.hash))showPanel(location.hash.slice(1));
})();
