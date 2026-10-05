import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, Controls, Handle, Position,
  addEdge, useNodesState, useEdgesState, useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { engine } from './engine'
import { EFFECTS, CATEGORIES, defaultParams } from './effects'
import Knob from './Knob.jsx'
import credits from './credits.json'

const photo = (type) => (credits[type] ? `${import.meta.env.BASE_URL}pedals/${type}.jpg` : null)

const edgeStyle = { stroke: '#d8cfb8', strokeWidth: 4, strokeLinecap: 'round' }
const mkEdge = (s, t) => ({ id: `${s}->${t}`, source: s, target: t, type: 'default', style: edgeStyle })
let uid = 1
const newId = () => `fx${Date.now().toString(36)}${uid++}`

function chain(list) {
  const nodes = [
    { id: 'in', type: 'io', position: { x: 0, y: 160 }, data: { kind: 'in' }, deletable: false },
    { id: 'out', type: 'io', position: { x: 260 + list.length * 270, y: 160 }, data: { kind: 'out' }, deletable: false },
  ]
  const ids = ['in']
  list.forEach(([type, over], i) => {
    const id = newId()
    ids.push(id)
    nodes.push({ id, type: 'effect', position: { x: 230 + i * 270, y: 60 }, data: { type, params: { ...defaultParams(type), ...over }, bypass: false } })
  })
  ids.push('out')
  return { nodes, edges: ids.slice(1).map((t, i) => mkEdge(ids[i], t)) }
}

const PRESETS = {
  'Clean Sparkle': [['compressor'], ['chorus', { mix: 0.35 }], ['reverb', { mix: 0.25 }]],
  'Classic Crunch': [['overdrive', { drive: 45 }], ['cab'], ['delay', { mix: 0.2, time: 300 }]],
  'Hard Rock': [['distortion', { drive: 60 }], ['eq', { mid: 3 }], ['cab'], ['reverb', { mix: 0.15 }]],
  'Metal': [['gate', { threshold: -55 }], ['metal', { drive: 80 }], ['eq', { mid: -4, high: 3 }], ['cab']],
  'Ambient Wash': [['compressor'], ['shimmer', { mix: 0.5 }], ['delay', { time: 500, mix: 0.4 }], ['reverb', { mix: 0.5 }]],
  'Funk Wah': [['compressor', { ratio: 6 }], ['autowah'], ['phaser', { mix: 0.3 }]],
}

function load() {
  try {
    const g = JSON.parse(localStorage.getItem('gb-graph'))
    if (g?.nodes?.length) return g
  } catch { /* ignore */ }
  return chain(PRESETS['Classic Crunch'])
}
const loadStrip = () => {
  try { return { inGain: 0, gate: -100, bass: 0, mid: 0, treble: 0, presence: 0, master: -6, ...JSON.parse(localStorage.getItem('gb-strip')) } } catch { return { inGain: 0, gate: -100, bass: 0, mid: 0, treble: 0, presence: 0, master: -6 } }
}

function IONode({ data }) {
  const isIn = data.kind === 'in'
  return (
    <div className={`io-node ${isIn ? 'in' : 'out'}`}>
      {!isIn && <Handle type="target" position={Position.Left} />}
      {isIn ? (
        <svg width="46" height="46" viewBox="0 0 46 46"><rect x="4" y="19" width="22" height="8" rx="2" fill="#bdbdbd" /><rect x="26" y="15" width="14" height="16" rx="3" fill="#222" /><rect x="2" y="21" width="4" height="4" fill="#888" /></svg>
      ) : (
        <svg width="46" height="46" viewBox="0 0 46 46"><rect x="5" y="4" width="36" height="38" rx="3" fill="#2a2420" stroke="#6b5b3e" /><circle cx="23" cy="25" r="11" fill="#111" stroke="#555" /><circle cx="23" cy="25" r="3" fill="#333" /><rect x="10" y="8" width="26" height="3" fill="#b79b55" /></svg>
      )}
      <div>{isIn ? 'Guitar in' : 'To amp'}</div>
      {isIn && <Handle type="source" position={Position.Right} />}
    </div>
  )
}

