from machine import Pin
from infrared import Transmitter
import time

BUTTON_PIN = 14
TRANSMITTER_PIN = 16
VALUE = 65
UNIT_US = 560

signal = [8 * UNIT_US, 4 * UNIT_US]
for shift in range(7, -1, -1):
    bit = (VALUE >> shift) & 1
    signal.extend([UNIT_US, (3 if bit else 1) * UNIT_US])
signal.append(UNIT_US)

button = Pin(BUTTON_PIN, Pin.IN, Pin.PULL_DOWN)
transmitter = Transmitter(TRANSMITTER_PIN)
previous = 0

try:
    while True:
        pressed = button.value()
        if pressed and not previous:
            time.sleep_ms(20)
            if button.value():
                transmitter.send(signal)
                print(signal)
        previous = pressed
        time.sleep_ms(20)
finally:
    transmitter.close()
