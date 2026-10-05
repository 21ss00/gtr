import * as T from 'tone'

const db2g = (d) => Math.pow(10, d / 20)
const ramp = (p, v) => (p && p.rampTo ? p.rampTo(v, 0.03) : p && (p.value = v))
const P = (k, label, min, max, def, o = {}) => ({ k, label, min, max, def, ...o })
const MIX = (def = 0.5) => P('mix', 'Mix', 0, 1, def, { step: 0.01 })

// Wraps a single Tone node whose params are set by a map of setter functions.
const single = (node, setters) => ({
  input: node,
  output: node,
  set: (k, v) => setters[k] && setters[k](node, v),
  dispose: () => node.dispose(),
})
const wet = { mix: (n, v) => ramp(n.wet, v) }

// Dry/wet parallel wrapper for chains that have no built-in wet control.
function mixChain(nodes, extra = {}) {
  const input = new T.Gain(1), output = new T.Gain(1)
  const dry = new T.Gain(0.5), wetG = new T.Gain(0.5)
  input.connect(dry); dry.connect(output)
  T.connectSeries(input, ...nodes, wetG); wetG.connect(output)
  return {
    input, output,
    set: (k, v) => {
      if (k === 'mix') { ramp(dry.gain, 1 - v); ramp(wetG.gain, v) } else extra[k]?.(v)
    },
    dispose: () => [input, output, dry, wetG, ...nodes].forEach((n) => n.dispose()),
  }
}

const DRIVE = {
  overdrive: { K: 12, hp: 90, f: (z) => Math.tanh(z) },
  distortion: { K: 40, hp: 120, f: (z) => Math.sign(z) * (1 - Math.exp(-Math.abs(z))) },
  fuzz: { K: 50, hp: 60, f: (z) => (z >= 0 ? Math.tanh(2 * z) : -0.6 * Math.tanh(-3 * z)) },
  metal: { K: 90, hp: 280, f: (z) => Math.tanh(z * 1.5) },
}
function drive(kind) {
  const d = DRIVE[kind]
  const hp = new T.Filter(d.hp, 'highpass')
  const shaper = new T.WaveShaper((x) => d.f(x * 4), 2048)
  shaper.oversample = '4x'
  const lp = new T.Filter(6000, 'lowpass')
  const dc = new T.Filter(30, 'highpass')
  const level = new T.Gain(0.5)
  T.connectSeries(hp, shaper, lp, dc, level)
  return {
    input: hp, output: level,
    set: (k, v) => {
      if (k === 'drive') { const g = 1 + (v / 100) * d.K; shaper.setMap((x) => d.f(x * g)) }
      if (k === 'tone') ramp(lp.frequency, v)
      if (k === 'level') ramp(level.gain, db2g(v))
    },
    dispose: () => [hp, shaper, lp, dc, level].forEach((n) => n.dispose()),
  }
}
const driveParams = (def) => [
  P('drive', 'Drive', 0, 100, def, { step: 1 }),
  P('tone', 'Tone', 500, 12000, 5000, { log: true, unit: 'Hz' }),
  P('level', 'Level', -24, 12, -8, { step: 0.5, unit: 'dB' }),
]

const filt = (type, def) => () => {
  const f = new T.Filter(def, type)
  return single(f, {
    cutoff: (n, v) => ramp(n.frequency, v),
    q: (n, v) => ramp(n.Q, v),
  })
}
const filtParams = (def) => [
  P('cutoff', 'Cutoff', 60, 12000, def, { log: true, unit: 'Hz' }),
  P('q', 'Reso', 0.1, 15, 1, { step: 0.1 }),
]

export const CATEGORIES = ['Drive', 'Dynamics', 'Tone', 'Modulation', 'Time & Space', 'Pitch & Special']

