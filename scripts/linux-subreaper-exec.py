#!/usr/bin/env python3
"""Set Linux child-subreaper status, verify it, then exec the Node supervisor."""

from __future__ import annotations

import ctypes
import os
import sys

PR_SET_CHILD_SUBREAPER = 36
PR_GET_CHILD_SUBREAPER = 37
TOKEN_ENV = 'SNL_OWNED_SUBREAPER_TOKEN'


def fail(message: str):
    print(f'owned-process subreaper startup failed: {message}', file=sys.stderr, flush=True)
    raise SystemExit(78)


def main(argv: list[str]) -> int:
    if len(argv) != 5:
        fail('usage: linux-subreaper-exec.py NODE SUPERVISOR CONFIG TOKEN')
    if not sys.platform.startswith('linux'):
        fail('prctl child subreaper requires Linux')
    if os.environ.get('SNL_TEST_SUBREAPER_PRCTL_FAILURE') == '1':
        fail('injected prctl(PR_SET_CHILD_SUBREAPER) failure')

    try:
        libc = ctypes.CDLL(None, use_errno=True)
        prctl = libc.prctl
        prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
        prctl.restype = ctypes.c_int
    except BaseException as error:
        fail(f'prctl unavailable: {error}')

    if prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        errno = ctypes.get_errno()
        fail(f'prctl(PR_SET_CHILD_SUBREAPER) failed: [errno {errno}] {os.strerror(errno)}')
    active = ctypes.c_int(0)
    if prctl(PR_GET_CHILD_SUBREAPER, ctypes.addressof(active), 0, 0, 0) != 0:
        errno = ctypes.get_errno()
        fail(f'prctl(PR_GET_CHILD_SUBREAPER) failed: [errno {errno}] {os.strerror(errno)}')
    if active.value != 1:
        fail('prctl child subreaper verification returned inactive')

    node, supervisor, config, token = argv[1:]
    env = os.environ.copy()
    env[TOKEN_ENV] = token
    os.execve(node, [node, supervisor, config], env)
    return 127


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
