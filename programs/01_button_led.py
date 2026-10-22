from machine import Pin
import time

BUTTON_PIN = 14
LED_PIN = 13

button = Pin(BUTTON_PIN, Pin.IN, Pin.PULL_DOWN)
led = Pin(LED_PIN, Pin.OUT)

try:
    while True:
        led.value(button.value())
        time.sleep_ms(10)
finally:
    led.off()
