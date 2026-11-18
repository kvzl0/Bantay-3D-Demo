/**
 * Bantay 3D Demo
 * A Cloud-based Smart Student Monitoring System with Performance Tracking
 * and Alert System for Claro M. Recto High School.
 *
 * Single-file interactive 3D demo of the Room B 301 entry/exit process and
 * the local network / SMS data flow. Built only with React Three Fiber + drei
 * primitives (no GLTF/GLB models). All animation is driven by useFrame.
 *
 * Author: Kiev Gonzales (kvzl0)
 */
import { createContext, useContext, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Billboard, Html, Line, OrbitControls } from '@react-three/drei'

/* ------------------------------------------------------------------ */
/* Constants & helpers                                                 */
/* ------------------------------------------------------------------ */

const MOCK_STUDENT = { name: 'Juan Dela Cruz', lrn: '1234-5678-9012' }

const COLORS = {
  wall: '#f3e7a1',
  baseboard: '#4a2c17',
  door: '#4a2a14',
  doorInset: '#5c3519',
  frame: '#3a210f',
  wood: '#4b2e1a',
  metal: '#3f4650',
  aluminum: '#a3a9b1',
  curtain: '#f5d142',
  scanBlue: '#3b82f6',
  scanGreen: '#22c55e',
  lan: '#38bdf8',
  cloud: '#a78bfa',
  sms: '#f59e0b',
}

const WALL_H = 3.2
const DOOR = { x1: 1.1, x2: 2.1, h: 2.2 }
const WINDOW = { x1: -4.2, x2: -0.2, y1: 1.0, y2: 2.6 }
const SHELF_Y = 2.62 // top surface of the shelf above the door
const HALLWAY_REST = [5.5, 0, 2.6]
const HALLWAY_REST_ROT = [0, -Math.PI / 2, 0]

/** Camera presets. `auto` follow mode switches between them during a simulation. */
const VIEWS = {
  hallway: { label: 'Hallway', pos: [7.5, 6, 9], target: [0.5, 1.4, -0.8] },
  classroom: { label: 'Classroom', pos: [6.8, 4.0, -5.2], target: [2.0, 1.3, -0.8] },
  overview: { label: 'Overview', pos: [6.5, 12, 10], target: [0.8, 0.8, -1.2] },
}

const now = () => performance.now() / 1000
const clamp01 = (v) => Math.min(1, Math.max(0, v))
const smooth = (v) => v * v * (3 - 2 * v)
const progress = (t, [a, b]) => clamp01((t - a) / (b - a))
const flash = (t, hit) => (hit != null && t >= hit ? Math.exp(-(t - hit) * 3) : 0)

/** Polyline with cumulative lengths so we can sample it at constant speed. */
function buildPath(points) {
  const pts = points.map((p) => new THREE.Vector3(...p))
  const lens = [0]
  const dirs = []
  for (let i = 1; i < pts.length; i++) {
    lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]))
    dirs.push(pts[i].clone().sub(pts[i - 1]).normalize())
  }
  return { pts, lens, dirs, total: lens[lens.length - 1] }
}

/** Writes the point at fraction u (0..1) into `out`; returns the segment index. */
function samplePath(path, u, out) {
  const d = clamp01(u) * path.total
  let i = 0
  while (i < path.lens.length - 2 && path.lens[i + 1] < d) i++
  const segLen = path.lens[i + 1] - path.lens[i] || 1
  out.lerpVectors(path.pts[i], path.pts[i + 1], (d - path.lens[i]) / segLen)
  return i
}

/* ------------------------------------------------------------------ */
/* Wires (cable routes between terminals and the network/SMS cluster)  */
/* ------------------------------------------------------------------ */

const DEVICES = {
  miniPc: [0.75, SHELF_Y + 0.05, 0.28],
  mercusys: [1.28, SHELF_Y + 0.025, 0.28],
  dito: [1.82, SHELF_Y + 0.16, 0.28],
  esp: [2.38, SHELF_Y + 0.015, 0.3],
  gsmAntennaTip: [2.53, SHELF_Y + 0.22, 0.3],
  cloud: [1.82, 4.55, 0.4],
}

const WIRES = {
  // Hallway entry terminal -> Mini PC
  entryWire: buildPath([
    [0.6, 1.62, 0.13],
    [0.6, 2.5, 0.13],
    [0.75, 2.58, 0.13],
    [0.75, 2.67, 0.14],
  ]),
  // Interior exit terminal -> up the classroom wall -> through the wall -> Mini PC
  exitWire: buildPath([
    [2.9, 1.62, -0.12],
    [2.9, 3.0, -0.12],
    [2.9, 3.0, 0.12],
    [0.75, 3.0, 0.12],
    [0.75, 2.72, 0.14],
  ]),
  // Mini PC -> Mercusys AC12G -> DITO ZTE K10 (LAN)
  lan: buildPath([
    [0.75, 2.67, 0.14],
    [0.75, 2.645, 0.13],
    [1.28, 2.645, 0.13],
    [1.82, 2.645, 0.13],
    [1.82, 2.7, 0.19],
  ]),
  // DITO router -> cloud (wireless uplink, drawn dashed)
  uplink: buildPath([
    [1.82, 2.95, 0.28],
    [1.82, 4.35, 0.4],
  ]),
  // Mini PC -> ESP32 + GSM (serial/USB trigger)
  espWire: buildPath([
    [0.75, 2.64, 0.42],
    [0.75, 2.632, 0.45],
    [2.22, 2.632, 0.45],
    [2.29, 2.645, 0.32],
  ]),
}

/* ------------------------------------------------------------------ */
/* Simulation timelines (seconds since the button was pressed)         */
/* ------------------------------------------------------------------ */

