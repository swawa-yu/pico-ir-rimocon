import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Pin:
    IN, OUT, PULL_UP, PULL_DOWN = range(4)
    levels = {}

    def __init__(self, number, *args, **kwargs):
        self.number = number

    def value(self):
        return self.levels.get(self.number, 1)


class PWM:
    def __init__(self, *args, **kwargs):
        self.frequency = kwargs.get('freq')
        self.duty = kwargs.get('duty_u16', 0)
        self.closed = False

    def freq(self, value):
        self.frequency = value

    def duty_u16(self, value):
        self.duty = value

    def deinit(self):
        self.closed = True


class FrameBuffer:
    def __init__(self, *args):
        self.text_calls = []
        self.width, self.height = args[1:3]
        self.pixels = [0] * (self.width * self.height)

    def fill(self, value):
        self.pixels[:] = [value] * len(self.pixels)

    def fill_rect(self, *args):
        pass

    def text(self, *args):
        self.text_calls.append(args)

    def pixel(self, x, y, value=None):
        index = y * self.width + x
        if value is None:
            return self.pixels[index]
        self.pixels[index] = value


class I2C:
    def __init__(self, **kwargs):
        self.settings = kwargs
        self.transfers = []

    def writeto(self, address, data):
        self.transfers.append((address, bytes(data)))

    def writevto(self, address, chunks):
        self.transfers.append((address, b''.join(chunks)))


class PartsTests(unittest.TestCase):
    def setUp(self):
        Pin.levels = {}
        self.clock = types.SimpleNamespace(sleep=lambda seconds: None)
        self.modules = patch.dict(sys.modules, {
            'machine': types.SimpleNamespace(Pin=Pin, PWM=PWM, SoftI2C=I2C),
            'micropython': types.SimpleNamespace(const=lambda value: value),
            'framebuf': types.SimpleNamespace(FrameBuffer=FrameBuffer, MONO_VLSB=0),
            'time': self.clock,
        })
        self.modules.start()
        sys.modules['ssd1306'] = load('ssd1306', 'programs/ssd1306.py')
        self.parts = load('test_parts_runtime', 'programs/pico_parts.py')

    def tearDown(self):
        self.modules.stop()

    def test_pwm_percent_and_cleanup(self):
        output = self.parts.PWMOutput(20, frequency=2000)
        self.assertEqual(output.pwm.frequency, 2000)
        self.assertEqual(output.pwm.duty, 0)
        for percent, duty in [(0, 0), (25, 16384), (50, 32768), (100, 65535)]:
            output.set(percent)
            self.assertEqual(output.pwm.duty, duty)
        for invalid in [-1, 101, float('nan'), float('inf'), '50']:
            with self.assertRaises(ValueError):
                output.set(invalid)
        self.parts.close()
        self.assertEqual(output.pwm.duty, 0)
        self.assertTrue(output.pwm.closed)

    def test_dip_reads_active_low_and_switch_one_is_the_lowest_bit(self):
        switch = self.parts.DIPSwitch(list(range(8)))
        self.assertEqual(switch.value(), 0)
        Pin.levels = {0: 0, 7: 0}
        self.assertEqual(switch.value(), 129)
        self.assertTrue(switch.is_on(1))
        self.assertFalse(switch.is_on(2))
        with self.assertRaises(ValueError):
            switch.is_on(9)

    def test_ir_carrier_stays_on_until_off_and_cleanup_releases_pwm(self):
        infrared = self.parts.Infrared(14)
        infrared.on()
        self.assertEqual(infrared.pwm.frequency, 38000)
        self.assertEqual(infrared.pwm.duty, 21845)
        infrared.off()
        self.assertEqual(infrared.pwm.duty, 0)
        infrared.on()
        self.parts.close()
        self.assertEqual(infrared.pwm.duty, 0)
        self.assertTrue(infrared.pwm.closed)

    def test_speaker_stays_on_until_off_or_cleanup(self):
        speaker = self.parts.Speaker(2)
        speaker.on(880)
        self.assertEqual(speaker.pwm.frequency, 880)
        self.assertEqual(speaker.pwm.duty, 32768)
        speaker.off()
        self.assertEqual(speaker.pwm.duty, 0)
        speaker.on(440)
        self.parts.close()
        self.assertEqual(speaker.pwm.duty, 0)
        self.assertTrue(speaker.pwm.closed)

    def test_interrupted_legacy_tone_stops_pwm_and_cleanup_releases_it(self):
        speaker = self.parts.Speaker(2)

        def interrupt(seconds):
            raise KeyboardInterrupt()

        self.clock.sleep = interrupt
        with self.assertRaises(KeyboardInterrupt):
            speaker.tone(440, 0.2)
        self.assertEqual(speaker.pwm.duty, 0)
        self.parts.close()
        self.assertTrue(speaker.pwm.closed)

    def test_display_initializes_the_bundled_i2c_driver_on_first_use(self):
        display = self.parts.Display(0, 1, height=64, address=0x3c)
        self.assertIsNone(display.screen)
        display.text(129, 4)
        self.assertEqual(display.screen.text_calls, [('129', 0, 24, 1)])
        bus = display.screen.i2c
        self.assertEqual(bus.settings['sda'].number, 0)
        self.assertEqual(bus.settings['scl'].number, 1)
        self.assertTrue(any(address == 0x3c and data[:1] == b'\x40' and len(data) == 1025 for address, data in bus.transfers))
        with self.assertRaises(ValueError):
            display.text('日本語')

    def test_pixel_edits_are_buffered_until_show_and_validate_coordinates_and_values(self):
        display = self.parts.Display(16, 17)
        for x, y, value in [(-1, 0, 1), (128, 0, 1), (0, 64, 1), (0.5, 0, 1), (0, 0, 2)]:
            with self.assertRaises(ValueError):
                display.pixel(x, y, value)
        self.assertIsNone(display.screen)
        screen = display._screen()
        transfers = len(screen.i2c.transfers)
        for x in range(64):
            display.pixel(x, x, 1)
        self.assertEqual(display.pixel(63, 63), 1)
        self.assertEqual(display.pixel(62, 63), 0)
        self.assertEqual(len(screen.i2c.transfers), transfers)
        display.show()
        self.assertGreater(len(screen.i2c.transfers), transfers)
        display.fill(0)
        self.assertEqual(display.pixel(63, 63), 0)
        display.text_at('Pico', 10, 12)
        self.assertEqual(screen.text_calls[-1], ('Pico', 10, 12, 1))
        with self.assertRaises(ValueError):
            display.text('hello', 9)
