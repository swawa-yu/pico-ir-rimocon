(() => {
  'use strict';
  class PicoREPL {
    constructor({onState=()=>{},onOutput=()=>{},onIdleOutput=null}={}) {
      this.onState=onState;this.onOutput=onOutput;this.onIdleOutput=onIdleOutput;
      this.port=null;this.reader=null;this.writer=null;this.buffer='';
      this.waiter=null;this.running=false;this.busy=false;this.closing=false;
      this.outputStage=0;this.finished=null;
    }
    async connect(port) {
      if(this.port)throw Error('すでにUSB接続しています。');
      await port.open({baudRate:115200});
      this.port=port;
      try {
        this.writer=port.writable.getWriter();
        this.reader=port.readable.getReader();
        this.readTask=this.readLoop().catch(error=>this.onOutput(`USB解放エラー: ${error.message}\n`,true));
        this.onState('connected');
      } catch(error) {await this.release();throw error;}
    }
    async readLoop() {
      const decoder=new TextDecoder();
      try {
        while(true){
          const {value,done}=await this.reader.read();if(done)break;
          const text=decoder.decode(value,{stream:true});
          if(this.running)this.output(text);
          else if(!this.busy&&this.onIdleOutput)this.onIdleOutput(text);
          else {this.buffer=(this.buffer+text).slice(-65536);this.resolveWaiter();}
        }
      } catch(error) {if(!this.closing)this.onOutput(`USB受信エラー: ${error.message}\n`,true);}
      finally {
        this.failWaiter(Error('USB接続が終了しました。'));
        this.finishRun();
        if(this.reader){this.reader.releaseLock();this.reader=null;}
        if(!this.closing)await this.release();
      }
    }
    output(text) {
      for(const character of text){
        if(character==='\x04'){
          this.outputStage++;
          if(this.outputStage===2)this.finishRun();
        } else if(this.outputStage<2){
          if(this.capture){this.capture[this.outputStage===1?'error':'text']+=character;}
          else this.onOutput(character,this.outputStage===1);
        }
      }
    }
    finishRun() {
      const wasRunning=this.running;this.running=false;
      if(this.capture){const c=this.capture;this.capture=null;clearTimeout(c.timer);
        if(this.outputStage!==2)c.reject(Error('USB接続が終了しました。転送結果を確認できません。'));
        else if(c.error)c.reject(Error(c.error.trim()));else c.resolve(c.text);
      }
      if(this.finished){this.finished();this.finished=null;}
      if(wasRunning&&this.port&&!this.closing)this.onState('connected');
    }
    resolveWaiter() {
      if(!this.waiter)return;
      const i=this.buffer.indexOf(this.waiter.marker);if(i===-1)return;
      const waiter=this.waiter;this.waiter=null;clearTimeout(waiter.timer);
      this.buffer=this.buffer.slice(i+waiter.marker.length);waiter.resolve();
    }
    failWaiter(error) {
      if(this.waiter){const w=this.waiter;this.waiter=null;clearTimeout(w.timer);w.reject(error);}
    }
    waitFor(marker,timeout=6000) {
      return new Promise((resolve,reject)=>{
        this.waiter={marker,resolve,reject,timer:setTimeout(()=>this.failWaiter(Error('Picoが応答しません。MicroPythonの導入と接続先を確認してください。')),timeout)};
        this.resolveWaiter();
      });
    }
    async write(data){if(!this.writer)throw Error('USB接続してください。');await this.writer.write(typeof data==='string'?new TextEncoder().encode(data):data);}
    async command(data,marker){this.buffer='';await this.write(data);await this.waitFor(marker);}
    async run(code) {
      if(this.busy||this.running)throw Error('実行中のプログラムを停止してください。');
      if(!this.port)throw Error('プログラム用PicoをUSB接続してください。');
      const bytes=new TextEncoder().encode(code);
      if(bytes.length>32768)throw Error('この試作ではプログラムを32KB以内にしてください。');
      this.busy=true;this.onState('uploading');
      try {
        await this.command('\r\x03\x03\x02','>>> ');
        await this.command('\x01','raw REPL; CTRL-B to exit\r\n>');
        this.buffer='';
        // Pace standard raw-REPL input so small USB receive buffers can drain.
        for(let offset=0;offset<bytes.length;offset+=128){await this.write(bytes.slice(offset,offset+128));await new Promise(resolve=>setTimeout(resolve,10));}
        await this.write('\x04');await this.waitFor('OK');
        this.running=true;this.outputStage=0;this.onState('running');
        const pending=this.buffer;this.buffer='';if(pending)this.output(pending);
      } finally {this.busy=false;if(!this.running&&this.port)this.onState('connected');}
    }
    async repl(source){
      const literal=JSON.stringify(source);
      return this.run(`if '_studio_namespace' not in globals():\n _studio_namespace = {'__name__': '__main__'}\ntry:\n _console_code = compile(${literal}, '<stdin>', 'eval')\nexcept SyntaxError:\n exec(compile(${literal}, '<stdin>', 'exec'), _studio_namespace)\nelse:\n _console_value = eval(_console_code, _studio_namespace)\n if _console_value is not None:\n  print(repr(_console_value))\n`);
    }
    async sendInput(text){
      if(!this.port||!this.running||this.busy||this.capture)throw Error('プログラムの実行中に入力を送れます。');
      if(typeof text!=='string'||/[\x00-\x1f\x7f]/.test(text))throw Error('入力は制御文字を含まない1行にしてください。');
      await this.write(text+'\r');
    }
    async exec(code) {
      if(this.capture||this.running||this.busy)throw Error('実行中の処理を停止してください。');
      let capture;
      const result=new Promise((resolve,reject)=>{
        capture={resolve,reject,text:'',error:'',timer:setTimeout(()=>{
          if(this.capture===capture)this.capture=null;
          reject(Error('Picoの処理結果を確認できません。停止してから再接続してください。'));
        },15000)};
      });
      // Attach the rejection handler before USB I/O can fail.
      result.catch(()=>{});
      this.capture=capture;
      try {await this.run(code);return await result;}
      catch(error){if(this.capture===capture)this.capture=null;clearTimeout(capture.timer);throw error;}
    }
    async stop() {
      if(!this.running)return;
      if(this.busy)throw Error('転送が終わるまで待ってください。');
      this.busy=true;this.onState('stopping');
      let timer;
      try {
        const stopped=new Promise((resolve,reject)=>{
          this.finished=resolve;timer=setTimeout(()=>{this.finished=null;reject(Error('停止に応答がありません。Picoの状態を確認してください。'));},3000);
        });
        await this.write('\x03\x03');await stopped;
      } finally {clearTimeout(timer);this.busy=false;this.onState(!this.port?'disconnected':this.running?'running':'connected');}
    }
    async interrupt(){
      if(this.running)return this.stop();
      if(this.busy||!this.port)throw Error('USB接続と処理の終了を確認してください。');
      this.busy=true;this.onState('stopping');
      try{await this.command('\r\x03\x03\x02','>>> ');}
      finally{this.busy=false;if(this.port)this.onState('connected');}
    }
    async disconnect() {
      if(this.busy)throw Error('転送・停止処理が終わるまで待ってください。');
      if(!this.port)return;
      let stopError;
      if(this.running){try{await this.stop();}catch(error){stopError=error;}}
      this.closing=true;
      try {
        if(this.reader){try{await this.reader.cancel();}catch(_){}await this.readTask;}
        await this.release();
      } finally {this.closing=false;}
      if(stopError)throw Error('USBは切断しましたが、Picoの停止を確認できませんでした。');
    }
    async release() {
      if(this.writer){this.writer.releaseLock();this.writer=null;}
      if(this.port){
        try {await this.port.close();this.port=null;this.running=false;this.onState('disconnected');}
        catch(error){this.onState('close-error');throw error;}
      }
    }
  }
  if(typeof module!=='undefined')module.exports={PicoREPL};
  if(typeof window!=='undefined')window.PicoREPL=PicoREPL;
})();
