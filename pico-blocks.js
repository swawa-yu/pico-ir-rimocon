(() => {
  "use strict";
  const defaults=()=>[
    {id:'send_button',name:'送信ボタン',kind:'button',pin:14},
    {id:'status_led',name:'お知らせLED',kind:'led',pin:13},
    {id:'infrared',name:'赤外線LED',kind:'infrared',pin:16,unit:560}
  ];
  const kinds={pico_button:'button',pico_led:'led',pico_send:'infrared',pico_carrier:'infrared',pico_tone:'speaker',pico_speaker_on:'speaker',pico_speaker_off:'speaker',pico_display_text:'ssd1306',pico_display_clear:'ssd1306',pico_display_pixel:'ssd1306',pico_display_get_pixel:'ssd1306',pico_display_fill:'ssd1306',pico_display_text_at:'ssd1306',pico_display_show:'ssd1306',pico_dip_on:'dip',pico_dip_value:'dip'};
  const pinsFor=p=>p.kind==='ssd1306'?[p.sda,p.scl]:p.kind==='dip'?p.pins:[p.pin];
  function validateParts(parts){
    if(!Array.isArray(parts)||parts.length>23)throw Error('部品は23個以内にしてください。');
    const ids=new Set(),names=new Set(),pins=new Set();
    for(const p of parts){
      if(typeof p.id!=='string'||p.id.length>64||!/^[a-z][a-z0-9_]*$/.test(p.id)||('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield time close').split(' ').includes(p.id)||ids.has(p.id))throw Error('部品の識別子が不正です。');
      if(typeof p.name!=='string'||!p.name.trim()||p.name.length>40||names.has(p.name.trim()))throw Error('部品名は重複しない1〜40文字にしてください。');
      if(!['button','led','infrared','speaker','ssd1306','dip'].includes(p.kind))throw Error('部品の種類が不正です。');
      const assigned=pinsFor(p);
      if(!Array.isArray(assigned)||p.kind==='dip'&&assigned.length!==8)throw Error('DIPスイッチは8個のGPIOを設定してください。');
      for(const pin of assigned){if(!Number.isInteger(pin)||pin<0||pin>22||pins.has(pin))throw Error('GPIOはGP0〜GP22で、重複しない番号を指定してください。');pins.add(pin);}
      if(p.kind==='ssd1306'&&(p.width!==128||![32,64].includes(p.height)||![60,61].includes(p.address)))throw Error('SSD1306は128×32 / 128×64、アドレス0x3C / 0x3Dを指定してください。');
      if(p.kind==='infrared'&&(!Number.isInteger(p.unit)||p.unit<100||p.unit>100000))throw Error('赤外線の基準時間は100〜100,000µsにしてください。');
      ids.add(p.id);names.add(p.name.trim());
    }
    const pwm=parts.filter(p=>['speaker','infrared'].includes(p.kind));
    for(let i=0;i<pwm.length;i++)for(let j=i+1;j<pwm.length;j++)if((pwm[i].kind==='speaker'||pwm[j].kind==='speaker')&&((pwm[i].pin>>1)%8===(pwm[j].pin>>1)%8))throw Error(`${pwm[i].name}と${pwm[j].name}はPWM回路を共有します。別のGPIOの組に変更してください。`);
  }
  function validateWorkspace(state,parts){
    function visit(value){
      if(!value||typeof value!=='object')return;
      if(kinds[value.type]&&!parts.some(p=>p.id===value.fields?.PART&&p.kind===kinds[value.type]))throw Error('ブロックに対応する部品がありません。部品設定を確認してください。');
      Object.values(value).forEach(visit);
    }
    visit(state);
  }
  function configure(Blockly,generator,getParts=defaults){
    const kindFor=kinds;
    const options=kind=>()=>getParts().filter(p=>p.kind===kind).map(p=>[p.name,p.id]).concat(getParts().some(p=>p.kind===kind)?[]:[['部品を設定','__missing']]);
    Blockly.defineBlocksWithJsonArray([
      {type:'pico_start',message0:'実行したとき %1 %2',args0:[{type:'input_dummy'},{type:'input_statement',name:'DO'}],colour:45},
      {type:'pico_forever',message0:'ずっと %1 %2',args0:[{type:'input_dummy'},{type:'input_statement',name:'DO'}],previousStatement:null,colour:45},
      {type:'pico_wait',message0:'%1 秒待つ',args0:[{type:'input_value',name:'SECONDS',check:'Number'}],previousStatement:null,nextStatement:null,colour:45},
      {type:'pico_button',message0:'%1 が押されている',args0:[{type:'field_dropdown',name:'PART',options:options('button')}],output:'Boolean',colour:200},
      {type:'pico_led',message0:'%1 を %2',args0:[{type:'field_dropdown',name:'PART',options:options('led')},{type:'field_dropdown',name:'ON',options:[['点灯','1'],['消灯','0']]}],previousStatement:null,nextStatement:null,colour:150},
      {type:'pico_send',message0:'%1 で %2 を送る',args0:[{type:'field_dropdown',name:'PART',options:options('infrared')},{type:'input_value',name:'VALUE',check:'Number'}],previousStatement:null,nextStatement:null,colour:285},
      {type:'pico_carrier',message0:'%1 を %2',args0:[{type:'field_dropdown',name:'PART',options:options('infrared')},{type:'field_dropdown',name:'ON',options:[['38 kHzでON','1'],['OFF','0']]}],previousStatement:null,nextStatement:null,colour:285},
      {type:'pico_speaker_on',message0:'%1 の %2 HzをONにする',args0:[{type:'field_dropdown',name:'PART',options:options('speaker')},{type:'input_value',name:'HZ',check:'Number'}],previousStatement:null,nextStatement:null,colour:150},
      {type:'pico_tone',message0:'%1 で %2 Hzを %3 秒鳴らす',args0:[{type:'field_dropdown',name:'PART',options:options('speaker')},{type:'input_value',name:'HZ',check:'Number'},{type:'input_value',name:'SECONDS',check:'Number'}],previousStatement:null,nextStatement:null,colour:150},
      {type:'pico_speaker_off',message0:'%1 の音を止める',args0:[{type:'field_dropdown',name:'PART',options:options('speaker')}],previousStatement:null,nextStatement:null,colour:150},
      {type:'pico_display_text',message0:'%1 の %2 行目に %3 を表示',args0:[{type:'field_dropdown',name:'PART',options:options('ssd1306')},{type:'input_value',name:'LINE',check:'Number'},{type:'input_value',name:'TEXT'}],previousStatement:null,nextStatement:null,colour:150},
      {type:'pico_display_clear',message0:'%1 を消去',args0:[{type:'field_dropdown',name:'PART',options:options('ssd1306')}],previousStatement:null,nextStatement:null,colour:150},
      {type:'pico_display_pixel',message0:'%1 の x:%2 y:%3 のピクセルを %4 にする',args0:[{type:'field_dropdown',name:'PART',options:options('ssd1306')},{type:'input_value',name:'X',check:'Number'},{type:'input_value',name:'Y',check:'Number'},{type:'input_value',name:'COLOR',check:'Number'}],previousStatement:null,nextStatement:null,colour:150},
      {type:'pico_display_get_pixel',message0:'%1 の x:%2 y:%3 のピクセルの値',args0:[{type:'field_dropdown',name:'PART',options:options('ssd1306')},{type:'input_value',name:'X',check:'Number'},{type:'input_value',name:'Y',check:'Number'}],output:'Number',colour:200},
      {type:'pico_display_fill',message0:'%1 全体のピクセルを %2 にする',args0:[{type:'field_dropdown',name:'PART',options:options('ssd1306')},{type:'input_value',name:'COLOR',check:'Number'}],previousStatement:null,nextStatement:null,colour:150},
      {type:'pico_display_text_at',message0:'%1 の x:%2 y:%3 に %4 を描く',args0:[{type:'field_dropdown',name:'PART',options:options('ssd1306')},{type:'input_value',name:'X',check:'Number'},{type:'input_value',name:'Y',check:'Number'},{type:'input_value',name:'TEXT'}],previousStatement:null,nextStatement:null,colour:150},
      {type:'pico_display_show',message0:'%1 の変更を反映',args0:[{type:'field_dropdown',name:'PART',options:options('ssd1306')}],previousStatement:null,nextStatement:null,colour:150},
      {type:'pico_dip_on',message0:'%1 のスイッチ %2 がON',args0:[{type:'field_dropdown',name:'PART',options:options('dip')},{type:'input_value',name:'NUMBER',check:'Number'}],output:'Boolean',colour:200},
      {type:'pico_dip_value',message0:'%1 の値',args0:[{type:'field_dropdown',name:'PART',options:options('dip')}],output:'Number',colour:200}
    ]);
    function part(b){
      const p=getParts().find(p=>p.id===b.getFieldValue('PART')&&p.kind===kindFor[b.type]);
      if(!p)throw Error('ブロックに対応する部品を設定してください。');
      return p.id;
    }
    generator.forBlock.pico_start=(b,g)=>g.statementToCode(b,'DO').replace(/^  /gm,'')||'pass\n';
    generator.forBlock.pico_forever=(b,g)=>'while True:\n'+(g.statementToCode(b,'DO')||'  pass\n');
    generator.forBlock.pico_wait=(b,g)=>`time.sleep(max(0, ${g.valueToCode(b,'SECONDS',g.ORDER_NONE)||'0'}))\n`;
    generator.forBlock.pico_button=(b,g)=>[`${part(b)}.is_pressed()`,g.ORDER_FUNCTION_CALL];
    generator.forBlock.pico_led=b=>`${part(b)}.${b.getFieldValue('ON')==='1'?'on':'off'}()\n`;
    generator.forBlock.pico_send=(b,g)=>`${part(b)}.send(${g.valueToCode(b,'VALUE',g.ORDER_NONE)||'0'})\n`;
    generator.forBlock.pico_carrier=b=>`${part(b)}.${b.getFieldValue('ON')==='1'?'on':'off'}()\n`;
    generator.forBlock.pico_speaker_on=(b,g)=>`${part(b)}.on(${g.valueToCode(b,'HZ',g.ORDER_NONE)||'440'})\n`;
    generator.forBlock.pico_tone=(b,g)=>`${part(b)}.tone(${g.valueToCode(b,'HZ',g.ORDER_NONE)||'440'}, ${g.valueToCode(b,'SECONDS',g.ORDER_NONE)||'0.5'})\n`;
    generator.forBlock.pico_speaker_off=b=>`${part(b)}.off()\n`;
    generator.forBlock.pico_display_text=(b,g)=>`${part(b)}.text(${g.valueToCode(b,'TEXT',g.ORDER_NONE)||"''"}, ${g.valueToCode(b,'LINE',g.ORDER_NONE)||'1'})\n`;
    generator.forBlock.pico_display_clear=b=>`${part(b)}.clear()\n`;
    generator.forBlock.pico_display_pixel=(b,g)=>`${part(b)}.pixel(${g.valueToCode(b,'X',g.ORDER_NONE)||'0'}, ${g.valueToCode(b,'Y',g.ORDER_NONE)||'0'}, ${g.valueToCode(b,'COLOR',g.ORDER_NONE)||'0'})\n`;
    generator.forBlock.pico_display_get_pixel=(b,g)=>[`${part(b)}.pixel(${g.valueToCode(b,'X',g.ORDER_NONE)||'0'}, ${g.valueToCode(b,'Y',g.ORDER_NONE)||'0'})`,g.ORDER_FUNCTION_CALL];
    generator.forBlock.pico_display_fill=(b,g)=>`${part(b)}.fill(${g.valueToCode(b,'COLOR',g.ORDER_NONE)||'0'})\n`;
    generator.forBlock.pico_display_text_at=(b,g)=>`${part(b)}.text_at(${g.valueToCode(b,'TEXT',g.ORDER_NONE)||"''"}, ${g.valueToCode(b,'X',g.ORDER_NONE)||'0'}, ${g.valueToCode(b,'Y',g.ORDER_NONE)||'0'})\n`;
    generator.forBlock.pico_display_show=b=>`${part(b)}.show()\n`;
    generator.forBlock.pico_dip_on=(b,g)=>[`${part(b)}.is_on(${g.valueToCode(b,'NUMBER',g.ORDER_NONE)||'1'})`,g.ORDER_FUNCTION_CALL];
    generator.forBlock.pico_dip_value=b=>[`${part(b)}.value()`,generator.ORDER_FUNCTION_CALL];
    generator.forBlock.text_prompt_ext=(b,g)=>{
      const input=`input(${g.valueToCode(b,'TEXT',g.ORDER_NONE)||"''"})`;
      return [b.getFieldValue('TYPE')==='NUMBER'?`float(${input})`:input,g.ORDER_FUNCTION_CALL];
    };
    generator.addReservedWords('time,'+getParts().map(p=>p.id).join(','));
  }
  function generateProject(Blockly,generator,workspace,parts,runtime,displayDriver='',sourceMap=null){
    validateParts(parts);
    syncEnabled(Blockly,workspace);
    generator.addReservedWords(parts.map(p=>p.id).join(','));
    const blocks=workspace.getAllBlocks(false).filter(b=>b.isEnabled()&&!b.getInheritedDisabled());
    const used=parts.filter(p=>blocks.some(b=>b.getFieldValue('PART')===p.id));
    let main;
    const prefix=generator.STATEMENT_PREFIX;
    try{
      if(sourceMap)generator.STATEMENT_PREFIX='# @pico-block:%1\n';
      main=generator.workspaceToCode(workspace).trim();
    }finally{generator.STATEMENT_PREFIX=prefix;}
    if(sourceMap){
      sourceMap.clear();
      const markers=new Map(blocks.map(b=>[generator.injectId('# @pico-block:%1',b),b.id]));
      const lines=[];let owner=null;
      for(const line of main.split('\n')){
        const marker=markers.get(line.trim());
        if(marker){owner=marker;continue;}
        if(owner&&/^\s*(else:|elif |except\b|finally:|return\b)/.test(line)){
          let parent=workspace.getBlockById(owner)?.getSurroundParent();
          while(parent){
            if(/^\s*return\b/.test(line)?parent.type.startsWith('procedures_def'):['controls_if','controls_whileUntil','controls_repeat_ext','controls_forEach','controls_for','pico_forever'].includes(parent.type))break;
            parent=parent.getSurroundParent();
          }
          if(parent)owner=parent.id;
        }
        lines.push(line);
        if(owner&&line.trim()){
          const range=sourceMap.get(owner)||{from:lines.length,to:lines.length};range.to=lines.length;sourceMap.set(owner,range);
        }
      }
      main=lines.join('\n').trim();
      for(const block of blocks.filter(b=>b.type.startsWith('procedures_def'))){
        const name=generator.getProcedureName(block.getFieldValue('NAME'));
        const line=lines.findIndex(line=>line.startsWith(`def ${name}(`))+1;
        if(line)sourceMap.set(block.id,{from:line,to:sourceMap.get(block.id)?.to||line});
      }
    }
    const imports=[];
    if(used.length)imports.push('from parts import '+used.map(p=>p.id).join(', '));
    if(blocks.some(b=>b.type==='pico_wait'))imports.push('import time');
    if(sourceMap){
      const offset=imports.length?imports.length+1:0;
      for(const range of sourceMap.values()){range.from+=offset;range.to+=offset;}
      function cover(block){
        let range=sourceMap.get(block.id);
        for(const input of block.inputList){
          let child=input.connection?.targetBlock();
          while(child){
            const inner=cover(child);
            if(inner)range=range?{from:Math.min(range.from,inner.from),to:Math.max(range.to,inner.to)}:{...inner};
            child=child.getNextBlock();
          }
        }
        if(range)sourceMap.set(block.id,range);return range;
      }
      for(const root of workspace.getTopBlocks(false))if(root.isEnabled())cover(root);
      for(const block of blocks)if(!sourceMap.has(block.id)){
        let parent=block.getParent();while(parent&&!sourceMap.has(parent.id))parent=parent.getParent();
        if(parent)sourceMap.set(block.id,{...sourceMap.get(parent.id)});
      }
    }
    main=(imports.length?imports.join('\n')+'\n\n':'')+main+'\n';
    const classes={button:'Button',led:'LED',infrared:'Infrared',speaker:'Speaker',ssd1306:'Display',dip:'DIPSwitch'};
    const config=(parts.length?'from pico_parts import '+[...new Set(parts.map(p=>classes[p.kind]))].join(', ')+'\n\n':'')+parts.map(p=>`${p.id} = ${classes[p.kind]}(${p.kind==='ssd1306'?`${p.sda}, ${p.scl}, width=${p.width}, height=${p.height}, address=${p.address}`:p.kind==='dip'?`[${p.pins.join(', ')}]`:`${p.pin}${p.kind==='infrared'?`, unit=${p.unit}`:''}`})`).join('\n')+'\n';
    const files={'main.py':main,'parts.py':config,'lib/pico_parts.py':runtime};
    if(parts.some(p=>p.kind==='ssd1306')){if(!displayDriver)throw Error('SSD1306ドライバがありません。');files['lib/ssd1306.py']=displayDriver;}
    return files;
  }
  function syncEnabled(Blockly,workspace){
    Blockly.Events.disable();
    try{
      for(const block of workspace.getAllBlocks(false)){
        const root=block.getRootBlock();
        const disabled=!['pico_start','pico_module','pico_class','pico_def','pico_import','pico_import_as','pico_from_import','pico_python','procedures_defnoreturn','procedures_defreturn'].includes(root.type);
        if(block.hasDisabledReason('PICO_UNCONNECTED')===disabled)continue;
        const manual=block.hasDisabledReason('MANUALLY_DISABLED');
        block.setDisabledReason(disabled,'PICO_UNCONNECTED');
        if(manual)block.setDisabledReason(true,'MANUALLY_DISABLED');
      }
    }finally{Blockly.Events.enable();}
  }
  function migrate(workspace){
    const state=JSON.parse(JSON.stringify(workspace)),parts=defaults();
    function visit(value){
      if(!value||typeof value!=='object')return;
      const kinds={pico_led:'led',pico_button:'button',pico_send:'infrared'};
      if(kinds[value.type]&&value.fields?.PIN!==undefined){
        const kind=kinds[value.type],pin=Number(value.fields.PIN),unit=Number(value.fields.UNIT||560);
        let p=parts.find(p=>p.kind===kind&&p.pin===pin&&(kind!=='infrared'||p.unit===unit));
        if(!p){p={id:`${kind}_${parts.length}`,name:`${kind==='led'?'LED':kind==='button'?'ボタン':'赤外線LED'} GP${pin}`,kind,pin};if(kind==='infrared')p.unit=unit;parts.push(p);}
        value.fields.PART=p.id;delete value.fields.PIN;delete value.fields.UNIT;
      }
      Object.values(value).forEach(visit);
    }
    visit(state);
    const used=new Set();
    function collect(v){if(!v||typeof v!=='object')return;if(v.fields?.PART)used.add(v.fields.PART);Object.values(v).forEach(collect);}
    collect(state);
    return {format:'pico-blocks-2',parts:parts.filter(p=>used.has(p.id)||!parts.some(q=>used.has(q.id)&&q.pin===p.pin)),workspace:state};
  }
  function migrateSpeaker(workspace){
    const state=JSON.parse(JSON.stringify(workspace));
    function visit(value){
      if(!value||typeof value!=='object')return;
      Object.values(value).forEach(visit);
      if(value.type!=='pico_tone')return;
      const seconds=value.inputs?.SECONDS||number(.5),next=value.next;
      const off={type:'pico_speaker_off',fields:{PART:value.fields.PART}};
      if(next)off.next=next;
      value.type='pico_speaker_on';delete value.inputs.SECONDS;
      value.next={block:{type:'pico_wait',inputs:{SECONDS:seconds},next:{block:off}}};
    }
    visit(state);return state;
  }

  const number=value=>({shadow:{type:'math_number',fields:{NUM:value}}});
  const led=on=>({type:'pico_led',fields:{PART:'status_led',ON:String(on)}});
  const wait=seconds=>({type:'pico_wait',inputs:{SECONDS:number(seconds)}});
  const button=()=>({block:{type:'pico_button',fields:{PART:'send_button'}}});
  const send=()=>({type:'pico_send',fields:{PART:'infrared'},inputs:{VALUE:number(65)}});
  function stack(...blocks) {for(let i=0;i<blocks.length-1;i++)blocks[i].next={block:blocks[i+1]};return blocks[0];}
  function root(body){return {blocks:{languageVersion:0,blocks:[{type:'pico_start',x:30,y:30,inputs:{DO:{block:body}}}]}};}
  const examples={
    console:()=>root({type:'text_print',inputs:{TEXT:{block:{type:'text_prompt_ext',fields:{TYPE:'TEXT'},inputs:{TEXT:{shadow:{type:'text',fields:{TEXT:'名前は？ '}}}}}}}}),
    pixels:()=>root(stack(
      {type:'pico_display_fill',fields:{PART:'screen'},inputs:{COLOR:number(0)}},
      {type:'controls_for',fields:{VAR:{name:'x'}},inputs:{FROM:number(0),TO:number(63),BY:number(1),DO:{block:{type:'pico_display_pixel',fields:{PART:'screen'},inputs:{X:{block:{type:'variables_get',fields:{VAR:{name:'x'}}}},Y:{block:{type:'variables_get',fields:{VAR:{name:'x'}}}},COLOR:number(1)}}}}},
      {type:'pico_display_show',fields:{PART:'screen'}}
    )),
    peripherals:()=>root(stack(
      {type:'pico_display_clear',fields:{PART:'screen'}},
      {type:'pico_display_text',fields:{PART:'screen'},inputs:{LINE:number(1),TEXT:{block:{type:'pico_dip_value',fields:{PART:'switches'}}}}},
      {type:'controls_if',extraState:{hasElse:true},inputs:{IF0:{block:{type:'pico_dip_on',fields:{PART:'switches'},inputs:{NUMBER:number(1)}}},DO0:{block:{type:'pico_speaker_on',fields:{PART:'speaker'},inputs:{HZ:number(880)}}},ELSE:{block:{type:'pico_speaker_on',fields:{PART:'speaker'},inputs:{HZ:number(440)}}}}}
      ,wait(.2),{type:'pico_speaker_off',fields:{PART:'speaker'}}
    )),
    blink:()=>root({type:'pico_forever',inputs:{DO:{block:stack(led(1),wait(.5),led(0),wait(.5))}}}),
    button:()=>root({type:'pico_forever',inputs:{DO:{block:stack({type:'controls_if',extraState:{hasElse:true},inputs:{IF0:button(),DO0:{block:led(1)},ELSE:{block:led(0)}}},wait(.01))}}}),
    send:()=>root(send()),
    button_send:()=>root({type:'pico_forever',inputs:{DO:{block:stack({type:'controls_if',inputs:{IF0:button(),DO0:{block:stack(led(1),send(),{type:'controls_whileUntil',fields:{MODE:'WHILE'},inputs:{BOOL:button(),DO:{block:wait(.01)}}},led(0))}}},wait(.01))}}})
  };
  const peripheralParts=()=>[
    {id:'screen',name:'画面',kind:'ssd1306',sda:16,scl:17,width:128,height:64,address:60},
    {id:'speaker',name:'スピーカー',kind:'speaker',pin:18},
    {id:'switches',name:'DIPスイッチ',kind:'dip',pins:[3,4,5,6,7,8,9,10]}
  ];
  function signalForByte(value,unit) {
    if(!Number.isInteger(value)||value<0||value>255)throw Error('送信値は0〜255の整数にしてください。');
    if(!Number.isInteger(unit)||unit<100||unit>100000)throw Error('基準時間が不正です。');
    const signal=[8*unit,4*unit];
    for(let shift=7;shift>=0;shift--)signal.push(unit,((value>>shift)&1?3:1)*unit);
    return [...signal,unit];
  }
  function previewValue(block) {
    if(!block)throw Error('送信値を入力してください。');
    if(block.type==='math_number')return Number(block.getFieldValue('NUM'));
    if(block.type==='math_arithmetic'){
      const a=previewValue(block.getInputTargetBlock('A')),b=previewValue(block.getInputTargetBlock('B'));
      const operations={ADD:()=>a+b,MINUS:()=>a-b,MULTIPLY:()=>a*b,DIVIDE:()=>a/b,POWER:()=>a**b};
      return operations[block.getFieldValue('OP')]();
    }
    throw Error('波形のプレビューには、数値または計算式を指定してください。変数を使うプログラムは実機で実行できます。');
  }
  const api={configure,generateProject,defaults,validateParts,validateWorkspace,migrate,migrateSpeaker,examples,signalForByte,previewValue,pinsFor,peripheralParts};
  if(typeof module!=='undefined')module.exports=api;
  if(typeof window!=='undefined')window.PicoBlocks=api;
})();
