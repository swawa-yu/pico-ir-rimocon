"""GP15 active-low IR envelope -> live-analyzer.html over USB serial.

Run this file on Pico, release the editor's USB connection, then connect the
browser. Save as main.py for automatic startup, after backing up any main.py.
20 ms reports target 50 display updates/s; GPIO edges are recorded in hard IRQs.
The 2048-slot ring uses about 10 KiB. An overflow is reported, never overwritten.
IRQ timestamp accuracy and sustained USB throughput require hardware validation.
"""

from array import array
from machine import Pin, disable_irq, enable_irq
import json
import micropython
import time

RECEIVER_PIN = 15
AUXILIARY_OUTPUTS = []
REPORT_INTERVAL_MS = 20
BUFFER_SIZE = 2048
BUFFER_MASK = BUFFER_SIZE - 1


class Recorder:
    def __init__(self, pin_number=RECEIVER_PIN):
        self.pin_number = pin_number
        self.pin = Pin(pin_number, Pin.IN, Pin.PULL_UP)
        self.timestamps = array("I", [0] * BUFFER_SIZE)
        self.states = bytearray(BUFFER_SIZE)
        self.head = 0
        self.tail = 0
        self.lost = 0
        self.on = 1 - self.pin.value()
        self.elapsed = 0
        self.previous_raw = time.ticks_us()
        self.pin.irq(
            handler=self.record_edge,
            trigger=Pin.IRQ_RISING | Pin.IRQ_FALLING,
            hard=True,
        )

    def record_edge(self, pin):
        timestamp = time.ticks_us()
        self.on = 1 - pin.value()
        next_head = (self.head + 1) & BUFFER_MASK
        if next_head == self.tail:
            if self.lost < 32767:
                self.lost += 1
            return
        self.timestamps[self.head] = timestamp
        self.states[self.head] = self.on
        self.head = next_head

    def packet(self, sequence):
        irq_state = disable_irq()
        try:
            raw_now = time.ticks_us()
            stop = self.head
            on = self.on
            lost = self.lost
            self.lost = 0
        finally:
            enable_irq(irq_state)
        delta = time.ticks_diff(raw_now, self.previous_raw)
        self.previous_raw = raw_now
        edges = []
        if delta < 0:
            self.elapsed += 1
            lost += 1
            self.tail = stop
        else:
            self.elapsed += delta
            while self.tail != stop:
                index = self.tail
                timestamp = self.timestamps[index]
                state = self.states[index]
                self.tail = (index + 1) & BUFFER_MASK
                offset = time.ticks_diff(timestamp, raw_now)
                if offset > 0 or self.elapsed + offset < 0:
                    lost += 1
                else:
                    edges.append([self.elapsed + offset, state])
        return {
            "ir": 1,
            "pin": self.pin_number,
            "seq": sequence,
            "time": self.elapsed,
            "on": on,
            "edges": edges,
            "lost": lost,
        }

    def close(self):
        self.pin.irq(handler=None)


def run():
    micropython.alloc_emergency_exception_buf(100)
    recorder = None
    outputs = []
    sequence = 0
    try:
        for pin, level in AUXILIARY_OUTPUTS:
            outputs.append(Pin(pin, Pin.OUT, value=level))
        recorder = Recorder()
        while True:
            print(json.dumps(recorder.packet(sequence)))
            sequence += 1
            time.sleep_ms(REPORT_INTERVAL_MS)
    finally:
        try:
            if recorder is not None:
                recorder.close()
        finally:
            for output in outputs:
                output.init(Pin.IN, pull=None)


if __name__ == "__main__":
    run()
