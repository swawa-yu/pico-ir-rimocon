const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('');
const B=require('../vendor/blockly/blockly_compressed.js');
B.utils.xml.injectDependencies({document:dom.window.document,DOMParser:dom.window.DOMParser,XMLSerializer:dom.window.XMLSerializer});
require('../vendor/blockly/blocks_compressed.js');
const {pythonGenerator:g}=require('../vendor/blockly/python_compressed.js');
Object.assign(B.Msg,require('../vendor/blockly/msg/ja.js'));
const P=require('../pico-blocks.js');
const {decodeDurations}=require('../live-core.js');
let parts=P.defaults();
P.configure(B,g,()=>parts);

test('part variable names match block labels and generated imports while aliases preserve existing code',()=>{
 const old=parts;parts=[{id:'infrared',name:'赤外線LED',variable:'赤外線LED',aliases:['以前のLED'],kind:'infrared',pin:16,unit:560}];
 const w=new B.Workspace();
 try{
  const start=w.newBlock('pico_start'),on=w.newBlock('pico_carrier');on.setFieldValue('infrared','PART');on.setFieldValue('1','ON');start.getInput('DO').connection.connect(on.previousConnection);
  assert.equal(on.getField('PART').getText(),'赤外線LED');
  const files=generate(w);
  assert.match(files['main.py'],/from parts import 赤外線LED[\s\S]*赤外線LED\.on\(\)/);
  assert.match(files['parts.py'],/赤外線LED = Infrared\(16, unit=560\)\ninfrared = 赤外線LED\n以前のLED = 赤外線LED/);
  const result=spawnSync('python3',['-c',`import sys,types\nm=types.ModuleType('pico_parts')\nclass Infrared:\n def __init__(self,*args,**kwargs): pass\nm.Infrared=Infrared\nsys.modules['pico_parts']=m\nexec(sys.stdin.read())\nassert infrared is 赤外線LED is 以前のLED\n`],{input:files['parts.py'],encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  for(const variable of ['1led','two words','class','__debug__','LED'])assert.throws(()=>P.validateParts([{...parts[0],variable}]),/変数名/);
  assert.throws(()=>P.validateParts([...parts,{id:'other',name:'別のLED',variable:'以前のLED',kind:'led',pin:13}]),/別の部品/);
 }finally{w.dispose();parts=old;}
});
const runtime=require('node:fs').readFileSync(require('node:path').join(__dirname,'../programs/pico_parts.py'),'utf8');
function generate(w){return P.generateProject(B,g,w,parts,runtime,require('../pico-sources.js').ssd1306,null,require('../pico-sources.js'));}
function combined(w){const f=generate(w);return `import types,sys\n_driver=types.ModuleType('pico_parts')\nsys.modules['pico_parts']=_driver\nexec(${JSON.stringify(f['lib/pico_parts.py'])},_driver.__dict__)\n_parts=types.ModuleType('parts')\nsys.modules['parts']=_parts\nexec(${JSON.stringify(f['parts.py'])},_parts.__dict__)\ntry:\n exec(${JSON.stringify(f['main.py'])})\nfinally:\n _driver.close()\n`;} 
function workspace(example){parts=example==='display'?P.displayParts():example==='receive'?[...P.defaults(),{id:'receiver',name:'赤外線受信',kind:'receiver',pin:15}]:example==='peripherals'?P.peripheralParts():example==='pixels'?P.peripheralParts().filter(p=>p.kind==='ssd1306'):example==='fan'?[...P.defaults(),{id:'fan',name:'扇風機',kind:'pwm',pin:20,frequency:25000}]:P.defaults();const w=new B.Workspace();B.serialization.workspaces.load(P.examples[example](),w);return w;}
function python(script,source){const result=spawnSync('python3',['-c',script],{input:source,encoding:'utf8'});assert.equal(result.status,0,JSON.stringify({stderr:result.stderr,stdout:result.stdout,signal:result.signal,error:String(result.error)}));return result.stdout;}

test('all examples generate valid Python and survive block save/load',()=>{
  for(const name of Object.keys(P.examples)){
    const w=workspace(name), code=combined(w);
    for(const file of Object.values(generate(w)))python('import ast,sys;ast.parse(sys.stdin.read())',file);
    const copy=new B.Workspace();B.serialization.workspaces.load(B.serialization.workspaces.save(w),copy);
    assert.equal(combined(copy),code);copy.dispose();w.dispose();
  }
});

test('generated Python emits the same IR timing as the live preview and switches PWM off',()=>{
  const w=workspace('send');
  const block=w.getAllBlocks(false).find(b=>b.type==='pico_send');
  block.getInputTargetBlock('VALUE').setFieldValue(66,'NUM');
  parts=P.defaults();parts.find(p=>p.kind==='infrared').unit=1120;
  const code=combined(w);
  const output=python(`import sys,types,json
source=sys.stdin.read()
durations=[]
pwms=[]
class Pin:
 IN=0; OUT=1; PULL_DOWN=2
 def __init__(self,*a,**k):pass
 def value(self):return 0
 def on(self):pass
 def off(self):pass
class PWM:
 def __init__(self,*a,**k):self.duty=0;self.closed=False;pwms.append(self)
 def duty_u16(self,v):self.duty=v
 def deinit(self):self.closed=True
sys.modules['machine']=types.SimpleNamespace(Pin=Pin,PWM=PWM)
sys.modules['time']=types.SimpleNamespace(sleep_us=durations.append)
exec(source)
assert all(p.duty==0 and p.closed for p in pwms)
print(json.dumps(durations))`,code);
  assert.deepEqual(JSON.parse(output),[...P.signalForByte(66,1120),8*1120]);
  assert.deepEqual(decodeDurations(P.signalForByte(66,1120)).bytes,[66]);w.dispose();parts=P.defaults();
});

test('an interrupted transmission still switches PWM off and deinitializes it',()=>{
  const w=workspace('send'),code=combined(w);
  python(`import sys,types
source=sys.stdin.read();pwms=[]
class Pin:
 IN=0; OUT=1; PULL_DOWN=2
 def __init__(self,*a,**k):pass
 def value(self):return 0
 def on(self):pass
 def off(self):pass
class PWM:
 def __init__(self,*a,**k):self.duty=0;self.closed=False;pwms.append(self)
 def duty_u16(self,v):self.duty=v
 def deinit(self):self.closed=True
class TestInterrupt(BaseException):pass
def interrupt(us):raise TestInterrupt()
sys.modules['machine']=types.SimpleNamespace(Pin=Pin,PWM=PWM)
sys.modules['time']=types.SimpleNamespace(sleep_us=interrupt)
try:exec(source)
except TestInterrupt:pass
assert all(p.duty==0 and p.closed for p in pwms)`,code);w.dispose();
});

test('duplicate pins are rejected, while renaming and rewiring preserve activity code',()=>{
  const w=workspace('button'),before=generate(w)['main.py'];
  parts=P.defaults();parts[0].pin=13;assert.throws(()=>generate(w),/GPIO/);
  parts=P.defaults();parts[0].pin=2;parts[0].name='入力ボタン';
  assert.equal(generate(w)['main.py'],before);
  assert.match(generate(w)['parts.py'],/send_button = Button\(2\)/);
  parts=P.defaults();w.dispose();
});

test('legacy blocks migrate without losing pin and timing settings',()=>{
  const data=P.examples.send();const block=data.blocks.blocks[0].inputs.DO.block;
  block.fields={PIN:'20',UNIT:1120};
  const migrated=P.migrate(data);P.validateParts(migrated.parts);
  const part=migrated.parts.find(p=>p.id===migrated.workspace.blocks.blocks[0].inputs.DO.block.fields.PART);
  assert.equal(part.pin,20);assert.equal(part.unit,1120);
});

test('disabled blocks do not emit cleanup for nonexistent hardware objects',()=>{
  const w=workspace('send');w.getTopBlocks(false)[0].setDisabledReason(true,'MANUALLY_DISABLED');
  const code=combined(w);assert(!generate(w)['main.py'].includes('from parts import'));
  python('import ast,sys;ast.parse(sys.stdin.read())',code);w.dispose();
});

test('preview validates byte values and matches bit order at slow timings',()=>{
  for(const invalid of [-1,256,1.5,NaN])assert.throws(()=>P.signalForByte(invalid,560));
  for(const value of [0,65,66,255])assert.deepEqual(decodeDurations(P.signalForByte(value,56000)).bytes,[value]);
});

test('whole-number division has the same byte value in preview and MicroPython',()=>{
  const w=workspace('send'),send=w.getAllBlocks(false).find(b=>b.type==='pico_send');
  send.getInputTargetBlock('VALUE').dispose();
  const division=w.newBlock('math_arithmetic');division.setFieldValue('DIVIDE','OP');
  for(const [name,value]of [['A',132],['B',2]]){
    const n=w.newBlock('math_number');n.setFieldValue(value,'NUM');division.getInput(name).connection.connect(n.outputConnection);
  }
  send.getInput('VALUE').connection.connect(division.outputConnection);
  assert.equal(P.previewValue(division),66);
  const code=combined(w);
  const result=python(`import sys,types,json
source=sys.stdin.read();durations=[]
class Pin:
 IN=0; OUT=1; PULL_DOWN=2
 def __init__(self,*a,**k):pass
 def value(self):return 0
 def on(self):pass
 def off(self):pass
class PWM:
 def __init__(self,*a,**k):pass
 def duty_u16(self,v):pass
 def deinit(self):pass
sys.modules['machine']=types.SimpleNamespace(Pin=Pin,PWM=PWM)
sys.modules['time']=types.SimpleNamespace(sleep_us=durations.append)
exec(source)
print(json.dumps(durations[:-1]))`,code);
  assert.deepEqual(decodeDurations(JSON.parse(result)).bytes,[66]);w.dispose();
});

test('loading a project rejects missing or mismatched component references',()=>{
  const state=P.examples.send();
  assert.throws(()=>P.validateWorkspace(state,P.defaults().filter(p=>p.kind!=='infrared')),/部品/);
  const next=P.defaults();next.find(p=>p.id==='infrared').kind='led';
  assert.throws(()=>P.validateWorkspace(state,next),/部品/);
  assert.throws(()=>P.validateParts([{id:'import',name:'LED',kind:'led',pin:1}]),/識別子/);
});

test('functions and lists generate executable MicroPython activity code',()=>{
  const w=new B.Workspace();
  const list={type:'lists_create_with',extraState:{itemCount:2},inputs:{
    ADD0:{block:{type:'math_number',fields:{NUM:65}}},ADD1:{block:{type:'math_number',fields:{NUM:66}}}
  }};
  const def={type:'procedures_defreturn',fields:{NAME:'values'},inputs:{RETURN:{block:list}}};
  const call={type:'procedures_callreturn',extraState:{name:'values',params:[]}};
  const set={type:'variables_set',fields:{VAR:{name:'codes'}},inputs:{VALUE:{block:call}}};
  const start={type:'pico_start',inputs:{DO:{block:set}}};
  B.serialization.workspaces.load({blocks:{languageVersion:0,blocks:[def,start]}},w);
  const main=generate(w)['main.py'];
  assert.equal(w.getAllBlocks(false).find(b=>b.type==='procedures_defreturn').getSurroundParent().type,'pico_start');
  assert.match(main,/def values/);assert.match(main,/\[65, 66\]/);
  const map=new Map(),mapped=P.generateProject(B,g,w,parts,runtime,require('../pico-sources.js').ssd1306,map,require('../pico-sources.js'))['main.py'];
  assert.equal(mapped,main);
  const definition=w.getAllBlocks(false).find(b=>b.type==='procedures_defreturn');
  assert.match(main.split('\n')[map.get(definition.id).from-1],/^def values/);
  python('import sys; env={};exec(sys.stdin.read(),env);assert env["codes"] == [65,66]',main);w.dispose();
});

test('detached stacks and values are disabled, reconnecting restores them, and manual disable survives',()=>{
  const w=workspace('send'),start=w.getTopBlocks(false)[0],send=start.getInputTargetBlock('DO');
  send.unplug();generate(w);
  assert.equal(send.isEnabled(),false);assert.equal(send.getInputTargetBlock('VALUE').isEnabled(),false);
  assert(!generate(w)['main.py'].includes('infrared.send'));
  start.getInput('DO').connection.connect(send.previousConnection);generate(w);
  assert.equal(send.isEnabled(),true);assert.match(generate(w)['main.py'],/infrared.send/);
  send.setDisabledReason(true,'MANUALLY_DISABLED');send.unplug();generate(w);
  start.getInput('DO').connection.connect(send.previousConnection);generate(w);
  assert.equal(send.hasDisabledReason('MANUALLY_DISABLED'),true);assert.equal(send.hasDisabledReason('PICO_UNCONNECTED'),false);
  const orphan=w.newBlock('pico_led');orphan.setFieldValue('status_led','PART');
  const copy=new B.Workspace();generate(w);B.serialization.workspaces.load(B.serialization.workspaces.save(w),copy);
  assert(!generate(copy)['main.py'].includes('status_led.on'));
  copy.dispose();w.dispose();
});

test('new component settings validate multiple pins, addresses and RP2040 PWM sharing',()=>{
  P.validateParts(P.peripheralParts());
  const duplicate=P.peripheralParts();duplicate[2].pins[0]=duplicate[0].sda;assert.throws(()=>P.validateParts(duplicate),/GPIO/);
  const pwm=[...P.defaults(),{id:'speaker',name:'音',kind:'speaker',pin:17}];assert.throws(()=>P.validateParts(pwm),/PWM/);
  const screen=P.peripheralParts();screen[0].address=0;assert.throws(()=>P.validateParts(screen),/SSD1306/);
  const dip=P.peripheralParts();dip[2].pins.pop();assert.throws(()=>P.validateParts(dip),/8個/);
  const w=new B.Workspace();const old=parts;parts=[];python('import ast,sys;ast.parse(sys.stdin.read())',generate(w)['parts.py']);parts=old;w.dispose();
});
test('the peripheral example generates a display driver and executes both switch branches',()=>{
  const w=workspace('peripherals'),files=generate(w);
  assert(files['lib/ssd1306.py'].includes('class SSD1306_I2C'));
  for(const on of [true,false])python(`import sys,types,json
source=sys.stdin.read();tones=[];shown=[]
class Pin:
 IN=0;OUT=1;PULL_UP=2
 def __init__(self,pin,*a,**k):self.pin=pin
 def value(self):return 0 if self.pin == 3 and ${on?'True':'False'} else 1
class PWM:
 def __init__(self,*a,**k):self.duty=0
 def freq(self,hz):tones.append(hz)
 def duty_u16(self,duty):self.duty=duty
 def deinit(self):assert self.duty==0
class Screen:
 def __init__(self,*a,**k):pass
 def fill(self,*a):pass
 def fill_rect(self,*a):pass
 def text(self,text,*a):shown.append(text)
 def show(self):pass
sys.modules['machine']=types.SimpleNamespace(Pin=Pin,PWM=PWM,SoftI2C=lambda **k:None)
sys.modules['ssd1306']=types.SimpleNamespace(SSD1306_I2C=Screen)
sys.modules['time']=types.SimpleNamespace(sleep=lambda seconds:None)
exec(source)
assert tones==[${on?880:440}],tones
assert shown==['${on?1:0}'],shown`,combined(w));
  parts=P.defaults();w.dispose();
});

test('speaker ON and OFF are separate operations, and old timed blocks preserve their wait when opened',()=>{
  parts=P.peripheralParts();
  const tone={type:'pico_tone',fields:{PART:'speaker'},inputs:{HZ:{block:{type:'math_number',fields:{NUM:880}}},SECONDS:{block:{type:'math_number',fields:{NUM:2}}}},next:{block:{type:'pico_display_clear',fields:{PART:'screen'}}}};
  const state={blocks:{languageVersion:0,blocks:[{type:'pico_start',inputs:{DO:{block:tone}}}]}};
  const w=new B.Workspace();B.serialization.workspaces.load(P.migrateSpeaker(state),w);
  const code=generate(w)['main.py'];
  assert.match(code,/speaker\.on\(880\)\ntime.sleep\(2\)\nspeaker.off\(\)\nscreen.clear\(\)/);
  assert(!w.getAllBlocks(false).some(b=>b.type==='pico_tone'));
  assert.deepEqual(P.migrateSpeaker(P.migrateSpeaker(state)),P.migrateSpeaker(state));
  assert.equal(state.blocks.blocks[0].inputs.DO.block.type,'pico_tone');
  parts=P.defaults();w.dispose();
});

test('display preview uses the selected display block, DIP values and screen bounds without running Python',()=>{
  const preview=require('../display-preview.js'),w=workspace('peripherals');generate(w);
  assert.deepEqual(preview.command(w,null,parts,'screen',{switches:129}),{row:1,text:'129'});
  const text=w.getAllBlocks(false).find(b=>b.type==='pico_display_text');
  const clear=w.getAllBlocks(false).find(b=>b.type==='pico_display_clear');
  assert.deepEqual(preview.command(w,clear.id,parts,'screen'),{clear:true});
  text.getInputTargetBlock('LINE').setFieldValue(8,'NUM');
  assert.equal(preview.command(w,text.id,parts,'screen').row,8);
  const small=parts.map(p=>p.id==='screen'?{...p,height:32}:p);
  assert.throws(()=>preview.command(w,text.id,small,'screen'),/1〜4/);
  assert.throws(()=>preview.command(w,text.id,parts,'screen',{switches:256}),/0〜255/);
  text.getInputTargetBlock('TEXT').dispose();
  const words=w.newBlock('text');words.setFieldValue('Hello!','TEXT');text.getInput('TEXT').connection.connect(words.outputConnection);
  assert.equal(preview.command(w,text.id,parts,'screen').text,'Hello!');
  words.setFieldValue('日本語','TEXT');assert.throws(()=>preview.command(w,text.id,parts,'screen'),/半角/);
  parts=P.defaults();w.dispose();
});

test('source mapping preserves generated Python and associates selected blocks with their activity lines',()=>{
  for(const example of Object.keys(P.examples)){
    const w=workspace(example),plain=generate(w),map=new Map();
    const mapped=P.generateProject(B,g,w,parts,runtime,require('../pico-sources.js').ssd1306,map,require('../pico-sources.js'));
    assert.equal(mapped['main.py'],plain['main.py'],example);
    const lines=mapped['main.py'].split('\n');
    for(const block of w.getAllBlocks(false)){
      assert(map.has(block.id),block.type+' '+example);
      const range=map.get(block.id);assert(range.from>0&&range.to>=range.from&&range.to<=lines.length);
      if(block.type==='pico_speaker_on')assert(lines.slice(range.from-1,range.to).some(line=>line.includes('speaker.on(')));
      if(block.type==='pico_speaker_on')assert.equal(range.from,range.to);
      if(block.type==='pico_display_text')assert(lines.slice(range.from-1,range.to).some(line=>line.includes(P.variableFor(parts.find(p=>p.id===block.getFieldValue('PART')))+'.text(')));
    }
    w.dispose();
  }
  parts=P.defaults();
});

test('the pixel example draws 64 diagonal pixels and sends the display only after drawing',()=>{
  const w=workspace('pixels'),files=generate(w);
  assert.match(files['main.py'],/screen.pixel\(x, x, 1\)/);
  python(`import sys,types
source=sys.stdin.read();pixels={};shown=[]
class Pin:
 def __init__(self,*a,**k):pass
class Screen:
 def __init__(self,*a,**k):pass
 def fill(self,value):pixels.clear()
 def pixel(self,x,y,value=None):
  if value is None:return pixels.get((x,y),0)
  pixels[x,y]=value
 def show(self):shown.append(dict(pixels))
sys.modules['machine']=types.SimpleNamespace(Pin=Pin,PWM=None,SoftI2C=lambda **k:None)
sys.modules['ssd1306']=types.SimpleNamespace(SSD1306_I2C=Screen)
exec(source)
assert len(shown)==1
assert shown[0]=={(n,n):1 for n in range(64)}
`,combined(w));
  parts=P.defaults();w.dispose();
});

test('console blocks generate input and print, with the entered text reaching output',()=>{
  const w=workspace('console'),main=generate(w)['main.py'];
  const result=python('import builtins,sys;builtins.input=lambda prompt:"ピコ";exec(sys.stdin.read())',main);
  assert.equal(result,'ピコ\n');w.dispose();
});

test('pixel blocks generate reads, writes, fill, coordinate text and an explicit show with preview bounds matching the screen',()=>{
  const preview=require('../display-preview.js'),w=workspace('pixels');
  const block=w.getAllBlocks(false).find(b=>b.type==='pico_display_pixel');
  for(const key of ['X','Y']){
    block.getInputTargetBlock(key).dispose();
    const number=w.newBlock('math_number');number.setFieldValue(key==='X'?127:63,'NUM');block.getInput(key).connection.connect(number.outputConnection);
  }
  generate(w);
  assert.deepEqual(preview.command(w,block.id,parts,'screen'),{op:'pixel',x:127,y:63,value:1});
  block.getInputTargetBlock('Y').setFieldValue(64,'NUM');
  assert.throws(()=>preview.command(w,block.id,parts,'screen'),/座標/);
  block.getInputTargetBlock('Y').setFieldValue(63,'NUM');
  block.getInputTargetBlock('COLOR').setFieldValue(2,'NUM');
  assert.throws(()=>preview.command(w,block.id,parts,'screen'),/0か1/);
  block.getInputTargetBlock('COLOR').dispose();
  const read=w.newBlock('pico_display_get_pixel');read.setFieldValue('screen','PART');block.getInput('COLOR').connection.connect(read.outputConnection);
  const text=w.newBlock('pico_display_text_at');text.setFieldValue('screen','PART');
  const show=w.getAllBlocks(false).find(b=>b.type==='pico_display_show');show.previousConnection.disconnect();
  block.getRootBlock().getInputTargetBlock('DO').getNextBlock().nextConnection.connect(text.previousConnection);text.nextConnection.connect(show.previousConnection);
  assert.match(generate(w)['main.py'],/screen.pixel\(127, 63, screen.pixel\(0, 0\)\)/);
  assert.match(generate(w)['main.py'],/screen.text_at\('', 0, 0\)/);
  parts=P.defaults();w.dispose();
});

test('carrier ON and OFF generate named-part calls with the required import',()=>{
 parts=P.defaults();const w=new B.Workspace();
 B.serialization.workspaces.load({blocks:{languageVersion:0,blocks:[{type:'pico_start',inputs:{DO:{block:{type:'pico_carrier',fields:{PART:'infrared',ON:'1'},next:{block:{type:'pico_carrier',fields:{PART:'infrared',ON:'0'}}}}}}}]}},w);
 const code=generate(w)['main.py'];
 assert.match(code,/from parts import infrared/);
 assert.match(code,/infrared\.on\(\)\ninfrared\.off\(\)/);
 w.dispose();
});

test('BOOTSEL sample switches the infrared carrier on while pressed and off after release',()=>{
 const w=workspace('bootsel');
 try{
  const source=generate(w)['main.py'];
  const output=python(`import sys,types,json
source=sys.stdin.read()
events=[]
parts=types.ModuleType('parts')
class Infrared:
 def on(self):events.append('on')
 def off(self):events.append('off')
parts.infrared=Infrared()
sys.modules['parts']=parts
rp2=types.ModuleType('rp2')
levels=iter([0,1,1,0])
rp2.bootsel_button=lambda: next(levels)
sys.modules['rp2']=rp2
import time
time.sleep=lambda seconds: None
try:
 exec(source)
except StopIteration:
 pass
print(json.dumps(events))
`,source);
  assert.deepEqual(JSON.parse(output),['off','on','on','off']);
 }finally{w.dispose();}
});

test('PWM output generates its configured pin and frequency, percent expression, and rejects conflicting PWM circuits',()=>{
 parts=[{id:'fan',name:'扇風機',kind:'pwm',pin:20,frequency:1000}];
 const w=new B.Workspace();
 try{
  const start=w.newBlock('pico_start'),output=w.newBlock('pico_pwm'),percent=w.newBlock('math_number');
  output.setFieldValue('fan','PART');percent.setFieldValue(25,'NUM');
  start.getInput('DO').connection.connect(output.previousConnection);
  output.getInput('PERCENT').connection.connect(percent.outputConnection);
  const files=generate(w);
  assert.match(files['main.py'],/from parts import fan[\s\S]*fan\.set\(25\)/);
  assert.match(files['parts.py'],/fan = PWMOutput\(20, frequency=1000\)/);
  P.validateParts([...parts,{id:'other',name:'別のPWM',kind:'pwm',pin:21,frequency:1000}]);
  assert.throws(()=>P.validateParts([...parts,{id:'other',name:'別のPWM',kind:'pwm',pin:21,frequency:2000}]),/PWM/);
  assert.throws(()=>P.validateParts([...parts,{id:'other',name:'別のPWM',kind:'pwm',pin:4,frequency:1000}]),/PWM/);
  assert.throws(()=>P.validateParts([{...parts[0],frequency:0}]),/周波数/);
 }finally{w.dispose();parts=P.defaults();}
});

test('fan sample runs only while BOOTSEL is held and changing its percent block changes the output',()=>{
 const w=workspace('fan');
 try{
  const percent=w.getAllBlocks(false).find(b=>b.type==='pico_pwm'&&b.getInputTargetBlock('PERCENT').getFieldValue('NUM')===50).getInputTargetBlock('PERCENT');
  for(const strength of [50,75]){
   percent.setFieldValue(strength,'NUM');
   const output=python(`import sys,types,json,time
source=sys.stdin.read()
events=[]
parts=types.ModuleType('parts')
parts.fan=types.SimpleNamespace(set=lambda percent: events.append(percent))
sys.modules['parts']=parts
rp2=types.ModuleType('rp2')
levels=iter([0,1,1,0])
rp2.bootsel_button=lambda: next(levels)
sys.modules['rp2']=rp2
time.sleep=lambda seconds: None
try:
 exec(source)
except StopIteration:
 pass
print(json.dumps(events))
`,generate(w)['main.py']);
   assert.deepEqual(JSON.parse(output),[0,strength,strength,0]);
  }
 }finally{w.dispose();parts=P.defaults();}
});

test('receiver sample converts captured timing arrays to chronological bits, binary text and an integer',()=>{
 const w=workspace('receive');
 try{
  const files=generate(w),times=P.signalForByte(65,560);
  assert.equal(files['lib/ir_data.py'],require('../pico-sources.js').irData);
  assert.equal(files['lib/live_receiver.py'],require('../pico-sources.js').receiver);
  const output=python(`import sys,types
source=sys.stdin.read()
data=types.ModuleType('ir_data')
exec(${JSON.stringify(files['lib/ir_data.py'])},data.__dict__)
sys.modules['ir_data']=data
packets=iter([[],${JSON.stringify(times)}])
parts=types.ModuleType('parts')
parts.receiver=types.SimpleNamespace(receive=lambda timeout: next(packets))
sys.modules['parts']=parts
try:
 exec(source)
except StopIteration:
 pass
`,files['main.py']);
  assert.match(output,/ビット配列: \[0, 1, 0, 0, 0, 0, 0, 1\]/);
  assert.match(output,/2進文字列: 01000001/);assert.match(output,/整数: 65/);
 }finally{w.dispose();parts=P.defaults();}
});

test('binary practice preserves leading zeroes, converts character codes and edits the last array item',()=>{
 const w=workspace('binary');
 try{
  const files=generate(w);
  const output=python(`import types,sys
m=types.ModuleType('ir_data')
exec(${JSON.stringify(files['lib/ir_data.py'])},m.__dict__)
sys.modules['ir_data']=m
exec(sys.stdin.read())
`,files['main.py']);
  assert.match(output,/2進文字列: 01000001/);assert.match(output,/文字: A/);
  assert.match(output,/00101010 → 42/);assert.match(output,/末尾を1に変更: 00101011/);
 }finally{w.dispose();}
});

test('binary digit ranges preserve leading zeroes, other digits and the original value on invalid edits',()=>{
 python(`import sys
exec(sys.stdin.read())
bits = new_bits(16)
set_bits(bits, 1, 8, 65)
set_bits(bits, 9, 16, 42)
assert bits_to_text(bits) == '0100000100101010'
set_bits(bits, 1, 1, 1)
assert bits_to_text(bits) == '1100000100101010'
for start, end, value in [(0, 8, 0), (1, 17, 0), (8, 1, 0), (1, 8, 256), (1, 8, -1), (1, 8, 1.5)]:
 before = bits[:]
 try:
  set_bits(bits, start, end, value)
 except ValueError:
  pass
 else:
  raise AssertionError((start, end, value))
 assert bits == before
for width in [0, -1, 1.5]:
 try:
  new_bits(width)
 except ValueError:
  pass
 else:
  raise AssertionError(width)
`,require('../pico-sources.js').irData);
});

test('beginner sending keeps all digits and beginner reception decodes the same chronological binary',()=>{
 const samples=require('../studio-samples.js'),sources=require('../pico-sources.js');
 python(`import sys, types, time
sys.modules['machine'] = types.SimpleNamespace(Pin=lambda n: n, PWM=lambda *a, **k: types.SimpleNamespace(duty_u16=lambda value: None, deinit=lambda: None))
ir_data = types.ModuleType('ir_data')
exec(${JSON.stringify(sources.irData)}, ir_data.__dict__)
sys.modules['ir_data'] = ir_data
hardware = types.ModuleType('pico_parts')
exec(${JSON.stringify(runtime)}, hardware.__dict__)
durations = []
time.sleep_us = durations.append
parts = types.ModuleType('parts')
parts.infrared = hardware.Infrared(16)
sys.modules['parts'] = parts
exec(${JSON.stringify(samples.beginner('send').files['main.py'])}, {})
assert ir_data.bits_to_text(ir_data.durations_to_bits(durations[:-1])) == '0100000100101010'
packets = iter([[], durations[:-1]])
receiver = object.__new__(hardware.InfraredReceiver)
receiver.receive = lambda timeout: next(packets)
parts.receiver = receiver
try:
 exec(${JSON.stringify(samples.beginner('receive').files['main.py'])}, {})
except StopIteration:
 pass
before = durations[:]
try:
 parts.infrared.send_bits([0, 2])
except ValueError:
 pass
else:
 raise AssertionError('Invalid digits accepted')
assert durations == before
`,'');
});

test('time arrays transmit exactly the specified ON/OFF intervals, validate before output and stop on interruption',()=>{
 const source=require('../studio-samples.js').beginner('times').files['main.py'];
 python(`import sys, types
intervals=[]
class PWM:
 def __init__(self,*args,**kwargs): self.duty=0
 def duty_u16(self,value): self.duty=value
 def deinit(self): pass
sys.modules['machine']=types.SimpleNamespace(Pin=lambda n:n,PWM=PWM)
clock=types.SimpleNamespace(sleep_us=lambda duration:intervals.append((output.pwm.duty,duration)))
sys.modules['time']=clock
hardware=types.ModuleType('pico_parts')
exec(${JSON.stringify(runtime)},hardware.__dict__)
output=hardware.Infrared(16)
sys.modules['parts']=types.SimpleNamespace(infrared=output)
exec(${JSON.stringify(source)},{})
assert intervals == [(21845,560),(0,560),(21845,560),(0,1680),(21845,560)]
assert output.pwm.duty == 0
output.send_times([100,200])
assert intervals[-2:] == [(21845,100),(0,200)] and output.pwm.duty == 0
for invalid in [[],[560,0],[560,-1],[560,0.5],[float('inf')],[float('nan')],['560'],'560']:
 before=intervals[:]
 try: output.send_times(invalid)
 except ValueError: pass
 else: raise AssertionError(invalid)
 assert intervals == before and output.pwm.duty == 0
def interrupt(duration): raise KeyboardInterrupt()
clock.sleep_us=interrupt
try: output.send_times([560])
except KeyboardInterrupt: pass
else: raise AssertionError('Expected interrupt')
assert output.pwm.duty == 0
`,'');
});

test('RGB parts generate three PWM pins and reject pin, channel and frequency conflicts',()=>{
 const rgb={id:'color_led',name:'フルカラーLED',kind:'rgb',red:0,green:1,blue:2,common_anode:false,frequency:1000};
 parts=[rgb];const w=new B.Workspace();
 try{
  P.validateParts(parts);assert.deepEqual(P.pinsFor(rgb),[0,1,2]);
  const root=w.newBlock('pico_start'),block=w.newBlock('pico_rgb');block.setFieldValue('color_led','PART');root.getInput('DO').connection.connect(block.previousConnection);
  for(const [name,value] of [['RED',25],['GREEN',50],['BLUE',100]]){const n=w.newBlock('math_number');n.setFieldValue(value,'NUM');block.getInput(name).connection.connect(n.outputConnection);}
  const files=generate(w);assert.match(files['main.py'],/color_led\.set\(25, 50, 100\)/);assert.match(files['parts.py'],/RGBLED\(0, 1, 2, common_anode=False, frequency=1000\)/);
  assert.throws(()=>P.validateParts([{...rgb,blue:1}]),/GPIO/);
  assert.throws(()=>P.validateParts([{...rgb,blue:16}]),/PWM/);
  assert.throws(()=>P.validateParts([rgb,{id:'ir',name:'赤外線',kind:'infrared',pin:17,unit:560}]),/PWM/);
  assert.throws(()=>P.validateParts([{...rgb,frequency:0}]),/周波数/);
  assert.throws(()=>P.validateParts([{...rgb,common_anode:undefined}]),/共通端子/);
 }finally{w.dispose();parts=P.defaults();}
});

test('RGB brightness supports both common terminals, rejects invalid values atomically and turns off at close',()=>{
 python(`import sys,types
pwms=[]
class Pin:
 OUT=1
 def __init__(self,n): self.value=None
 def init(self,mode,value): self.value=value
class PWM:
 def __init__(self,pin,**kwargs): self.pin=pin;self.duty=kwargs['duty_u16'];self.closed=False;pwms.append(self)
 def duty_u16(self,value): self.duty=value
 def deinit(self): self.closed=True
sys.modules['machine']=types.SimpleNamespace(Pin=Pin,PWM=PWM)
exec(sys.stdin.read())
for anode in (False,True):
 led=RGBLED(0,1,2,common_anode=anode)
 outputs=led.outputs[:]
 assert [p.duty for p in outputs] == [65535 if anode else 0]*3
 led.set(25,50,100)
 expected=[16384,32768,65535]
 assert [p.duty for p in outputs] == [65535-v if anode else v for v in expected]
 before=[p.duty for p in outputs]
 for values in [(10,-1,20),(10,20,101),(10,float('nan'),20)]:
  try: led.set(*values)
  except ValueError: pass
  else: raise AssertionError(values)
  assert [p.duty for p in outputs] == before
 led.off()
 assert [p.duty for p in outputs] == [65535 if anode else 0]*3
 led.close()
 assert all(p.closed and p.pin.value == (1 if anode else 0) for p in outputs)
close()
`,runtime);
});

test('the first sender repeats 32 zeros, and editing zero to one changes all 32 bits without a button',()=>{
 const source=require('../studio-samples.js').beginner('zero32').files['main.py'];
 assert(!source.includes('rp2'));assert(!source.includes('bootsel'));
 for(const bit of [0,1])python(`import sys,types
frames=[];pauses=[]
class Finished(Exception):pass
class Transmitter:
 def send_bits(self,bits,leader=True):frames.append((bits,leader))
def wait(seconds):
 pauses.append(seconds)
 if len(pauses)==2:raise Finished
sys.modules['parts']=types.SimpleNamespace(infrared=Transmitter())
sys.modules['time']=types.SimpleNamespace(sleep=wait)
try:exec(${JSON.stringify(source.replace('[0]','['+bit+']'))},{})
except Finished:pass
assert frames==[([${bit}]*32,False)]*2
assert pauses==[0.5,0.5]
`,'');
});

test('BOOTSEL sends 32 data bits without a leader and waits half a second after each frame',()=>{
 const source=require('../studio-samples.js').beginner('continuous').files['main.py'];
 python(`import sys,types
intervals=[];pauses=[]
class PWM:
 def __init__(self,*args,**kwargs): self.duty=0;self.closed=False
 def duty_u16(self,value): self.duty=value
 def deinit(self): self.closed=True
sys.modules['machine']=types.SimpleNamespace(Pin=lambda n:n,PWM=PWM)
sys.modules['time']=types.SimpleNamespace(sleep_us=lambda duration:intervals.append((output.pwm.duty,duration)),sleep=lambda seconds:pauses.append(seconds))
hardware=types.ModuleType('pico_parts')
exec(${JSON.stringify(runtime)},hardware.__dict__)
output=hardware.Infrared(16)
sys.modules['parts']=types.SimpleNamespace(infrared=output)
levels=iter([False,False,True,True,False])
sys.modules['rp2']=types.SimpleNamespace(bootsel_button=lambda:next(levels))
try:
 exec(${JSON.stringify(source)},{})
except StopIteration:
 pass
finally:
 hardware.close()
expected=[]
for pressed in [False,False,True,True,False]:
 expected.extend([(21845,560),(0,1680 if pressed else 560)]*32+[(21845,560),(0,4480)])
assert intervals == expected
assert pauses == [0.5]*5
assert output.pwm.duty == 0 and output.pwm.closed
`,'');
});

test('one, eight and thirty-two-bit samples transmit without a leader and their receivers recover the same data',()=>{
 const samples=require('../studio-samples.js'),sources=require('../pico-sources.js');
 python(`import sys,types,io,contextlib
intervals=[]
class PWM:
 def __init__(self,*a,**k): self.duty=0
 def duty_u16(self,value): self.duty=value
 def deinit(self): pass
sys.modules['machine']=types.SimpleNamespace(Pin=lambda n:n,PWM=PWM)
sys.modules['time']=types.SimpleNamespace(sleep_us=intervals.append)
hardware=types.ModuleType('pico_parts')
exec(${JSON.stringify(runtime)},hardware.__dict__)
data=types.ModuleType('ir_data')
exec(${JSON.stringify(sources.irData)},data.__dict__)
sys.modules['ir_data']=data
parts=types.ModuleType('parts');sys.modules['parts']=parts
parts.infrared=hardware.Infrared(16)
for sender,receiver,length in ${JSON.stringify(['one_bit','byte','long'].map((name,i)=>[samples.beginner(name).files['main.py'],samples.beginner(['receive_one','receive_byte','receive_long'][i]).files['main.py'],[1,8,32][i]]))}:
 intervals.clear()
 exec(sender,{})
 times=intervals[:] if length == 1 else intervals[:-1]
 assert len(times) == length * 2 + 1 and times[0] == 560 and times[-1] == 560
 bits=data.durations_to_bits(times,0,2)
 assert len(bits) == length
 if length == 1: assert bits == [1]
 if length == 8: assert data.bits_to_int(bits) == 65
 packets=iter([[],times])
 parts.receiver=types.SimpleNamespace(receive=lambda timeout:next(packets))
 output=io.StringIO()
 with contextlib.redirect_stdout(output):
  try: exec(receiver,{})
  except StopIteration: pass
 assert str(times if length == 1 else bits) in output.getvalue()
 if length == 32: assert output.getvalue().endswith('32\\n')
 assert parts.infrared.pwm.duty == 0
`,'');
});
