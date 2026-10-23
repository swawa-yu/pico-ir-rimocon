import {parser} from '@lezer/python';

export function prepare(source){
  const tree=parser.parse(source);let invalid=false;
  tree.iterate({enter(node){if(node.type.isError)invalid=true;}});
  if(invalid)throw Error('1行実行の前にmain.pyの構文を確認してください。');
  if(/@micropython\.(native|viper|asm_)/.test(source))throw Error('native・viper・asmの関数を含むmain.pyは通常実行を使ってください。');
  let hook='_pico_studio_pause';while(source.includes(hook))hook+='_';
  const insertions=[];
  function visit(node,parent){
    const statement=/Statement$/.test(node.name)||['FunctionDefinition','ClassDefinition','DecoratedStatement'].includes(node.name);
    if(statement&&['Script','Body','StatementGroup'].includes(parent?.name)){
      const text=source.slice(node.from,node.to);
      const docstring=node.name==='ExpressionStatement'&&node.firstChild?.name==='String'&&(!node.prevSibling||[':', 'Comment'].includes(node.prevSibling.name));
      if(!docstring&&!/^from\s+__future__\s+import\b/.test(text)){
        const start=source.lastIndexOf('\n',node.from-1)+1,prefix=source.slice(start,node.from),line=source.slice(0,node.from).split('\n').length;
        const compound=['FunctionDefinition','ClassDefinition','DecoratedStatement','IfStatement','ForStatement','WhileStatement','TryStatement','WithStatement','MatchStatement'].includes(node.name);
        insertions.push({offset:node.from,text:`${hook}(${line})`+(compound?'\n'+prefix:'; ')});
      }
    }
    for(let child=node.firstChild;child;child=child.nextSibling)visit(child,node);
  }
  visit(tree.topNode,null);
  let code=source;for(const point of insertions.sort((a,b)=>b.offset-a.offset))code=code.slice(0,point.offset)+point.text+code.slice(point.offset);
  return {code,hook,lines:source.split('\n').length};
}

export class Output {
  constructor(token,onPause){this.token=token;this.onPause=onPause;this.buffer='';}
  feed(text){
    let visible='';
    for(const char of text){
      if(this.buffer||char==='\x1e'){
        this.buffer+=char;
        if(char==='\x1f'){
          const prefix='\x1ePICO_STEP:'+this.token+':',value=this.buffer.slice(prefix.length,-1);
          if(this.buffer.startsWith(prefix)&&/^\d+$/.test(value))this.onPause(Number(value));else visible+=this.buffer;
          this.buffer='';
        }else if(this.buffer.length>256){visible+=this.buffer;this.buffer='';}
      }else visible+=char;
    }
    return visible;
  }
  flush(){const text=this.buffer;this.buffer='';return text;}
}
