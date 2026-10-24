import {parser} from '@lezer/python';
const builtins=[
 ['print',['value'],'コンソール','値をコンソールに表示します。',false],['input',['message'],'コンソール','入力された文字列を返します。',true],
 ['len',['value'],'配列・文字列','要素数・文字数を返します。',true],['range',['start','stop','step'],'配列','終了値を含まない整数の並びを返します。',true],
 ['int',['value'],'数値','整数へ変換します。',true],['float',['value'],'数値','小数を扱う数値へ変換します。',true],['str',['value'],'文字列','文字列へ変換します。',true],
 ['bin',['value'],'2進数','0b付きの2進文字列を返します。',true],['hex',['value'],'16進数','0x付きの16進文字列を返します。',true],
 ['chr',['code'],'文字列','文字コードに対応する1文字を返します。',true],['ord',['char'],'文字列','1文字の文字コードを返します。',true],
 ['list',['values'],'配列','値をリストに変換します。',true],['sum',['values'],'数値','値の合計を返します。',true],['min',['values'],'数値','最小値を返します。',true],['max',['values'],'数値','最大値を返します。',true],['abs',['value'],'数値','絶対値を返します。',true],['round',['value'],'数値','値を丸めます。',true]
].map(([target,params,group,help,returns])=>({target,params,group:'組み込み / '+group,help,returns}));
const builtinNames=new Set(('__name__ __file__ __import__ __build_class__ abs all any ascii bin bool bytearray bytes callable chr classmethod compile complex delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals map max memoryview min next object oct open ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip BaseException Exception ArithmeticError AssertionError AttributeError EOFError ImportError IndexError KeyError KeyboardInterrupt MemoryError NameError NotImplementedError OSError OverflowError RuntimeError StopIteration SyntaxError SystemExit TypeError ValueError ZeroDivisionError').split(' '));
export function headerInfo(header){
 const source='def '+header+':\n    pass\n',tree=parser.parse(source),fn=tree.topNode.getChild('FunctionDefinition'),params=fn?.getChild('ParamList');
 if(!params||!fn.getChild('VariableName'))return null;
 const names=[];let group=[],required=0,variadic=false;const append=()=>{if(group[0]&&['*','**'].includes(group[0].name))variadic=true;const name=group.find(n=>n.name==='VariableName');if(name){names.push(source.slice(name.from,name.to));if(!group.some(n=>n.name==='AssignOp'||n.name==='*'||n.name==='**'))required++;}group=[];};for(let n=params.firstChild;n;n=n.nextSibling){if(n.name===',')append();else if(!['(',')'].includes(n.name))group.push(n);}append();
 return {name:source.slice(fn.getChild('VariableName').from,fn.getChild('VariableName').to),params:names,required,variadic,from:params.from-4,to:params.to-4};
}
export function sentenceParts(sentence,params){
 const names=[...sentence.matchAll(/\{([\p{L}\p{N}_]+)\}/gu)].map(m=>m[1]);
 return names.length===params.length&&names.every((n,i)=>n===params[i])?sentence.split(/\{[\p{L}\p{N}_]+\}/gu):null;
}
export function inspect(source){
 const tree=parser.parse(source),declared=new Set(builtinNames),issues=[],functions=[];let wildcard=false;
 const text=n=>source.slice(n.from,n.to);
 tree.iterate({enter(ref){const node=ref.node;if(node.type.isError)issues.push({from:node.from,to:Math.max(node.from+1,node.to),message:'Pythonの構文を確認してください。'});
  if(['FunctionDefinition','ClassDefinition'].includes(node.name)){const name=node.getChild('VariableName');if(name)declared.add(text(name));}
  if(node.name==='ParamList')for(let n=node.firstChild;n;n=n.nextSibling)if(n.name==='VariableName')declared.add(text(n));
  if(node.name==='VariableName'&&['for','as'].includes(node.prevSibling?.name))declared.add(text(node));
  if(node.name==='AssignStatement'||node.name==='ForStatement'){const first=node.firstChild;let target=node.name==='ForStatement'?first?.nextSibling:first;if(target?.name==='VariableName')declared.add(text(target));else if(target?.name==='TupleExpression'||target?.name==='ArrayExpression')for(let n=target.firstChild;n;n=n.nextSibling)if(n.name==='VariableName')declared.add(text(n));}
  if(node.name==='ImportStatement'){
   const line=text(node).replace(/[()\n]/g,' '),from=line.match(/^from\s+\S+\s+import\s+(.+)$/),plain=line.match(/^import\s+(.+)$/);
   if(from||plain)for(const part of (from||plain)[1].split(',')){if(part.trim()==='*'){wildcard=true;continue;}const m=part.trim().match(/^(\S+)(?:\s+as\s+(\S+))?$/);if(m)declared.add(m[2]||(from?m[1]:m[1].split('.')[0]));}
  }
 }});
 for(let node=tree.topNode.firstChild;node;node=node.nextSibling)if(node.name==='FunctionDefinition'){
  const body=node.getChild('Body');if(!body)continue;const header=source.slice(node.from+4,body.from),info=headerInfo(header);if(!info)continue;
  let returns=false;
  tree.iterate({from:body.from,to:body.to,enter(ref){if(ref.from>=body.from&&['FunctionDefinition','ClassDefinition'].includes(ref.name))return false;if(ref.name==='ReturnStatement'&&ref.node.firstChild?.nextSibling&&text(ref.node.firstChild.nextSibling)!=='None')returns=true;}});
  const previous=source.slice(0,node.from).trimEnd().split('\n').at(-1),sentence=previous?.match(/^\s*# ブロック:\s*(.*)$/)?.[1]||'';
  functions.push({...info,sentence,returns,help:`${info.name}(${info.params.join(', ')})`,line:source.slice(0,node.from).split('\n').length});
 }
 if(!wildcard)tree.iterate({enter(ref){const n=ref.node;if(n.name!=='VariableName'||declared.has(text(n)))return;const p=n.parent;if(['ImportStatement','ParamList','FunctionDefinition','ClassDefinition'].includes(p?.name))return;if(p?.name==='ArgList'&&n.nextSibling?.name==='AssignOp')return;if(p?.name==='ExceptClause'||p?.name==='CapturePattern')return;issues.push({from:n.from,to:n.to,message:`「${text(n)}」が定義されていません。`});}});
 return {functions,issues,declared};
}
export function catalog(files,path){
 const result=[...builtins],source=files[path]||'',own=inspect(source).functions;
 for(const fn of own)result.push({...fn,target:fn.name,group:'このファイル'});
 for(const [file,text] of Object.entries(files)){
  if(file===path||file.startsWith('lib/')||!file.endsWith('.py'))continue;
  const module=file.replace(/\.py$/,'').replace(/\//g,'.');
  for(const fn of inspect(text).functions){
   const imported=source.match(new RegExp('^from '+module.replace(/\./g,'\\.')+' import ([^\\n]+)','m'));
   const binding=imported?.[1].split(',').map(s=>s.trim()).find(s=>s.split(/\s+as\s+/)[0]===fn.name);
   const alias=source.match(new RegExp('^import '+module.replace(/\./g,'\\.')+'(?: as (\\w+))?\\s*$','m'));
   result.push({...fn,target:binding?(binding.split(/\s+as\s+/)[1]||fn.name):(alias?.[1]||module)+'.'+fn.name,module:binding||alias?'':module,group:file});
  }
 }
 return [...new Map(result.map(fn=>[fn.target,fn])).values()];
}
