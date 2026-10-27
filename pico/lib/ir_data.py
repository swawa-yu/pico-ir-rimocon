"""Editable IR frame capture and unsigned binary conversions."""

import time


def _bits(values):
    result = []
    for value in values:
        if value not in (0, 1, '0', '1'):
            raise ValueError('Bits must contain only 0 or 1')
        result.append(int(value))
    return result


def durations_to_bits(durations, skip=2, threshold=2):
    if not isinstance(skip, int) or skip < 0:
        raise ValueError('Skipped intervals must be a nonnegative integer')
    if not isinstance(threshold, (int, float)) or not 0 < threshold < float('inf'):
        raise ValueError('Threshold must be positive and finite')
    if any(not isinstance(t, (int, float)) or not 0 < t < float('inf') for t in durations):
        raise ValueError('Durations must be positive and finite')
    return [1 if durations[i + 1] / durations[i] >= threshold else 0
            for i in range(skip, len(durations) - 1, 2)]


def bits_to_text(bits):
    return ''.join(str(bit) for bit in _bits(bits))


def text_to_bits(text):
    if not isinstance(text, str):
        raise ValueError('Expected a binary string')
    return _bits(text)


def bits_to_int(bits):
    bits = _bits(bits)
    if not bits:
        raise ValueError('Cannot convert an empty bit array to an integer')
    value = 0
    for bit in bits:
        value = (value << 1) | bit
    return value


def int_to_bits(value, width=8):
    if not isinstance(value, int) or value < 0:
        raise ValueError('Expected an unsigned integer')
    if not isinstance(width, int) or width < 1 or value >> width:
        raise ValueError('Bit width is too small or invalid')
    return [(value >> shift) & 1 for shift in range(width - 1, -1, -1)]


def new_bits(width):
    if not isinstance(width, int) or width < 1:
        raise ValueError('Bit width must be a positive integer')
    return [0] * width


def set_bits(bits, start, end, value):
    if not isinstance(bits, list):
        raise ValueError('Expected a bit array')
    if not isinstance(start, int) or not isinstance(end, int) or not 1 <= start <= end <= len(bits):
        raise ValueError('Choose digits from 1 to the bit width, counted from the left')
    replacement = int_to_bits(value, end - start + 1)
    _bits(bits)
    bits[start - 1:end] = replacement


class Receiver:
    def __init__(self, pin=15):
        from live_receiver import Recorder
        import micropython
        micropython.alloc_emergency_exception_buf(100)
        self.recorder = Recorder(pin)
        self.on = self.recorder.on
        self.changed = 0
        self.active = None
        self.recovering = bool(self.on)
        self.pending = []
        self.index = 0
        self.now = 0
        self.sequence = 0

    def _finish(self, now, ratio):
        if self.active and not self.on and now - self.changed >= self.active[-1] * ratio:
            result = self.active
            self.active = None
            if self.recovering:
                self.recovering = False
                return None
            return result
        return None

    def receive(self, timeout_ms=1000, gap_ratio=8):
        if not isinstance(timeout_ms, int) or timeout_ms < 0:
            raise ValueError('Timeout must be a nonnegative integer')
        if not isinstance(gap_ratio, (int, float)) or not 1 < gap_ratio < float('inf'):
            raise ValueError('Gap ratio must exceed one')
        started = time.ticks_ms()
        polled = False
        while True:
            while self.index < len(self.pending):
                timestamp, on = self.pending[self.index]
                result = self._finish(timestamp, gap_ratio)
                if result is not None:
                    return result
                duration = timestamp - self.changed
                if duration <= 0 or on == self.on:
                    self.close()
                    raise OSError('Invalid IR transitions; restart reception')
                if self.active is not None:
                    self.active.append(duration)
                    if len(self.active) > 4096:
                        self.close()
                        raise OSError('IR frame exceeds 4096 intervals')
                if self.active is None and on:
                    self.active = []
                self.on, self.changed = on, timestamp
                self.index += 1
            result = self._finish(self.now, gap_ratio)
            if result is not None:
                return result
            if polled and self.active is None and time.ticks_diff(time.ticks_ms(), started) >= timeout_ms:
                return []
            self.pending = []
            packet = self.recorder.packet(self.sequence)
            self.sequence += 1
            polled = True
            if packet['lost']:
                self.close()
                raise OSError('IR edges were lost; restart reception')
            self.pending, self.index, self.now = packet['edges'], 0, packet['time']
            if not self.pending:
                time.sleep_ms(1)

    def close(self):
        self.recorder.close()
