import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class Pin:
    IN = 0
    PULL_UP = 1
    IRQ_RISING = 1
    IRQ_FALLING = 2

    def __init__(self, *args):
        self.state = 1

    def value(self):
        return self.state

    def irq(self, **kwargs):
        self.options = kwargs


class ReceiverTests(unittest.TestCase):
    def setUp(self):
        self.clock = 0
        self.disabled = False
        machine = types.SimpleNamespace(Pin=Pin, disable_irq=self.disable, enable_irq=self.enable)
        clock = types.SimpleNamespace(ticks_us=lambda: self.clock, ticks_diff=lambda a,b: (a-b+512)%1024-512)
        spec = importlib.util.spec_from_file_location('live_receiver', Path(__file__).parents[1]/'programs/live_receiver.py')
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'machine':machine, 'micropython':types.SimpleNamespace(), 'time':clock}):
            spec.loader.exec_module(self.module)
        self.recorder = self.module.Recorder()

    def disable(self):
        self.disabled = True
        return 123

    def enable(self, state):
        self.assertEqual(state, 123)
        self.disabled = False

    def edge(self, at, on):
        self.clock = at
        self.recorder.pin.state = 1-on
        self.recorder.record_edge(self.recorder.pin)

    def test_packet_uses_pico_time_and_active_low_edges(self):
        self.edge(10,1)
        self.edge(20,0)
        self.clock=30
        packet=self.recorder.packet(1)
        self.assertEqual(packet['edges'], [[10,1],[20,0]])
        self.assertEqual(packet['time'],30)
        self.assertEqual(packet['on'],0)
        self.assertEqual(packet['lost'],0)
        self.assertFalse(self.disabled)
        self.assertEqual(self.recorder.packet(2)['edges'],[])
        self.assertTrue(self.recorder.pin.options['hard'])

    def test_tick_wrap_keeps_monotonic_times(self):
        self.recorder.previous_raw=1000
        self.recorder.elapsed=1000
        self.edge(1010,1)
        self.edge(5,0)
        self.clock=20
        packet=self.recorder.packet(1)
        self.assertEqual(packet['time'],1044)
        self.assertEqual(packet['edges'],[[1010,1],[1029,0]])

    def test_full_ring_reports_loss_and_does_not_overwrite_unread_edges(self):
        for i in range(self.module.BUFFER_SIZE+10):
            self.edge(i%1024,i%2)
        self.assertEqual(self.recorder.timestamps[0],0)
        self.assertEqual(self.recorder.head,self.module.BUFFER_SIZE-1)
        self.assertEqual(self.recorder.lost,11)
        self.clock=100
        packet=self.recorder.packet(1)
        self.assertGreaterEqual(packet['lost'],11)
        self.assertEqual(self.recorder.lost,0)

    def test_close_releases_interrupt_handler(self):
        self.recorder.close()
        self.assertIsNone(self.recorder.pin.options['handler'])


if __name__=='__main__':
    unittest.main()
