(() => {
  'use strict';
  class Connections {
    constructor(REPL){
      this.roles={program:'1',observer:'1'};this.watchers={};this.listeners=new Set();
      this.devices=['1','2'].map(id=>{
        const item={id,state:'disconnected',task:null,link:null};
        item.link=new REPL({
          onState:state=>{item.state=state;this.emit(item,'onState',state);this.changed();},
          onOutput:(...args)=>this.emit(item,'onOutput',...args),
          onIdleOutput:text=>this.emit(item,'onIdleOutput',text)
        });return item;
      });
    }
    entry(role){return this.devices.find(item=>item.id===this.roles[role]);}
    emit(item,event,...args){for(const [role,watcher] of Object.entries(this.watchers))if(this.roles[role]===item.id)watcher[event]?.(...args);}
    changed(){for(const listener of this.listeners)listener();}
    select(role,id){
      if(!this.devices.some(item=>item.id===id))throw Error('Picoを選んでください。');
      if(this.entry(role).link.busy)throw Error('処理が終わるまで待ってください。');
      if(this.roles[role]===id)return;
      this.roles[role]=id;this.watchers[role]?.onSelect?.();this.watchers[role]?.onState?.(this.entry(role).state);this.changed();
    }
    forRole(role,watcher){
      this.watchers[role]=watcher;
      const pool=this;
      return new Proxy({}, {get(_,key){
        if(key==='task')return pool.entry(role).task;
        if(key==='state')return pool.entry(role).state;
        if(key==='id')return pool.roles[role];
        if(key==='connect')return async port=>{
          const existing=pool.devices.find(item=>item.link.port===port);
          if(existing){pool.select(role,existing.id);return;}
          await pool.entry(role).link.connect(port);
        };
        const entry=pool.entry(role),value=entry.link[key];
        if(typeof value!=='function')return value;
        return (...args)=>{if(['run','exec','repl'].includes(key))entry.task=role;const result=value.apply(entry.link,args);return result?.finally?result.finally(()=>{pool.emit(entry,'onState',entry.state);pool.changed();}):result;};
      }});
    }
    async requestPort(serial){
      const granted=serial.getPorts?await serial.getPorts():[];
      const available=granted.filter(port=>!this.devices.some(item=>item.link.port===port));
      if(available.length===1)return available[0];
      return serial.requestPort();
    }
    bindSelect(element,role){
      const current=()=>typeof role==='function'?role():role;
      const render=()=>{element.replaceChildren();for(const item of this.devices){const option=document.createElement('option');option.value=item.id;option.textContent=`Pico ${item.id}${item.link.port?' · 接続済み':''}`;element.append(option);}element.value=this.roles[current()];};
      this.listeners.add(render);element.addEventListener('change',()=>{this.select(current(),element.value);});render();
    }
  }
  if(typeof module!=='undefined')module.exports={Connections};
  if(typeof window!=='undefined')window.PicoDevices=new Connections(window.PicoREPL);
})();
