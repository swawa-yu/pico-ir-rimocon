(() => {
  'use strict';
  const paths=['main.py','parts.py','lib/pico_parts.py','lib/ssd1306.py'];
  function validPath(path,directory=false){
    if(typeof path!=='string')return false;
    const chunks=path.split('/');
    return chunks.every((name,index)=>/^[A-Za-z_]\w*$/.test(directory||index<chunks.length-1?name:name.replace(/\.py$/,''))&&name!=='__pycache__')&&(directory||path.endsWith('.py'));
  }
  function validateEdits(edits){
    if(!edits||typeof edits!=='object'||Array.isArray(edits)||Object.entries(edits).some(([path,text])=>!validPath(path)||typeof text!=='string'))throw Error('編集したファイルの形式が不正です。');
    const names=Object.keys(edits);if(names.some(path=>names.some(other=>other.startsWith(path+'/'))))throw Error('ファイルとフォルダの名前が重複しています。');
    return {...edits};
  }
  class Files {
    constructor(){this.generated={};this.edits={};}
    get all(){return {...this.generated,...this.edits};}
    regenerate(files){this.generated={...files};return this.all;}
    edit(path,text){if(!validPath(path))throw Error('Pythonファイルのパスを指定してください。');if(text===this.generated[path])delete this.edits[path];else this.edits[path]=text;}
    restore(edits){this.edits=validateEdits(edits);}
    reset(path){delete this.edits[path];}
    protected(path){return paths.some(name=>name===path||name.startsWith(path+'/'));}
    parents(path,edits){
      const chunks=path.split('/');
      for(let i=1;i<chunks.length;i++){
        const parent=chunks.slice(0,i).join('/');
        if(Object.hasOwn(this.all,parent))throw Error('同じ名前のファイルがあります。');
        if(parent!=='lib'&&!Object.hasOwn(this.all,parent+'/__init__.py'))edits[parent+'/__init__.py']='';
      }
    }
    create(path,directory=false){
      if(!validPath(path,directory))throw Error('名前には英字・数字・_を使い、先頭は英字か_にしてください。ファイルの拡張子は.pyです。');
      if(Object.keys(this.all).some(name=>name===path||name.startsWith(path+'/')))throw Error('同じ名前が既にあります。');
      const target=directory?path+'/__init__.py':path,edits={};this.parents(target,edits);edits[target]='';Object.assign(this.edits,edits);return target;
    }
    rename(path,target){
      if(this.protected(path))throw Error('生成ファイルとそのフォルダは名前を変更できません。');
      const directory=!Object.hasOwn(this.all,path),all=this.all;
      const names=Object.keys(all).filter(name=>name===path||name.startsWith(path+'/'));
      if(!names.length||!validPath(target,directory)||target.startsWith(path+'/'))throw Error('変更先のパスを確認してください。');
      if(target===path)return {};
      const mapping=Object.fromEntries(names.map(name=>[name,target+name.slice(path.length)]));
      if(Object.keys(all).some(name=>!names.includes(name)&&(name===target||name.startsWith(target+'/')||Object.values(mapping).includes(name))))throw Error('変更先の名前が既にあります。');
      const edits={};for(const name of Object.values(mapping))this.parents(name,edits);
      for(const [old,name] of Object.entries(mapping))edits[name]=all[old];
      for(const old of names)delete this.edits[old];Object.assign(this.edits,edits);return mapping;
    }
  }
  function definitions(source){
    const result=[];let owner='';
    source.split('\n').forEach((line,index)=>{
      const match=line.match(/^(\s*)(?:async\s+)?(def|class)\s+([\p{L}\p{N}_]+)/u);
      if(!match)return;
      if(!match[1])owner=match[2]==='class'?match[3]:'';
      result.push({name:match[3],label:match[2]==='def'&&owner?`${owner}.${match[3]}`:match[3],line:index+1});
    });
    return result;
  }
  function compare(files,path,entries){
    const prefix=path?path+'/':'',result=entries.map(entry=>({...entry,path:prefix+entry.name,status:entry.dir?'':Object.hasOwn(files,prefix+entry.name)?entry.same===null?'未比較':entry.same?'同じ':'内容が異なる':'Pico内のみ'}));
    for(const name of Object.keys(files).filter(p=>p.startsWith(prefix))){
      const rest=name.slice(prefix.length),directory=rest.includes('/'),child=rest.split('/')[0];
      if(!result.some(e=>e.name===child))result.push({name:child,path:prefix+child,dir:directory,exists:false,status:'編集中のみ'});
    }
    return result.sort((a,b)=>Number(b.dir)-Number(a.dir)||a.name.localeCompare(b.name));
  }
  function diff(local,remote){
    const a=local===null?[]:local.split('\n'),b=remote===null?[]:remote.split('\n'),rows=[];
    let first=0,last=0;
    while(first<a.length&&first<b.length&&a[first]===b[first]){rows.push({kind:'same',local:a[first],remote:b[first]});first++;}
    while(last<a.length-first&&last<b.length-first&&a[a.length-1-last]===b[b.length-1-last])last++;
    const x=a.slice(first,a.length-last),y=b.slice(first,b.length-last);
    function changed(left,right){const n=Math.max(left.length,right.length);for(let i=0;i<n;i++)rows.push({kind:'changed',local:left[i]??null,remote:right[i]??null});}
    // Bound the LCS table for files with many short lines; a replacement still preserves every line.
    if(x.length*y.length>250000)changed(x,y);
    else{
      const table=Array.from({length:x.length+1},()=>new Uint32Array(y.length+1));
      for(let i=x.length-1;i>=0;i--)for(let j=y.length-1;j>=0;j--)table[i][j]=x[i]===y[j]?table[i+1][j+1]+1:Math.max(table[i+1][j],table[i][j+1]);
      let i=0,j=0,left=[],right=[];
      while(i<x.length||j<y.length){
        if(i<x.length&&j<y.length&&x[i]===y[j]){changed(left,right);left=[];right=[];rows.push({kind:'same',local:x[i++],remote:y[j++]});}
        else if(i<x.length&&(j===y.length||table[i+1][j]>=table[i][j+1]))left.push(x[i++]);
        else right.push(y[j++]);
      }
      changed(left,right);
    }
    for(let k=last;k>0;k--)rows.push({kind:'same',local:a[a.length-k],remote:b[b.length-k]});
    let ln=0,rn=0;return rows.map(r=>({...r,localLine:r.local===null?null:++ln,remoteLine:r.remote===null?null:++rn}));
  }
  const api={validPath,Files,definitions,validateEdits,paths,compare,diff};
  if(typeof module!=='undefined')module.exports=api;
  if(typeof window!=='undefined')window.StudioFiles=api;
})();