export const EFFECTS = {
  overdrive: { name: 'Overdrive', cat: 'Drive', main: true, color: '#7bd24a', params: driveParams(35), create: () => drive('overdrive') },
  distortion: { name: 'Distortion', cat: 'Drive', main: true, color: '#ff5d3b', params: driveParams(55), create: () => drive('distortion') },
  fuzz: { name: 'Fuzz', cat: 'Drive', color: '#d94fa8', params: driveParams(60), create: () => drive('fuzz') },
  metal: { name: 'Metal', cat: 'Drive', color: '#c9ccd4', params: driveParams(75), create: () => drive('metal') },
  bitcrusher: {
    name: 'Bit Crusher', cat: 'Drive', color: '#e0a526',
    params: [P('bits', 'Bits', 1, 16, 6, { step: 1 }), MIX(0.7)],
    create: () => single(new T.BitCrusher(6), { bits: (n, v) => (n.bits.value = v), ...wet }),
  },
  chebyshev: {
    name: 'Exciter', cat: 'Drive', color: '#e0a526',
    params: [P('order', 'Order', 1, 100, 20, { step: 1 }), MIX(0.3)],
    create: () => single(new T.Chebyshev(20), { order: (n, v) => (n.order = Math.round(v)), ...wet }),
  },

  compressor: {
    name: 'Compressor', cat: 'Dynamics', main: true, color: '#3b9eff',
    params: [
      P('threshold', 'Thresh', -60, 0, -24, { unit: 'dB' }),
      P('ratio', 'Ratio', 1, 20, 4, { step: 0.1 }),
      P('attack', 'Attack', 1, 100, 10, { unit: 'ms' }),
      P('release', 'Release', 20, 1000, 200, { log: true, unit: 'ms' }),
      P('makeup', 'Makeup', 0, 24, 6, { unit: 'dB' }),
    ],
    create: () => {
      const c = new T.Compressor(-24, 4), m = new T.Gain(2)
      c.connect(m)
      return {
        input: c, output: m,
        set: (k, v) => {
          if (k === 'threshold') ramp(c.threshold, v)
          if (k === 'ratio') ramp(c.ratio, v)
          if (k === 'attack') ramp(c.attack, v / 1000)
          if (k === 'release') ramp(c.release, v / 1000)
          if (k === 'makeup') ramp(m.gain, db2g(v))
        },
        dispose: () => { c.dispose(); m.dispose() },
      }
    },
  },
  gate: {
    name: 'Noise Gate', cat: 'Dynamics', color: '#3b9eff',
    params: [P('threshold', 'Thresh', -100, -10, -60, { unit: 'dB' })],
    create: () => single(new T.Gate(-60, 0.05), { threshold: (n, v) => (n.threshold = v) }),
  },
  limiter: {
    name: 'Limiter', cat: 'Dynamics', color: '#3b9eff',
    params: [P('threshold', 'Ceiling', -30, 0, -3, { unit: 'dB' })],
    create: () => single(new T.Limiter(-3), { threshold: (n, v) => ramp(n.threshold, v) }),
  },
  boost: {
    name: 'Clean Boost', cat: 'Dynamics', color: '#3b9eff',
    params: [P('gain', 'Gain', -24, 24, 6, { step: 0.5, unit: 'dB' })],
    create: () => single(new T.Gain(2), { gain: (n, v) => ramp(n.gain, db2g(v)) }),
  },

  eq: {
    name: '3-Band EQ', cat: 'Tone', main: true, color: '#17b8a6',
    params: [
      P('low', 'Bass', -15, 15, 0, { step: 0.5, unit: 'dB' }),
      P('mid', 'Mids', -15, 15, 0, { step: 0.5, unit: 'dB' }),
      P('high', 'Treble', -15, 15, 0, { step: 0.5, unit: 'dB' }),
      P('lowFreq', 'Low Hz', 80, 600, 250, { log: true, unit: 'Hz' }),
      P('highFreq', 'High Hz', 1500, 8000, 3000, { log: true, unit: 'Hz' }),
    ],
    create: () => single(new T.EQ3(0, 0, 0), {
      low: (n, v) => ramp(n.low, v), mid: (n, v) => ramp(n.mid, v), high: (n, v) => ramp(n.high, v),
      lowFreq: (n, v) => ramp(n.lowFrequency, v), highFreq: (n, v) => ramp(n.highFrequency, v),
    }),
  },
  lowpass: { name: 'Low-pass', cat: 'Tone', color: '#17b8a6', params: filtParams(4000), create: filt('lowpass', 4000) },
  highpass: { name: 'High-pass', cat: 'Tone', color: '#17b8a6', params: filtParams(200), create: filt('highpass', 200) },
  cab: {
    name: 'Cab Sim', cat: 'Tone', color: '#17b8a6',
    params: [
      P('lowCut', 'Low Cut', 40, 300, 90, { log: true, unit: 'Hz' }),
      P('highCut', 'High Cut', 2500, 9000, 5000, { log: true, unit: 'Hz' }),
      P('presence', 'Presence', -6, 9, 3, { step: 0.5, unit: 'dB' }),
    ],
    create: () => {
      const hp = new T.Filter(90, 'highpass')
      const pk = new T.Filter({ type: 'peaking', frequency: 2500, gain: 3, Q: 1 })
      const lp = new T.Filter({ type: 'lowpass', frequency: 5000, rolloff: -24 })
      T.connectSeries(hp, pk, lp)
      return {
        input: hp, output: lp,
        set: (k, v) => {
          if (k === 'lowCut') ramp(hp.frequency, v)
          if (k === 'highCut') ramp(lp.frequency, v)
          if (k === 'presence') ramp(pk.gain, v)
        },
        dispose: () => [hp, pk, lp].forEach((n) => n.dispose()),
      }
    },
  },
  wah: {
    name: 'Wah', cat: 'Tone', main: true, color: '#e0a526',
    params: [P('pos', 'Pedal', 0, 100, 50, { step: 1 }), P('q', 'Reso', 1, 15, 6, { step: 0.1 })],
    create: () => {
      const bp = new T.Filter({ type: 'bandpass', frequency: 800, Q: 6 }), g = new T.Gain(3)
      bp.connect(g)
      return {
        input: bp, output: g,
        set: (k, v) => {
          if (k === 'pos') ramp(bp.frequency, 350 * Math.pow(2200 / 350, v / 100))
          if (k === 'q') ramp(bp.Q, v)
        },
        dispose: () => { bp.dispose(); g.dispose() },
      }
    },
  },
  autowah: {
    name: 'Auto Wah', cat: 'Tone', color: '#e0a526',
    params: [
      P('base', 'Base', 50, 500, 100, { log: true, unit: 'Hz' }),
      P('octaves', 'Range', 1, 8, 6, { step: 0.1 }),
      P('sens', 'Sens', -40, 0, -10, { unit: 'dB' }),
      P('q', 'Reso', 0.5, 10, 2, { step: 0.1 }),
      MIX(1),
    ],
    create: () => single(new T.AutoWah(100, 6, -10), {
      base: (n, v) => (n.baseFrequency = v), octaves: (n, v) => (n.octaves = v),
      sens: (n, v) => (n.sensitivity = v), q: (n, v) => ramp(n.Q, v), ...wet,
    }),
  },

  chorus: {
    name: 'Chorus', cat: 'Modulation', main: true, color: '#8f6bff',
    params: [
      P('rate', 'Rate', 0.1, 8, 1.5, { log: true, unit: 'Hz' }),
      P('depth', 'Depth', 0, 1, 0.7, { step: 0.01 }),
      P('delay', 'Delay', 2, 20, 3.5, { step: 0.1, unit: 'ms' }),
      MIX(0.5),
    ],
    create: () => single(new T.Chorus(1.5, 3.5, 0.7).start(), {
      rate: (n, v) => ramp(n.frequency, v), depth: (n, v) => (n.depth = v), delay: (n, v) => (n.delayTime = v), ...wet,
    }),
  },
  flanger: {
    name: 'Flanger', cat: 'Modulation', color: '#8f6bff',
    params: [
      P('rate', 'Rate', 0.05, 5, 0.3, { log: true, unit: 'Hz' }),
      P('depth', 'Depth', 0, 1, 0.8, { step: 0.01 }),
      P('feedback', 'Feedback', 0, 0.95, 0.6, { step: 0.01 }),
      MIX(0.5),
    ],
    create: () => {
      const c = new T.Chorus({ frequency: 0.3, delayTime: 2, depth: 0.8, feedback: 0.6, spread: 90 }).start()
      return single(c, {
        rate: (n, v) => ramp(n.frequency, v), depth: (n, v) => (n.depth = v),
        feedback: (n, v) => ramp(n.feedback, v), ...wet,
      })
    },
  },
  phaser: {
    name: 'Phaser', cat: 'Modulation', main: true, color: '#8f6bff',
    params: [
      P('rate', 'Rate', 0.05, 8, 0.5, { log: true, unit: 'Hz' }),
      P('octaves', 'Depth', 1, 6, 3, { step: 0.1 }),
      P('base', 'Center', 100, 1500, 350, { log: true, unit: 'Hz' }),
      MIX(0.6),
    ],
    create: () => single(new T.Phaser({ frequency: 0.5, octaves: 3, baseFrequency: 350, Q: 10 }), {
      rate: (n, v) => ramp(n.frequency, v), octaves: (n, v) => (n.octaves = v),
      base: (n, v) => (n.baseFrequency = v), ...wet,
    }),
  },
  tremolo: {
    name: 'Tremolo', cat: 'Modulation', main: true, color: '#8f6bff',
    params: [P('rate', 'Rate', 0.1, 20, 5, { log: true, unit: 'Hz' }), P('depth', 'Depth', 0, 1, 0.6, { step: 0.01 })],
    create: () => single(new T.Tremolo(5, 0.6).start(), { rate: (n, v) => ramp(n.frequency, v), depth: (n, v) => ramp(n.depth, v) }),
  },
  vibrato: {
    name: 'Vibrato', cat: 'Modulation', color: '#8f6bff',
    params: [P('rate', 'Rate', 0.5, 12, 5, { log: true, unit: 'Hz' }), P('depth', 'Depth', 0, 1, 0.2, { step: 0.01 }), MIX(1)],
    create: () => single(new T.Vibrato(5, 0.2), {
      rate: (n, v) => ramp(n.frequency, v), depth: (n, v) => ramp(n.depth, v), ...wet,
    }),
  },
  autopan: {
    name: 'Auto Pan', cat: 'Modulation', color: '#8f6bff',
    params: [P('rate', 'Rate', 0.1, 10, 2, { log: true, unit: 'Hz' }), P('depth', 'Depth', 0, 1, 1, { step: 0.01 })],
    create: () => single(new T.AutoPanner(2).start(), { rate: (n, v) => ramp(n.frequency, v), depth: (n, v) => ramp(n.depth, v) }),
  },

  delay: {
    name: 'Delay', cat: 'Time & Space', main: true, color: '#ffa13b',
    params: [
      P('time', 'Time', 20, 1000, 350, { log: true, unit: 'ms' }),
      P('feedback', 'Repeats', 0, 0.95, 0.4, { step: 0.01 }),
      MIX(0.35),
    ],
    create: () => single(new T.FeedbackDelay(0.35, 0.4), {
      time: (n, v) => ramp(n.delayTime, v / 1000), feedback: (n, v) => ramp(n.feedback, v), ...wet,
    }),
  },
  pingpong: {
    name: 'Ping-Pong', cat: 'Time & Space', color: '#ffa13b',
    params: [
      P('time', 'Time', 20, 1000, 300, { log: true, unit: 'ms' }),
      P('feedback', 'Repeats', 0, 0.95, 0.45, { step: 0.01 }),
      MIX(0.35),
    ],
    create: () => single(new T.PingPongDelay(0.3, 0.45), {
      time: (n, v) => ramp(n.delayTime, v / 1000), feedback: (n, v) => ramp(n.feedback, v), ...wet,
    }),
  },
  reverb: {
    name: 'Reverb', cat: 'Time & Space', main: true, color: '#4fc3e8',
    params: [
      P('size', 'Size', 0, 0.98, 0.8, { step: 0.01 }),
      P('damp', 'Damping', 500, 10000, 3000, { log: true, unit: 'Hz' }),
      MIX(0.3),
    ],
    create: () => single(new T.Freeverb(0.8, 3000), {
      size: (n, v) => ramp(n.roomSize, v), damp: (n, v) => (n.dampening = v), ...wet,
    }),
  },
  shimmer: {
    name: 'Shimmer', cat: 'Time & Space', color: '#4fc3e8',
    params: [P('size', 'Size', 0, 0.98, 0.9, { step: 0.01 }), MIX(0.4)],
    create: () => {
      const ps = new T.PitchShift({ pitch: 12, windowSize: 0.1, wet: 1 })
      const rv = new T.Freeverb({ roomSize: 0.9, dampening: 4000, wet: 1 })
      return mixChain([ps, rv], { size: (v) => ramp(rv.roomSize, v) })
    },
  },

  pitch: {
    name: 'Pitch Shift', cat: 'Pitch & Special', color: '#ff7aa8',
    params: [P('semi', 'Semitones', -12, 12, 7, { step: 1 }), MIX(0.5)],
    create: () => single(new T.PitchShift({ pitch: 7, windowSize: 0.08 }), { semi: (n, v) => (n.pitch = v), ...wet }),
  },
  octaver: {
    name: 'Octaver', cat: 'Pitch & Special', color: '#ff7aa8',
    params: [P('octave', 'Octave', -12, 12, -12, { step: 12 }), MIX(0.5)],
    create: () => single(new T.PitchShift({ pitch: -12, windowSize: 0.1 }), { octave: (n, v) => (n.pitch = v), ...wet }),
  },
  freqshift: {
    name: 'Freq Shift', cat: 'Pitch & Special', color: '#ff7aa8',
    params: [P('freq', 'Shift', -500, 500, 40, { step: 1, unit: 'Hz' }), MIX(0.5)],
    create: () => single(new T.FrequencyShifter(40), { freq: (n, v) => ramp(n.frequency, v), ...wet }),
  },
}

export const defaultParams = (type) => Object.fromEntries(EFFECTS[type].params.map((p) => [p.k, p.def]))
