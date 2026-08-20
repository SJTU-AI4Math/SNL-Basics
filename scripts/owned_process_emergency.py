#!/usr/bin/env python3
"""Fail-closed invalid-anchor cleanup using retained Linux pidfds."""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import select
import signal
import sys
import time
from typing import Protocol

FRAME = 'SNL_OWNED_PROCESS_EMERGENCY_RESULT\t'


class EmergencyError(RuntimeError):
    pass


@dataclass(frozen=True)
class Identity:
    pid: int
    ppid: int
    starttime: str
    state: str


@dataclass
class Capability:
    pid: int
    ppid: int
    starttime: str
    depth: int
    fd: int


class Kernel(Protocol):
    def require_capabilities(self) -> None: ...
    def pidfd_open(self, pid: int) -> int: ...
    def read_identity(self, pid: int) -> Identity | None: ...
    def list_pids(self) -> list[int]: ...
    def send(self, fd: int, sig: int) -> None: ...
    def ready(self, fd: int, timeout: float) -> bool: ...
    def close(self, fd: int) -> None: ...
    def sleep(self, seconds: float) -> None: ...


class LinuxKernel:
    def require_capabilities(self) -> None:
        if not sys.platform.startswith('linux'):
            raise EmergencyError('pidfd emergency cleanup requires Linux')
        if not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
            raise EmergencyError('pidfd emergency cleanup capability is unavailable')

    def pidfd_open(self, pid: int) -> int:
        return os.pidfd_open(pid, 0)

    def read_identity(self, pid: int) -> Identity | None:
        try:
            text = Path(f'/proc/{pid}/stat').read_text()
        except FileNotFoundError:
            return None
        end = text.rfind(')')
        if end < 0:
            raise EmergencyError(f'malformed /proc identity for PID {pid}')
        fields = text[end + 2:].split()
        if len(fields) < 20:
            raise EmergencyError(f'malformed /proc identity fields for PID {pid}')
        return Identity(pid=pid, state=fields[0], ppid=int(fields[1]), starttime=fields[19])

    def list_pids(self) -> list[int]:
        return [int(entry.name) for entry in Path('/proc').iterdir() if entry.name.isdigit()]

    def send(self, fd: int, sig: int) -> None:
        signal.pidfd_send_signal(fd, sig, None, 0)

    def ready(self, fd: int, timeout: float) -> bool:
        poller = select.poll()
        poller.register(fd, select.POLLIN)
        return bool(poller.poll(max(0, int(timeout * 1000))))

    def close(self, fd: int) -> None:
        os.close(fd)

    def sleep(self, seconds: float) -> None:
        time.sleep(seconds)


def _open_verified(pid: int, expected_starttime: str, kernel: Kernel) -> tuple[int, Identity]:
    try:
        fd = kernel.pidfd_open(pid)
    except ProcessLookupError as error:
        raise EmergencyError(f'owned process PID {pid} disappeared before pidfd acquisition') from error
    try:
        actual = kernel.read_identity(pid)
        if actual is None or actual.starttime != expected_starttime:
            raise EmergencyError(f'owned process identity mismatch for PID {pid}')
        return fd, actual
    except BaseException:
        kernel.close(fd)
        raise


def _snapshot(kernel: Kernel) -> dict[int, Identity]:
    result: dict[int, Identity] = {}
    for pid in kernel.list_pids():
        identity = kernel.read_identity(pid)
        if identity is not None:
            result[pid] = identity
    return result


def _descendant_depths(root: Capability, snapshot: dict[int, Identity]) -> dict[int, int]:
    depths = {root.pid: 0}
    changed = True
    while changed:
        changed = False
        for identity in snapshot.values():
            if identity.pid in depths or identity.ppid not in depths:
                continue
            depths[identity.pid] = depths[identity.ppid] + 1
            changed = True
    return depths


def _wait_stopped(capability: Capability, timeout: float, kernel: Kernel) -> None:
    deadline = time.monotonic() + timeout
    while True:
        actual = kernel.read_identity(capability.pid)
        if actual is None or actual.starttime != capability.starttime:
            raise EmergencyError(f'owned process identity changed while freezing PID {capability.pid}')
        if actual.state in ('T', 't'):
            return
        if time.monotonic() >= deadline:
            raise EmergencyError(f'owned process PID {capability.pid} did not stop')
        kernel.sleep(0.005)