const RAW_TIMELINES = {
  entry: {
    duration: 11,
    endLocation: 'classroom',
    walks: [
      { from: 0, to: 3, face: Math.PI, path: buildPath([HALLWAY_REST, [0.6, 0, 1.0]]) },
      {
        from: 5.8,
        to: 10,
        face: -Math.PI / 2,
        path: buildPath([
          [0.6, 0, 1.0],
          [1.6, 0, 0.9],
          [1.6, 0, -1.0],
          [0.95, 0, -2.6],
          [0.95, 0, -3.5],
        ]),
      },
    ],
    cameras: [
      { at: 0, view: 'hallway' },
      { at: 6.2, view: 'overview' },
    ],
    scan: { terminal: 'entry', from: 3, to: 5, granted: 4.4 },
    door: { angle: 1.35, open: [4.8, 5.8], close: [8.8, 9.8] }, // + = swings inward
    pulses: [
      { wire: 'entryWire', from: 6.4, to: 7.4, color: COLORS.lan },
      { wire: 'lan', from: 7.6, to: 8.4, color: COLORS.lan },
      { wire: 'uplink', from: 8.4, to: 9.2, color: COLORS.cloud },
      { wire: 'espWire', from: 7.6, to: 8.5, color: COLORS.sms },
    ],
    hits: { miniPc: 7.4, mercusys: 8.0, dito: 8.4, esp: 8.5, cloud: 9.2 },
    sms: [8.5, 10.5],
    status: [
      { at: 0, text: 'Approaching entry terminal…', tone: 'idle' },
      { at: 3, text: 'Scanning face…', tone: 'scan' },
      { at: 4.4, text: 'Room Access Granted', tone: 'ok' },
    ],
    logs: [
      { at: 4.4, icon: '✓', text: 'Face verified at hallway entry terminal (Hikvision).' },
      { at: 7.6, icon: '✓', text: 'Local processing via Mini PC complete.' },
      {
        at: 8.8,
        icon: '✉',
        sms: true,
        text: 'Alert 1: SMS Alert dispatched to parent via ESP32 & GSM Module (DITO Network).',
      },
      { at: 9.3, icon: '☁', text: 'Alert 2: Section attendance logged in cloud database.' },
    ],
  },
  exit: {
    duration: 11,
    endLocation: 'hallway',
    walks: [
      {
        from: 0,
        to: 2.8,
        face: 0,
        path: buildPath([
          [0.95, 0, -3.5],
          [1.3, 0, -2.2],
          [2.9, 0, -0.95],
        ]),
      },
      {
        from: 5.6,
        to: 10,
        path: buildPath([
          [2.9, 0, -0.95],
          [1.6, 0, -0.95],
          [1.6, 0, 1.0],
          HALLWAY_REST,
        ]),
      },
    ],
    cameras: [
      { at: 0, view: 'classroom' },
      { at: 6.0, view: 'hallway' },
    ],
    scan: { terminal: 'exit', from: 2.8, to: 4.8, granted: 4.2 },
    door: { angle: -1.35, open: [4.6, 5.6], close: [8.4, 9.4] }, // - = swings outward
    pulses: [
      { wire: 'exitWire', from: 5.8, to: 7.0, color: COLORS.lan },
      { wire: 'lan', from: 7.2, to: 8.0, color: COLORS.lan },
      { wire: 'uplink', from: 8.0, to: 8.8, color: COLORS.cloud },
      { wire: 'espWire', from: 7.2, to: 8.1, color: COLORS.sms },
    ],
    hits: { miniPc: 7.0, mercusys: 7.6, dito: 8.0, esp: 8.1, cloud: 8.8 },
    sms: [8.1, 10.1],
    status: [
      { at: 0, text: 'Approaching exit terminal…', tone: 'idle' },
      { at: 2.8, text: 'Scanning face…', tone: 'scan' },
      { at: 4.2, text: 'Exit Logged', tone: 'ok' },
    ],
    logs: [
      { at: 4.2, icon: '✓', text: 'Face verified at interior exit terminal (Hikvision).' },
      { at: 7.2, icon: '✓', text: 'Local processing via Mini PC complete.' },
      {
        at: 8.4,
        icon: '✉',
        sms: true,
        text: 'Alert: SMS Exit Alert dispatched to parent via ESP32 & GSM Module.',
      },
      { at: 9.0, icon: '☁', text: 'Cloud log updated with exit time.' },
    ],
  },
}

// Precompute the moments the dashboard needs to re-render.
const TIMELINES = Object.fromEntries(
  Object.entries(RAW_TIMELINES).map(([key, tl]) => [
    key,
    {
      ...tl,
      thresholds: [...new Set([...tl.status, ...tl.logs].map((e) => e.at))].sort((a, b) => a - b),
    },
  ]),
)

/* ------------------------------------------------------------------ */
/* Shared simulation clock                                             */
/* ------------------------------------------------------------------ */

const SimContext = createContext(null)

/** useFrame wrapper that passes the active timeline and elapsed time. */
function useSimFrame(callback) {
  const sim = useContext(SimContext)
  useFrame((state, dt) => {
    const s = sim.current
    const tl = s.mode ? TIMELINES[s.mode] : null
    const t = s.mode ? now() - s.start : 0
    callback({ s, tl, t, dt, state })
  })
}

/** Publishes timeline progress to React state (only when a threshold is crossed). */
function Director({ onReach, onDone }) {
  const last = useRef(-1)
  useSimFrame(({ s, tl, t }) => {
    if (!tl) return
    if (t >= tl.duration) {
      s.location = tl.endLocation
      s.mode = null
      last.current = -1
      onDone(tl.endLocation)
      return
    }
    let reached = 0
    for (const a of tl.thresholds) if (a <= t) reached = a
    if (reached !== last.current) {
      last.current = reached
      onReach(reached)
    }
  })
  return null
}

/* ------------------------------------------------------------------ */
/* Primitive helpers                                                   */
/* ------------------------------------------------------------------ */

/** Box defined by min/max corners. */
function Box({ min, max, color, mat, shadow = true, ...props }) {
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const pos = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  return (
    <mesh position={pos} castShadow={shadow} receiveShadow={shadow} {...props}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.8} {...mat} />
    </mesh>
  )
}

/** Box defined by center + size. */
function Block({ position, size, color, mat, shadow = true, ...props }) {
  return (
    <mesh position={position} castShadow={shadow} receiveShadow={shadow} {...props}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.7} {...mat} />
    </mesh>
  )
}

/**
 * Floating HTML label. `side` hides it when the camera is on the other side
 * of the hallway/classroom wall (z = 0), since HTML labels aren't occluded.
 */
function Label({ position, children, show = true, tone = 'dark', side }) {
  const el = useRef()
  useFrame(({ camera }) => {
    if (!el.current || !side) return
    const visible = side === 'hallway' ? camera.position.z > 0 : camera.position.z < 0
    el.current.style.visibility = visible ? 'visible' : 'hidden'
  })
  if (!show) return null
  const toneClass =
    tone === 'dark' ? 'bg-slate-900/85 text-white' : 'bg-white/90 text-slate-900 border border-slate-300'
  return (
    <Html position={position} center distanceFactor={8} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div
        ref={el}
        className={`pointer-events-none select-none whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium shadow ${toneClass}`}
      >
        {children}
      </div>
    </Html>
  )
}

