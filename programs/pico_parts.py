from machine import Pin, PWM
import time

_outputs = []


class Button:
    def __init__(self, pin):
        self.pin = Pin(pin, Pin.IN, Pin.PULL_DOWN)

    def is_pressed(self):
        return self.pin.value() == 1


class LED:
    def __init__(self, pin):
        self.pin = Pin(pin, Pin.OUT, value=0)
        _outputs.append(self)

    def on(self):
        self.pin.on()

    def off(self):
        self.pin.off()

    def close(self):
        self.off()


class PWMOutput:
    def __init__(self, pin, frequency=1000):
        if not isinstance(frequency, (int, float)) or not frequency > 0 or frequency != int(frequency):
            raise ValueError("Frequency must be a positive integer")
        self.pwm = PWM(Pin(pin), freq=int(frequency), duty_u16=0)
        _outputs.append(self)

    def set(self, percent):
        if not isinstance(percent, (int, float)) or not 0 <= percent <= 100:
            raise ValueError("PWM output must be from 0 to 100 percent")
        self.pwm.duty_u16(int(percent * 65535 / 100 + 0.5))

    def close(self):
        self.pwm.duty_u16(0)
        self.pwm.deinit()


class RGBLED:
    def __init__(self, red, green, blue, common_anode=False, frequency=1000):
        self.common_anode = common_anode
        self.pins = []
        self.outputs = []
        try:
            for number in (red, green, blue):
                pin = Pin(number)
                self.pins.append(pin)
                self.outputs.append(PWM(pin, freq=frequency, duty_u16=65535 if common_anode else 0))
        except BaseException:
            self.close()
            raise
        _outputs.append(self)

    def set(self, red, green, blue):
        values = (red, green, blue)
        if any(not isinstance(value, (int, float)) or not 0 <= value <= 100 for value in values):
            raise ValueError("RGB brightness must be from 0 to 100 percent")
        for pwm, value in zip(self.outputs, values):
            duty = int(value * 65535 / 100 + 0.5)
            pwm.duty_u16(65535 - duty if self.common_anode else duty)

    def off(self):
        self.set(0, 0, 0)

    def close(self):
        for pwm, pin in zip(self.outputs, self.pins):
            pwm.duty_u16(65535 if self.common_anode else 0)
            pwm.deinit()
            pin.init(Pin.OUT, value=1 if self.common_anode else 0)
        self.outputs = []


class InfraredReceiver:
    def __init__(self, pin):
        self.pin = Pin(pin, Pin.IN, Pin.PULL_UP)
        self.pin_number = pin
        self.receiver = None
        _outputs.append(self)

    def is_on(self):
        return self.pin.value() == 0

    def receive(self, timeout_ms=1000):
        if self.receiver is None:
            from ir_data import Receiver
            self.receiver = Receiver(self.pin_number)
        try:
            return self.receiver.receive(timeout_ms)
        except BaseException:
            self.close()
            raise

    def receive_bits(self, timeout_ms=1000):
        from ir_data import durations_to_bits
        return durations_to_bits(self.receive(timeout_ms))

    def close(self):
        if self.receiver is not None:
            self.receiver.close()
            self.receiver = None


class Infrared:
    def __init__(self, pin, unit=560):
        self.pwm = PWM(Pin(pin), freq=38000, duty_u16=0)
        self.unit = unit
        _outputs.append(self)

    def on(self):
        self.pwm.duty_u16(21845)

    def off(self):
        self.pwm.duty_u16(0)

    def send(self, value):
        if not isinstance(value, (int, float)) or not 0 <= value <= 255 or value != int(value):
            raise ValueError("IR value must be an integer from 0 to 255")
        value = int(value)
        self.send_bits([(value >> shift) & 1 for shift in range(7, -1, -1)])

    def send_bits(self, bits):
        if not bits or any(bit not in (0, 1) for bit in bits):
            raise ValueError("Expected a nonempty array of 0 and 1")
        unit = self.unit
        signal = [8 * unit, 4 * unit]
        for bit in bits:
            signal.extend([unit, (3 if bit else 1) * unit])
        signal.append(unit)
        self.send_times(signal)
        time.sleep_us(8 * unit)

    def send_times(self, times):
        if not isinstance(times, (list, tuple)) or not times or any(
                not isinstance(duration, (int, float)) or not 0 < duration < float('inf') or duration != int(duration)
                for duration in times):
            raise ValueError("Durations must be positive whole microseconds, alternating ON and OFF")
        try:
            for i, duration in enumerate(times):
                self.pwm.duty_u16(21845 if i % 2 == 0 else 0)
                time.sleep_us(int(duration))
        finally:
            self.pwm.duty_u16(0)

    def close(self):
        self.pwm.duty_u16(0)
        self.pwm.deinit()


