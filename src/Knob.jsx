import { useRef } from 'react'

const clamp = (n) => Math.min(1, Math.max(0, n))
const A0 = -135, A1 = 135
const TICKS = Array.from({ length: 11 }, (_, i) => A0 + (i * (A1 - A0)) / 10)

function pt(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}
export function fmt(v, unit = '') {
  const a = Math.abs(v)
  const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2)
  return `${s}${unit ? ' ' + unit : ''}`
}

export default function Knob({ label, value, min, max, def, step, unit, log, onChange, size = 44 }) {
  const drag = useRef(null)
  const norm = clamp(log ? Math.log(value / min) / Math.log(max / min) : (value - min) / (max - min))
  const apply = (n) => {
    n = clamp(n)
    let v = log ? min * Math.pow(max / min, n) : min + n * (max - min)
    if (step) v = Math.min(max, Math.max(min, Math.round(v / step) * step))
    onChange(v)
  }
  const ang = A0 + norm * (A1 - A0)
  const c = size / 2, r = size / 2 - 7
  const [x0, y0] = pt(c, c, r * 0.25, ang)
  const [x1, y1] = pt(c, c, r - 1.5, ang)
  return (
    <div className="knob nodrag nopan nowheel" title="Drag up/down · double-click resets">
      <svg
        width={size} height={size}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { y: e.clientY, n: norm }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          apply(drag.current.n + (drag.current.y - e.clientY) / (e.shiftKey ? 500 : 140))
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => onChange(def)}
        onWheel={(e) => apply(norm - Math.sign(e.deltaY) * 0.03)}
      >
        {TICKS.map((a) => {
          const [ax, ay] = pt(c, c, c - 4, a)
          const [bx, by] = pt(c, c, c - 1.5, a)
          return <line key={a} x1={ax} y1={ay} x2={bx} y2={by} stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
        })}
        <circle cx={c} cy={c + 1} r={r + 1} fill="#000" opacity="0.45" />
        <circle cx={c} cy={c} r={r} fill="#101010" stroke="#4a4a4a" strokeWidth="1" />
        <circle cx={c} cy={c} r={r - 3.5} fill="#1c1c1c" stroke="#2c2c2c" />
        <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#f4f0e6" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <div className="knob-label">{label}</div>
      <div className="knob-val">{fmt(value, unit)}</div>
    </div>
  )
}
