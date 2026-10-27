import {parser} from '@lezer/python';
import {inspect,headerInfo} from './python-symbols.mjs';
const children=node=>{const list=[];for(let n=node?.firstChild;n;n=n.nextSibling)list.push(n);return list;};
const builtins=inspect('').declared;
const text=(source,node)=>node?source.slice(node.from,node.to):'';
const union=(a,b)=>new Set([...a,...b]);
const intersection=sets=>new Set([...sets[0]].filter(name=>sets.every(set=>set.has(name))));

function imports(source,node){
 const value=text(source,node).replace(/[()\n\\]/g,' '),from=value.match(/^from\s+\S+\s+import\s+(.+)$/),plain=value.match(/^import\s+(.+)$/);
 return ((from||plain)?.[1]||'').split(',').map(part=>{const pair=part.trim().split(/\s+as\s+/);return pair[1]||(from?pair[0]:pair[0].split('.')[0]);}).filter(Boolean);
}
function globalNames(source){
 const names=new Set(builtins);
 for(const node of children(parser.parse(source).topNode)){
  if(node.name==='ImportStatement')for(const name of imports(source,node))names.add(name);
  if(['FunctionDefinition','ClassDefinition'].includes(node.name))names.add(text(source,node.getChild('VariableName')));
 }
 return names;
}
function analyze(source,{strict=false,initial=[]}={}){
 const tree=parser.parse(source),reads=new Map(),writes=new Set(),inputs=new Set();
 let invalid=false;tree.iterate({enter(n){if(n.type.isError)invalid=true;}});
 if(invalid)throw Error('Pythonの構文を修正してから関数化してください。');
 const read=(name,bound)=>{reads.set(name,(reads.get(name)||0)+1);if(!bound.has(name))inputs.add(name);};
 function bind(node,bound,loop){
  if(node.name==='VariableName'){const name=text(source,node);writes.add(name);bound.add(name);}
  else if(['TupleExpression','ArrayExpression'].includes(node.name)){for(const child of children(node))if(![',','(',')','[',']'].includes(child.name))bind(child,bound,loop);}
  else visit(node,bound,loop);
 }
 function visit(node,bound,loop=0){
  if(!node)return;
  const items=children(node),type=node.name;
  if(['FunctionDefinition','ClassDefinition','ImportStatement','ReturnStatement','YieldExpression','YieldStatement','AwaitExpression','ScopeStatement'].includes(type)){
   if(strict)throw Error('関数・クラス・importの定義や、return・yield・await・global・nonlocalを含む範囲は関数化できません。');
   if(['FunctionDefinition','ClassDefinition'].includes(type)){
    const before=new Set(writes);visit(node.getChild('Body'),new Set(),loop);
    writes.clear();for(const name of before)writes.add(name);
    bound.add(text(source,node.getChild('VariableName')));
   }else if(type==='ImportStatement'){for(const name of imports(source,node))bound.add(name);
   }else if(type==='ReturnStatement')for(const child of items.slice(1))visit(child,bound,loop);
   return;
  }
  if(strict&&(type.includes('Comprehension')||['LambdaExpression','NamedExpression','AssignmentExpression','DeleteStatement','MatchStatement'].includes(type)))throw Error('内包表記・lambda・代入式・del・matchを含む範囲は関数化できません。');
  if(strict&&type==='ExpressionStatement'&&node.firstChild?.name==='String')throw Error('ドキュメント文字列を除いて処理を選択してください。');
  if(['TryStatement','WithStatement'].includes(type)&&strict)throw Error('try・withを含む範囲は、内側の処理を選んでください。');
  if(['BreakStatement','ContinueStatement'].includes(type)){
   if(strict&&!loop)throw Error('選択範囲の外にある繰り返しへのbreak・continueは関数化できません。');
   return;
  }
  if(type==='CallExpression'&&strict&&['locals','globals','eval','exec','super'].includes(text(source,node.firstChild)))throw Error('locals・globals・eval・exec・superを含む範囲は関数化できません。');
  if(type==='AssignStatement'||type==='UpdateStatement'){
   if(strict&&items.filter(node=>node.name==='AssignOp').length>1)throw Error('連続代入を分けてから関数化してください。');
   if(strict&&items.some(node=>node.name==='TypeDef'))throw Error('型注釈付きの代入を含む範囲は関数化できません。');
   const operator=items.findIndex(n=>['AssignOp','UpdateOp'].includes(n.name));
   if(operator>0){
    if(type==='UpdateStatement')visit(items[0],bound,loop);
    for(const child of items.slice(operator+1))visit(child,bound,loop);
    for(const child of items.slice(0,operator))if(child.name!==',')bind(child,bound,loop);
    return;
   }
  }
  if(type==='IfStatement'){
   const branches=[];let hasElse=false;
   for(let i=0;i<items.length;){
    if(['if','elif'].includes(items[i].name)){visit(items[i+1],bound,loop);branches.push(visit(items[i+2],new Set(bound),loop));i+=3;}
    else if(items[i].name==='else'){hasElse=true;branches.push(visit(items[i+1],new Set(bound),loop));i+=2;}else i++;
   }
   if(!hasElse)branches.push(new Set(bound));
   return branches.length?union(bound,intersection(branches)):bound;
  }
  if(type==='ForStatement'||type==='WhileStatement'){
   if(strict&&items.some(node=>['else','async'].includes(node.name)))throw Error('else付きの繰り返しやasyncを含む範囲は関数化できません。');
   const local=new Set(bound);
   if(type==='ForStatement'){visit(items[3],bound,loop);bind(items[1],local,loop);}
   else visit(items[1],bound,loop);
   visit(node.getChild('Body'),local,loop+1);return bound;
  }
  if(type==='VariableName'){
   if(node.parent?.name==='ArgList'&&node.nextSibling?.name==='AssignOp')return;
   read(text(source,node),bound);return;
  }
  for(const child of items){const result=visit(child,bound,loop);if(result instanceof Set)bound=result;}
  return bound;
 }
 const definite=visit(tree.topNode,new Set(initial));
 return {reads,writes,inputs,definite};
}

