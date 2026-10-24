import {nativeStatement,friendlyCall} from './python-native.mjs';
import {installBlockUI} from './python-block-ui.mjs';
import {parser} from '@lezer/python';

function hasError(tree){let bad=false;tree.iterate({enter(node){if(node.type.isError)bad=true;}});return bad;}
function indentSource(source,indent,remove=false){
  const strings=[];parser.parse(source).iterate({enter(node){if(['String','FormatString'].includes(node.name))strings.push([node.from,node.to]);}});
  let offset=0;
  return source.split(/(?<=\n)/).map(line=>{
    const inside=strings.some(([from,to])=>offset>from&&offset<to);offset+=line.length;
    if(inside)return line;
    return remove?(line.startsWith(indent)?line.slice(indent.length):line):(line.trim()?indent+line:line);
  }).join('');
}
function raw(code){return {type:'pico_python',extraState:{code}};}
function chain(blocks){let first=null,last=null;for(const block of blocks){if(last)last.next={block};else first=block;last=block;}return first;}
function importState(text){
  let match=text.match(/^import\s+([^\s,]+)(?:\s+as\s+(\S+))?$/);
  if(match)return {type:match[2]?'pico_import_as':'pico_import',fields:{MODULE:match[1],...(match[2]?{ALIAS:match[2]}:{})}};
  match=text.match(/^from\s+(\S+)\s+import\s+(.+)$/);
  return match?{type:'pico_from_import',fields:{MODULE:match[1],NAMES:match[2]}}:null;
}
function importCode(block){
  const module=block.getFieldValue('MODULE');
  if(block.type==='pico_from_import')return `from ${module} import ${block.getFieldValue('NAMES')}`;
  return `import ${module}`+(block.type==='pico_import_as'?` as ${block.getFieldValue('ALIAS')}`:'');
}
function parse(source,parts=null){
  const tree=parser.parse(source);
  if(hasError(tree))return source.trim()?[raw(source)]:[];
  const blocks=[];let end=0,pending='';
  function append(block){if(pending){block.extraState={...block.extraState,before:pending};pending='';}blocks.push(block);}
  function appendRaw(code){
    if(!code)return;
    if(!code.trim()){const last=blocks.at(-1),newline=code.match(/^\r?\n/)?.[0];if(last?.type==='pico_python'&&newline&&!last.extraState.code.endsWith('\n')){last.extraState.code+=newline;code=code.slice(newline.length);}pending+=code;return;}
    const last=blocks.at(-1);
    if(last?.type==='pico_python'&&!/[\r\n]$/.test(last.extraState.code)&&!/[\r\n]/.test(pending)) {last.extraState.code+=pending+code;pending='';}
    else append(raw(code));
  }
  for(let node=tree.topNode.firstChild;node;node=node.nextSibling){
    appendRaw(source.slice(end,node.from));
    const text=source.slice(node.from,node.to),body=node.getChild('Body');
    function bodyBlock(body){
      const content=source.slice(body.from+1,body.to),newline=content.match(/^([^\S\r\n]*\r?\n)([ \t]+)/);
      return newline?chain(parse(indentSource(content.slice(newline[1].length),newline[2],true),parts)):null;
    }
    const native=parts?nativeStatement(node,source,parts,bodyBlock):null;
    const imported=node.name==='ImportStatement'&&!text.includes('\n')?importState(text):null;
    if(native){append(native);end=node.to;continue;}
    if(imported&&(node.to===source.length||/^[\r\n]/.test(source.slice(node.to)))){
      const eol=source.slice(node.to).match(/^\r?\n/)?.[0]||'';
      append({...imported,extraState:{eol,importCode:text,importFields:imported.fields}});
      end=node.to+eol.length;continue;
    }
    else if(['ClassDefinition','FunctionDefinition'].includes(node.name)&&body){
      const match=source.slice(node.from,body.from).match(/^(class|def) ([^\r\n]+)$/);
      const content=source.slice(body.from+1,node.to),newline=content.match(/^([^\S\r\n]*\r?\n)([ \t]+)/);
      if(match&&newline){
        const indent=newline[2],bodySource=indentSource(content.slice(newline[1].length),indent,true);
        const children=chain(parse(bodySource,parts));
        let sentence='';const marker=blocks.at(-1);if(match[1]==='def'&&marker?.type==='pico_python'){const found=marker.extraState.code.trim().match(/^# ブロック:\s*(.+)$/);if(found){sentence=found[1];blocks.pop();pending=(marker.extraState.before||'')+pending;}}
        append({type:match[1]==='class'?'pico_class':'pico_def',fields:{HEADER:match[2]},extraState:{original:text,header:match[2],body:bodySource,indent,sentence},...(children?{inputs:{DO:{block:children}}}:{})});
      }else appendRaw(text);
    }else appendRaw(text);
    end=node.to;
  }
  appendRaw(source.slice(end));
  if(pending&&blocks.length)blocks.at(-1).extraState={...blocks.at(-1).extraState,after:pending};
  return blocks;
}
function positionRoots(blocks){
  let y=24;
  function count(block){let n=1;for(const input of Object.values(block.inputs||{})){let child=input.block;while(child){n+=count(child);child=child.next?.block;}}return n;}
  for(const block of blocks){block.x=24;block.y=y;y+=48*count(block)+32;}
  return blocks;
}
function fileRoot(first,path){return {type:path==='main.py'?'pico_start':'pico_module',data:'pico-source-root',...(first?{inputs:{DO:{block:first}}}:{})};}
export function fromSource(source,parts=null,path='main.py'){return {blocks:{languageVersion:0,blocks:positionRoots([fileRoot(chain(parse(source,parts)),path)])}};}
export function upgrade(state,parts=null,path='main.py'){
  const copy=structuredClone(state);
  function clean(first){
    const result=[];let gap='';
    for(let block=first;block;){
      const next=block.next?.block;delete block.next;if(block.data==='pico-source-root')delete block.data;
      for(const input of Object.values(block.inputs||{}))if(input.block)input.block=chain(clean(input.block));
      if(parts&&block.type==='pico_expression'){
        const source='__value = '+(block.fields?.CODE||''),tree=parser.parse(source);
        if(!hasError(tree)){const statement=nativeStatement(tree.topNode.firstChild,source,parts,()=>null),value=statement?.inputs?.VALUE?.block;if(value&&value.type!=='pico_expression')block={...block,...value};}
      }
      if(block.type==='pico_call_value'){
        const args=Array.from({length:block.extraState?.argumentCount||0},(_,i)=>block.inputs?.['ARG'+i]?.block);
        const friendly=args.every(Boolean)?friendlyCall(block.fields?.TARGET,args):null;
        if(friendly)block={...block,...friendly,extraState:{before:block.extraState?.before||'',after:block.extraState?.after||''}};
      }
      if(block.type==='pico_python'&&!block.extraState?.code?.trim()){gap+=(block.extraState?.before||'')+(block.extraState?.code||'')+(block.extraState?.after||'');block=next;continue;}
      if(block.type==='pico_import'&&Object.hasOwn(block.fields||{},'CODE')){
        const code=block.fields.CODE,imported=importState(code);
        if(imported){block.type=imported.type;block.fields=imported.fields;block.extraState={...block.extraState,importCode:code,importFields:imported.fields};}
        else{block.type='pico_python';delete block.fields;block.extraState={...block.extraState,code:code+(block.extraState?.eol??'\n')};}
      }
      if(parts&&block.type==='pico_python'&&block.extraState?.code?.trim()){
        if(gap){block.extraState.before=gap+(block.extraState.before||'');gap='';}
        const parsed=parse(block.extraState.code,parts);
        if(parsed.length){for(const item of parsed){if(block.disabledReasons)item.disabledReasons=[...block.disabledReasons];}parsed[0].extraState={...parsed[0].extraState,before:(block.extraState.before||'')+(parsed[0].extraState?.before||'')};parsed.at(-1).extraState={...parsed.at(-1).extraState,after:(parsed.at(-1).extraState?.after||'')+(block.extraState.after||'')};result.push(...parsed);block=next;continue;}
      }
      if(gap){block.extraState={...block.extraState,before:gap+(block.extraState?.before||'')};gap='';}
      result.push(block);block=next;
    }
    if(gap&&result.length)result.at(-1).extraState={...result.at(-1).extraState,after:(result.at(-1).extraState?.after||'')+gap};
    return result;
  }
  const roots=[];
  for(const root of copy.blocks?.blocks||[]){
    if(root.disabledReasons?.includes('PICO_UNCONNECTED'))root.disabledReasons=[...new Set([...root.disabledReasons,'MANUALLY_DISABLED'])];
    if(['pico_module','pico_start'].includes(root.type)){const body=clean(root.inputs?.DO?.block);for(const block of body){delete block.x;delete block.y;const reasons=(root.disabledReasons||[]).filter(reason=>reason!=='PICO_UNCONNECTED');if(reasons.length)block.disabledReasons=[...new Set([...(block.disabledReasons||[]),...reasons])];}roots.push(...body);}
    else{const list=clean(root);if(list.length)roots.push(chain(list));}
  }
  if(copy.blocks)copy.blocks.blocks=positionRoots([fileRoot(chain(roots),path)]);
  return copy;
}
export function layout(workspace){
  let y=24;
  for(const block of workspace.getTopBlocks(true)){
    if(!block.getHeightWidth)continue;
    const point=block.getRelativeToSurfaceXY();block.moveBy(24-point.x,y-point.y);y+=block.getHeightWidth().height+24;
  }
}
const rootTypes=['pico_module','pico_start'];
export function configure(B,g,editRaw,options={}){
  B.Blocks.logic_null={init(){this.jsonInit({message0:'None',output:null,colour:210,tooltip:'値がないことを表します。'});}};
  B.defineBlocksWithJsonArray([
    {type:'pico_module',message0:'読み込まれたとき %1 %2',args0:[{type:'input_dummy'},{type:'input_statement',name:'DO'}],colour:45},
    {type:'pico_import',message0:'%1 を読み込む',args0:[{type:'field_input',name:'MODULE',text:'time'}],previousStatement:null,nextStatement:null,colour:165},
    {type:'pico_from_import',message0:'%1 から %2 を読み込む',args0:[{type:'field_input',name:'MODULE',text:'my_tools'},{type:'field_input',name:'NAMES',text:'Counter, twice'}],previousStatement:null,nextStatement:null,colour:165},
    {type:'pico_import_as',message0:'%1 を %2 という名前で読み込む',args0:[{type:'field_input',name:'MODULE',text:'time'},{type:'field_input',name:'ALIAS',text:'clock'}],previousStatement:null,nextStatement:null,colour:165},
    {type:'pico_class',message0:'クラス %1 を定義 %2 %3',args0:[{type:'field_input',name:'HEADER',text:'MyClass'},{type:'input_dummy'},{type:'input_statement',name:'DO'}],previousStatement:null,nextStatement:null,colour:215},
    {type:'pico_def',message0:'関数 %1 を定義 %2 %3',args0:[{type:'field_input',name:'HEADER',text:'my_function()'},{type:'input_dummy'},{type:'input_statement',name:'DO'}],previousStatement:null,nextStatement:null,colour:290}
  ]);
  B.defineBlocksWithJsonArray([
    {type:'pico_expression',message0:'%1',args0:[{type:'field_input',name:'CODE',text:'value'}],output:null,colour:210},
    {type:'pico_return',message0:'%1 を返す',args0:[{type:'input_value',name:'VALUE'}],previousStatement:null,nextStatement:null,colour:290},
    {type:'pico_flow',message0:'%1',args0:[{type:'field_dropdown',name:'CODE',options:[['次の繰り返しへ','continue'],['繰り返しを抜ける','break'],['何もしない','pass']]}],previousStatement:null,nextStatement:null,colour:120}
  ]);
  for(const type of ['pico_call','pico_call_value'])B.Blocks[type]={
    init(){this.appendDummyInput('TARGET').appendField(new B.FieldTextInput('my_function'),'TARGET');this.argumentCount=0;this.setColour(290);if(type==='pico_call_value')this.setOutput(true);else{this.setPreviousStatement(true);this.setNextStatement(true);}this.setInputsInline(true);},
    saveExtraState(){return {argumentCount:this.argumentCount};},
    loadExtraState(state){for(let i=0;i<this.argumentCount;i++)this.removeInput('ARG'+i);this.argumentCount=state.argumentCount||0;for(let i=0;i<this.argumentCount;i++)this.appendValueInput('ARG'+i).appendField(i?',':'(');if(this.getInput('END'))this.removeInput('END');this.appendDummyInput('END').appendField((this.argumentCount?')':'()')+(type==='pico_call_value'?' を呼び出した結果':' を呼び出す'));}
  };
  g.forBlock.pico_expression=block=>[block.getFieldValue('CODE'),g.ORDER_NONE];
  for(const type of ['pico_call','pico_call_value'])g.forBlock[type]=(block,g)=>{const args=Array.from({length:block.argumentCount},(_,i)=>g.valueToCode(block,'ARG'+i,g.ORDER_NONE)||'None');const code=block.getFieldValue('TARGET')+'('+args.join(', ')+')';return type==='pico_call_value'?[code,g.ORDER_FUNCTION_CALL]:code+'\n';};
  g.forBlock.pico_return=(block,g)=>'return'+(block.getInputTargetBlock('VALUE')?' '+g.valueToCode(block,'VALUE',g.ORDER_NONE):'')+'\n';
  g.forBlock.pico_flow=block=>block.getFieldValue('CODE')+'\n';
  B.Blocks.pico_python={
    init(){this.appendDummyInput().appendField(new B.FieldLabelSerializable('pass'),'LABEL');this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(210);this.pythonCode='pass\n';},
    saveExtraState(){return {code:this.pythonCode};},
    loadExtraState(state){if(typeof state.code!=='string')throw Error('Pythonブロックの内容が不正です。');this.pythonCode=state.code;const lines=state.code.split('\n').filter(line=>line.trim());this.setFieldValue(lines[0]?.slice(0,100)||'空行','LABEL');for(const row of [...this.inputList].slice(1))this.removeInput(row.name);for(const [i,line] of lines.slice(1,8).entries())this.appendDummyInput('RAW'+i).appendField(line.slice(0,100));if(lines.length>8)this.appendDummyInput('MORE').appendField('…');this.setTooltip(state.code);},
    setCode(code){const before=JSON.stringify(this.saveExtraState());B.Events.disable();try{this.loadExtraState({...this.saveExtraState(),code});}finally{B.Events.enable();}B.Events.fire(new B.Events.BlockChange(this,'mutation',null,before,JSON.stringify(this.saveExtraState())));},
    customContextMenu(options){options.push({text:'Pythonを編集…',enabled:true,callback:()=>editRaw(this)});}
  };
  for(const type of ['pico_import','pico_import_as','pico_from_import']){
    B.Blocks[type].saveExtraState=function(){return this.originalImport||{eol:'\n'};};
    B.Blocks[type].loadExtraState=function(state){this.originalImport=state;};
  }
  for(const type of ['pico_class','pico_def']){
    B.Blocks[type].saveExtraState=function(){return this.originalPython||{};};
    B.Blocks[type].loadExtraState=function(state){this.originalPython=state.original?state:null;};
  }
  for(const type of ['pico_class','pico_def','pico_import','pico_import_as','pico_from_import','pico_python']){
    const definition=B.Blocks[type],save=definition.saveExtraState,load=definition.loadExtraState;
    definition.saveExtraState=function(){return {...save.call(this),...(this.pythonBefore?{before:this.pythonBefore}:{}),...(this.pythonAfter?{after:this.pythonAfter}:{})};};
    definition.loadExtraState=function(state){const {before='',after='',...rest}=state;this.pythonBefore=before;this.pythonAfter=after;load.call(this,rest);};
  }
  function sequence(block,g,one=false){let code='';while(block){if(block.isEnabled()&&!block.getInheritedDisabled()){
    code+=block.pythonBefore||'';
    if(['pico_module','pico_start'].includes(block.type))code+=sequence(block.getInputTargetBlock('DO'),g);
    else if(block.type==='pico_python')code+=block.pythonCode;
    else if(['pico_import','pico_import_as','pico_from_import'].includes(block.type)){const original=block.originalImport;const unchanged=original?.importFields&&Object.entries(original.importFields).every(([field,value])=>block.getFieldValue(field)===value);code+=(unchanged?original.importCode:importCode(block))+(original?.eol??'\n');}
    else if(['pico_class','pico_def'].includes(block.type)){
      if(block.type==='pico_def'&&block.pythonSentence)code+='# ブロック: '+block.pythonSentence+'\n';
      let body=sequence(block.getInputTargetBlock('DO'),g),header=block.getFieldValue('HEADER');const original=block.originalPython;
      if(original&&body===original.body){const prefix=block.type==='pico_class'?'class ':'def ';code+=prefix+header+original.original.slice(prefix.length+original.header.length);}
      else{if(!body.trim())body='pass\n';const indent=original?.indent||'    ';code+=(block.type==='pico_class'?'class ':'def ')+header+':\n'+indentSource(body,indent);if(!code.endsWith('\n'))code+='\n';}
    }else{const value=g.blockToCode(block,true);code+=Array.isArray(value)?value[0]+'\n':value;}
  code+=block.pythonAfter||'';
  }if(one)break;const next=block.getNextBlock();if(next&&code&&!code.endsWith('\n')&&!(/^[\r\n]/.test(next.pythonBefore||'')||next.type==='pico_python'&&/^[\r\n]/.test(next.pythonCode)))code+='\n';block=next;}return code;}
  for(const type of ['pico_module','pico_class','pico_def','pico_import','pico_import_as','pico_from_import','pico_python'])g.forBlock[type]=(block,g)=>sequence(block,g,true);
  const ui=installBlockUI(B,g,options);
  return {diagnose:ui.diagnose,generate(workspace,parts=[],path='main.py'){
    const getVariableName=g.getVariableName;
    g.getVariableName=id=>workspace.getVariableMap().getVariableById(id)?.name||id;
    B.Events.disable();
    try{
      for(const block of workspace.getAllBlocks(false)){const root=block.getRootBlock(),manual=block.hasDisabledReason('MANUALLY_DISABLED');block.setDisabledReason(!rootTypes.includes(root.type),'PICO_UNCONNECTED');if(manual)block.setDisabledReason(true,'MANUALLY_DISABLED');}
      g.init(workspace);
      let code='';const roots=workspace.getTopBlocks(false).sort((a,b)=>{const p=a.getRelativeToSurfaceXY(),q=b.getRelativeToSurfaceXY();return p.y-q.y||p.x-q.x;});
      for(const block of roots)if(block.isEnabled()){const text=sequence(block,g);if(code&&!code.endsWith('\n')&&text&&!/^[\r\n]/.test(text))code+='\n';code+=text;}
      const imports=[];
      const enabled=workspace.getAllBlocks(false).filter(b=>b.isEnabled()&&!b.getInheritedDisabled());
      const used=parts.filter(p=>enabled.some(b=>b.getFieldValue('PART')===p.id));
      const present=[...code.matchAll(/^from parts import ([^\r\n]+)/gm)].flatMap(match=>match[1].split(',').map(name=>name.trim()));
      const variable=p=>p.variable||p.id;
      const missing=used.filter(p=>!present.includes(variable(p))&&!present.includes('*'));
      if(missing.length&&path!=='parts.py')imports.push('from parts import '+missing.map(variable).join(', '));
      if(enabled.some(b=>['pico_wait','pico_time_us','pico_time_diff'].includes(b.type))&&!/^import time\s*$/m.test(code))imports.push('import time');
      if(enabled.some(b=>b.type==='pico_bootsel')&&!/^import rp2\s*$/m.test(code))imports.push('import rp2');
      if(enabled.some(b=>['pico_new_bits','pico_set_bits','pico_decode_bits','pico_bits_text','pico_text_bits','pico_bits_int','pico_int_bits'].includes(b.type))&&!/^import ir_data\s*$/m.test(code))imports.push('import ir_data');
      const parsed=workspace.getTopBlocks(false).some(block=>block.data==='pico-source-root');
      const definitions=Object.entries(g.definitions_||{}).filter(([key,text])=>!(parsed&&key==='variables')&&!code.includes(text)).map(([,text])=>text);
      const root=roots.find(block=>rootTypes.includes(block.type)&&block.isEnabled());
      if(root)for(const text of [...imports,...definitions.filter(text=>/^(?:import |from )[^\n]+$/.test(text))].reverse()){
        const state=importState(text);if(!state)continue;
        const imported=B.serialization.blocks.append({...state,extraState:{eol:'\n'}},workspace),body=root.getInputTargetBlock('DO');
        if(body){body.previousConnection.disconnect();imported.nextConnection.connect(body.previousConnection);}
        root.getInput('DO').connection.connect(imported.previousConnection);
      }
      return [...imports,...definitions].map(text=>text+'\n').join('')+code;
    }finally{g.getVariableName=getVariableName;B.Events.enable();}
  }};
}
