import {catalog,inspect,headerInfo,sentenceParts} from './python-symbols.mjs';
const icon=(symbol)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><rect width="18" height="18" rx="4" fill="white" fill-opacity=".85"/><text x="9" y="13" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#544366">${symbol}</text></svg>`);
export function installBlockUI(B,g,{getFiles=()=>({}),getPath=()=> 'main.py',editFunction=()=>{},showHelp=()=>{}}={}){
 let cachedFiles,cachedPath,cachedFunctions;
 const functions=()=>{const files=getFiles(),path=getPath();if(files!==cachedFiles||path!==cachedPath){cachedFiles=files;cachedPath=path;cachedFunctions=catalog(files,path);}return cachedFunctions;};
 function button(symbol,label,callback){const field=new B.FieldImage(icon(symbol),18,18,label,callback);field.setTooltip?.(label);return field;}
 function mutate(block,change){const before=JSON.stringify(block.saveExtraState?.()||{}),group=B.Events.getGroup();B.Events.setGroup(group||true);try{change();B.Events.fire(new B.Events.BlockChange(block,'mutation',null,before,JSON.stringify(block.saveExtraState?.()||{})));}finally{B.Events.setGroup(group||false);}}
 for(const type of ['pico_call','pico_call_value'])B.Blocks[type]={
  init(){
   const block=this;
   const picker=new B.FieldDropdown(()=>[['ƒ','__choose'],...functions().filter(fn=>type==='pico_call'||fn.returns).map(fn=>[`${fn.group} · ${fn.name||fn.target}`,fn.target])],target=>{if(target!=='__choose'){const fn=functions().find(fn=>fn.target===target);if(fn)block.chooseFunction(fn);}return null;});
   this.appendDummyInput('TARGET').appendField(picker,'FUNCTION').appendField(new B.FieldTextInput('my_function'),'TARGET');
   this.argumentCount=0;this.argumentNames=[];this.callSentence='';this.importModule='';this.setColour(290);if(type==='pico_call_value')this.setOutput(true);else{this.setPreviousStatement(true);this.setNextStatement(true);}this.setInputsInline(true);this.updateArguments(0);
   this.setTooltip(()=>{const fn=functions().find(fn=>fn.target===this.getFieldValue('TARGET'));return fn?`${fn.help}\n${fn.returns?'値を返します。':'値を返さない関数です。'}`:this.getFieldValue('TARGET')+' を呼び出します。';});
  },
  saveExtraState(){return {argumentCount:this.argumentCount,argumentNames:this.argumentNames,sentence:this.callSentence,module:this.importModule};},
  loadExtraState(state){this.argumentNames=state.argumentNames||[];this.callSentence=state.sentence||'';this.importModule=state.module||'';this.updateArguments(state.argumentCount||0);},
  updateArguments(count){
   if(this.getInput('END'))this.removeInput('END');
   while(this.argumentCount>count){this.removeInput('ARG'+--this.argumentCount);}
   while(this.argumentCount<count)this.appendValueInput('ARG'+this.argumentCount++);
   const phrase=this.callSentence&&sentenceParts(this.callSentence,this.argumentNames),use=phrase&&this.argumentCount===this.argumentNames.length;
   this.getField('TARGET').setVisible(!use);
   for(let i=0;i<count;i++){const input=this.getInput('ARG'+i);input.removeField('LABEL'+i,true);input.appendField(new B.FieldLabel(use?phrase[i]:(i?',':'(')),'LABEL'+i);}
   const end=this.appendDummyInput('END');end.appendField(use?phrase.at(-1):(count?')':'()')+(type==='pico_call_value'?' を呼び出した結果':' を呼び出す'));
   end.appendField(button('+','引数を追加',()=>mutate(this,()=>this.updateArguments(this.argumentCount+1))),'ADD');
   end.appendField(button('−','最後の引数を外す',()=>{if(this.argumentCount)mutate(this,()=>this.updateArguments(this.argumentCount-1));}),'REMOVE');
   end.appendField(button('?','関数の説明',()=>{const fn=functions().find(fn=>fn.target===this.getFieldValue('TARGET'));showHelp(fn||{target:this.getFieldValue('TARGET'),help:'関数名を直接編集するか、一覧から選べます。'});}), 'HELP');
  },
  chooseFunction(fn){mutate(this,()=>{this.setFieldValue(fn.target,'TARGET');this.argumentNames=fn.params;this.callSentence=fn.sentence||'';this.importModule=fn.module||'';this.updateArguments(fn.params.length);});},
  setSentenceFrom(fn){if(this.callSentence===(fn?.sentence||'')&&JSON.stringify(this.argumentNames)===JSON.stringify(fn?.params||[]))return;B.Events.disable();try{this.callSentence=fn?.sentence||'';this.argumentNames=fn?.params||[];this.updateArguments(this.argumentCount);}finally{B.Events.enable();}}
 };
 for(const type of ['pico_call','pico_call_value'])g.forBlock[type]=(block,g)=>{
  if(block.importModule)g.definitions_['import_'+block.importModule]='import '+block.importModule;
  const args=Array.from({length:block.argumentCount},(_,i)=>g.valueToCode(block,'ARG'+i,g.ORDER_NONE)||'None');const code=block.getFieldValue('TARGET')+'('+args.join(', ')+')';return type==='pico_call_value'?[code,g.ORDER_FUNCTION_CALL]:code+'\n';
 };
 const list=B.Blocks.lists_create_with;
 if(!list.picoListInit){
  list.updateShape_=function(){
   if(this.getInput('EMPTY'))this.removeInput('EMPTY');
   if(!this.getInput('OPEN'))this.appendDummyInput('OPEN').appendField('[');
   if(!this.getInput('OPEN_ROW'))this.appendEndRowInput('OPEN_ROW');
   for(let i=0;i<this.itemCount_;i++){
    if(!this.getInput('ADD'+i))this.appendValueInput('ADD'+i);
    if(!this.getInput('COMMA'+i))this.appendDummyInput('COMMA'+i).appendField('', 'SEPARATOR'+i);
    this.setFieldValue(i<this.itemCount_-1?',':'','SEPARATOR'+i);
    if(!this.getInput('ROW'+i))this.appendEndRowInput('ROW'+i);
   }
   for(let i=this.itemCount_;this.getInput('ADD'+i);i++)for(const prefix of ['ADD','COMMA','ROW'])this.removeInput(prefix+i);
   if(!this.getInput('CLOSE'))this.appendDummyInput('CLOSE').appendField(']');
   const order=['OPEN','OPEN_ROW',...Array.from({length:this.itemCount_},(_,i)=>['ADD'+i,'COMMA'+i,'ROW'+i]).flat(),'CLOSE'];
   if(this.getInput('PICO_ITEMS'))order.push('PICO_ITEMS');
   for(const name of order)this.moveInputBefore(name,null);
   this.getInput('OPEN_ROW').setVisible(this.itemCount_>0);
   this.setInputsInline(true);
  };
  list.picoListInit=list.init;list.init=function(){list.picoListInit.call(this);this.setMutator(null);const input=this.appendDummyInput('PICO_ITEMS');input.appendField(button('+','リストの項目を追加',()=>mutate(this,()=>{this.itemCount_++;this.updateShape_();})));input.appendField(button('−','最後の項目を外す',()=>{if(this.itemCount_)mutate(this,()=>{this.itemCount_--;this.updateShape_();});}));};}
 const def=B.Blocks.pico_def,init=def.init,save=def.saveExtraState,load=def.loadExtraState;
 def.init=function(){init.call(this);this.pythonSentence='';this.inputList[0].appendField(button('+','関数の引数を追加',()=>{const header=this.getFieldValue('HEADER'),info=headerInfo(header);if(!info)return;let i=1;while(info.params.includes('arg'+i))i++;const inside=header.slice(info.from+1,info.to-1);if(inside.includes('**')){this.setWarningText('**引数のある定義は、関数名の欄で編集してください。','signature');return;}this.setFieldValue(header.slice(0,info.to-1)+(info.params.length?', ':'')+'arg'+i+(inside.includes('=')?'=None':'')+header.slice(info.to-1),'HEADER');}));};
 def.saveExtraState=function(){return {...save.call(this),sentence:this.pythonSentence||''};};
 def.loadExtraState=function(state){this.pythonSentence=state.sentence||'';load.call(this,state);};
 def.setSentence=function(sentence){const info=headerInfo(this.getFieldValue('HEADER'));if(!info||sentence&&!sentenceParts(sentence,info.params))throw Error('引数を定義順に {引数名} として1回ずつ含めてください。');mutate(this,()=>{this.pythonSentence=sentence;});};
 def.customContextMenu=function(options){options.push({text:'ブロックの文章…',enabled:true,callback:()=>editFunction(this)});};
 function diagnose(workspace,source){
  const analysis=inspect(source),all=functions();B.Events.disable();
  try{for(const block of workspace.getAllBlocks(false)){
   let message='';const root=block.getRootBlock(),active=['pico_start','pico_module'].includes(root.type)&&block.isEnabled()&&!block.getInheritedDisabled();
   if(active&&block.type==='variables_get'){const variable=block.getField('VAR')?.getVariable()?.name;if(variable&&!analysis.declared.has(variable))message=`「${variable}」が定義されていません。`;}
   if(['pico_call','pico_call_value'].includes(block.type)){
    const target=block.getFieldValue('TARGET'),fn=all.find(fn=>fn.target===target);block.setSentenceFrom(fn);
    if(active){if(/^[\p{L}_][\p{L}\p{N}_]*$/u.test(target)&&!analysis.declared.has(target))message=`関数「${target}」が見つかりません。`;
     if(fn){const required=fn.required??(['print','input','int','float','str','list'].includes(fn.target)?0:fn.params.length);if(block.argumentCount<required)message=`引数が不足しています（${required}個以上）。`;if(fn.required!==undefined&&!fn.variadic&&block.argumentCount>fn.params.length)message=`引数が多すぎます（${fn.params.length}個まで）。`;}
     for(let i=0;i<block.argumentCount;i++)if(!block.getInputTargetBlock('ARG'+i))message='接続されていない引数があります。';
    }
   }
   if(block.type==='pico_def'&&!headerInfo(block.getFieldValue('HEADER')))message='関数定義の構文を確認してください。';
   if(block.picoDiagnostic!==message){block.picoDiagnostic=message;block.setWarningText(message||null,'python');block.getSvgRoot?.()?.classList.toggle('pico-block-error',Boolean(message));}
  }}finally{B.Events.enable();}
  return analysis.issues;
 }
 return {diagnose};
}