export function planExtraction(fragment,scopeSource,moduleSource,parameters=[],availableBefore=parameters,preserveAssignments=false){
 const selected=analyze(fragment,{strict:true}),scope=analyze(scopeSource),globals=globalNames(moduleSource);
 let changesScope=false,dynamic=false;
 parser.parse(scopeSource).iterate({enter(ref){const node=ref.node;if(['FunctionDefinition','ClassDefinition'].includes(node.name))return false;if(node.name==='ScopeStatement')changesScope=true;if(node.name==='CallExpression'&&['locals','globals','eval','exec'].includes(text(scopeSource,node.firstChild)))dynamic=true;}});
 parser.parse(moduleSource).iterate({enter(ref){if(ref.name==='ScopeStatement')changesScope=true;}});
 if(changesScope)throw Error('global・nonlocalを使うファイルでは関数化できません。');
 if(dynamic)throw Error('locals・globals・eval・execを使う処理の中では関数化できません。');
 for(const name of [...scope.writes,...parameters])globals.delete(name);
 const inputs=[...selected.inputs].filter(name=>!globals.has(name));
 const unprepared=inputs.filter(name=>selected.writes.has(name)&&!selected.definite.has(name)&&!availableBefore.includes(name));
 if(unprepared.length)throw Error(`「${unprepared.join('、')}」の値を用意する部分も選択してください。`);
 const outputs=[...selected.writes].filter(name=>preserveAssignments||(scope.reads.get(name)||0)>(selected.reads.get(name)||0));
 for(const name of outputs)if(!selected.definite.has(name)&&availableBefore.includes(name)&&!inputs.includes(name))inputs.push(name);
 const uncertain=outputs.filter(name=>!selected.definite.has(name)&&!inputs.includes(name));
 if(uncertain.length)throw Error(`「${uncertain.join('、')}」は条件によって値が決まりません。値を用意する部分も選択してください。`);
 return {parameters:inputs,outputs};
}

export function definedNames(source,initial=[]){return [...analyze(source,{initial}).definite];}

export function validateFunctionName(name,source){
 if(!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)||name!==name.normalize('NFKC')||!headerInfo(name+'()'))throw Error('関数名を確認してください。日本語・英数字・_が使えます。');
 if(inspect(source).declared.has(name))throw Error('その名前は使われています。別の関数名にしてください。');
 return name;
}

export function isPreamble(source){
 return children(parser.parse(source).topNode).every(node=>node.name==='Comment'||node.name==='ImportStatement'||node.name==='ExpressionStatement'&&node.firstChild?.name==='String');
}