function useCanvasTexture(draw, deps, repeat) {
  return useMemo(() => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    draw(canvas, ctx)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    if (repeat) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(...repeat)
    }
    tex.anisotropy = 4
    return tex
  }, deps)
}

/* ------------------------------------------------------------------ */
/* Environment: floor, walls, door, sign, window, classroom            */
/* ------------------------------------------------------------------ */

function Floor() {
  // 4x4 light tiles per texture tile (2 m x 2 m => 0.5 m tiles)
  const tex = useCanvasTexture(
    (c, g) => {
      c.width = c.height = 512
      g.fillStyle = '#cfc8b8'
      g.fillRect(0, 0, 512, 512)
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          g.fillStyle = (i + j) % 2 ? '#f1ede3' : '#ece6d8'
          g.fillRect(i * 128 + 3, j * 128 + 3, 122, 122)
        }
    },
    [],
    [7, 5.25],
  )
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -0.75]} receiveShadow>
      <planeGeometry args={[14, 10.5]} />
      <meshStandardMaterial map={tex} roughness={0.6} />
    </mesh>
  )
}

function DividingWall() {
  const T = 0.1 // half thickness
  const wall = (x1, x2, y1, y2, key) => (
    <Box key={key} min={[x1, y1, -T]} max={[x2, y2, T]} color={COLORS.wall} />
  )
  return (
    <group>
      {wall(-7, WINDOW.x1, 0, WALL_H, 'l')}
      {wall(WINDOW.x1, WINDOW.x2, 0, WINDOW.y1, 'under-window')}
      {wall(WINDOW.x1, WINDOW.x2, WINDOW.y2, WALL_H, 'over-window')}
      {wall(WINDOW.x2, DOOR.x1, 0, WALL_H, 'between')}
      {wall(DOOR.x1, DOOR.x2, DOOR.h, WALL_H, 'over-door')}
      {wall(DOOR.x2, 7, 0, WALL_H, 'r')}
      {/* Dark brown lower border (baseboard) on both faces */}
      <Box min={[-7, 0, -0.12]} max={[DOOR.x1 - 0.06, 0.3, 0.12]} color={COLORS.baseboard} />
      <Box min={[DOOR.x2 + 0.06, 0, -0.12]} max={[7, 0.3, 0.12]} color={COLORS.baseboard} />
      {/* Door frame */}
      <Box min={[DOOR.x1 - 0.06, 0, -0.12]} max={[DOOR.x1, DOOR.h + 0.06, 0.12]} color={COLORS.frame} />
      <Box min={[DOOR.x2, 0, -0.12]} max={[DOOR.x2 + 0.06, DOOR.h + 0.06, 0.12]} color={COLORS.frame} />
      <Box min={[DOOR.x1 - 0.06, DOOR.h, -0.12]} max={[DOOR.x2 + 0.06, DOOR.h + 0.06, 0.12]} color={COLORS.frame} />
    </group>
  )
}

function Door() {
  const pivot = useRef()
  useSimFrame(({ tl, t }) => {
    let angle = 0
    if (tl) {
      const { angle: a, open, close } = tl.door
      angle = a * (smooth(progress(t, open)) - smooth(progress(t, close)))
    }
    pivot.current.rotation.y = angle
  })
  const w = DOOR.x2 - DOOR.x1
  const inset = (y1, y2, z) => (
    <Box min={[0.15, y1, z > 0 ? 0.025 : -0.035]} max={[w - 0.15, y2, z > 0 ? 0.035 : -0.025]} color={COLORS.doorInset} />
  )
  return (
    // Hinge on the left jamb of the doorway
    <group ref={pivot} position={[DOOR.x1, 0, 0]}>
      <Box min={[0.01, 0.01, -0.025]} max={[w - 0.01, DOOR.h - 0.01, 0.025]} color={COLORS.door} mat={{ roughness: 0.5 }} />
      {inset(1.25, 2.0, 1)}
      {inset(0.2, 1.05, 1)}
      {inset(1.25, 2.0, -1)}
      {inset(0.2, 1.05, -1)}
      {[0.05, -0.05].map((z) => (
        <Block key={z} position={[w - 0.12, 1.0, z]} size={[0.1, 0.03, 0.04]} color="#c9a227" mat={{ metalness: 0.8, roughness: 0.3 }} />
      ))}
    </group>
  )
}

function RoomSign() {
  const tex = useCanvasTexture((c, g) => {
    c.width = 256
    c.height = 96
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, 256, 96)
    g.fillStyle = '#111111'
    g.font = 'bold 60px Arial, Helvetica, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('B 301', 128, 52)
  }, [])
  const x = (DOOR.x1 + DOOR.x2) / 2
  return (
    <group position={[x, 2.39, 0.1]}>
      <Block position={[0, 0, 0.01]} size={[0.42, 0.16, 0.02]} color="#ffffff" />
      <mesh position={[0, 0, 0.021]}>
        <planeGeometry args={[0.4, 0.15]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  )
}

