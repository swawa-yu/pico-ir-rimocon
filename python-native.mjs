const outputType=b=>!b?null:['variables_get','pico_expression','pico_call_value','pico_index','logic_null'].includes(b.type)?null:['text','pico_char','pico_bits_text','pico_to_text','pico_base_text'].includes(b.type)?'String':['lists_create_with','pico_receive','pico_int_bits','pico_text_bits','pico_decode_bits','pico_new_bits','pico_receive_bits','pico_range'].includes(b.type)?'Array':b.type.startsWith('logic_')||['pico_bootsel','pico_ir_level','pico_button'].includes(b.type)?'Boolean':'Number';
export function friendlyCall(target,items){
  if(items.some(item=>item?.type==='pico_expression'&&/^\s*\*/.test(item.fields?.CODE||'')))return null;
  const number=n=>({type:'math_number',fields:{NUM:n}});
  let type,names,values=items,fields={};
  if(target==='range'&&items.length>=1&&items.length<=3){type='pico_range';names=['START','STOP','STEP'];values=items.length===1?[number(0),items[0],number(1)]:[items[0],items[1],items[2]||number(1)];}
  else if(items.length===1&&['int','float','str'].includes(target)){type={int:'pico_to_int',float:'pico_to_float',str:'pico_to_text'}[target];names=['VALUE'];}
  else if(items.length===1&&['bin','oct','hex'].includes(target)){type='pico_base_text';names=['VALUE'];fields={BASE:target};}
  else if(target==='int'&&items.length===2){type='pico_parse_int';names=['VALUE','BASE'];}
  if(!type)return null;
  const expected=type==='pico_parse_int'?['String','Number']:type==='pico_range'?['Number','Number','Number']:type==='pico_base_text'?['Number']:null;
  if(expected&&values.some((value,i)=>outputType(value)&&outputType(value)!==expected[i]))return null;
  return {type,fields,inputs:Object.fromEntries(names.map((name,i)=>[name,{block:values[i]}]))};
}
// Only complete, recognized expressions are converted; all others stay as source.
export function nativeStatement(node,source,parts,parseBody){
  const text=n=>source.slice(n.from,n.to);
  const children=n=>{const values=[];for(let c=n?.firstChild;c;c=c.nextSibling)values.push(c);return values;};
  const args=n=>{
    const items=children(n.getChild('ArgList')).filter(c=>!['(',')'].includes(c.name));
    if(items.some(c=>c.name==='for'))return [{name:'RawExpression',from:items[0].from,to:items.at(-1).to}];
    const result=[];let group=[];
    function append(){if(group.length)result.push(group.length===1?group[0]:{name:'RawExpression',from:group[0].from,to:group.at(-1).to});group=[];}
    for(const child of children(n.getChild('ArgList'))){if(child.name===',')append();else if(!['(',')'].includes(child.name))group.push(child);}
    append();return result;
  };
  const input=block=>({block});
  const number=n=>({type:'math_number',fields:{NUM:n}});
  const variable=name=>({type:'variables_get',fields:{VAR:{name}}});
  const checks={math_arithmetic:'Number',pico_time_diff:'Number',pico_wait:'Number',pico_pwm:'Number',pico_send:'Number',pico_speaker_on:'Number',pico_receive:'Number',pico_receive_bits:'Number',pico_rgb:'Number',pico_char:'Number',pico_ord:'String',pico_int_bits:'Number',pico_text_bits:'String',pico_bits_text:'Array',pico_bits_int:'Array',pico_decode_bits:null,lists_length:'Array',text_length:'String',logic_negate:'Boolean'};
  function values(type,names,items,fields={}){
    if(!items.every(Boolean))return null;
    for(let i=0;i<items.length;i++){
      const expected=type==='pico_set_bits'?(names[i]==='BITS'?'Array':'Number'):type==='pico_new_bits'?'Number':['pico_send_bits','pico_send_times'].includes(type)?'Array':type==='pico_decode_bits'?(names[i]==='TIMES'?'Array':'Number'):checks[type],actual=outputType(items[i]);
      if(expected&&actual&&expected!==actual)return null;
    }
    return {type,fields,inputs:Object.fromEntries(names.map((name,i)=>[name,input(items[i])]))};
  }
  function recognizedExpression(n){
    if(!n)return null;
    const value=text(n),cs=children(n);
    if(n.name==='Number'&&Number.isFinite(Number(value))&&(!Number.isInteger(Number(value))||Number.isSafeInteger(Number(value))))return number(Number(value));
    if(n.name==='String'&&/^(['"])[^\n]*\1$/.test(value)&&!value.includes('\\')&&!value.startsWith(value[0].repeat(3)))return {type:'text',fields:{TEXT:value.slice(1,-1)}};
    if(n.name==='Boolean')return {type:'logic_boolean',fields:{BOOL:value.toUpperCase()}};
    if(value==='None')return {type:'logic_null'};
    if(n.name==='VariableName')return variable(value);
    if(n.name==='MemberExpression'&&cs.length===4&&cs[1].name==='['&&cs[3].name===']'&&cs[2].name!=='SliceExpression')return values('pico_index',['VALUE','INDEX'],[expression(cs[0]),expression(cs[2])]);
    if(n.name==='ArrayExpression'){
      const items=cs.filter(c=>!['[',']',','].includes(c.name)).map(expression);
      if(items.every(Boolean))return {type:'lists_create_with',extraState:{itemCount:items.length},inputs:Object.fromEntries(items.map((b,i)=>['ADD'+i,input(b)]))};
    }
    if(n.name==='UnaryExpression'&&text(cs[0])==='not')return values('logic_negate',['BOOL'],[expression(cs[1])]);
    if(n.name==='BinaryExpression'&&cs.length===3){
      const op=text(cs[1]),arithmetic={'+':'ADD','-':'MINUS','*':'MULTIPLY','/':'DIVIDE','**':'POWER'},compare={'==':'EQ','!=':'NEQ','<':'LT','<=':'LTE','>':'GT','>=':'GTE'};
      if(arithmetic[op])return values('math_arithmetic',['A','B'],[expression(cs[0]),expression(cs[2])],{OP:arithmetic[op]});
      if(compare[op])return values('logic_compare',['A','B'],[expression(cs[0]),expression(cs[2])],{OP:compare[op]});
    }
    if(n.name==='CallExpression'){
      const target=text(cs[0]),arguments_=args(n),converted=arguments_.map(expression);
      if(!arguments_.some(a=>a.name==='RawExpression')){const friendly=friendlyCall(target,converted);if(friendly)return friendly;}
      if(target==='rp2.bootsel_button'&&!arguments_.length)return {type:'pico_bootsel'};
      if(target==='time.ticks_us'&&!arguments_.length)return {type:'pico_time_us'};
      if(target==='time.ticks_diff'&&arguments_.length===2)return values('pico_time_diff',['END','START'],converted);
      if(target==='len'&&arguments_.length===1)return values(outputType(converted[0])==='String'?'text_length':'lists_length',['VALUE'],converted);
      if(target==='chr'&&arguments_.length===1)return values('pico_char',['VALUE'],converted);
      if(target==='ord'&&arguments_.length===1)return values('pico_ord',['VALUE'],converted);
      const methods={new_bits:['pico_new_bits',['WIDTH']],bits_to_text:['pico_bits_text',['VALUE']],text_to_bits:['pico_text_bits',['VALUE']],bits_to_int:['pico_bits_int',['VALUE']],int_to_bits:['pico_int_bits',['VALUE','WIDTH']],durations_to_bits:['pico_decode_bits',['TIMES','SKIP','THRESHOLD']]};
      const method=methods[target.replace(/^ir_data\./,'')];
      if(target.startsWith('ir_data.')&&method){
        if(arguments_.length===method[1].length)return values(method[0],method[1],converted);
        if(target==='ir_data.int_to_bits'&&arguments_.length===1)return values('pico_int_bits',['VALUE','WIDTH'],[converted[0],number(8)]);
      }
      const [id,action]=target.split('.'),part=parts.find(p=>p.id===id);
      if(part?.kind==='receiver'&&action==='receive_bits'&&arguments_.length<=1)return values('pico_receive_bits',['TIMEOUT'],arguments_.length?converted:[number(1000)],{PART:id});
      if(part?.kind==='receiver'&&action==='receive'&&arguments_.length<=1)return values('pico_receive',['TIMEOUT'],arguments_.length?converted:[number(1000)],{PART:id});
      if(part&&['button','receiver'].includes(part.kind)&&['is_pressed','is_on'].includes(action)&&!arguments_.length)return {type:part.kind==='receiver'?'pico_ir_level':'pico_button',fields:{PART:id}};
    }
    if(n.name==='CallExpression')return callBlock(n,true);
    return null;
  }
  function expression(n){return n?(recognizedExpression(n)||{type:'pico_expression',fields:{CODE:text(n)}}):null;}
  function callBlock(n,output=false){
    const arguments_=args(n),target=text(n.firstChild);
    return {type:output?'pico_call_value':'pico_call',fields:{TARGET:target},extraState:{argumentCount:arguments_.length},inputs:Object.fromEntries(arguments_.map((arg,i)=>['ARG'+i,input(expression(arg))]))};
  }
  function condition(n){const block=expression(n);return outputType(block)&&outputType(block)!=='Boolean'?{type:'pico_expression',fields:{CODE:text(n)}}:block;}
  const cs=children(node);
  if(node.name==='AssignStatement'&&cs.length===3&&text(cs[1])==='='&&cs[0].name==='MemberExpression'){const target=children(cs[0]);if(target.length===4&&target[1].name==='['&&target[3].name===']'&&target[2].name!=='SliceExpression')return values('pico_set_index',['VALUE','INDEX','ITEM'],[expression(target[0]),expression(target[2]),expression(cs[2])]);}
  if(node.name==='AssignStatement'&&cs.length===3&&cs[0].name==='VariableName'&&text(cs[1])==='='&&text(cs[0])!=='None')return values('variables_set',['VALUE'],[expression(cs[2])],{VAR:{name:text(cs[0])}});
  if(node.name==='ExpressionStatement'&&cs[0]?.name==='CallExpression'){
    const call=cs[0],target=text(call.firstChild),arguments_=args(call),converted=arguments_.map(expression);
    if(target==='ir_data.set_bits'&&arguments_.length===4)return values('pico_set_bits',['BITS','START','END','VALUE'],converted);
    if(target==='print'&&arguments_.length===1)return values('text_print',['TEXT'],converted);
    if(target==='time.sleep'&&arguments_.length===1){
      const value=arguments_[0];
      const actual=value.name==='CallExpression'&&text(value.firstChild)==='max'&&args(value).length===2&&text(args(value)[0])==='0'?expression(args(value)[1]):converted[0];
      return values('pico_wait',['SECONDS'],[actual]);
    }
    const [id,action]=target.split('.'),part=parts.find(p=>p.id===id);
    if(part){
      const fields={PART:id};
      if(part.kind==='pwm'&&action==='set'&&arguments_.length===1)return values('pico_pwm',['PERCENT'],converted,fields);
      if(part.kind==='infrared'&&action==='send_times'&&arguments_.length===1)return values('pico_send_times',['TIMES'],converted,fields);
      if(part.kind==='rgb'&&action==='set'&&arguments_.length===3)return values('pico_rgb',['RED','GREEN','BLUE'],converted,fields);
      if(part.kind==='rgb'&&action==='off'&&!arguments_.length)return {type:'pico_rgb_off',fields};
      if(part.kind==='infrared'&&action==='send_bits'&&arguments_.length===1)return values('pico_send_bits',['BITS'],converted,fields);
      if(part.kind==='infrared'&&action==='send'&&arguments_.length===1)return values('pico_send',['VALUE'],converted,fields);
      if(['infrared','led'].includes(part.kind)&&['on','off'].includes(action)&&!arguments_.length)return {type:part.kind==='led'?'pico_led':'pico_carrier',fields:{...fields,ON:action==='on'?'1':'0'}};
      if(part.kind==='speaker'&&action==='on'&&arguments_.length===1)return values('pico_speaker_on',['HZ'],converted,fields);
      if(part.kind==='speaker'&&action==='off'&&!arguments_.length)return {type:'pico_speaker_off',fields};
    }
    return callBlock(call);
  }
  if(node.name==='ReturnStatement')return {type:'pico_return',inputs:cs[1]?{VALUE:input(expression(cs[1]))}:{}};
  if(['BreakStatement','ContinueStatement','PassStatement'].includes(node.name))return {type:'pico_flow',fields:{CODE:text(node)}};
  if(node.name==='WhileStatement'&&cs.length===3){
    const test=condition(cs[1]),body=parseBody(cs[2]);
    if(test&&body)return {type:'controls_whileUntil',fields:{MODE:'WHILE'},inputs:{BOOL:input(test),DO:input(body)}};
  }
  if(node.name==='ForStatement'&&cs.length===5&&cs[1].name==='VariableName'){
    const items=expression(cs[3]),body=parseBody(cs[4]);
    if(body)return {type:'controls_forEach',fields:{VAR:{name:text(cs[1])}},inputs:{LIST:input(items),DO:input(body)}};
  }
  if(node.name==='IfStatement'){
    const inputs={};let branches=0,otherwise=null;
    for(let i=0;i<cs.length;){
      if(['if','elif'].includes(cs[i].name)){
        const test=condition(cs[i+1]),body=parseBody(cs[i+2]);if(!test||!body)return null;
        inputs['IF'+branches]=input(test);inputs['DO'+branches]=input(body);branches++;i+=3;
      }else if(cs[i].name==='else'){otherwise=parseBody(cs[i+1]);if(!otherwise)return null;inputs.ELSE=input(otherwise);i+=2;}
      else return null;
    }
    if(branches)return {type:'controls_if',extraState:{elseIfCount:branches-1,hasElse:Boolean(otherwise)},inputs};
  }
  return null;
}
