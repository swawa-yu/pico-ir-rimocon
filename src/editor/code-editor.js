export * as blocks from './python-blocks.mjs';
export * as symbols from './python-symbols.mjs';
export * as step from './pico-step.mjs';
export * as definitions from './python-definitions.mjs';
export * as extraction from './python-extract.mjs';
import {basicSetup} from 'codemirror';
import {EditorState, StateEffect, StateField, Compartment} from '@codemirror/state';
import {EditorView, keymap, Decoration, hoverTooltip} from '@codemirror/view';
import {indentWithTab,undo,redo} from '@codemirror/commands';
import {indentUnit} from '@codemirror/language';
import {python} from '@codemirror/lang-python';

export function create(parent,{onChange,onDefinition,onPreview=()=>null,onSave}){
  const documents=new Map(),scrollPositions=new Map();
  let active=null,changing=false,errorRequest=0;
  const access=new Compartment();
  const setHighlight=StateEffect.define();
  const highlights=StateField.define({create:()=>Decoration.none,update(value,transaction){
    if(transaction.docChanged)value=Decoration.none;
    for(const effect of transaction.effects)if(effect.is(setHighlight)){
      value=Decoration.set(effect.value.map(line=>Decoration.line({class:'cm-block-source'}).range(transaction.state.doc.line(line).from)));
    }
    return value;
  },provide:field=>EditorView.decorations.from(field)});
  const setErrors=StateEffect.define();
  const errors=StateField.define({create:()=>Decoration.none,update(value,tr){if(tr.docChanged)value=Decoration.none;for(const effect of tr.effects)if(effect.is(setErrors))value=Decoration.set(effect.value.filter(()=>tr.state.doc.length>0).map(e=>{const from=Math.max(0,Math.min(e.from,tr.state.doc.length-1));return Decoration.mark({class:'cm-source-error',attributes:{title:e.message}}).range(from,Math.min(tr.state.doc.length,Math.max(from+1,e.to)));}),true);return value;},provide:field=>EditorView.decorations.from(field)});
  const extensions=[basicSetup,python(),access.of([]),indentUnit.of('    '),highlights,errors,
    hoverTooltip((view,position)=>{
      const line=view.state.doc.lineAt(position),offset=position-line.from;
      const before=line.text.slice(0,offset).match(/[\p{L}\p{N}_.]+$/u)?.[0]||'',after=line.text.slice(offset).match(/^[\p{L}\p{N}_.]+/u)?.[0]||'';
      if(!before&&!after)return null;
      const info=onPreview(position);if(!info)return null;
      return {pos:position-before.length,end:position+after.length,above:true,create(){
        const dom=document.createElement('div');dom.className='definition-preview';
        const title=document.createElement('div');title.className='definition-preview-title';title.textContent=info.path+':'+info.line;
        const code=document.createElement('pre');code.textContent=info.text;
        const button=document.createElement('button');button.type='button';button.textContent='定義へ移動';button.addEventListener('click',()=>onDefinition(position));
        dom.append(title,code,button);return {dom};
      }};
    },{hideOnChange:true}),
    keymap.of([indentWithTab,{key:'F12',run:()=>{onDefinition(view.state.selection.main.head);return true;}},{key:'Mod-s',run:()=>{onSave();return true;}}]),
    EditorView.domEventHandlers({mousedown(event,view){
      if(event.button!==0||!event.metaKey&&!event.ctrlKey)return false;
      const position=view.posAtCoords({x:event.clientX,y:event.clientY});
      if(position===null)return false;
      event.preventDefault();onDefinition(position);return true;
    }}),
    EditorView.contentAttributes.of({'aria-label':'MicroPythonエディタ'}),
    EditorView.updateListener.of(update=>{if(update.docChanged&&!changing&&active){documents.set(active,update.state);onChange(active,update.state.doc.toString());}}),
    EditorView.theme({'&':{height:'100%',fontSize:'13px'},'.cm-scroller':{overflow:'auto',fontFamily:'ui-monospace, SFMono-Regular, Consolas, monospace'},'.cm-content':{padding:'12px 0'},'.cm-gutters':{backgroundColor:'#f5f7f9',border:'none'},'.cm-block-source':{backgroundColor:'#fff0bf',boxShadow:'inset 3px 0 #d19a21'}})
  ];
  const view=new EditorView({parent,state:EditorState.create({extensions})});
  function setFile(path,text){
    changing=true;
    try{
      if(active){documents.set(active,view.state);scrollPositions.set(active,{top:view.scrollDOM.scrollTop,left:view.scrollDOM.scrollLeft});}
      if(active===path){if(view.state.doc.toString()!==text)view.dispatch({changes:{from:0,to:view.state.doc.length,insert:text}});return;}
      let state=documents.get(path)||EditorState.create({doc:text,extensions});
      if(state.doc.toString()!==text)state=state.update({changes:{from:0,to:state.doc.length,insert:text}}).state;
      active=path;documents.set(path,state);view.setState(state);const scroll=scrollPositions.get(path);view.scrollDOM.scrollTop=scroll?.top||0;view.scrollDOM.scrollLeft=scroll?.left||0;
    }finally{changing=false;}
  }
  function goTo(position){
    const anchor=Math.max(0,Math.min(position,view.state.doc.length));
    view.dispatch({selection:{anchor}});view.scrollDOM.scrollTop=Math.max(0,view.lineBlockAt(anchor).top-view.scrollDOM.clientHeight/2);view.focus();
  }
  return {setFile,goTo,cursor:()=>view.state.selection.main.head,undo:()=>undo(view),redo:()=>redo(view),forget(path){documents.delete(path);scrollPositions.delete(path);},
    setErrors(issues){const request=++errorRequest;queueMicrotask(()=>{if(request===errorRequest)view.dispatch({effects:setErrors.of(issues)});});},
    setReadOnly(value){view.dispatch({effects:access.reconfigure([EditorState.readOnly.of(value),EditorView.editable.of(!value)])});},
    highlightLines(range){
      const lines=range?Array.from({length:range.to-range.from+1},(_,i)=>range.from+i).filter(n=>n>=1&&n<=view.state.doc.lines):[];
      const effects=[setHighlight.of(lines)];
      view.dispatch({effects});
    },
    goLine(number){goTo(view.state.doc.line(Math.max(1,Math.min(number,view.state.doc.lines))).from);},
    word(){const {from,to}=view.state.selection.main;if(from!==to)return view.state.sliceDoc(from,to);const line=view.state.doc.lineAt(from),offset=from-line.from;const before=line.text.slice(0,offset).match(/[\p{L}\p{N}_]+$/u)?.[0]||'';const after=line.text.slice(offset).match(/^[\p{L}\p{N}_]+/u)?.[0]||'';return before+after;}
  };
}
