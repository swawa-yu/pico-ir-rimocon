(() => {
  'use strict';
  const maxIntervals=4096,maxBits=Math.floor((maxIntervals-3)/2);
  function array(text,bits=false){
    const source=text.trim();let values;
    try{values=JSON.parse(source.replace(/,\s*]/g,']'));}catch(_){throw Error(bits?'0と1の配列を入力してください。例：[0, 1, 0, 1]':'時間配列を入力してください。例：[560, 560, 560, 1680, 560]');}
    if(!Array.isArray(values)||!values.length||values.length>(bits?maxBits:maxIntervals)||!values.every(n=>bits?n===0||n===1:Number.isSafeInteger(n)&&n>0))throw Error(bits?`0と1を1〜${maxBits}個の配列で入力してください。`:'時間は正の整数（µs）、区間数は4,096以内にしてください。');
    if(!bits&&!Number.isSafeInteger(values.reduce((sum,n)=>sum+n,0)))throw Error('時間の合計が大きすぎます。');
    return values;
  }
  function ordered(bits,lsb){
    if(!lsb)return bits;
    const result=[];for(let i=0;i<bits.length;i+=8)result.push(...bits.slice(i,i+8).reverse());return result;
  }
  function convert(kind,input,{unit=560,leader='none',lsb=false,width=8,start=null}={}){
    if(!Number.isSafeInteger(unit)||unit<1)throw Error('ON時間は1µs以上の整数にしてください。');
    const factors={none:[],short:[8,4],long:[16,8]}[leader];
    if(!factors||!factors.every(n=>Number.isSafeInteger(n*unit))||!Number.isSafeInteger(3*unit))throw Error('リーダ部またはON時間を確認してください。');
    let bits,times;
    if(kind==='times'){
      times=array(input);bits=[];
      start=start??factors.length;
      if(!Number.isSafeInteger(start)||start<0||start%2||start>times.length)throw Error('データ開始位置は時間配列の範囲内の0以上の偶数にしてください。');
      for(let i=start;i+1<times.length;i+=2)bits.push(times[i+1]>=2*times[i]?1:0);
    }else if(kind==='bits')bits=array(input,true);
    else if(kind==='binary'){
      let source=input.trim();if(/^(['"])[01_\s]+\1$/.test(source))source=source.slice(1,-1);
      source=source.replace(/[\s_]/g,'');if(!/^[01]+$/.test(source))throw Error('2進数の文字列は0と1で入力してください。');
      bits=[...source].map(Number);
    }else if(kind==='text'){
      if(!input.length)throw Error('文字列を入力してください。');
      const bytes=new TextEncoder().encode(input);
      if(bytes.length*8>maxBits)throw Error('文字列はUTF-8で255バイト以内にしてください。');
      bits=ordered([...bytes].flatMap(byte=>[...byte.toString(2).padStart(8,'0')].map(Number)),lsb);
    }else if(kind==='number'){
      const source=input.trim();
      if(!/^(?:[0-9](?:_?[0-9])*|0[bB][01](?:_?[01])*|0[xX][\da-fA-F](?:_?[\da-fA-F])*)$/.test(source)||source.length>maxBits+2)throw Error('0以上の整数を入力してください。0bや0xも使えます。');
      if(!Number.isSafeInteger(width)||width<1||width>maxBits)throw Error(`ビット数は1〜${maxBits}にしてください。`);
      const binary=BigInt(source.replace(/_/g,'')).toString(2);
      if(binary.length>width)throw Error('数値が指定したビット数に収まりません。ビット数を増やしてください。');
      bits=ordered([...binary.padStart(width,'0')].map(Number),lsb);
    }else throw Error('入力形式を選んでください。');
    if(bits.length>maxBits)throw Error(`ビット数は${maxBits}以内にしてください。`);
    if(!times){
      times=factors.map(n=>n*unit);
      for(const bit of bits)times.push(unit,(bit?3:1)*unit);
      times.push(unit);
      if(!times.every(Number.isSafeInteger)||!Number.isSafeInteger(times.reduce((a,b)=>a+b,0)))throw Error('時間の合計が大きすぎます。');
    }
    const canonical=ordered(bits,lsb),binary=bits.join('');
    const number=canonical.length?BigInt('0b'+canonical.join('')).toString():null;
    let text=null,textReason='8ビット単位で変換します。';
    if(canonical.length&&canonical.length%8===0){
      const bytes=[];for(let i=0;i<canonical.length;i+=8)bytes.push(parseInt(canonical.slice(i,i+8).join(''),2));
      try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(new Uint8Array(bytes));textReason='';}catch(_){textReason='UTF-8の文字列として読めません。';}
    }
    return {times,bits,binary,number,text,textReason,start:kind==='times'?start:factors.length};
  }
  const api={convert,maxBits};
  if(typeof module!=='undefined')module.exports=api;
  if(typeof window!=='undefined')window.SignalConversion=api;
})();
