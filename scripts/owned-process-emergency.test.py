import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

MODULE_PATH = Path(__file__).with_name('owned_process_emergency.py')
spec = importlib.util.spec_from_file_location('owned_process_emergency', MODULE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError('could not load emergency helper')
emergency = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = emergency
spec.loader.exec_module(emergency)


class FakeKernel:
    def __init__(self, *, mismatch=False, reuse_after_stop=False):
        self.processes = {10: {'pid': 10, 'ppid': 1, 'starttime': 'root', 'state': 'R', 'alive': True}}
        if mismatch:
            self.processes[10]['starttime'] = 'sentinel'
        self.fd_targets = {}
        self.next_fd = 100
        self.signals = []
        self.reuse_after_stop = reuse_after_stop
        self.original_alive = True
        self.sentinel_alive = mismatch

    def require_capabilities(self): pass
    def pidfd_open(self, pid):
        if pid not in self.processes: raise ProcessLookupError(pid)
        fd = self.next_fd; self.next_fd += 1
        self.fd_targets[fd] = ('original', self.processes[pid]['starttime'])
        return fd
    def read_identity(self, pid):
        value = self.processes.get(pid)
        return None if value is None else emergency.Identity(**{k: value[k] for k in ('pid', 'ppid', 'starttime', 'state')})
    def list_pids(self): return list(self.processes)
    def send(self, fd, sig):
        self.signals.append((fd, sig))
        target, starttime = self.fd_targets[fd]
        if sig == signal.SIGSTOP:
            self.processes[10]['state'] = 'T'
            if self.reuse_after_stop:
                self.processes[10] = {'pid': 10, 'ppid': 1, 'starttime': 'sentinel', 'state': 'R', 'alive': True}
                self.sentinel_alive = True
        elif sig == signal.SIGKILL:
            self.original_alive = False
    def ready(self, fd, timeout): return not self.original_alive
    def close(self, fd): self.fd_targets.pop(fd, None)
    def sleep(self, seconds): pass


class EmergencyShutdownTests(unittest.TestCase):
    def test_retained_pidfd_targets_original_after_numeric_pid_reuse(self):
        kernel = FakeKernel(reuse_after_stop=True)
        with self.assertRaisesRegex(emergency.EmergencyError, 'identity changed'):
            emergency.emergency_shutdown(10, 'root', 1, kernel=kernel)
        self.assertFalse(kernel.original_alive)
        self.assertTrue(kernel.sentinel_alive)
        self.assertEqual([sig for _, sig in kernel.signals], [signal.SIGSTOP, signal.SIGKILL])

    def test_identity_mismatch_sends_zero_signals(self):
        kernel = FakeKernel(mismatch=True)
        with self.assertRaisesRegex(emergency.EmergencyError, 'identity'):
            emergency.emergency_shutdown(10, 'root', 1, kernel=kernel)
        self.assertEqual(kernel.signals, [])
        self.assertTrue(kernel.sentinel_alive)

    @unittest.skipUnless(sys.platform.startswith('linux') and hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'), 'Linux pidfd required')
    def test_real_mutating_descendants_are_all_killed(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory, 'pids')
            leaf = 'import time; time.sleep(60)'
            worker = (
                'import subprocess,sys,time,pathlib; p=pathlib.Path(sys.argv[1]); '
                'end=time.time()+1.5; '
                '\nwhile time.time()<end:\n'
                f' c=subprocess.Popen([sys.executable,"-c",{leaf!r}]); p.open("a").write(str(c.pid)+"\\n"); time.sleep(.01)\n'
                'time.sleep(60)'
            )
            root_source = (
                'import subprocess,sys,time,pathlib; p=pathlib.Path(sys.argv[1]); '
                f'c=subprocess.Popen([sys.executable,"-c",{worker!r},str(p)]); '
                'p.open("a").write(str(c.pid)+"\\n"); time.sleep(60)'
            )
            child = subprocess.Popen([sys.executable, '-c', root_source, str(log)])
            try:
                deadline = time.time() + 3
                while (not log.exists() or len(log.read_text().splitlines()) < 3) and time.time() < deadline:
                    time.sleep(.02)
                identity = emergency.LinuxKernel().read_identity(child.pid)
                self.assertIsNotNone(identity)
                result = emergency.emergency_shutdown(child.pid, identity.starttime, os.getpid())
                self.assertTrue(result['ok'])
                child.wait(timeout=2)
                pids = [int(value) for value in log.read_text().split()]
                self.assertGreater(len(pids), 2)
                for pid in pids:
                    current = emergency.LinuxKernel().read_identity(pid)
                    # pidfd readiness means the task has exited. Linux may expose
                    # that terminal task briefly as zombie (Z) or dead (X/x)
                    # before /proc removes it; none of those states can run.
                    self.assertTrue(
                        current is None or current.state in ('Z', 'X', 'x'),
                        f'PID {pid} survived as {current}',
                    )
            finally:
                if child.poll() is None: child.kill()
                child.wait(timeout=2)


if __name__ == '__main__':
    unittest.main()
