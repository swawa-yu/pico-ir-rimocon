(() => {
  const signal = `"""Pulse-distance signaling with NEC leader timing; data bits are sent LSB first."""
from machine import Pin, PWM
from time import ticks_us, ticks_diff, sleep_us

UNIT_US = 560
END_UNITS = 8


def receive(pin, timeout_ms=1000):
    times = []
    waiting = ticks_us()
    while pin.value() == 1:
        if ticks_diff(ticks_us(), waiting) >= timeout_ms * 1000:
            return times
    level = 0
    changed = ticks_us()
    shortest_on = 9000
    while True:
        now = ticks_us()
        elapsed = ticks_diff(now, changed)
        current = pin.value()
        if current != level:
            times.append(elapsed)
            if level == 0:
                shortest_on = min(shortest_on, elapsed)
            changed = now
            level = current
        elif level == 1 and elapsed >= shortest_on * END_UNITS:
            return times


def decode(times):
    bits = []
    if len(times) < 3:
        return bits
    if not (7000 <= times[0] <= 11000 and 3000 <= times[1] <= 6000):
        return bits
    for i in range(2, len(times) - 1, 2):
        on = times[i]
        off = times[i + 1]
        bits.append(1 if off >= on * 2 else 0)
    return bits


def to_number(bits):
    number = 0
    for i in range(len(bits)):
        number = number + bits[i] * (2 ** i)
    return number


def to_times(bits):
    times = [9000, 4500]
    for bit in bits:
        times.append(UNIT_US)
        times.append(UNIT_US * 3 if bit else UNIT_US)
    times.append(UNIT_US)
    return times


def send(pwm, times):
    try:
        for i in range(len(times)):
            pwm.duty_u16(21845 if i % 2 == 0 else 0)
            sleep_us(times[i])
    finally:
        pwm.duty_u16(0)
`;
  const main = `from machine import Pin, PWM
from time import sleep_ms
from ir_signal import receive, decode, to_number, to_times, send

MODE = "receive"
RECEIVE_PIN = 15
SEND_PIN = 16

if MODE == "send":
    output = PWM(Pin(SEND_PIN), freq=38000, duty_u16=0)
    bits = [1, 0, 0, 0, 0, 0, 1, 0]
    times = to_times(bits)
    try:
        while True:
            send(output, times)
            sleep_ms(1000)
    finally:
        output.deinit()
else:
    receiver = Pin(RECEIVE_PIN, Pin.IN)
    while True:
        times = receive(receiver)
        if times:
            bits = decode(times)
            print("times us:", times)
            print("bits (LSB first):", bits)
            if bits:
                print("number:", to_number(bits))
`;
  const names={UNIT_US:'基本時間',END_UNITS:'終了までの倍率',receive:'受信する',decode:'解読する',to_number:'数値にする',to_times:'時間配列にする',send:'送信する',times:'時間配列',bits:'ビット配列',bit:'ビット',number:'数値',pin:'受信ピン',timeout_ms:'待ち時間ミリ秒',waiting:'待ち始め',level:'前のレベル',changed:'変化した時刻',shortest_on:'最短のON時間',now:'現在時刻',elapsed:'経過時間',current:'現在のレベル',on:'ON時間',off:'OFF時間',i:'位置',pwm:'PWM出力',MODE:'動作',RECEIVE_PIN:'受信ピン番号',SEND_PIN:'送信ピン番号',output:'出力',receiver:'受信入力'};
  function japanese(source){return source.replace(/"[^"]*"|\b[A-Za-z_]\w*\b/g,word=>({'"receive"':'"受信"','"send"':'"送信"','"times us:"':'"時間配列（μs）:"','"bits (LSB first):"':'"ビット配列（下位ビットから）:"','"number:"':'"数値:"'}[word]||names[word]||word));}
  function infrared(jp=false){
    return {parts:[{id:'receiver',name:'赤外線受信',kind:'receiver',pin:15},{id:'remote',name:'赤外線送信',kind:'infrared',pin:16,unit:560}],files:{'main.py':jp?japanese(main):main,'ir_signal.py':jp?japanese(signal):signal}};
  }
  const api={infrared};if(typeof module!=='undefined')module.exports=api;if(typeof window!=='undefined')window.StudioSamples=api;
})();
