import {parser} from '@lezer/python';

const children=node=>{const items=[];for(let child=node?.firstChild;child;child=child.nextSibling)items.push(child);return items;};
const isScope=node=>['Script','FunctionDefinition','ClassDefinition'].includes(node.name);

export function callPositions(source,target,owners=[]){
  const positions=[];
  parser.parse(source).iterate({enter(ref){
    const node=ref.node;if(node.name!=='CallExpression'||source.slice(node.firstChild.from,node.firstChild.to)!==target)return;
    const names=[];
    for(let parent=node.parent;parent;parent=parent.parent)if(isScope(parent)&&parent.name!=='Script'){
      const name=parent.getChild('VariableName');if(name)names.unshift(source.slice(name.from,name.to));
    }
    if(JSON.stringify(names)===JSON.stringify(owners))positions.push(node.firstChild.to-1);
  }});
  return positions;
}

export function findDefinition(files,path,position,target=null){
  if(!Object.hasOwn(files,path))return null;
  const trees=new Map();
  const tree=file=>{if(!trees.has(file))trees.set(file,parser.parse(files[file]));return trees.get(file);};
  const text=(node,file)=>node?files[file].slice(node.from,node.to):'';
  const at=(file,offset)=>tree(file).resolveInner(Math.max(0,Math.min(offset,files[file].length)),1);
  function moduleEntity(name,from){
    const dots=name.match(/^\.+/)?.[0].length||0;
    const base=dots?from.split('/').slice(0,-dots):[];
    const module=[...base,...name.slice(dots).split('.').filter(Boolean)].join('/');
    const roots=dots?[module]:[module,'lib/'+module];
    for(const root of roots){
      for(const file of [root+'.py',root+'/__init__.py'])if(Object.hasOwn(files,file))return {kind:'module',path:file,module:root};
      if(Object.keys(files).some(file=>file.startsWith(root+'/')))return {kind:'module',path:null,module:root};
    }
    return null;
  }
  function scopes(context){
    if(context.scope)return [context.scope];
    const result=[];let inFunction=false;
    for(let node=at(context.path,context.position);node;node=node.parent){
      if(node.name==='FunctionDefinition'){result.push(node);inFunction=true;}
      else if(node.name==='Script'||node.name==='ClassDefinition'&&!inFunction)result.push(node);
    }
    return result;
  }
  function binding(scope,name,context){
    const found=[],file=context.path;
    function walk(node){
      if(node!==scope&&['FunctionDefinition','ClassDefinition'].includes(node.name)){
        if(text(node.getChild('VariableName'),file)===name)found.push({kind:node.name==='ClassDefinition'?'class':'function',path:file,node});
        return;
      }
      if(node.name==='AssignStatement'){
        const items=children(node),left=items[0],operator=items.findIndex(n=>n.name==='AssignOp');
        if(left.name==='VariableName'&&text(left,file)===name)found.push({kind:'variable',path:file,node,value:items[operator+1],position:node.from});
      }
      if(node.name==='ImportStatement'){
        const source=text(node,file).replace(/[()\n\\]/g,' '),from=source.match(/^from\s+(\S+)\s+import\s+(.+)$/),plain=source.match(/^import\s+(.+)$/);
        for(const part of (from||plain)?.[from?2:1]?.split(',')||[]){
          const match=part.trim().match(/^(\S+)(?:\s+as\s+(\S+))?$/);if(!match)continue;
          const local=match[2]||(from?match[1]:match[1].split('.')[0]);
          if(local===name)found.push({kind:'import',path:file,node,module:from?from[1]:match[2]?match[1]:local,member:from?match[1]:null});
        }
      }
      for(const child of children(node))walk(child);
    }
    for(const node of children(scope.name==='Script'?scope:scope.getChild('Body')))walk(node);
    return found.filter(item=>item.node.from<=context.position).at(-1)||found.find(item=>['function','class'].includes(item.kind))||null;
  }
  function nameEntity(name,context,seen){
    const key=context.path+':'+context.position+':'+name+':'+(context.scope?.from??'');
    if(seen.has(key))return null;seen=new Set([...seen,key]);
    for(const scope of scopes(context)){
      const item=binding(scope,name,context);
      if(item){
        if(item.kind!=='import')return item;
        const module=moduleEntity(item.module,item.path);
        return item.member?memberEntity(module,item.member,seen):module;
      }
      if(scope.name==='FunctionDefinition'){
        const parameters=children(scope.getChild('ParamList')).filter(n=>n.name==='VariableName');
        if(parameters.some(n=>text(n,context.path)===name)){
          if(parameters[0]&&text(parameters[0],context.path)===name&&scope.parent?.parent?.name==='ClassDefinition')return {kind:'instance',class:{kind:'class',path:context.path,node:scope.parent.parent}};
          return null;
        }
      }
    }
    return null;
  }
  function dereference(entity,seen){
    if(entity?.kind!=='variable')return entity;
    const key=entity.path+':'+entity.node.from+':value';if(seen.has(key))return null;
    return expression(entity.value,{path:entity.path,position:entity.position},new Set([...seen,key]));
  }
  function memberEntity(entity,name,seen){
    entity=dereference(entity,seen);if(!entity)return null;
    if(entity.kind==='module'){
      const value=entity.path?nameEntity(name,{path:entity.path,position:files[entity.path].length,scope:tree(entity.path).topNode},seen):null;
      return value||moduleEntity(entity.module.replace(/\//g,'.')+'.'+name,'main.py');
    }
    const cls=entity.kind==='instance'?entity.class:entity.kind==='class'?entity:null;
    if(!cls)return null;
    const key=cls.path+':'+cls.node.from+':member:'+name;if(seen.has(key))return null;
    seen=new Set([...seen,key]);
    const own=binding(cls.node,name,{path:cls.path,position:cls.node.to});if(own)return own;
    for(const base of children(cls.node.getChild('ArgList'))){
      if(!['VariableName','MemberExpression'].includes(base.name))continue;
      const inherited=memberEntity(expression(base,{path:cls.path,position:cls.node.from},seen),name,seen);
      if(inherited)return inherited;
    }
    return null;
  }
  function expression(node,context,seen,source=files[context.path]){
    if(!node)return null;
    if(node.name==='VariableName')return nameEntity(source.slice(node.from,node.to),context,seen);
    if(node.name==='MemberExpression'){
      const items=children(node);if(items[1]?.name!=='.')return null;
      return memberEntity(expression(items[0],context,seen,source),source.slice(items.at(-1).from,items.at(-1).to),seen);
    }
    if(node.name==='CallExpression'){
      const callee=dereference(expression(node.firstChild,context,seen,source),seen);
      return callee?.kind==='class'?{kind:'instance',class:callee}:null;
    }
    return null;
  }
  let node;
  if(target){node=parser.parse(target).topNode.firstChild?.firstChild;}
  else{
    node=at(path,position);
    let statement=node;while(statement&&statement.name!=='ImportStatement'&&statement.name!=='Script')statement=statement.parent;
    if(statement?.name==='ImportStatement'){
      const source=text(statement,path),match=source.match(/^from\s+(\S+)\s+import\b/);
      if(match){const start=statement.from+match[0].indexOf(match[1]);if(position>=start&&position<start+match[1].length){const module=moduleEntity(match[1],path);if(module?.path)return {path:module.path,line:1,from:0,kind:'module'};}}
    }
    if(!['VariableName','PropertyName'].includes(node.name))node=tree(path).resolveInner(Math.max(0,position-1),1);
    if(node.name==='PropertyName')node=node.parent;
    else if(node.name!=='VariableName')return null;
  }
  let entity=expression(node,{path,position},new Set(),target||files[path]);
  if(entity?.kind==='variable'){
    const value=dereference(entity,new Set());if(value&&['function','class'].includes(value.kind))entity=value;
  }
  if(entity?.kind==='instance')entity=entity.class;
  if(!entity?.path)return null;
  const from=entity.node?.from||0,line=files[entity.path].slice(0,from).split('\n').length;
  return {path:entity.path,line,from};
}

export function definitionPreview(files,destination){
 const source=files[destination?.path];if(typeof source!=='string')return null;
 const tree=parser.parse(source),node=tree.resolveInner(destination.from,1);
 let definition=destination.kind==='module'?null:node;while(definition&&!['FunctionDefinition','ClassDefinition'].includes(definition.name))definition=definition.parent;
 const start=definition?source.lastIndexOf('\n',definition.from-1)+1:0;
 return {path:destination.path,line:destination.line,text:source.slice(start,definition?.to??source.length)};
}