function Curtain({ x1, x2, z }) {
  const strips = 9
  const w = (x2 - x1) / strips
  const h = WINDOW.y2 + 0.1 - WINDOW.y1
  return (
    <group>
      {Array.from({ length: strips }, (_, i) => (
        <mesh
          key={i}
          position={[x1 + w * (i + 0.5), WINDOW.y1 + h / 2, z + (i % 2 ? 0.03 : 0)]}
          rotation={[0, i % 2 ? 0.35 : -0.35, 0]}
        >
          <planeGeometry args={[w * 1.08, h]} />
          <meshStandardMaterial
            color={COLORS.curtain}
            transparent
            opacity={0.55}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

function WindowWithGrilles() {
  const { x1, x2, y1, y2 } = WINDOW
  const cx = (x1 + x2) / 2
  const w = x2 - x1
  const h = y2 - y1
  const metal = { metalness: 0.6, roughness: 0.4 }
  const verticals = []
  for (let x = x1 + 0.2; x < x2 - 0.05; x += 0.2) verticals.push(x)
  return (
    <group>
      {/* Aluminum frame + mullions */}
      <Box min={[x1, y1 - 0.04, -0.13]} max={[x2, y1, 0.13]} color={COLORS.aluminum} mat={metal} />
      <Box min={[x1, y2, -0.11]} max={[x2, y2 + 0.04, 0.11]} color={COLORS.aluminum} mat={metal} />
      {[x1, x1 + w / 3, x1 + (2 * w) / 3, x2].map((x) => (
        <Box key={x} min={[x - 0.025, y1, -0.03]} max={[x + 0.025, y2, 0.03]} color={COLORS.aluminum} mat={metal} />
      ))}
      {/* Glass */}
      <mesh position={[cx, y1 + h / 2, 0]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color="#cfe9f5" transparent opacity={0.18} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* Security grilles on the hallway side */}
      <group position={[0, 0, 0.16]}>
        <Box min={[x1, y1, -0.015]} max={[x2, y1 + 0.03, 0.015]} color={COLORS.metal} mat={metal} />
        <Box min={[x1, y2 - 0.03, -0.015]} max={[x2, y2, 0.015]} color={COLORS.metal} mat={metal} />
        <Box min={[x1, y1, -0.015]} max={[x1 + 0.03, y2, 0.015]} color={COLORS.metal} mat={metal} />
        <Box min={[x2 - 0.03, y1, -0.015]} max={[x2, y2, 0.015]} color={COLORS.metal} mat={metal} />
        {verticals.map((x) => (
          <Block key={x} position={[x, y1 + h / 2, 0]} size={[0.02, h, 0.02]} color={COLORS.metal} mat={metal} />
        ))}
        {[y1 + h * 0.33, y1 + h * 0.66].map((y) => (
          <Block key={y} position={[cx, y, 0]} size={[w, 0.025, 0.025]} color={COLORS.metal} mat={metal} />
        ))}
        {/* Brackets anchoring the grille to the wall */}
        {[x1 + 0.05, x2 - 0.05].map((x) =>
          [y1 + 0.05, y2 - 0.05].map((y) => (
            <Block key={`${x}${y}`} position={[x, y, -0.04]} size={[0.04, 0.04, 0.06]} color={COLORS.metal} />
          )),
        )}
      </group>
      {/* Curtain rod + semi-transparent yellow curtains (classroom side) */}
      <mesh position={[cx, y2 + 0.12, -0.2]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.012, 0.012, w + 0.3, 8]} />
        <meshStandardMaterial color="#888" metalness={0.7} roughness={0.3} />
      </mesh>
      <Curtain x1={x1 - 0.1} x2={cx - 0.35} z={-0.22} />
      <Curtain x1={cx + 0.35} x2={x2 + 0.1} z={-0.22} />
    </group>
  )
}

function Desk({ x, z }) {
  const top = 0.74
  const chairZ = z + 0.48
  return (
    <group>
      <Block position={[x, top, z]} size={[0.62, 0.04, 0.45]} color={COLORS.wood} />
      <Block position={[x, top - 0.12, z - 0.05]} size={[0.56, 0.02, 0.32]} color={COLORS.wood} />
      {[-0.27, 0.27].map((dx) =>
        [-0.19, 0.19].map((dz) => (
          <Block key={`${dx}${dz}`} position={[x + dx, top / 2, z + dz]} size={[0.04, top, 0.04]} color="#2e1b0f" />
        )),
      )}
      {/* Chair */}
      <Block position={[x, 0.44, chairZ]} size={[0.4, 0.04, 0.38]} color={COLORS.wood} />
      <Block position={[x, 0.7, chairZ + 0.18]} size={[0.4, 0.3, 0.03]} color={COLORS.wood} />
      {[-0.17, 0.17].map((dx) =>
        [-0.16, 0.16].map((dz) => (
          <Block key={`${dx}${dz}`} position={[x + dx, 0.21, chairZ + dz]} size={[0.035, 0.42, 0.035]} color="#2e1b0f" />
        )),
      )}
    </group>
  )
}

function Classroom() {
  const cols = [-4.6, -3.0, -1.4, 0.2]
  const rows = [-2.4, -3.8, -5.1]
  return (
    <group>
      {/* Back wall with blackboard */}
      <Box min={[-7.1, 0, -6.1]} max={[7, WALL_H, -6]} color={COLORS.wall} />
      <Box min={[-7, 0, -6]} max={[7, 0.3, -5.96]} color={COLORS.baseboard} />
      <Box min={[-3.6, 0.95, -6]} max={[1.6, 2.35, -5.97]} color="#5a3a1e" />
      <Box min={[-3.5, 1.0, -5.97]} max={[1.5, 2.3, -5.95]} color="#1f3b2d" mat={{ roughness: 0.95 }} />
      {/* Left wall */}
      <Box min={[-7.1, 0, -6.1]} max={[-7, WALL_H, 0.1]} color={COLORS.wall} />
      <Box min={[-7, 0, -6]} max={[-6.96, 0.3, -0.1]} color={COLORS.baseboard} />
      {cols.map((x) => rows.map((z) => <Desk key={`${x}${z}`} x={x} z={z} />))}
      {/* Teacher's table */}
      <Block position={[3.2, 0.76, -4.9]} size={[1.4, 0.05, 0.7]} color={COLORS.wood} />
      <Block position={[3.2, 0.37, -4.9]} size={[1.3, 0.72, 0.6]} color="#3d2414" />
    </group>
  )
}

function HallwayRailing() {
  const z = 4.4
  const posts = []
  for (let x = -7; x <= 7; x += 1) posts.push(x)
  return (
    <group>
      <Box min={[-7, 0, z - 0.1]} max={[7, 0.25, z + 0.1]} color="#d8d2c2" />
      <Box min={[-7, 1.0, z - 0.04]} max={[7, 1.05, z + 0.04]} color={COLORS.metal} mat={{ metalness: 0.6 }} />
      {posts.map((x) => (
        <Block key={x} position={[x, 0.62, z]} size={[0.04, 0.76, 0.04]} color={COLORS.metal} mat={{ metalness: 0.6 }} />
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Hardware: face-recognition terminals                                */
/* ------------------------------------------------------------------ */

const BLUE = new THREE.Color(COLORS.scanBlue)
const GREEN = new THREE.Color(COLORS.scanGreen)
const IDLE_SCREEN = new THREE.Color('#0c1a3a')

/**
 * Hikvision-style terminal. Local +z is the side facing the person.
 * `beamLength` is the distance to where the student stands.
 */
function Terminal({ id, position, rotationY = 0, beamLength = 0.8 }) {
  const screen = useRef()
  const beam = useRef()
  const beamMat = useRef()
  const sweep = useRef()
  const sweepMat = useRef()
  const light = useRef()

  useSimFrame(({ tl, t }) => {
    const scan = tl?.scan
    const active = scan && scan.terminal === id && t >= scan.from && t <= scan.to
    const color = active && t >= scan.granted ? GREEN : BLUE
    beam.current.visible = !!active
    sweep.current.visible = !!active
    light.current.intensity = active ? 2.5 : 0
    if (active) {
      beamMat.current.color.copy(color)
      sweepMat.current.color.copy(color)
      light.current.color.copy(color)
      beamMat.current.opacity = 0.18 + Math.sin(t * 20) * 0.05
      sweep.current.position.y = t >= scan.granted ? 0 : Math.sin(t * 7) * 0.16
      screen.current.color.copy(color)
      screen.current.emissive.copy(color)
      screen.current.emissiveIntensity = 1.5
    } else {
      screen.current.color.copy(IDLE_SCREEN)
      screen.current.emissive.copy(IDLE_SCREEN)
      screen.current.emissiveIntensity = 0.6
    }
  })

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box min={[-0.11, -0.16, 0]} max={[0.11, 0.16, 0.05]} color="#0b0b0d" mat={{ roughness: 0.35 }} />
      <mesh position={[0, -0.02, 0.0505]}>
        <planeGeometry args={[0.15, 0.2]} />
        <meshStandardMaterial ref={screen} color={IDLE_SCREEN} emissive={IDLE_SCREEN} toneMapped={false} />
      </mesh>
      {/* Camera lens */}
      <mesh position={[0, 0.115, 0.052]}>
        <circleGeometry args={[0.012, 16]} />
        <meshBasicMaterial color="#5ec8ff" />
      </mesh>
      {/* Scanning cone (apex at the terminal) */}
      <mesh ref={beam} visible={false} position={[0, 0, 0.05 + beamLength / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.24, beamLength, 32, 1, true]} />
        <meshBasicMaterial
          ref={beamMat}
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      {/* Sweeping scan line across the face */}
      <mesh ref={sweep} visible={false} position={[0, 0, 0.05 + beamLength - 0.06]}>
        <planeGeometry args={[0.36, 0.012]} />
        <meshBasicMaterial ref={sweepMat} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <pointLight ref={light} position={[0, 0, 0.25]} intensity={0} distance={2} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Hardware: network & SMS cluster on the shelf above the door         */
/* ------------------------------------------------------------------ */

function Led({ position, color, hit, size = 0.015 }) {
  const mat = useRef()
  useSimFrame(({ tl, t }) => {
    mat.current.emissiveIntensity = 0.8 + flash(t, tl?.hits?.[hit]) * 8
  })
  return (
    <mesh position={position}>
      <boxGeometry args={[size, size, size]} />
      <meshStandardMaterial ref={mat} color={color} emissive={color} toneMapped={false} />
    </mesh>
  )
}

function NetworkShelf({ showLabels }) {
  const front = 0.415 // z of device front faces
  return (
    <group>
      {/* Shelf board + brackets */}
      <Box min={[0.42, SHELF_Y - 0.04, 0.1]} max={[2.72, SHELF_Y, 0.46]} color={COLORS.wood} />
      {[0.5, 2.64].map((x) => (
        <Box key={x} min={[x - 0.015, SHELF_Y - 0.2, 0.1]} max={[x + 0.015, SHELF_Y - 0.04, 0.4]} color={COLORS.metal} />
      ))}

      {/* Mini PC */}
      <Block position={DEVICES.miniPc} size={[0.28, 0.1, 0.28]} color="#4b5563" mat={{ metalness: 0.5, roughness: 0.4 }} />
      <Led position={[0.68, DEVICES.miniPc[1], 0.42]} color="#60a5fa" hit="miniPc" />

      {/* Mercusys AC12G (black, 4 antennas) */}
      <Block position={DEVICES.mercusys} size={[0.42, 0.05, 0.26]} color="#111111" mat={{ roughness: 0.3 }} />
      {[-0.18, -0.06, 0.06, 0.18].map((dx) => (
        <Block key={dx} position={[1.28 + dx, SHELF_Y + 0.15, 0.16]} size={[0.025, 0.2, 0.012]} color="#111111" />
      ))}
      {[-0.1, -0.05, 0, 0.05].map((dx) => (
        <Led key={dx} position={[1.28 + dx, DEVICES.mercusys[1] + 0.012, front]} color="#22c55e" hit="mercusys" size={0.012} />
      ))}

      {/* DITO ZTE K10 home router (white upright unit with red accent) */}
      <Block position={DEVICES.dito} size={[0.18, 0.32, 0.18]} color="#f5f5f4" mat={{ roughness: 0.4 }} />
      <Block position={[1.82, SHELF_Y + 0.25, 0.372]} size={[0.12, 0.03, 0.005]} color="#dc2626" shadow={false} />
      <Led position={[1.82, SHELF_Y + 0.12, 0.373]} color="#ef4444" hit="dito" />

      {/* ESP32 + GSM module on a small base */}
      <Block position={DEVICES.esp} size={[0.42, 0.03, 0.22]} color="#1f2937" />
      <Block position={[2.29, SHELF_Y + 0.04, 0.3]} size={[0.2, 0.02, 0.08]} color="#1e3a8a" />
      <Block position={[2.26, SHELF_Y + 0.055, 0.3]} size={[0.08, 0.012, 0.06]} color="#cbd5e1" mat={{ metalness: 0.8 }} />
      <Led position={[2.36, SHELF_Y + 0.055, 0.32]} color="#3b82f6" hit="esp" size={0.012} />
      <Block position={[2.5, SHELF_Y + 0.04, 0.3]} size={[0.12, 0.02, 0.12]} color="#b91c1c" />
      <Led position={[2.47, SHELF_Y + 0.055, 0.34]} color="#f59e0b" hit="esp" size={0.012} />
      <mesh position={[2.53, SHELF_Y + 0.13, 0.3]} castShadow>
        <cylinderGeometry args={[0.008, 0.008, 0.18, 8]} />
        <meshStandardMaterial color="#111" />
      </mesh>

      <Label show={showLabels} side="hallway" position={[0.55, 2.82, 0.45]}>Mini PC</Label>
      <Label show={showLabels} side="hallway" position={[1.3, 3.02, 0.3]}>Mercusys AC12G</Label>
      <Label show={showLabels} side="hallway" position={[2.0, 3.22, 0.3]}>DITO ZTE K10</Label>
      <Label show={showLabels} side="hallway" position={[2.6, 2.9, 0.4]}>ESP32 + GSM</Label>
    </group>
  )
}

function Wires() {
  const wire = { color: '#2b2b2b', lineWidth: 2.2 }
  return (
    <group>
      <Line points={WIRES.entryWire.pts} {...wire} />
      <Line points={WIRES.exitWire.pts} {...wire} />
      <Line points={WIRES.lan.pts} {...wire} color="#1e40af" />
      <Line points={WIRES.espWire.pts} {...wire} color="#92400e" />
      <Line points={WIRES.uplink.pts} color={COLORS.cloud} lineWidth={1.5} dashed dashSize={0.08} gapSize={0.06} />
    </group>
  )
}

/** Glowing packet travelling along a wire during [from, to] of a given mode. */
function Pulse({ mode, wire, from, to, color }) {
  const group = useRef()
  useSimFrame(({ s, t }) => {
    const active = s.mode === mode && t >= from && t <= to
    group.current.visible = active
    if (active) samplePath(WIRES[wire], progress(t, [from, to]), group.current.position)
  })
  return (
    <group ref={group} visible={false}>
      <mesh>
        <sphereGeometry args={[0.035, 16, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.09, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  )
}

function Pulses() {
  return Object.entries(TIMELINES).flatMap(([mode, tl]) =>
    tl.pulses.map((p, i) => <Pulse key={`${mode}-${i}`} mode={mode} {...p} />),
  )
}

/** Expanding radio rings + SMS bubble from the GSM antenna. */
function GsmSignal() {
  const rings = [useRef(), useRef(), useRef()]
  const bubble = useRef()
  useSimFrame(({ tl, t }) => {
    const active = tl && t >= tl.sms[0] && t <= tl.sms[1]
    rings.forEach((r, i) => {
      const local = active ? (((t - tl.sms[0]) - i * 0.33) % 1 + 1) % 1 : 0
      const show = active && t - tl.sms[0] >= i * 0.33
      r.current.visible = show
      if (show) {
        r.current.scale.setScalar(0.6 + local * 3.5)
        r.current.material.opacity = 1 - local
      }
    })
    if (bubble.current) bubble.current.style.opacity = active ? '1' : '0'
  })
  return (
    <group position={DEVICES.gsmAntennaTip}>
      <Billboard>
        {rings.map((r, i) => (
          <mesh key={i} ref={r} visible={false}>
            <ringGeometry args={[0.06, 0.075, 40]} />
            <meshBasicMaterial color={COLORS.sms} transparent side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </Billboard>
      <Html position={[0.35, 0.25, 0]} center distanceFactor={8} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div
          ref={bubble}
          className="pointer-events-none whitespace-nowrap rounded-lg bg-amber-400 px-2 py-1 text-[11px] font-semibold text-amber-950 shadow-lg transition-opacity duration-300"
          style={{ opacity: 0 }}
        >
          ✉ SMS → Parent (DITO)
        </div>
      </Html>
    </group>
  )
}

function CloudNode({ showLabels }) {
  const group = useRef()
  const mats = useRef([])
  const puffs = [
    [0, 0, 0, 0.22],
    [0.22, -0.04, 0, 0.17],
    [-0.22, -0.05, 0, 0.16],
    [0.08, 0.13, 0, 0.16],
  ]
  useSimFrame(({ tl, t, state }) => {
    group.current.position.y = DEVICES.cloud[1] + Math.sin(state.clock.elapsedTime * 1.2) * 0.05
    const f = flash(t, tl?.hits?.cloud)
    mats.current.forEach((m) => m && (m.emissiveIntensity = 0.15 + f * 2.5))
  })
  return (
    <group ref={group} position={DEVICES.cloud}>
      {puffs.map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]}>
          <sphereGeometry args={[r, 24, 24]} />
          <meshStandardMaterial ref={(m) => (mats.current[i] = m)} color="#ffffff" emissive={COLORS.cloud} emissiveIntensity={0.15} />
        </mesh>
      ))}
      <Label show={showLabels} position={[0, 0.42, 0]}>Cloud Database</Label>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Grade 10 student                                                    */
/* ------------------------------------------------------------------ */

const SKIN = '#c68c5a'

function Leg({ x, limbRef }) {
  return (
    <group ref={limbRef} position={[x, 0.82, 0]}>
      <Block position={[0, -0.38, 0]} size={[0.13, 0.76, 0.15]} color="#1f2a44" />
      <Block position={[0, -0.79, 0.03]} size={[0.13, 0.06, 0.22]} color="#111111" />
    </group>
  )
}

function Arm({ x, limbRef }) {
  return (
    <group ref={limbRef} position={[x, 1.32, 0]}>
      <Block position={[0, -0.08, 0]} size={[0.11, 0.18, 0.12]} color="#f8fafc" />
      <Block position={[0, -0.33, 0]} size={[0.08, 0.36, 0.09]} color={SKIN} />
    </group>
  )
}

function Student({ showLabels }) {
  const root = useRef()
  const legL = useRef()
  const legR = useRef()
  const armL = useRef()
  const armR = useRef()
  const body = useRef()
  const tmp = useMemo(() => new THREE.Vector3(), [])

  useSimFrame(({ tl, t, dt }) => {
    let moving = false
    let target = null
    if (tl) {
      const walk = tl.walks.find((w) => t >= w.from && t <= w.to)
      if (walk) {
        const seg = samplePath(walk.path, smooth(progress(t, [walk.from, walk.to])), tmp)
        root.current.position.copy(tmp)
        const d = walk.path.dirs[seg]
        target = Math.atan2(d.x, d.z)
        moving = true
      } else {
        const prev = [...tl.walks].reverse().find((w) => t > w.to)
        if (prev) {
          root.current.position.copy(prev.path.pts[prev.path.pts.length - 1])
          target = prev.face ?? null
        } else {
          root.current.position.copy(tl.walks[0].path.pts[0])
        }
      }
    }
    if (target != null) {
      const cur = root.current.rotation.y
      const diff = Math.atan2(Math.sin(target - cur), Math.cos(target - cur))
      root.current.rotation.y = cur + diff * Math.min(1, dt * 8)
    }
    const swing = moving ? Math.sin(now() * 9) * 0.55 : 0
    const k = Math.min(1, dt * 10)
    legL.current.rotation.x += (swing - legL.current.rotation.x) * k
    legR.current.rotation.x += (-swing - legR.current.rotation.x) * k
    armL.current.rotation.x += (-swing * 0.7 - armL.current.rotation.x) * k
    armR.current.rotation.x += (swing * 0.7 - armR.current.rotation.x) * k
    body.current.position.y = moving ? Math.abs(Math.sin(now() * 9)) * 0.025 : 0
  })

  return (
    <group ref={root} position={HALLWAY_REST} rotation={HALLWAY_REST_ROT}>
      <group ref={body}>
        <Leg x={-0.08} limbRef={legL} />
        <Leg x={0.08} limbRef={legR} />
        {/* White school polo + ID lanyard */}
        <Block position={[0, 1.1, 0]} size={[0.38, 0.52, 0.22]} color="#f8fafc" />
        <Block position={[0, 1.18, 0.112]} size={[0.025, 0.3, 0.005]} color="#1d4ed8" shadow={false} />
        <Block position={[0, 1.0, 0.115]} size={[0.07, 0.09, 0.006]} color="#ffffff" shadow={false} />
        <Arm x={-0.245} limbRef={armL} />
        <Arm x={0.245} limbRef={armR} />
        {/* Head + hair */}
        <Block position={[0, 1.39, 0]} size={[0.08, 0.06, 0.08]} color={SKIN} />
        <mesh position={[0, 1.52, 0]} castShadow>
          <sphereGeometry args={[0.13, 24, 24]} />
          <meshStandardMaterial color={SKIN} />
        </mesh>
        <mesh position={[0, 1.565, -0.02]} scale={[1.05, 0.8, 1.05]} castShadow>
          <sphereGeometry args={[0.13, 24, 24]} />
          <meshStandardMaterial color="#141414" />
        </mesh>
        {/* Backpack */}
        <Block position={[0, 1.1, -0.17]} size={[0.3, 0.38, 0.12]} color="#2563eb" />
      </group>
      <Label show={showLabels} position={[0, 1.9, 0]} tone="light">
        Grade 10 Student
      </Label>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

function Scene({ showLabels, viewRequest, autoFollow }) {
  return (
    <>
      <color attach="background" args={['#dfe7ef']} />
      <hemisphereLight args={['#ffffff', '#d6cfc0', 0.8]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[6, 10, 7]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-bias={-0.0005}
      />

      <Floor />
      <DividingWall />
      <Door />
      <RoomSign />
      <WindowWithGrilles />
      <Classroom />
      <HallwayRailing />

      {/* Entry terminal: hallway wall, between the window and the door */}
      <Terminal id="entry" position={[0.6, 1.45, 0.1]} beamLength={0.8} />
      {/* Exit terminal: inside wall of the classroom, faces into the room */}
      <Terminal id="exit" position={[2.9, 1.45, -0.1]} rotationY={Math.PI} beamLength={0.75} />
      <Label show={showLabels} side="hallway" position={[0.35, 1.78, 0.25]}>Entry Terminal (Hikvision)</Label>
      <Label show={showLabels} side="classroom" position={[2.9, 1.78, -0.25]}>Exit Terminal (Hikvision)</Label>

      <NetworkShelf showLabels={showLabels} />
      <Wires />
      <Pulses />
      <GsmSignal />
      <CloudNode showLabels={showLabels} />
      <Student showLabels={showLabels} />

      <CameraRig viewRequest={viewRequest} autoFollow={autoFollow} />
    </>
  )
}

/**
 * Orbit controls + smooth camera transitions between VIEWS.
 * A manual view request or the active timeline's `cameras` cues set the goal;
 * dragging the scene cancels an in-progress transition.
 */
function CameraRig({ viewRequest, autoFollow }) {
  const camera = useThree((s) => s.camera)
  const controls = useRef()
  const goal = useRef({ key: 'hallway', moving: false })
  const goalPos = useMemo(() => new THREE.Vector3(), [])
  const goalTarget = useMemo(() => new THREE.Vector3(), [])

  const setGoal = (key) => {
    goal.current = { key, moving: true }
    goalPos.set(...VIEWS[key].pos)
    goalTarget.set(...VIEWS[key].target)
  }

  // React to manual preset buttons (n changes on every click).
  const lastRequest = useRef(viewRequest.n)
  if (lastRequest.current !== viewRequest.n) {
    lastRequest.current = viewRequest.n
    setGoal(viewRequest.key)
  }

  const lastCue = useRef(null)
  useSimFrame(({ s, tl, t, dt }) => {
    if (autoFollow && tl) {
      let cue = null
      for (const c of tl.cameras) if (c.at <= t) cue = c
      const cueId = cue && `${s.mode}-${s.start}-${cue.at}`
      if (cue && cueId !== lastCue.current) {
        lastCue.current = cueId
        setGoal(cue.view)
      }
    }
    const c = controls.current
    if (!goal.current.moving || !c) return
    const k = 1 - Math.exp(-dt * 2.5)
    camera.position.lerp(goalPos, k)
    c.target.lerp(goalTarget, k)
    if (camera.position.distanceTo(goalPos) < 0.02 && c.target.distanceTo(goalTarget) < 0.02) {
      goal.current.moving = false
    }
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={VIEWS.hallway.target}
      maxPolarAngle={Math.PI / 2.05}
      minDistance={3}
      maxDistance={24}
      enableDamping
      onStart={() => (goal.current.moving = false)}
    />
  )
}

/* ------------------------------------------------------------------ */
/* HTML / Tailwind overlay                                             */
/* ------------------------------------------------------------------ */

const TONE_STYLES = {
  standby: 'bg-slate-700 text-slate-200',
  idle: 'bg-slate-600 text-white',
  scan: 'bg-blue-600 text-white animate-pulse',
  ok: 'bg-emerald-500 text-emerald-950',
}

function Dashboard({ mode, reached, smsTime }) {
  const tl = mode ? TIMELINES[mode] : null
  const status = tl ? [...tl.status].reverse().find((s) => s.at <= reached) : null
  const tone = status?.tone ?? 'standby'
  const smsRevealed = tl?.logs.some((l) => l.sms && l.at <= reached)
  const verb = mode === 'exit' ? 'EXITED' : 'ENTERED'

  return (
    <div className="pointer-events-auto absolute left-3 top-3 z-20 w-[23rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-white/10 bg-slate-900/85 p-4 text-white shadow-2xl backdrop-blur-md">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">
        Bantay · Smart Student Monitoring
      </p>
      <h1 className="mt-1 text-sm font-bold leading-snug">
        Claro M. Recto High School - Grade 10 Diamond (Room B 301)
      </h1>

      <div className="mt-3 flex items-center gap-3 rounded-xl bg-white/5 p-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-xs font-bold">
          {MOCK_STUDENT.name
            .split(' ')
            .map((p) => p[0])
            .slice(0, 2)
            .join('')}
        </div>
        <div className="text-xs">
          <p>
            <span className="text-slate-400">Student:</span> <span className="font-semibold">{MOCK_STUDENT.name}</span>
          </p>
          <p className="text-slate-400">LRN {MOCK_STUDENT.lrn} · mock data</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-slate-400">Status</span>
        <span className={`rounded-full px-2.5 py-1 font-semibold ${TONE_STYLES[tone]}`}>
          {status?.text ?? 'Standby – choose a simulation'}
        </span>
      </div>

      {tl && (
        <ul className="mt-3 space-y-1.5 text-xs">
          {tl.logs.map((log) => {
            const done = log.at <= reached
            return (
              <li
                key={log.text}
                className={`flex gap-2 rounded-lg px-2 py-1.5 transition-colors duration-300 ${
                  done ? 'bg-emerald-500/15 text-white' : 'bg-white/5 text-slate-500'
                }`}
              >
                <span className={`w-4 shrink-0 text-center ${done ? 'text-emerald-300' : ''}`}>
                  {done ? log.icon : '•'}
                </span>
                <span>{log.text}</span>
              </li>
            )
          })}
        </ul>
      )}

      {smsRevealed && (
        <div className="mt-3 rounded-xl border border-amber-300/30 bg-amber-400/10 p-2.5 text-xs">
          <p className="text-[10px] uppercase tracking-wider text-amber-300">SMS preview · to Parent/Guardian</p>
          <p className="mt-1 text-amber-50">
            CMRHS ALERT: {MOCK_STUDENT.name} (Gr. 10 Diamond) has {verb} Room B 301 at {smsTime}.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/10 pt-2 text-[10px] text-slate-400">
        {[
          ['bg-sky-400', 'LAN data'],
          ['bg-violet-400', 'Cloud uplink'],
          ['bg-amber-400', 'SMS trigger'],
        ].map(([dot, text]) => (
          <span key={text} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
            {text}
          </span>
        ))}
      </div>
    </div>
  )
}

function Controls({
  running,
  location,
  onEntry,
  onExit,
  showLabels,
  onToggleLabels,
  onView,
  autoFollow,
  onToggleAuto,
}) {
  const small = 'rounded-lg px-3 py-1.5 text-xs font-medium shadow transition'
  const base =
    'rounded-xl px-5 py-2.5 text-sm font-semibold shadow-lg transition disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <>
      <div className="pointer-events-auto absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onEntry}
            disabled={running || location !== 'hallway'}
            className={`${base} bg-emerald-500 text-emerald-950 hover:bg-emerald-400`}
          >
            Simulate Entry
          </button>
          <button
            type="button"
            onClick={onExit}
            disabled={running || location !== 'classroom'}
            className={`${base} bg-rose-500 text-white hover:bg-rose-400`}
          >
            Simulate Exit
          </button>
        </div>
        <p className="rounded-full bg-slate-900/70 px-3 py-1 text-[11px] text-slate-200">
          {running
            ? 'Simulation running…'
            : location === 'hallway'
              ? 'Student is in the hallway. Run the entry simulation.'
              : 'Student is inside Room B 301. Run the exit simulation.'}
        </p>
      </div>
      <div className="pointer-events-auto absolute right-3 top-3 z-20 flex flex-col items-end gap-2">
        <div className="flex gap-1.5 rounded-xl bg-slate-900/70 p-1.5">
          {Object.entries(VIEWS).map(([key, v]) => (
            <button
              key={key}
              type="button"
              onClick={() => onView(key)}
              className={`${small} bg-white/10 text-white hover:bg-white/20`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onToggleAuto}
            aria-pressed={autoFollow}
            className={`${small} ${autoFollow ? 'bg-sky-500 text-sky-950 hover:bg-sky-400' : 'bg-slate-900/80 text-white hover:bg-slate-800'}`}
          >
            Auto camera: {autoFollow ? 'On' : 'Off'}
          </button>
          <button
            type="button"
            onClick={onToggleLabels}
            className={`${small} bg-slate-900/80 text-white hover:bg-slate-800`}
          >
            {showLabels ? 'Hide labels' : 'Show labels'}
          </button>
        </div>
        <p className="hidden rounded-lg bg-slate-900/60 px-2 py-1 text-[10px] text-slate-200 sm:block">
          Drag to orbit · Scroll to zoom · Right-drag to pan
        </p>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const sim = useRef({ mode: null, start: 0, location: 'hallway' })
  const [mode, setMode] = useState(null) // mode of the current / last simulation
  const [running, setRunning] = useState(false)
  const [location, setLocation] = useState('hallway')
  const [reached, setReached] = useState(0)
  const [smsTime, setSmsTime] = useState('')
  const [showLabels, setShowLabels] = useState(true)
  const [autoFollow, setAutoFollow] = useState(true)
  const [viewRequest, setViewRequest] = useState({ key: 'hallway', n: 0 })

  const start = (next) => {
    if (running) return
    sim.current = { ...sim.current, mode: next, start: now() }
    setMode(next)
    setRunning(true)
    setReached(0)
    setSmsTime(new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }))
  }

  return (
    <SimContext.Provider value={sim}>
      <div className="relative h-screen w-full overflow-hidden bg-slate-200 font-sans">
        <Canvas shadows dpr={[1, 2]} camera={{ position: [7.5, 6, 9], fov: 45 }}>
          <Scene showLabels={showLabels} viewRequest={viewRequest} autoFollow={autoFollow} />
          <Director
            onReach={setReached}
            onDone={(loc) => {
              setRunning(false)
              setLocation(loc)
              setReached(Infinity)
            }}
          />
        </Canvas>
        <div className="pointer-events-none absolute inset-0">
          <Dashboard mode={mode} reached={reached} smsTime={smsTime} />
          <Controls
            running={running}
            location={location}
            onEntry={() => start('entry')}
            onExit={() => start('exit')}
            showLabels={showLabels}
            onToggleLabels={() => setShowLabels((v) => !v)}
            onView={(key) => setViewRequest((r) => ({ key, n: r.n + 1 }))}
            autoFollow={autoFollow}
            onToggleAuto={() => setAutoFollow((v) => !v)}
          />
        </div>
      </div>
    </SimContext.Provider>
  )
}