function EffectNode({ id, data, selected }) {
  const { updateNodeData, deleteElements } = useReactFlow()
  const def = EFFECTS[data.type]
  const setParam = (k, v) => updateNodeData(id, (n) => ({ params: { ...n.data.params, [k]: v } }))
  return (
    <div className={`pedal ${data.bypass ? 'bypassed' : ''} ${selected ? 'sel' : ''}`} style={{ '--c': def.color }}>
      <Handle type="target" position={Position.Left} />
      <i className="screw tl" /><i className="screw tr" /><i className="screw bl" /><i className="screw br" />
      <div className="pedal-head">
        {photo(data.type) && <img className="thumb" src={photo(data.type)} alt="" draggable={false} />}
        <span className="pedal-name">{def.name}</span>
        <button
          className={`led nodrag ${data.bypass ? '' : 'on'}`}
          title={data.bypass ? 'Bypassed — click to enable' : 'Active — click to bypass'}
          onClick={() => updateNodeData(id, { bypass: !data.bypass })}
        />
        <button className="x nodrag" title="Remove" onClick={() => deleteElements({ nodes: [{ id }] })}>×</button>
      </div>
      <div className="knob-grid">
        {def.params.map((p) => (
          <Knob key={p.k} {...p} value={data.params[p.k] ?? p.def} onChange={(v) => setParam(p.k, v)} />
        ))}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = { io: IONode, effect: EffectNode }

function Meter({ k }) {
  const el = useRef(null)
  useEffect(() => {
    let raf
    const tick = () => {
      const db = engine.levels()[k]
      const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100))
      if (el.current) {
        el.current.style.width = `${pct}%`
        el.current.dataset.hot = db > -3 ? '1' : '0'
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [k])
  return <div className="meter"><div ref={el} className="meter-fill" /></div>
}

function Board() {
  const init = useMemo(load, [])
  const [nodes, setNodes, onNodesChange] = useNodesState(init.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(init.edges)
  const [strip, setStrip] = useState(loadStrip)
  const [devices, setDevices] = useState([])
  const [deviceId, setDeviceId] = useState('')
  const [channel, setChannel] = useState(0)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')
  const { screenToFlowPosition, getEdges, fitView } = useReactFlow()

  const sig = nodes.map((n) => n.id + n.data.type).join() + '|' + edges.map((e) => e.id).join()
  useEffect(() => { engine.sync(nodes, edges) }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { engine.applyParams(nodes) }, [nodes])
  useEffect(() => {
    for (const [k, v] of Object.entries(strip)) engine.setStrip(k, v)
    localStorage.setItem('gb-strip', JSON.stringify(strip))
  }, [strip])
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem('gb-graph', JSON.stringify({ nodes, edges })), 400)
    return () => clearTimeout(t)
  }, [nodes, edges])

  const isValid = useCallback((c) => {
    if (c.source === c.target) return false
    const es = getEdges()
    const seen = new Set()
    const stack = [c.target]
    while (stack.length) {
      const n = stack.pop()
      if (n === c.source) return false
      if (seen.has(n)) continue
      seen.add(n)
      es.forEach((e) => e.source === n && stack.push(e.target))
    }
    return true
  }, [getEdges])

  const onConnect = useCallback((c) => setEdges((es) => addEdge(mkEdge(c.source, c.target), es)), [setEdges])

  const addEffect = useCallback((type, position) => {
    const pos = position || { x: 200 + Math.random() * 200, y: 280 + Math.random() * 120 }
    setNodes((ns) => ns.concat({ id: newId(), type: 'effect', position: pos, data: { type, params: defaultParams(type), bypass: false } }))
  }, [setNodes])

  const onDrop = (e) => {
    e.preventDefault()
    const type = e.dataTransfer.getData('application/gb-effect')
    if (type) addEffect(type, screenToFlowPosition({ x: e.clientX - 80, y: e.clientY - 40 }))
  }

  const loadGraph = (g) => { setNodes(g.nodes); setEdges(g.edges); setTimeout(() => fitView({ padding: 0.2 }), 50) }

  const toggle = async () => {
    setErr('')
    try {
      if (running) { engine.stop(); setRunning(false); return }
      await engine.start(deviceId, channel)
      setRunning(true)
      setDevices(await engine.listInputs())
    } catch (e) { setErr(e.message || String(e)) }
  }
  const refresh = async () => {
    try { setDevices(await engine.listInputs()) } catch (e) { setErr(e.message || String(e)) }
  }

  const S = (k, label, min, max, def, o = {}) => (
    <Knob label={label} min={min} max={max} def={def} value={strip[k]} step={o.step ?? 0.5} unit={o.unit ?? 'dB'}
      onChange={(v) => setStrip((s) => ({ ...s, [k]: v }))} />
  )

  return (
    <div className="app">
      <aside className="strip">
        <h1>Pedal<span>board</span></h1>
        <section>
          <h2>Input</h2>
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">Default input</option>
            {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 12)}</option>)}
          </select>
          <div className="row">
            <select value={channel} onChange={(e) => setChannel(+e.target.value)}>
              <option value={0}>Channel 1 (L)</option>
              <option value={1}>Channel 2 (R)</option>
              <option value={2}>Both (mix)</option>
            </select>
            <button className="icon-btn" onClick={refresh} title="Rescan devices">⟳</button>
          </div>
          <button className={`power ${running ? 'on' : ''}`} onClick={toggle}><i className={`lamp ${running ? 'on' : ''}`} />{running ? 'Stop' : 'Power on'}</button>
          {err && <div className="err">{err}</div>}
          <div className="hint">Use headphones — speakers will feed back into the guitar.</div>
          <label>In</label><Meter k="in" />
        </section>
        <section>
          <h2>Channel strip</h2>
          <div className="knobs">
            {S('inGain', 'Gain', -12, 36, 0, { color: '#ff5d3b' })}
            {S('gate', 'Gate', -100, -20, -100, { step: 1 })}
            {S('bass', 'Bass', -15, 15, 0, { color: '#17b8a6' })}
            {S('mid', 'Mids', -15, 15, 0, { color: '#17b8a6' })}
            {S('treble', 'Treble', -15, 15, 0, { color: '#17b8a6' })}
            {S('presence', 'Presence', -12, 12, 0, { color: '#17b8a6' })}
          </div>
          <div className="knobs one">{S('master', 'Volume', -40, 6, -6, { color: '#ffb347' })}</div>
          <label>Out</label><Meter k="out" />
        </section>
        <section>
          <h2>Presets</h2>
          <div className="chips">
            {Object.entries(PRESETS).map(([name, list]) => (
              <button key={name} className="chip" onClick={() => loadGraph(chain(list))}>{name}</button>
            ))}
          </div>
        </section>
      </aside>

      <main className="canvas" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          isValidConnection={isValid} defaultEdgeOptions={{ style: edgeStyle }}
          connectionLineStyle={edgeStyle} deleteKeyCode={['Backspace', 'Delete']}
          fitView minZoom={0.3} maxZoom={1.5} colorMode="dark" proOptions={{ hideAttribution: true }}
        >
          <Controls />
        </ReactFlow>
        <div className="canvas-hint">Drag from a pedal's right dot to another's left dot to wire them. Select a wire or pedal and press Delete.</div>
      </main>

      <aside className="palette">
        <h2>Favourites</h2>
        <div className="main-grid">
          {Object.entries(EFFECTS).filter(([, d]) => d.main).map(([type, d]) => (
            <Tile key={type} type={type} d={d} onAdd={addEffect} big />
          ))}
        </div>
        {CATEGORIES.map((cat) => (
          <div key={cat}>
            <h2>{cat}</h2>
            <div className="tiles">
              {Object.entries(EFFECTS).filter(([, d]) => d.cat === cat && !d.main).map(([type, d]) => (
                <Tile key={type} type={type} d={d} onAdd={addEffect} />
              ))}
            </div>
          </div>
        ))}
        <Credits />
      </aside>
    </div>
  )
}

function Tile({ type, d, onAdd, big }) {
  const img = photo(type)
  return (
    <div
      className={`tile ${big ? 'big' : ''} ${img ? 'has-img' : ''}`} style={{ '--c': d.color }} draggable
      onDragStart={(e) => { e.dataTransfer.setData('application/gb-effect', type); e.dataTransfer.effectAllowed = 'copy' }}
      onClick={() => onAdd(type)} title="Drag onto the board, or click to add"
    >
      {img && <img src={img} alt="" draggable={false} />}
      <span>{d.name}</span>
    </div>
  )
}

function Credits() {
  return (
    <details className="credits">
      <summary>Photo credits</summary>
      {Object.entries(credits).map(([k, c]) => (
        <div key={k}><a href={c.page} target="_blank" rel="noreferrer">{EFFECTS[k]?.name}</a> — {c.author}, {c.license}</div>
      ))}
    </details>
  )
}

export default function App() {
  return <ReactFlowProvider><Board /></ReactFlowProvider>
}
