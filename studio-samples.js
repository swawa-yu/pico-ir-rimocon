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
  const api={infrared};if(typeof module!=='undefined')module.exports=api;if(typeof window!=='undefined')window.StudioSamples=api;
})();
