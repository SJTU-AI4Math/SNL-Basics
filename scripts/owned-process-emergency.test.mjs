import { describe, expect, it } from 'vitest'
import { freezeKillProcessTree } from './owned-process-emergency.mjs'

function fakeTree({ injectOnStop = false } = {}) {
  let resolveExit
  const childExit = new Promise(resolve => { resolveExit = resolve })
  const processes = new Map([
    [10, { pid: 10, ppid: 1, starttime: 'root', state: 'R' }],
    [20, { pid: 20, ppid: 10, starttime: 'worker', state: 'R' }],
  ])
  const calls = []
  let injected = false
  const child = {
    pid: 10,
    kill(signal) {
      calls.push({ via: 'handle', pid: 10, signal })
      const current = processes.get(10)
      if (!current) return false
      if (signal === 'SIGSTOP') current.state = 'T'
      if (signal === 'SIGCONT') current.state = 'R'
      if (signal === 'SIGKILL') { processes.delete(10); resolveExit() }
      return true
    },
  }
  const dependencies = {
    listProcessIds: async () => [...processes.keys()],
    readIdentity: async pid => processes.get(pid) ?? null,
    signalProcess: (pid, signal) => {
      if (pid <= 0) throw new Error(`unsafe numeric signal target ${pid}`)
      calls.push({ via: 'pid', pid, signal })
      const current = processes.get(pid)
      if (!current) return
      if (signal === 'SIGSTOP') {
        if (injectOnStop && pid === 20 && !injected) {
          injected = true
          processes.set(30, { pid: 30, ppid: 20, starttime: 'late', state: 'R' })
        }
        current.state = 'T'
      }
      if (signal === 'SIGCONT') current.state = 'R'
      if (signal === 'SIGKILL') processes.delete(pid)
    },
    delay: async () => {},
  }
  return { child, childExit, processes, calls, dependencies }
}

describe('capability-scoped emergency process-tree shutdown', () => {
  it('freezes the direct child before descendants and never sends graceful TERM', async () => {
    const tree = fakeTree()
    await freezeKillProcessTree(tree.child, tree.childExit, tree.dependencies)

    expect(tree.calls[0]).toEqual({ via: 'handle', pid: 10, signal: 'SIGSTOP' })
    expect(tree.calls.some(call => call.signal === 'SIGTERM')).toBe(false)
    expect(tree.calls.every(call => call.via === 'handle' || call.pid > 0)).toBe(true)
    expect(tree.processes.size).toBe(0)
  })

  it('rescans after freezing known descendants and captures a newly injected descendant', async () => {
    const tree = fakeTree({ injectOnStop: true })
    await freezeKillProcessTree(tree.child, tree.childExit, tree.dependencies)

    expect(tree.calls.filter(call => call.signal === 'SIGSTOP').map(call => call.pid)).toEqual([10, 20, 30])
    expect(tree.calls).toContainEqual({ via: 'pid', pid: 30, signal: 'SIGKILL' })
    expect(tree.processes.size).toBe(0)
  })

  it('fails closed at the convergence bound and kills or resumes every frozen capability', async () => {
    const tree = fakeTree({ injectOnStop: true })
    await expect(freezeKillProcessTree(tree.child, tree.childExit, {
      ...tree.dependencies,
      maxFreezeIterations: 1,
    })).rejects.toThrow(/converge/i)

    expect(tree.calls.some(call => call.signal === 'SIGTERM')).toBe(false)
    expect(tree.calls.some(call => call.pid < 0)).toBe(false)
    for (const process of tree.processes.values()) expect(process.state).not.toMatch(/^[Tt]$/)
  })
})