def _send_best_effort(capability: Capability, sig: int, kernel: Kernel) -> None:
    try:
        kernel.send(capability.fd, sig)
    except ProcessLookupError:
        pass


def _wait_all_ready(capabilities: list[Capability], timeout: float, kernel: Kernel) -> bool:
    deadline = time.monotonic() + timeout
    for capability in capabilities:
        remaining = max(0.0, deadline - time.monotonic())
        if not kernel.ready(capability.fd, remaining):
            return False
    return True


def emergency_shutdown(
    root_pid: int,
    expected_starttime: str,
    expected_ppid: int | None,
    *,
    kernel: Kernel | None = None,
    max_freeze_iterations: int = 32,
    exit_timeout: float = 3.0,
) -> dict[str, object]:
    """Freeze and kill one owned tree; every signal uses a retained pidfd."""
    kernel = kernel or LinuxKernel()
    kernel.require_capabilities()
    if root_pid <= 0 or not expected_starttime:
        raise EmergencyError('invalid owned direct-child identity')

    capabilities: dict[int, Capability] = {}
    try:
        root_fd, root_identity = _open_verified(root_pid, expected_starttime, kernel)
        if expected_ppid is not None and root_identity.ppid != expected_ppid:
            kernel.close(root_fd)
            raise EmergencyError(f'owned direct-child ancestry mismatch for PID {root_pid}')
        root = Capability(root_pid, root_identity.ppid, root_identity.starttime, 0, root_fd)
        capabilities[root_pid] = root
        kernel.send(root.fd, signal.SIGSTOP)
        _wait_stopped(root, 0.5, kernel)

        converged = False
        for iteration in range(max_freeze_iterations):
            snapshot = _snapshot(kernel)
            depths = _descendant_depths(root, snapshot)
            new_capabilities: list[Capability] = []
            for pid, depth in sorted(depths.items(), key=lambda item: item[1]):
                if pid == root_pid or pid in capabilities:
                    continue
                observed = snapshot[pid]
                parent = capabilities.get(observed.ppid)
                if parent is None or snapshot.get(parent.pid, root_identity).starttime != parent.starttime:
                    continue
                try:
                    fd, verified = _open_verified(pid, observed.starttime, kernel)
                except EmergencyError:
                    continue
                capability = Capability(pid, verified.ppid, verified.starttime, depth, fd)
                try:
                    kernel.send(fd, signal.SIGSTOP)
                except BaseException:
                    kernel.close(fd)
                    raise
                capabilities[pid] = capability
                _wait_stopped(capability, 0.5, kernel)
                new_capabilities.append(capability)
            if not new_capabilities:
                converged = True
                break
            kernel.sleep(0.005)
        if not converged:
            raise EmergencyError(f'owned process tree did not converge after {max_freeze_iterations} freeze iterations')

        ordered = sorted(capabilities.values(), key=lambda item: item.depth, reverse=True)
        for capability in ordered:
            _send_best_effort(capability, signal.SIGKILL, kernel)
        if not _wait_all_ready(ordered, exit_timeout, kernel):
            raise EmergencyError('retained owned process capabilities did not become ready after SIGKILL')
        return {'ok': True, 'retainedCapabilities': len(ordered), 'freezeIterations': iteration + 1}
    except BaseException:
        ordered = sorted(capabilities.values(), key=lambda item: item.depth, reverse=True)
        for capability in ordered:
            _send_best_effort(capability, signal.SIGKILL, kernel)
        _wait_all_ready(ordered, min(exit_timeout, 0.5), kernel)
        raise
    finally:
        for capability in capabilities.values():
            try:
                kernel.close(capability.fd)
            except OSError:
                pass


def main(argv: list[str]) -> int:
    try:
        if len(argv) not in (3, 4):
            raise EmergencyError('usage: owned_process_emergency.py PID STARTTIME [EXPECTED_PPID]')
        result = emergency_shutdown(int(argv[1]), argv[2], int(argv[3]) if len(argv) == 4 else None)
        print(FRAME + json.dumps(result, separators=(',', ':')), flush=True)
        return 0
    except BaseException as error:
        result = {'ok': False, 'cleanupIncomplete': True, 'message': str(error)}
        print(FRAME + json.dumps(result, separators=(',', ':')), flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
