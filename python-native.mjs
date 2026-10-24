// Only complete, recognized expressions are converted; all others stay as source.
export function nativeStatement(node,source,parts,parseBody){
  const text=n=>source.slice(n.from,n.to);
  const children=n=>{const values=[];for(let c=n?.firstChild;c;c=c.nextSibling)values.push(c);return values;};
  const args=n=>children(n.getChild('ArgList')).filter(c=>!['(',')',','].includes(c.name));
  const input=block=>({block});
  const number=n=>({type:'math_number',fields:{NUM:n}});
  const variable=name=>({type:'variables_get',fields:{VAR:{name}}});
  const outputType=b=>!b?null:b.type==='variables_get'?null:['text','pico_char','pico_bits_text'].includes(b.type)?'String':['lists_create_with','pico_receive','pico_int_bits','pico_text_bits','pico_decode_bits'].includes(b.type)?'Array':b.type.startsWith('logic_')||['pico_bootsel','pico_ir_level','pico_button'].includes(b.type)?'Boolean':'Number';
  const checks={math_arithmetic:'Number',pico_time_diff:'Number',pico_wait:'Number',pico_pwm:'Number',pico_send:'Number',pico_speaker_on:'Number',pico_receive:'Number',pico_char:'Number',pico_ord:'String',pico_int_bits:'Number',pico_text_bits:'String',pico_bits_text:'Array',pico_bits_int:'Array',pico_decode_bits:null,lists_length:'Array',text_length:'String',logic_negate:'Boolean'};
  function values(type,names,items,fields={}){
    if(!items.every(Boolean))return null;
    for(let i=0;i<items.length;i++){
      const expected=type==='pico_decode_bits'?(names[i]==='TIMES'?'Array':'Number'):checks[type],actual=outputType(items[i]);
      if(expected&&actual&&expected!==actual)return null;
    }
    return {type,fields,inputs:Object.fromEntries(names.map((name,i)=>[name,input(items[i])]))};
  }
  function expression(n){
    if(!n)return null;
    const value=text(n),cs=children(n);
    if(n.name==='Number'&&Number.isFinite(Number(value))&&(!Number.isInteger(Number(value))||Number.isSafeInteger(Number(value))))return number(Number(value));
    if(n.name==='String'&&/^(['"])[^\n]*\1$/.test(value)&&!value.includes('\\')&&!value.startsWith(value[0].repeat(3)))return {type:'text',fields:{TEXT:value.slice(1,-1)}};
    if(n.name==='Boolean')return {type:'logic_boolean',fields:{BOOL:value.toUpperCase()}};
    if(n.name==='VariableName')return variable(value);
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
      if(target==='rp2.bootsel_button'&&!arguments_.length)return {type:'pico_bootsel'};
      if(target==='time.ticks_us'&&!arguments_.length)return {type:'pico_time_us'};
      if(target==='time.ticks_diff'&&arguments_.length===2)return values('pico_time_diff',['END','START'],converted);
      if(target==='len'&&arguments_.length===1)return values(outputType(converted[0])==='String'?'text_length':'lists_length',['VALUE'],converted);
      if(target==='chr'&&arguments_.length===1)return values('pico_char',['VALUE'],converted);
      if(target==='ord'&&arguments_.length===1)return values('pico_ord',['VALUE'],converted);
      const methods={bits_to_text:['pico_bits_text',['VALUE']],text_to_bits:['pico_text_bits',['VALUE']],bits_to_int:['pico_bits_int',['VALUE']],int_to_bits:['pico_int_bits',['VALUE','WIDTH']],durations_to_bits:['pico_decode_bits',['TIMES','SKIP','THRESHOLD']]};
      const method=methods[target.replace(/^ir_data\./,'')];
      if(target.startsWith('ir_data.')&&method&&arguments_.length===method[1].length)return values(method[0],method[1],converted);
      const [id,action]=target.split('.'),part=parts.find(p=>p.id===id);
      if(part?.kind==='receiver'&&action==='receive'&&arguments_.length<=1)return values('pico_receive',['TIMEOUT'],arguments_.length?converted:[number(1000)],{PART:id});
      if(part&&['button','receiver'].includes(part.kind)&&['is_pressed','is_on'].includes(action)&&!arguments_.length)return {type:part.kind==='receiver'?'pico_ir_level':'pico_button',fields:{PART:id}};
    }
    return null;
  }
  const cs=children(node);
  if(node.name==='AssignStatement'&&cs.length===3&&cs[0].name==='VariableName'&&text(cs[1])==='='&&text(cs[0])!=='None')return values('variables_set',['VALUE'],[expression(cs[2])],{VAR:{name:text(cs[0])}});
  if(node.name==='ExpressionStatement'&&cs[0]?.name==='CallExpression'){
    const call=cs[0],target=text(call.firstChild),arguments_=args(call),converted=arguments_.map(expression);
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
      if(part.kind==='infrared'&&action==='send'&&arguments_.length===1)return values('pico_send',['VALUE'],converted,fields);
      if(['infrared','led'].includes(part.kind)&&['on','off'].includes(action)&&!arguments_.length)return {type:part.kind==='led'?'pico_led':'pico_carrier',fields:{...fields,ON:action==='on'?'1':'0'}};
      if(part.kind==='speaker'&&action==='on'&&arguments_.length===1)return values('pico_speaker_on',['HZ'],converted,fields);
      if(part.kind==='speaker'&&action==='off'&&!arguments_.length)return {type:'pico_speaker_off',fields};
    }
  }
  if(node.name==='WhileStatement'&&cs.length===3){
    const condition=expression(cs[1]),body=parseBody(cs[2]);
    if(condition&&(!outputType(condition)||outputType(condition)==='Boolean')&&body)return {type:'controls_whileUntil',fields:{MODE:'WHILE'},inputs:{BOOL:input(condition),DO:input(body)}};
  }
  if(node.name==='IfStatement'&&[3,5].includes(cs.length)&&(!cs[3]||cs[3].name==='else')){
    const condition=expression(cs[1]),body=parseBody(cs[2]),otherwise=cs[4]?parseBody(cs[4]):null;
    if(condition&&(!outputType(condition)||outputType(condition)==='Boolean')&&body&&(!cs[4]||otherwise))return {type:'controls_if',extraState:{hasElse:Boolean(otherwise)},inputs:{IF0:input(condition),DO0:input(body),...(otherwise?{ELSE:input(otherwise)}:{})}};
  }
  return null;
}
