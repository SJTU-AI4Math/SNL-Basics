export class Cdp {
  constructor(url, { connectTimeoutMs = 3_000, commandTimeoutMs = 5_000, closeTimeoutMs = 1_000 } = {}) {
    this.socket = new WebSocket(url)
    this.next = 0
    this.pending = new Map()
    this.listeners = new Map()
    this.commandTimeoutMs = commandTimeoutMs
    this.closeTimeoutMs = closeTimeoutMs
    this.transportError = null
    this.closePromise = null
    this.readySettled = false
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = () => { if (!this.readySettled) { this.readySettled = true; clearTimeout(this.connectTimer); resolve() } }
      this.rejectReady = error => { if (!this.readySettled) { this.readySettled = true; clearTimeout(this.connectTimer); reject(error) } }
    })
    this.readyPromise.catch(() => {})
    this.connectTimer = setTimeout(() => this.fail(new Error(`CDP connect timed out after ${connectTimeoutMs}ms`)), connectTimeoutMs)
    this.connectTimer.unref?.()

    this.socket.addEventListener('open', () => this.resolveReady())
    this.socket.addEventListener('message', ({ data }) => {
      let message
      try { message = JSON.parse(data) } catch (error) { this.fail(new Error('invalid CDP response', { cause: error })); return }
      if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {})
        return
      }
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result)
    })
    this.socket.addEventListener('error', () => this.fail(new Error('CDP transport error')))
    this.socket.addEventListener('close', () => this.fail(new Error('CDP transport closed')))
  }

  fail(error) {
    this.transportError ??= error
    this.rejectReady(this.transportError)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(this.transportError)
    }
    this.pending.clear()
  }

  ready() {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve()
    if (this.socket.readyState === WebSocket.CLOSING || this.socket.readyState === WebSocket.CLOSED) {
      this.fail(new Error('CDP socket closed before ready'))
    }
    return this.readyPromise
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set()
    listeners.add(listener)
    this.listeners.set(method, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(method)
    }
  }

  send(method, params = {}) {
    if (this.socket.readyState !== WebSocket.OPEN || this.transportError) {
      return Promise.reject(this.transportError ?? new Error('CDP socket is not open'))
    }
    const id = ++this.next
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return
        reject(new Error(`CDP command ${method} timed out after ${this.commandTimeoutMs}ms`))
      }, this.commandTimeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer, method })
      try { this.socket.send(JSON.stringify({ id, method, params })) }
      catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  close() {
    if (this.closePromise) return this.closePromise
    this.fail(new Error('CDP socket closed by owner'))
    this.closePromise = new Promise(resolve => {
      if (this.socket.readyState === WebSocket.CLOSED) { resolve(); return }
      let settled = false
      const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolve() } }
      const timer = setTimeout(finish, this.closeTimeoutMs)
      timer.unref?.()
      this.socket.addEventListener('close', finish, { once: true })
      try { this.socket.close() } catch { finish() }
    })
    return this.closePromise
  }
}
