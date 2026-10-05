import * as T from 'tone'
import { EFFECTS } from './effects'

try {
  T.setContext(new T.Context({ latencyHint: 'interactive', lookAhead: 0 }))
} catch (e) {
  console.warn('low-latency context unavailable', e)
}

const db2g = (d) => Math.pow(10, d / 20)

function makeInstance(type) {
  const inst = EFFECTS[type].create()
  const input = new T.Gain(1), output = new T.Gain(1)
  const wetG = new T.Gain(1), dry = new T.Gain(0)
  input.connect(wetG); wetG.connect(inst.input); inst.output.connect(output)
  input.connect(dry); dry.connect(output)
  return {
    input, output,
    set: inst.set,
    setBypass(b) { wetG.gain.rampTo(b ? 0 : 1, 0.02); dry.gain.rampTo(b ? 1 : 0, 0.02) },
    dispose() { [input, output, wetG, dry].forEach((n) => n.dispose()); inst.dispose() },
  }
}

class Engine {
  constructor() {
    this.running = false
    this.inst = new Map()
    this.cache = new Map()
    this.stream = null
    this.src = null
    this.splitter = null

    // fixed channel strip: in -> gain -> gate -> [patch graph] -> EQ -> presence -> master -> limiter
    this.inGain = new T.Gain(1)
    this.gate = new T.Gate(-100, 0.05)
    this.inBus = new T.Gain(1)
    this.outBus = new T.Gain(1)
    this.eq = new T.EQ3({ low: 0, mid: 0, high: 0, lowFrequency: 200, highFrequency: 3000 })
    this.presence = new T.Filter({ type: 'highshelf', frequency: 5000, gain: 0 })
    this.master = new T.Gain(db2g(-6))
    this.limiter = new T.Limiter(-1)
    T.connectSeries(this.inGain, this.gate, this.inBus)
    T.connectSeries(this.outBus, this.eq, this.presence, this.master, this.limiter)
    this.limiter.toDestination()
    this.inMeter = new T.Meter({ smoothing: 0.7 })
    this.outMeter = new T.Meter({ smoothing: 0.7 })
    this.inGain.connect(this.inMeter)
    this.limiter.connect(this.outMeter)
  }

  async listInputs() {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true })
    tmp.getTracks().forEach((t) => t.stop())
    const all = await navigator.mediaDevices.enumerateDevices()
    return all.filter((d) => d.kind === 'audioinput')
  }

  async start(deviceId, channel = 0) {
    await T.start()
    this.stop()
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        channelCount: { ideal: 2 }, latency: 0,
      },
    })
    const ctx = T.getContext().rawContext
    this.src = ctx.createMediaStreamSource(this.stream)
    if (channel === 2) {
      T.connect(this.src, this.inGain)
    } else {
      this.splitter = ctx.createChannelSplitter(2)
      this.src.connect(this.splitter)
      T.connect(this.splitter, this.inGain, channel, 0)
    }
    this.running = true
  }

  stop() {
    try { this.src?.disconnect() } catch { /* already gone */ }
    try { this.splitter?.disconnect() } catch { /* already gone */ }
    this.stream?.getTracks().forEach((t) => t.stop())
    this.src = this.splitter = this.stream = null
    this.running = false
  }

  setStrip(k, v) {
    const r = (p, x) => p.rampTo(x, 0.03)
    if (k === 'inGain') r(this.inGain.gain, db2g(v))
    else if (k === 'gate') this.gate.threshold = v
    else if (k === 'bass') r(this.eq.low, v)
    else if (k === 'mid') r(this.eq.mid, v)
    else if (k === 'treble') r(this.eq.high, v)
    else if (k === 'presence') r(this.presence.gain, v)
    else if (k === 'master') r(this.master.gain, db2g(v))
  }

  // Rebuild instances and wiring whenever the patch structure changes.
  sync(nodes, edges) {
    const effects = nodes.filter((n) => n.type === 'effect')
    const ids = new Set(effects.map((n) => n.id))
    for (const [id, w] of this.inst) {
      if (!ids.has(id)) { w.dispose(); this.inst.delete(id); this.cache.delete(id) }
    }
    for (const n of effects) {
      if (!this.inst.has(n.id)) this.inst.set(n.id, makeInstance(n.data.type))
    }
    this.inBus.disconnect()
    for (const w of this.inst.values()) w.output.disconnect()
    for (const e of edges) {
      const src = e.source === 'in' ? this.inBus : this.inst.get(e.source)?.output
      const dst = e.target === 'out' ? this.outBus : this.inst.get(e.target)?.input
      if (src && dst) src.connect(dst)
    }
    this.cache.clear()
    this.applyParams(nodes)
  }

  applyParams(nodes) {
    for (const n of nodes) {
      const w = this.inst.get(n.id)
      if (!w) continue
      const def = EFFECTS[n.data.type]
      const key = this.cache.get(n.id) || {}
      for (const p of def.params) {
        const v = n.data.params?.[p.k] ?? p.def
        if (key[p.k] !== v) { w.set(p.k, v); key[p.k] = v }
      }
      const b = !!n.data.bypass
      if (key.__b !== b) { w.setBypass(b); key.__b = b }
      this.cache.set(n.id, key)
    }
  }

  levels() {
    const m = (x) => (Array.isArray(x) ? Math.max(...x) : x)
    return { in: m(this.inMeter.getValue()), out: m(this.outMeter.getValue()) }
  }
}

export const engine = new Engine()

if (import.meta.env.DEV) window.__engine = engine
