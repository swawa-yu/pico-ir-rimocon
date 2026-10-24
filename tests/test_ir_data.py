import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class IRDataTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.packets = []
        self.closed = False
        owner = self

        class Recorder:
            on = 0

            def __init__(self, pin):
                self.pin = pin

            def packet(self, sequence):
                if owner.packets:
                    packet = owner.packets.pop(0)
                    owner.now = max(owner.now, packet['time'])
                    return packet
                return {'edges': [], 'time': owner.now, 'lost': 0}

            def close(self):
                owner.closed = True

        self.modules = patch.dict(sys.modules, {
            'live_receiver': types.SimpleNamespace(Recorder=Recorder),
            'micropython': types.SimpleNamespace(alloc_emergency_exception_buf=lambda size: None),
            'time': types.SimpleNamespace(ticks_ms=lambda: self.now // 1000,
                                          ticks_diff=lambda a, b: a - b,
                                          sleep_ms=lambda ms: setattr(self, 'now', self.now + ms * 1000))
        })
        self.modules.start()
        path = Path(__file__).parents[1] / 'programs/ir_data.py'
        spec = importlib.util.spec_from_file_location('ir_data_test', path)
        self.data = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.data)

    def tearDown(self):
        self.modules.stop()

    def test_leading_zeroes_survive_text_and_array_round_trips(self):
        bits = self.data.int_to_bits(65, 8)
        self.assertEqual(bits, [0, 1, 0, 0, 0, 0, 0, 1])
        self.assertEqual(self.data.bits_to_text(bits), '01000001')
        self.assertEqual(self.data.text_to_bits('01000001'), bits)
        self.assertEqual(self.data.bits_to_int(bits), 65)
        self.assertEqual(self.data.int_to_bits(0, 8), [0] * 8)
        self.assertEqual(self.data.bits_to_text([]), '')

    def test_invalid_bits_widths_and_times_are_rejected(self):
        for text in ['012', '0 1', 'abc']:
            with self.assertRaises(ValueError):
                self.data.text_to_bits(text)
        for value, width in [(256, 8), (-1, 8), (1, 0), (1.5, 8)]:
            with self.assertRaises(ValueError):
                self.data.int_to_bits(value, width)
        with self.assertRaises(ValueError):
            self.data.bits_to_int([])
        for times in [[0, 10], [-1, 2], [1, float('inf')]]:
            with self.assertRaises(ValueError):
                self.data.durations_to_bits(times)

    def test_duration_pairs_use_the_editable_threshold_and_ignore_the_final_on(self):
        times = [4480, 2240, 500, 500, 500, 1000, 500, 1500, 500]
        self.assertEqual(self.data.durations_to_bits(times), [0, 1, 1])
        self.assertEqual(self.data.durations_to_bits(times, 2, 2.5), [0, 0, 1])
        self.assertEqual(self.data.durations_to_bits(times[2:], 0, 2), [0, 1, 1])

    def test_two_frames_in_one_batch_keep_the_next_start_and_omit_terminal_off(self):
        self.packets.append({'edges': [[100, 1], [200, 0], [300, 1], [400, 0], [1200, 1], [1300, 0]], 'time': 2100, 'lost': 0})
        receiver = self.data.Receiver(15)
        self.assertEqual(receiver.receive(), [100, 100, 100])
        self.assertEqual(receiver.receive(), [100])
        receiver.close()
        self.assertTrue(self.closed)

    def test_long_on_is_not_cut_off_and_idle_timeout_returns_an_empty_array(self):
        receiver = self.data.Receiver()
        self.assertEqual(receiver.receive(3), [])
        self.now = 0
        self.packets.extend([
            {'edges': [[100, 1]], 'time': 5000, 'lost': 0},
            {'edges': [[10100, 0]], 'time': 90099, 'lost': 0},
            {'edges': [], 'time': 90100, 'lost': 0},
        ])
        self.assertEqual(receiver.receive(1), [10000])

    def test_nonblocking_receive_still_polls_and_missing_edges_stop_capture(self):
        self.packets.append({'edges': [[100, 1], [200, 0]], 'time': 1000, 'lost': 0})
        self.assertEqual(self.data.Receiver().receive(0), [100])
        self.packets.append({'edges': [], 'time': 2000, 'lost': 1})
        with self.assertRaisesRegex(OSError, 'lost'):
            self.data.Receiver().receive()
        self.assertTrue(self.closed)


if __name__ == '__main__':
    unittest.main()
