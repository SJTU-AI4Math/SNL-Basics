import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnOwnedProcess, terminateOwnedProcess } from './process-group-cleanup.mjs'

const cleanupGroups = new Set()

function groupIsAlive(groupId) {
  try {
    process.kill(-groupId, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

async function readFirstLine(stream) {
  let text = ''
  for await (const chunk of stream) {
    text += chunk
    const newline = text.indexOf('\n')
    if (newline >= 0) return text.slice(0, newline)
  }
  throw new Error('owned process exited before reporting its grandchild')
}

afterEach(() => {
  for (const groupId of cleanupGroups) {
    try { process.kill(-groupId, 'SIGKILL') } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
  cleanupGroups.clear()
})

describe('owned process-group cleanup', () => {
  it('handles startup failure and an exit-before-cleanup race without unhandled child errors', async () => {
    await expect(spawnOwnedProcess('/definitely/missing/snl-owned-process', [], { stdio: 'ignore' })).rejects.toThrow()

    const exited = await spawnOwnedProcess(process.execPath, ['-e', ''], { stdio: 'ignore' })
    cleanupGroups.add(exited.groupId)
    await exited.exited
    await expect(terminateOwnedProcess(exited, { sigtermTimeoutMs: 100 })).resolves.toEqual({ escalated: false })
    cleanupGroups.delete(exited.groupId)
  })

  it('keeps verifier cleanup awaited, ordered, and free of parent-only kills', () => {
    const source = readFileSync(new URL('./verify-parameterized-svg.mjs', import.meta.url), 'utf8')
    const close = source.indexOf('await cdp?.close()')
    const browser = source.indexOf('await terminateOwnedProcess(browser)')
    const vite = source.indexOf('await terminateOwnedProcess(vite)')
    const profile = source.indexOf('rmSync(profile')
    expect(close).toBeGreaterThan(-1)
    expect(browser).toBeGreaterThan(close)
    expect(vite).toBeGreaterThan(browser)
    expect(profile).toBeGreaterThan(browser)
    expect(source).not.toMatch(/(?:browser|vite)(?:\.child)?\.kill\s*\(/)
  })

  it('waits for a SIGTERM-resistant grandchild to die with the exact owned group', async () => {
    const grandchildSource = `
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
    `
    const parentSource = `
      const { spawn } = require('node:child_process');
      process.on('SIGTERM', () => {});
      const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], {
        stdio: 'ignore',
      });
      console.log(JSON.stringify({ parent: process.pid, grandchild: grandchild.pid }));
      setInterval(() => {}, 1000);
    `

    const owned = await spawnOwnedProcess(process.execPath, ['-e', parentSource], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    cleanupGroups.add(owned.groupId)
    const reported = JSON.parse(await readFirstLine(owned.child.stdout))

    expect(owned.groupId).toBe(reported.parent)
    expect(groupIsAlive(owned.groupId)).toBe(true)

    const result = await terminateOwnedProcess(owned, {
      sigtermTimeoutMs: 100,
      sigkillTimeoutMs: 2_000,
      pollIntervalMs: 10,
    })

    cleanupGroups.delete(owned.groupId)
    expect(result.escalated).toBe(true)
    expect(groupIsAlive(owned.groupId)).toBe(false)
    expect(() => process.kill(reported.grandchild, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
  })
})