class Speaker:
    def __init__(self, pin):
        self.pwm = PWM(Pin(pin), freq=440, duty_u16=0)
        _outputs.append(self)

    def on(self, frequency):
        if not isinstance(frequency, (int, float)) or not frequency > 0 or frequency != int(frequency):
            raise ValueError("Frequency must be a positive integer")
        self.pwm.duty_u16(0)
        self.pwm.freq(int(frequency))
        self.pwm.duty_u16(32768)

    def tone(self, frequency, seconds):
        if not seconds >= 0:
            raise ValueError("Duration must be nonnegative")
        try:
            if frequency:
                self.on(frequency)
            else:
                self.off()
            time.sleep(seconds)
        finally:
            self.off()

    def off(self):
        self.pwm.duty_u16(0)

    def close(self):
        self.off()
        self.pwm.deinit()


class DIPSwitch:
    def __init__(self, pins):
        if len(pins) != 8 or len(set(pins)) != 8:
            raise ValueError("DIP switch requires eight distinct GPIOs")
        self.pins = [Pin(pin, Pin.IN, Pin.PULL_UP) for pin in pins]

    def is_on(self, number):
        if number != int(number) or not 1 <= number <= 8:
            raise ValueError("Switch number must be from 1 to 8")
        return self.pins[int(number) - 1].value() == 0

    def value(self):
        return sum((1 << i) for i, pin in enumerate(self.pins) if pin.value() == 0)


class Display:
    def __init__(self, sda, scl, width=128, height=64, address=0x3c):
        self.sda, self.scl = sda, scl
        self.width, self.height, self.address = width, height, address
        self.screen = None

    def _screen(self):
        if self.screen is None:
            from machine import SoftI2C
            from ssd1306 import SSD1306_I2C
            bus = SoftI2C(sda=Pin(self.sda), scl=Pin(self.scl), freq=400000)
            self.screen = SSD1306_I2C(self.width, self.height, bus, addr=self.address)
        return self.screen

    def text(self, value, line=1):
        text = str(value)
        if any(ord(c) < 32 or ord(c) > 126 for c in text):
            raise ValueError("Display text supports ASCII characters")
        if line != int(line) or not 1 <= line <= self.height // 8:
            raise ValueError("Display line is outside the screen")
        screen = self._screen()
        y = (int(line) - 1) * 8
        screen.fill_rect(0, y, self.width, 8, 0)
        screen.text(text, 0, y, 1)
        screen.show()

    def clear(self):
        screen = self._screen()
        screen.fill(0)
        screen.show()

    def _point(self, x, y):
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or x != int(x) or y != int(y) or not 0 <= x < self.width or not 0 <= y < self.height:
            raise ValueError("Pixel coordinates are outside the screen")
        return int(x), int(y)

    def _color(self, value):
        if value not in (0, 1):
            raise ValueError("Pixel value must be 0 or 1")
        return int(value)

    def pixel(self, x, y, value=None):
        x, y = self._point(x, y)
        if value is None:
            return self._screen().pixel(x, y)
        value = self._color(value)
        self._screen().pixel(x, y, value)

    def fill(self, value):
        value = self._color(value)
        self._screen().fill(value)

    def text_at(self, value, x, y):
        x, y = self._point(x, y)
        text = str(value)
        if any(ord(c) < 32 or ord(c) > 126 for c in text):
            raise ValueError("Display text supports ASCII characters")
        self._screen().text(text, x, y, 1)

    def show(self):
        self._screen().show()


def close():
    while _outputs:
        _outputs.pop().close()
