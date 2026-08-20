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

  it('uses only retained pidfd capabilities in the emergency implementation', () => {
    const helper = read('owned_process_emergency.py')
    const supervisor = read('owned-process-supervisor.mjs')
    expect(helper).toContain('os.pidfd_open')
    expect(helper).toContain('signal.pidfd_send_signal')
    expect(helper).not.toMatch(/\bos\.kill\s*\(/)
    expect(helper).not.toContain('SIGTERM')
    expect(supervisor).not.toMatch(/(?:child|process)\.kill\s*\(/)
    expect(supervisor).toContain('owned_process_emergency.py')
    expect(supervisor).toMatch(/setTimeout[\s\S]*helper\.kill\('SIGKILL'\)/)
  })

  it('keeps freeze-to-fixed-point and framed-result guards mutation-sensitive', () => {
    const helper = read('owned_process_emergency.py')
    const supervisor = read('owned-process-supervisor.mjs')
    expect(helper).toMatch(/signal\.SIGSTOP[\s\S]*for iteration in range\(max_freeze_iterations\)/)
    expect(helper).toMatch(/new_capabilities[\s\S]*if not new_capabilities:[\s\S]*converged = True/)
    expect(helper).toContain("FRAME = 'SNL_OWNED_PROCESS_EMERGENCY_RESULT\\t'")
    expect(supervisor).toMatch(/frames\.length !== 1[\s\S]*expected exactly one/)
  })
})
