from machine import Pin, PWM
import time


class Receiver:
    def __init__(self, pin=15):
        self.pin = Pin(pin, Pin.IN, Pin.PULL_UP)

    def receive(self, wait_us=100000, gap_us=20000, max_us=200000, max_edges=1024):
        """Return positive ON/OFF durations, starting with ON, or None.

        Active-low receiver. Capture blocks for at most wait_us + max_us.
        Raises ValueError for an incomplete capture. Final idle gap is omitted.
        """
        started = time.ticks_us()
        while self.pin.value():
            if time.ticks_diff(time.ticks_us(), started) >= wait_us:
                return None
        started = changed = time.ticks_us()
        level = 0
        signal = []
        while True:
            now = time.ticks_us()
            current = self.pin.value()
            elapsed = time.ticks_diff(now, changed)
            if current != level:
                signal.append(elapsed)
                if len(signal) >= max_edges:
                    raise ValueError("Too many edges")
                level = current
                changed = now
            elif level == 1 and elapsed >= gap_us:
                return signal
            if time.ticks_diff(now, started) >= max_us:
                raise ValueError("Capture timeout")


class Transmitter:
    def __init__(self, pin=16, frequency=38000):
        self.pwm = PWM(Pin(pin))
        self.pwm.duty_u16(0)
        self.pwm.freq(frequency)

    def send(self, signal):
        """Send positive durations alternating ON/OFF, starting with ON."""
        if not signal or len(signal) > 1024:
            raise ValueError("Invalid signal length")
        if any(not isinstance(t, int) or isinstance(t, bool) or t <= 0 for t in signal):
            raise ValueError("Durations must be positive integers")
        if sum(signal) > 200000:
            raise ValueError("Signal exceeds 200 ms")
        try:
            for i, duration in enumerate(signal):
                self.pwm.duty_u16(21845 if i % 2 == 0 else 0)
                time.sleep_us(duration)
        finally:
            self.pwm.duty_u16(0)

    def close(self):
        self.pwm.duty_u16(0)
        self.pwm.deinit()
