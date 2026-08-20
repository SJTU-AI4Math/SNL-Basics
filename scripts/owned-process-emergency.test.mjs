import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')

describe('retained pidfd emergency process-tree shutdown', () => {
  it('passes deterministic PID reuse, identity mismatch, and real tree tests', () => {
    const result = spawnSync('python3', [new URL('./owned-process-emergency.test.py', import.meta.url).pathname], {
      encoding: 'utf8',
      timeout: 15_000,
    })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout + result.stderr).toMatch(/Ran 3 tests/)
  })

  it('uses retained pidfds and reserves numeric group signals for supervisor self-signaling', () => {
    const helper = read('owned_process_emergency.py')
    const supervisor = read('owned-process-supervisor.mjs')
    const parent = read('process-group-cleanup.mjs')
    expect(helper).toContain('os.pidfd_open')
    expect(helper).toContain('signal.pidfd_send_signal')
    expect(helper).not.toMatch(/\bos\.kill\s*\(/)
    expect(helper).not.toContain('SIGTERM')
    expect(parent).not.toMatch(/process\.kill\s*\(\s*-/)
    expect(supervisor).toContain("process.kill(0, 'SIGTERM')")
    expect(supervisor).toContain("process.kill(0, 'SIGKILL')")
    expect(supervisor).toContain('owned_process_emergency.py')
    expect(supervisor).toMatch(/setTimeout[\s\S]*helper\.kill\('SIGKILL'\)/)
  })

  it('keeps freeze-to-fixed-point and framed-result guards mutation-sensitive', () => {
    const helper = read('owned_process_emergency.py')
    const supervisor = read('owned-process-supervisor.mjs')
    expect(helper).toMatch(/signal\.SIGSTOP[\s\S]*for iteration in range\(max_freeze_iterations\)/)
    expect(helper).toMatch(/new_capabilities[\s\S]*if not new_capabilities:[\s\S]*converged = True/)
    expect(helper).toContain("FRAME = 'SNL_OWNED_PROCESS_EMERGENCY_RESULT\\t'")
    expect(supervisor).toMatch(/frames\.length !== 1[\s\S]*framed results/)
  })
})
