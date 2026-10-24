(() => {
  const receive = `from machine import Pin
from time import ticks_us, ticks_diff

receiver = Pin(15, Pin.IN)

while True:
    while receiver.value() == 1:
        pass
    times = []
    level = 0
    changed = ticks_us()
    shortest_on = 9000
    while True:
        now = ticks_us()
        elapsed = ticks_diff(now, changed)
        current = receiver.value()
        if current != level:
            times.append(elapsed)
            if level == 0:
                shortest_on = min(shortest_on, elapsed)
            changed = now
            level = current
        elif level == 1 and elapsed >= shortest_on * 8:
            break
    if len(times) < 3:
        continue
    if not (7000 <= times[0] <= 11000 and 3000 <= times[1] <= 6000):
        continue
    bits = []
    number = 0
    for i in range(2, len(times) - 1, 2):
        on = times[i]
        off = times[i + 1]
        bit = 1 if off >= on * 2 else 0
        bits.append(bit)
        number = number + bit * (2 ** (len(bits) - 1))
    print("times us:", times)
    print("bits (LSB first):", bits)
    print("number:", number)
`;
  const send = `from machine import Pin, PWM
from time import sleep_us

bits = [1, 0, 0, 0, 0, 0, 1, 0]
times = [9000, 4500]
for bit in bits:
    times.append(560)
    times.append(1680 if bit else 560)
times.append(560)

output = PWM(Pin(16), freq=38000, duty_u16=0)
try:
    for i in range(len(times)):
        output.duty_u16(21845 if i % 2 == 0 else 0)
        sleep_us(times[i])
finally:
    output.deinit()
`;
  const names={times:'時間配列',bits:'ビット配列',bit:'ビット',number:'数値',level:'前のレベル',changed:'変化した時刻',shortest_on:'最短のON時間',now:'現在時刻',elapsed:'経過時間',current:'現在のレベル',on:'ON時間',off:'OFF時間',i:'位置',output:'出力',receiver:'受信入力'};
  function japanese(source){return source.replace(/"[^"]*"|\b[A-Za-z_]\w*\b/g,word=>({'"times us:"':'"時間配列（μs）:"','"bits (LSB first):"':'"ビット配列（下位ビットから）:"','"number:"':'"数値:"'}[word]||names[word]||word));}
  function infrared(jp=false,mode='receive'){
    const source=mode==='send'?send:receive;
    return {parts:[],files:{'main.py':jp?japanese(source):source}};
  }
  function basic(name){
    const code={
      console:'value = 65\nprint(value)\n',
      bits:'bits = [1, 0, 0, 0, 0, 0, 1, 0]\nnumber = 0\nfor i in range(len(bits)):\n    number = number + bits[i] * (2 ** i)\nprint(bits)\nprint(number)\n',
      button:'import rp2\nfrom time import sleep\n\nwhile True:\n    pressed = rp2.bootsel_button()\n    print(pressed)\n    sleep(0.05)\n',
      carrier:'from machine import Pin, PWM\nfrom time import sleep\n\noutput = PWM(Pin(16), freq=38000, duty_u16=0)\ntry:\n    output.duty_u16(21845)\n    sleep(0.5)\n    output.duty_u16(0)\nfinally:\n    output.deinit()\n',
      pwm:'from machine import Pin, PWM\nimport rp2\nfrom time import sleep\n\nstrength = 60\noutput = PWM(Pin(20), freq=25000, duty_u16=0)\ntry:\n    while True:\n        if rp2.bootsel_button():\n            output.duty_u16(strength * 65535 // 100)\n        else:\n            output.duty_u16(0)\n        sleep(0.01)\nfinally:\n    output.deinit()\n',
      level:'from machine import Pin\nfrom time import sleep\n\nreceiver = Pin(15, Pin.IN)\nwhile True:\n    level = receiver.value()\n    print(level)\n    sleep(0.05)\n',
      times:receive.slice(0,receive.indexOf('    if len(times)'))+'    print(times)\n',
      decode:'times = [9000, 4500, 560, 1680, 560, 560, 560]\n'+receive.slice(receive.indexOf('    bits = []'),receive.indexOf('    print("times us:"')).replace(/^    /gm,'')+'print(bits)\nprint(number)\n',
      send,
      receive
    }[name];
    if(!code)throw Error('サンプルがありません。');
    return {parts:[],files:{'main.py':code}};
  }
  function organized(mode){
    if(mode==='send'){
      const body=send.slice(send.indexOf('times = '));
      return {parts:[],files:{'main.py':'from ir_signal import send_bits\n\nsend_bits([1, 0, 0, 0, 0, 0, 1, 0])\n','ir_signal.py':'from machine import Pin, PWM\nfrom time import sleep_us\n\ndef send_bits(bits):\n'+body.replace(/^(.+)$/gm,'    $1')}};
    }
    const setup=receive.slice(0,receive.indexOf('while True:'));
    const capture=receive.slice(receive.indexOf('    while receiver.value()'),receive.indexOf('    if len(times)'));
    const decode=receive.slice(receive.indexOf('    bits = []'),receive.indexOf('    print("times us:"'));
    return {parts:[],files:{'ir_signal.py':setup+'def receive_times():\n'+capture+'    return times\n\ndef decode(times):\n'+decode+'    return bits, number\n','main.py':'from ir_signal import receive_times, decode\n\nwhile True:\n    times = receive_times()\n    if len(times) < 3:\n        continue\n    if not (7000 <= times[0] <= 11000 and 3000 <= times[1] <= 6000):\n        continue\n    bits, number = decode(times)\n    print("times us:", times)\n    print("bits (LSB first):", bits)\n    print("number:", number)\n'}};
  }
  function beginner(name){
    const binary = '信号 = [\n    0, 1, 0, 0, 0, 0, 0, 1,\n    0, 0, 1, 0, 1, 0, 1, 0,\n]\n';
    const sender = [{id:'infrared',name:'赤外線LED',kind:'infrared',pin:16,unit:560}];
    const receiver = [{id:'receiver',name:'赤外線受信',kind:'receiver',pin:15}];
    const receiveBits = 'from parts import receiver\nimport ir_data\n\nwhile True:\n    時間 = receiver.receive(1000)\n    if 時間:\n        信号 = ir_data.durations_to_bits(時間, 0, 2)\n        print(信号)\n';
    const examples = {
      one_bit: {parts:sender,code:'from parts import infrared\n\ninfrared.send_times([560, 1680, 560])\n'},
      byte: {parts:sender,code:'from parts import infrared\n\n信号 = [0, 1, 0, 0, 0, 0, 0, 1]\ninfrared.send_bits(信号, leader=False)\n'},
      long: {parts:sender,code:'from parts import infrared\n\n信号 = [\n    0, 1, 0, 0, 0, 0, 0, 1,\n    0, 0, 1, 0, 1, 0, 1, 0,\n    1, 1, 1, 1, 0, 0, 0, 0,\n    0, 0, 0, 0, 1, 1, 1, 1,\n]\ninfrared.send_bits(信号, leader=False)\n'},
      receive_one: {parts:receiver,code:'from parts import receiver\n\nwhile True:\n    時間 = receiver.receive(1000)\n    if 時間:\n        print(時間)\n'},
      receive_byte: {parts:receiver,code:receiveBits},
      receive_long: {parts:receiver,code:receiveBits+'        print(len(信号))\n'},
      continuous: {parts:sender,code:'from parts import infrared\nimport rp2\n\nwhile True:\n    if rp2.bootsel_button():\n        infrared.send_times([560, 1680])\n    else:\n        infrared.send_times([560, 560])\n'},
      times: {parts:sender,code:'from parts import infrared\n\n時間 = [560, 560, 560, 1680, 560]\ninfrared.send_times(時間)\n'},
      button_times: {parts:sender,code:'from parts import infrared\nimport rp2\nimport time\n\n時間 = [560, 560, 560, 1680, 560]\nwhile True:\n    if rp2.bootsel_button():\n        infrared.send_times(時間)\n    time.sleep(0.1)\n'},
      receive_times: {parts:receiver,code:'from parts import receiver\n\nwhile True:\n    時間 = receiver.receive(1000)\n    if 時間:\n        print(時間)\n'},
      number: {parts:[],code:'import ir_data\n\n信号 = [0, 1, 0, 0, 0, 0, 0, 1]\nprint(ir_data.bits_to_int(信号))\n'},
      rgb: {parts:[{id:'color_led',name:'フルカラーLED',kind:'rgb',red:0,green:1,blue:2,common_anode:false,frequency:1000}],code:'from parts import color_led\nimport time\n\ncolor_led.set(100, 0, 0)\ntime.sleep(1)\ncolor_led.set(0, 100, 0)\ntime.sleep(1)\ncolor_led.set(0, 0, 100)\ntime.sleep(1)\ncolor_led.off()\n'},
      console: {parts:[],code:'値 = 65\nprint(値)\n'},
      binary: {parts:[],code:'import ir_data\n\n'+binary+'print(ir_data.bits_to_text(信号))\n'},
      send: {parts:sender,code:'from parts import infrared\n\n'+binary+'infrared.send_bits(信号)\n'},
      button_send: {parts:sender,code:'from parts import infrared\nimport rp2\nimport time\n\n'+binary+'while True:\n    if rp2.bootsel_button():\n        infrared.send_bits(信号)\n    time.sleep(0.1)\n'},
      receive: {parts:receiver,code:'from parts import receiver\n\nwhile True:\n    信号 = receiver.receive_bits(1000)\n    if 信号:\n        print(信号)\n'},
      carrier: {parts:sender,code:'from parts import infrared\nimport rp2\nimport time\n\nwhile True:\n    if rp2.bootsel_button():\n        infrared.on()\n    else:\n        infrared.off()\n    time.sleep(0.01)\n'},
      fan: {parts:[{id:'fan',name:'扇風機',kind:'pwm',pin:20,frequency:25000}],code:'from parts import fan\nimport rp2\nimport time\n\n強さ = 60\nwhile True:\n    if rp2.bootsel_button():\n        fan.set(強さ)\n    else:\n        fan.set(0)\n    time.sleep(0.01)\n'}
    };
    const sample=examples[name];
    if(!sample)throw Error('サンプルがありません。');
    return {parts:sample.parts,files:{'main.py':sample.code}};
  }
  const api={infrared,basic,organized,beginner};if(typeof module!=='undefined')module.exports=api;if(typeof window!=='undefined')window.StudioSamples=api;
})();
