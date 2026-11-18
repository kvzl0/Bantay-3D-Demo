/**
 * Bantay 3D Demo
 * A Cloud-based Smart Student Monitoring System with Performance Tracking
 * and Alert System for Claro M. Recto High School.
 *
 * Single-file interactive 3D demo of the 3-story school building, the
 * Room B 301 entry/exit process, and the local network / SMS data flow.
 * Built only with React Three Fiber + drei primitives (no GLTF/GLB models).
 * All animation is driven by useFrame.
 *
 * Coordinate notes
 *  - x runs along the building, z = 0 is the classroom front wall,
 *    z > 0 is the open-air hallway, z < 0 is inside the classrooms.
 *  - Each story is STORY m tall. Room B 301 is on the top story (y = TOP_Y).
 *  - The concrete stairwell is on the LEFT end of the building (x = -10.4..-6).
 *    Room 301 (x = -6..4) sits right beside its top landing; 302 and 303
 *    continue to the right. Floors below repeat the layout (101/201 under 301).
 *  - Entry terminal: outside on the hallway wall. Exit terminal and the
 *    network shelf: inside Room 301, around the door.
 *  - Room 301 details, hardware and wires use room-local coordinates and are
 *    rendered inside <group position={[0, TOP_Y, 0]}>. The student and the
 *    cameras use world coordinates.
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
  woodDark: '#2e1b0f',
  metal: '#3f4650',
  aluminum: '#a3a9b1',
  curtain: '#f5d142',
  railing: '#2f7d4a',
  concrete: '#cfc8b6',
  concreteLight: '#ddd6c4',
  slab: '#d9d2bf',
  scanBlue: '#3b82f6',
  scanGreen: '#22c55e',
  lan: '#38bdf8',
  cloud: '#a78bfa',
  sms: '#f59e0b',
}

const STORY = 3.4 // floor-to-floor height
const WALL_H = 3.2 // clear wall height (slab is 0.2)
const TOP_Y = STORY * 2 // floor level of the top story (rooms 301-303)
const ROOF_TOP = TOP_Y + STORY
const ROOM_W = 10
const ROOM = { x1: -6, x2: 4, depth: 6 } // room 301 footprint (local x)
// Rooms run left -> right: 301 | 302 | 303 (and 101..103, 201..203 below)
const BUILDING = { x1: ROOM.x1, x2: ROOM.x1 + 3 * ROOM_W } // x = -6..24
// Concrete switchback stairwell on the LEFT end of the building, right beside Room 301
const STAIR = { x1: -10.4, x2: ROOM.x1 - 0.05 }
const FLIGHT_OUT = { x1: STAIR.x1, x2: STAIR.x1 + 2.0, cx: STAIR.x1 + 1.0 } // flight 1 (outer side)
const FLIGHT_IN = { x1: STAIR.x1 + 2.1, x2: STAIR.x2, cx: (STAIR.x1 + 2.1 + STAIR.x2) / 2 } // flight 2 (beside 301)
const STAIR_DIVIDER = STAIR.x1 + 2.05
const HALL_Z = 3.0 // outer edge of the hallway
const DOOR = { x1: 1.1, x2: 2.1, h: 2.2 } // hinge on the right jamb (x2)
const WINDOW = { x1: -4.2, x2: -0.2, y1: 1.0, y2: 2.6 }
const SHELF_Y = 2.62 // top surface of the indoor shelf above the door
const WALK_SPEED = 2.0

const FLOORS = [
  { level: 0, label: 'Ground floor', rooms: [101, 102, 103] },
  { level: 1, label: 'Middle floor', rooms: [201, 202, 203] },
  { level: 2, label: 'Top floor', rooms: [301, 302, 303] },
]

const now = () => performance.now() / 1000
const clamp01 = (v) => Math.min(1, Math.max(0, v))
const smooth = (v) => v * v * (3 - 2 * v)
const progress = (t, [a, b]) => clamp01((t - a) / (b - a))
const flash = (t, hit) => (hit != null && t >= hit ? Math.exp(-(t - hit) * 3) : 0)
const top = ([x, y, z]) => [x, y + TOP_Y, z] // room-301-local -> world

/** Official SMS wording (Asia/Manila time). */
function manilaStamp(d = new Date()) {
  const time = d.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })
  const date = d.toLocaleDateString('en-US', {
    timeZone: 'Asia/Manila',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  return { time, date }
}
const smsMessage = (mode, { time, date }) =>
  `Bantay: ${MOCK_STUDENT.name} checked ${mode === 'exit' ? 'out' : 'in'} at ${time} on ${date} (Manila Time)`

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

/** A constant-speed walk starting at `from`. `timeAt(k)` = arrival time at point k. */
function walk(points, from, { face, speed = WALK_SPEED } = {}) {
  const path = buildPath(points)
  return { from, to: from + path.total / speed, path, face, timeAt: (k) => from + path.lens[k] / speed }
}

/* ------------------------------------------------------------------ */
/* Student routes (world coordinates)                                  */
/* ------------------------------------------------------------------ */

const COURTYARD_START = [-13.5, 0, 6.5]
const COURTYARD_ROT = [0, 2.5, 0]

/** Ground floor -> top floor via the left-side switchback concrete staircase. */
function stairClimbPoints() {
  const out = FLIGHT_OUT.cx
  const inn = FLIGHT_IN.cx
  const pts = []
  for (const f of [0, STORY]) {
    const m = f + STORY / 2
    pts.push(
      [out, f, 0.6],
      [out, f, 0.1],
      [out, m, -2.7], // top of flight 1
      [out, m, -3.45], // mid landing
      [inn, m, -3.45],
      [inn, m, -2.7],
      [inn, f + STORY, 0.1], // top of flight 2
      [inn, f + STORY, 0.6],
    )
  }
  return pts
}

/* Room-local points in front of / inside Room 301 */
const AT_ENTRY_TERMINAL = [0.6, 0, 1.0] // hallway side, facing the outdoor entry terminal
const AT_EXIT_TERMINAL = [2.6, 0, -0.9] // inside, facing the indoor exit terminal
const AT_SEAT = [0.45, 0, -2.6] // aisle beside the student's armchair

/* ------------------------------------------------------------------ */
/* Wires & devices (room-301-local coordinates, inside the room)       */
/* ------------------------------------------------------------------ */

/*
 * Network topology (all inside Room B 301, on the shelf above the door):
 *   Hikvision scanners --LAN--> Mercusys AC12G (black router / local switch)
 *   Mercusys AC12G --LAN--> Mini PC (central node)
 *   DITO ZTE K10 --internet--> Mini PC  (cellular internet access)
 *   Mini PC --cloud link--> Cloud database
 *   Mini PC --trigger--> ESP32 + GSM module --SMS--> parent
 * Shelf order, left to right: DITO, Mini PC, Mercusys, ESP32 + GSM.
 */
const DEVICES = {
  dito: [0.68, SHELF_Y + 0.07, -0.28], // centre of the pill-shaped base
  miniPc: [1.1, SHELF_Y + 0.05, -0.28],
  mercusys: [1.68, SHELF_Y + 0.025, -0.28],
  esp: [2.38, SHELF_Y + 0.015, -0.3],
  gsmAntennaTip: [2.53, SHELF_Y + 0.22, -0.3],
  cloud: [1.1, 5.6, 0.8],
}

const WIRES = {
  // Outdoor entry terminal (hallway wall, between window and door) -> up the wall,
  // through the wall into the room, under the shelf -> Mercusys LAN port
  entryWire: buildPath([
    [0.6, 1.62, 0.13],
    [0.6, 2.5, 0.13],
    [0.6, 2.5, -0.12],
    [1.6, 2.5, -0.12],
    [1.6, 2.645, -0.13],
    [1.6, 2.66, -0.16],
  ]),
  // Indoor exit terminal (right of the door) -> Mercusys LAN port
  exitWire: buildPath([
    [2.6, 1.62, -0.13],
    [2.6, 2.5, -0.12],
    [1.76, 2.5, -0.12],
    [1.76, 2.645, -0.13],
    [1.76, 2.66, -0.16],
  ]),
  // Mercusys AC12G -> Mini PC (LAN)
  lan: buildPath([
    [1.55, 2.65, -0.16],
    [1.55, 2.64, -0.13],
    [1.15, 2.64, -0.13],
    [1.15, 2.67, -0.15],
  ]),
  // DITO ZTE K10 -> Mini PC (cellular internet access)
  ditoLink: buildPath([
    [0.86, 2.68, -0.24],
    [0.91, 2.675, -0.22],
    [0.96, 2.67, -0.22],
  ]),
  // Mini PC -> cloud database (drawn dashed, up through the roof)
  uplink: buildPath([
    [1.1, 2.72, -0.28],
    [1.1, 5.35, 0.8],
  ]),
  // Mini PC -> ESP32 + GSM (serial/USB trigger), along the shelf's front lip
  espWire: buildPath([
    [1.1, 2.64, -0.42],
    [1.1, 2.632, -0.45],
    [2.22, 2.632, -0.45],
    [2.29, 2.645, -0.32],
  ]),
}

/* ------------------------------------------------------------------ */
/* Simulation timelines (seconds since the button was pressed)         */
/* ------------------------------------------------------------------ */

/**
 * Pulses, device hits and the SMS window, starting at T0:
 * scanner -> Mercusys (LAN) -> Mini PC, then at the same time
 * Mini PC -> cloud (internet supplied by DITO) and Mini PC -> ESP32 + GSM.
 */
function dataFlow(T0, terminalWire) {
  return {
    pulses: [
      { wire: terminalWire, from: T0, to: T0 + 0.9, color: COLORS.lan },
      { wire: 'lan', from: T0 + 1.0, to: T0 + 1.5, color: COLORS.lan },
      { wire: 'ditoLink', from: T0 + 1.7, to: T0 + 2.0, color: COLORS.cloud },
      { wire: 'uplink', from: T0 + 1.7, to: T0 + 2.5, color: COLORS.cloud },
      { wire: 'espWire', from: T0 + 1.7, to: T0 + 2.5, color: COLORS.sms },
    ],
    hits: { mercusys: T0 + 0.9, miniPc: T0 + 1.5, dito: T0 + 1.7, esp: T0 + 2.5, cloud: T0 + 2.5 },
    sms: [T0 + 2.5, T0 + 7.5],
  }
}

/** Dashboard log entries: face match at G, network steps relative to T0. */
function dataLogs(G, T0, kind) {
  const entry = kind === 'entry'
  return [
    {
      at: G,
      icon: '✓',
      text: entry ? 'Face verified at hallway entry terminal (Hikvision).' : 'Face verified at indoor exit terminal (Hikvision).',
    },
    { at: T0 + 0.9, icon: '⇄', text: 'Scan data received by Mercusys AC12G (local LAN switch).' },
    { at: T0 + 1.7, icon: '✓', text: 'Local processing via Mini PC complete.' },
    entry
      ? { at: T0 + 2.7, icon: '✉', sms: true, text: 'Alert 1: SMS Alert dispatched to parent via ESP32 & GSM Module (DITO Network).' }
      : { at: T0 + 2.7, icon: '✉', sms: true, text: 'Alert: SMS Exit Alert dispatched to parent via ESP32 & GSM Module.' },
    entry
      ? { at: T0 + 2.9, icon: '☁', text: 'Alert 2: Section attendance logged in cloud database.' }
      : { at: T0 + 2.9, icon: '☁', text: 'Cloud log updated with exit time.' },
  ]
}

function makeEntryTimeline() {
  // 1. Courtyard -> up the left-side stairs -> top hallway -> outdoor entry terminal
  const climb = stairClimbPoints()
  const approach = walk(
    [COURTYARD_START, ...climb, top([FLIGHT_IN.cx, 0, 1.5]), top([AT_ENTRY_TERMINAL[0], 0, 1.5]), top(AT_ENTRY_TERMINAL)],
    0,
    { face: Math.PI },
  )
  const reachedTopHall = approach.timeAt(climb.length) // top-floor stair landing
  // 2. Face scan at the hallway terminal
  const s0 = approach.to + 0.2
  const scan = { terminal: 'entry', from: s0, to: s0 + 2, granted: s0 + 1.4 }
  const G = scan.granted
  // 3. Door swings inward, 4. student steps inside and walks to the armchair
  const doorOpen = [G + 0.2, G + 1.2]
  const stepIn = walk(
    [top(AT_ENTRY_TERMINAL), top([1.5, 0, 0.9]), top([1.5, 0, -0.6]), top([0.45, 0, -1.3]), top(AT_SEAT)],
    doorOpen[1] - 0.2,
    { face: -Math.PI / 2 },
  )
  const inside = stepIn.timeAt(2)
  // 5. Data pulses through the indoor network cluster once the student is inside
  const T0 = inside
  const flow = dataFlow(T0, 'entryWire')
  return {
    endLocation: 'classroom',
    duration: Math.max(stepIn.to, flow.sms[1]) + 0.4,
    walks: [approach, stepIn],
    door: { angle: -1.35, open: doorOpen, close: [inside + 0.6, inside + 1.6] }, // negative = swings inward
    scan,
    ...flow,
    cameras: [
      { at: 0, view: 'follow' },
      { at: reachedTopHall + 0.5, view: 'hallway' },
      { at: inside - 0.4, view: 'classroom' },
    ],
    status: [
      { at: 0, text: 'Walking up the left-side stairs…', tone: 'idle' },
      { at: reachedTopHall, text: 'Approaching hallway entry terminal…', tone: 'idle' },
      { at: scan.from, text: 'Scanning face…', tone: 'scan' },
      { at: G, text: 'Room Access Granted', tone: 'ok' },
    ],
    logs: dataLogs(G, T0, 'entry'),
  }
}

function makeExitTimeline() {
  // 1. Armchair -> indoor exit terminal
  const toTerminal = walk([top(AT_SEAT), top([0.9, 0, -1.6]), top(AT_EXIT_TERMINAL)], 0, { face: 0 })
  // 2. Face scan
  const s0 = toTerminal.to + 0.2
  const scan = { terminal: 'exit', from: s0, to: s0 + 2, granted: s0 + 1.4 }
  const G = scan.granted
  // 3. Door swings outward, 4. student walks out to the hallway and back down the stairs
  const doorOpen = [scan.to - 0.4, scan.to + 0.6]
  const out = walk(
    [
      top(AT_EXIT_TERMINAL),
      top([1.5, 0, -0.75]),
      top([1.5, 0, 1.5]), // index 2: outside, clear of the door leaf
      top([FLIGHT_IN.cx, 0, 1.5]), // west along the hallway to the stair landing
      ...stairClimbPoints().reverse(),
      COURTYARD_START,
    ],
    scan.to + 0.4,
  )
  const outside = out.timeAt(2)
  const T0 = G + 0.3
  const flow = dataFlow(T0, 'exitWire')
  return {
    endLocation: 'courtyard',
    duration: Math.max(out.to, flow.sms[1]) + 0.4,
    walks: [toTerminal, out],
    door: { angle: 1.35, open: doorOpen, close: [outside + 0.4, outside + 1.4] }, // positive = outward
    scan,
    ...flow,
    cameras: [
      { at: 0, view: 'classroom' },
      { at: outside, view: 'hallway' },
      { at: Math.max(out.timeAt(4), flow.sms[1] - 1), view: 'follow' },
    ],
    status: [
      { at: 0, text: 'Walking to exit terminal…', tone: 'idle' },
      { at: scan.from, text: 'Scanning face…', tone: 'scan' },
      { at: G, text: 'Exit Logged', tone: 'ok' },
    ],
    logs: dataLogs(G, T0, 'exit'),
  }
}

const withThresholds = (tl) => ({
  ...tl,
  thresholds: [...new Set([...tl.status, ...tl.logs].map((e) => e.at))].sort((a, b) => a - b),
})

const TIMELINES = { entry: withThresholds(makeEntryTimeline()), exit: withThresholds(makeExitTimeline()) }

/** Camera presets (world coordinates). `follow` tracks the student. */
const VIEWS = {
  // From the courtyard air on the stair side: stair landing, entry terminal, door and window
  hallway: { label: 'Hallway', pos: [-5.5, TOP_Y + 3.0, 8.5], target: [0.3, TOP_Y + 1.5, 0.3] },
  classroom: { label: 'Classroom', pos: [-3.4, TOP_Y + 2.6, -5.5], target: [1.6, TOP_Y + 1.7, -0.3] },
  overview: { label: 'Overview', pos: [30, 22, 34], target: [5, 4.5, -1] },
}
// Follow camera sits to the front-left so the left-side stairwell isn't hidden by the building
const FOLLOW_OFFSET = new THREE.Vector3(-4.5, 3.0, 6.5)

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
 * Floating HTML label. HTML isn't occluded by walls, so `side` hides it when
 * the camera can't see that side of Room 301's front wall (z = 0):
 * 'hallway' needs the camera in front, 'classroom' needs it inside or above the roof.
 */
function Label({ position, children, show = true, tone = 'dark', side, size = 'text-[11px]' }) {
  const el = useRef()
  useFrame(({ camera }) => {
    if (!el.current || !side) return
    const { y, z } = camera.position
    const visible = side === 'hallway' ? z > 0 : z < 0 || y > ROOF_TOP + 0.3
    el.current.style.visibility = visible ? 'visible' : 'hidden'
  })
  if (!show) return null
  const toneClass =
    tone === 'dark' ? 'bg-slate-900/85 text-white' : 'bg-white/90 text-slate-900 border border-slate-300'
  return (
    <Html position={position} center distanceFactor={8} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div
        ref={el}
        className={`pointer-events-none select-none whitespace-nowrap rounded px-1.5 py-0.5 font-medium shadow ${size} ${toneClass}`}
      >
        {children}
      </div>
    </Html>
  )
}

/* Canvas-generated textures (no external assets). Canvases are cached per kind. */
const canvasCache = {}
function cachedCanvas(key, draw) {
  if (!canvasCache[key]) {
    const c = document.createElement('canvas')
    draw(c, c.getContext('2d'))
    canvasCache[key] = c
  }
  return canvasCache[key]
}
function canvasTexture(canvas, repeat) {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(...repeat)
  }
  return tex
}

/** 2 m x 2 m texture tile of 4x4 light 0.5 m floor tiles. */
const tileCanvas = () =>
  cachedCanvas('tiles', (c, g) => {
    c.width = c.height = 512
    g.fillStyle = '#cfc8b8'
    g.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        g.fillStyle = (i + j) % 2 ? '#f1ede3' : '#ece6d8'
        g.fillRect(i * 128 + 3, j * 128 + 3, 122, 122)
      }
  })

/** Transparent square grid (for railings and simple window grilles). */
const gridCanvas = (color) =>
  cachedCanvas(`grid-${color}`, (c, g) => {
    c.width = c.height = 64
    g.clearRect(0, 0, 64, 64)
    g.fillStyle = color
    g.fillRect(0, 0, 64, 6)
    g.fillRect(0, 0, 6, 64)
  })

function useTextTexture(text, { w = 256, h = 96, font = 'bold 60px Arial, Helvetica, sans-serif', bg = '#fff', fg = '#111' } = {}) {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    g.fillStyle = bg
    g.fillRect(0, 0, w, h)
    g.fillStyle = fg
    g.font = font
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, w / 2, h / 2 + 4)
    return canvasTexture(c)
  }, [text, w, h, font, bg, fg])
}

function TiledFloor({ x1, x2, z1, z2, y = 0 }) {
  const tex = useMemo(() => canvasTexture(tileCanvas(), [(x2 - x1) / 2, (z2 - z1) / 2]), [x1, x2, z1, z2])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(x1 + x2) / 2, y + 0.005, (z1 + z2) / 2]} receiveShadow>
      <planeGeometry args={[x2 - x1, z2 - z1]} />
      <meshStandardMaterial map={tex} roughness={0.6} />
    </mesh>
  )
}

/** Vertical plane with a transparent grid texture. `rotY` turns it. */
function GridPanel({ position, width, height, color, cell, rotY = 0 }) {
  const tex = useMemo(() => canvasTexture(gridCanvas(color), [width / cell, height / cell]), [color, width, height, cell])
  return (
    <mesh position={position} rotation={[0, rotY, 0]}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial map={tex} alphaTest={0.5} side={THREE.DoubleSide} metalness={0.4} roughness={0.5} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ */
/* Building: courtyard, floors, room fronts, roof                      */
/* ------------------------------------------------------------------ */

function Courtyard() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[6, -0.02, 10]} receiveShadow>
        <planeGeometry args={[90, 60]} />
        <meshStandardMaterial color="#c9c3b3" roughness={0.95} />
      </mesh>
      {/* Garden plot in the courtyard */}
      <Box min={[0, -0.02, 6]} max={[16, 0.12, 12]} color="#7a9a5a" />
    </group>
  )
}

function Door({ animated = false, shadow = true }) {
  const pivot = useRef()
  useSimFrame(({ tl, t }) => {
    if (!animated) return
    let angle = 0
    if (tl) {
      const { angle: a, open, close } = tl.door
      angle = a * (smooth(progress(t, open)) - smooth(progress(t, close)))
    }
    pivot.current.rotation.y = angle
  })
  const w = DOOR.x2 - DOOR.x1
  const inset = (y1, y2, front) => (
    <Box
      min={[-(w - 0.15), y1, front ? 0.025 : -0.035]}
      max={[-0.15, y2, front ? 0.035 : -0.025]}
      color={COLORS.doorInset}
      shadow={shadow}
    />
  )
  return (
    // Hinge on the right jamb; the leaf extends toward -x.
    <group ref={pivot} position={[DOOR.x2, 0, 0]}>
      <Box
        min={[-(w - 0.01), 0.01, -0.025]}
        max={[-0.01, DOOR.h - 0.01, 0.025]}
        color={COLORS.door}
        mat={{ roughness: 0.5 }}
        shadow={shadow}
      />
      {inset(1.25, 2.0, true)}
      {inset(0.2, 1.05, true)}
      {inset(1.25, 2.0, false)}
      {inset(0.2, 1.05, false)}
      {[0.05, -0.05].map((z) => (
        <Block
          key={z}
          position={[-(w - 0.12), 1.0, z]}
          size={[0.1, 0.03, 0.04]}
          color="#c9a227"
          mat={{ metalness: 0.8, roughness: 0.3 }}
          shadow={false}
        />
      ))}
    </group>
  )
}

function RoomSign({ text }) {
  const tex = useTextTexture(text)
  const x = (DOOR.x1 + DOOR.x2) / 2
  return (
    <group position={[x, 2.39, 0.1]}>
      <Block position={[0, 0, 0.01]} size={[0.42, 0.16, 0.02]} color="#ffffff" shadow={false} />
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
          <meshStandardMaterial color={COLORS.curtain} transparent opacity={0.55} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

/** Room 301's detailed multi-pane window: 3D grille bars + pleated curtains. */
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
      {/* Aluminum frame, mullions and transom (multi-pane) */}
      <Box min={[x1, y1 - 0.04, -0.13]} max={[x2, y1, 0.13]} color={COLORS.aluminum} mat={metal} />
      <Box min={[x1, y2, -0.11]} max={[x2, y2 + 0.04, 0.11]} color={COLORS.aluminum} mat={metal} />
      <Box min={[x1, y1 + h * 0.7 - 0.02, -0.03]} max={[x2, y1 + h * 0.7 + 0.02, 0.03]} color={COLORS.aluminum} mat={metal} />
      {[x1, x1 + w / 4, cx, x1 + (3 * w) / 4, x2].map((x) => (
        <Box key={x} min={[x - 0.025, y1, -0.03]} max={[x + 0.025, y2, 0.03]} color={COLORS.aluminum} mat={metal} />
      ))}
      <mesh position={[cx, y1 + h / 2, 0]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color="#cfe9f5" transparent opacity={0.18} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* Dark metal security grilles (hallway side) */}
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

/** Lightweight window for the other 8 classrooms (textured grille, flat curtain). */
function SimpleWindow() {
  const { x1, x2, y1, y2 } = WINDOW
  const cx = (x1 + x2) / 2
  const w = x2 - x1
  const h = y2 - y1
  return (
    <group>
      <Box min={[x1, y1 - 0.04, -0.13]} max={[x2, y1, 0.13]} color={COLORS.aluminum} shadow={false} />
      <Box min={[x1, y2, -0.11]} max={[x2, y2 + 0.04, 0.11]} color={COLORS.aluminum} shadow={false} />
      <mesh position={[cx, y1 + h / 2, 0]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color="#9fb9c4" transparent opacity={0.45} depthWrite={false} />
      </mesh>
      <mesh position={[cx, y1 + h / 2 + 0.05, -0.15]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color={COLORS.curtain} transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <GridPanel position={[cx, y1 + h / 2, 0.16]} width={w} height={h} color="#2b2f36" cell={0.2} />
    </group>
  )
}

/** Hallway-facing wall of one classroom: wall, baseboard, door, sign, window. */
function RoomFront({ number, detailed }) {
  const T = 0.1
  const s = detailed // cast shadows only for the hero room
  const wall = (x1, x2, y1, y2) => (
    <Box key={`${x1}-${y1}`} min={[x1, y1, -T]} max={[x2, y2, T]} color={COLORS.wall} shadow={s} />
  )
  return (
    <group>
      {wall(ROOM.x1, WINDOW.x1, 0, WALL_H)}
      {wall(WINDOW.x1, WINDOW.x2, 0, WINDOW.y1)}
      {wall(WINDOW.x1, WINDOW.x2, WINDOW.y2, WALL_H)}
      {wall(WINDOW.x2, DOOR.x1, 0, WALL_H)}
      {wall(DOOR.x1, DOOR.x2, DOOR.h, WALL_H)}
      {wall(DOOR.x2, ROOM.x2, 0, WALL_H)}
      {/* Dark brown painted lower border, both faces */}
      <Box min={[ROOM.x1, 0, -0.12]} max={[DOOR.x1 - 0.06, 0.3, 0.12]} color={COLORS.baseboard} shadow={s} />
      <Box min={[DOOR.x2 + 0.06, 0, -0.12]} max={[ROOM.x2, 0.3, 0.12]} color={COLORS.baseboard} shadow={s} />
      {/* Door frame */}
      <Box min={[DOOR.x1 - 0.06, 0, -0.12]} max={[DOOR.x1, DOOR.h + 0.06, 0.12]} color={COLORS.frame} shadow={s} />
      <Box min={[DOOR.x2, 0, -0.12]} max={[DOOR.x2 + 0.06, DOOR.h + 0.06, 0.12]} color={COLORS.frame} shadow={s} />
      <Box min={[DOOR.x1 - 0.06, DOOR.h, -0.12]} max={[DOOR.x2 + 0.06, DOOR.h + 0.06, 0.12]} color={COLORS.frame} shadow={s} />
      <Door animated={detailed} shadow={s} />
      <RoomSign text={`B ${number}`} />
      {detailed ? <WindowWithGrilles /> : <SimpleWindow />}
    </group>
  )
}

const PARAPET_H = 1.0 // solid waist-level wall
const GRILLE_H = 1.0 // green grid grille on top of it
const PARAPET_T = 0.15 // wall thickness

/**
 * Exterior hallway barrier ("harang"): a solid waist-level concrete wall painted
 * pale yellow with a dark brown lower border, with the green metal grid grille
 * mounted on top. Built along local +x from 0 to `length`, centred on z = 0.
 */
function HallwayBarrier({ length }) {
  const L = length
  const t = PARAPET_T / 2
  const gy = PARAPET_H + 0.05 // grille base (on top of the coping)
  const metal = { metalness: 0.5, roughness: 0.4 }
  const posts = []
  for (let x = 0; x <= L + 0.01; x += 2) posts.push(Math.min(x, L - 0.025))
  return (
    <group>
      {/* Solid waist-level wall, coping and dark brown lower border (both faces) */}
      <Box min={[0, 0, -t]} max={[L, PARAPET_H, t]} color={COLORS.wall} />
      <Box min={[0, PARAPET_H, -t - 0.015]} max={[L, gy, t + 0.015]} color={COLORS.slab} />
      <Box min={[0, 0, -t - 0.02]} max={[L, 0.25, t + 0.02]} color={COLORS.baseboard} shadow={false} />
      {/* Green metal grid grille mounted on top */}
      <GridPanel position={[L / 2, gy + GRILLE_H / 2, 0]} width={L} height={GRILLE_H} color={COLORS.railing} cell={0.15} />
      <Box min={[0, gy + GRILLE_H, -0.025]} max={[L, gy + GRILLE_H + 0.05, 0.025]} color={COLORS.railing} mat={metal} shadow={false} />
      <Box min={[0, gy, -0.02]} max={[L, gy + 0.04, 0.02]} color={COLORS.railing} mat={metal} shadow={false} />
      {posts.map((x) => (
        <Block key={x} position={[x, gy + GRILLE_H / 2, 0]} size={[0.05, GRILLE_H, 0.05]} color={COLORS.railing} mat={metal} shadow={false} />
      ))}
    </group>
  )
}

/** Barrier along the open hallway edge, from the left stair landing past every classroom. */
function HallwayRailing() {
  return (
    <group position={[STAIR.x1, 0, HALL_Z - PARAPET_T / 2]}>
      <HallwayBarrier length={BUILDING.x2 - STAIR.x1} />
    </group>
  )
}

function FloorLevel({ level, rooms, label, showLabels }) {
  const y = level * STORY
  const { x1, x2 } = BUILDING
  const D = -ROOM.depth
  return (
    <group position={[0, y, 0]}>
      {level > 0 && (
        <>
          {/* Concrete floor slab (rooms + hallway) and the left stair landing */}
          <Box min={[x1 - 0.05, -0.2, D - 0.1]} max={[x2 + 0.05, 0, HALL_Z]} color={COLORS.slab} />
          <Box min={[STAIR.x1, -0.2, 0.1]} max={[STAIR.x2, 0, HALL_Z]} color={COLORS.slab} />
        </>
      )}
      <TiledFloor x1={x1} x2={x2} z1={D} z2={HALL_Z} />
      <TiledFloor x1={STAIR.x1} x2={x1} z1={level > 0 ? 0.1 : -4.3} z2={HALL_Z} />

      {/* Back wall, end walls and partitions between classrooms */}
      <Box min={[x1 - 0.05, 0, D - 0.1]} max={[x2 + 0.05, WALL_H, D]} color={COLORS.wall} shadow={false} />
      {[x1, x1 + ROOM_W, x1 + 2 * ROOM_W, x2].map((px) => (
        <Box key={px} min={[px - 0.05, 0, D]} max={[px + 0.05, WALL_H, -0.1]} color={COLORS.wall} shadow={false} />
      ))}

      {/* Room fronts left -> right: x01 next to the stairs, then x02, x03 (10 m apart) */}
      {rooms.map((n, i) => (
        <group key={n} position={[i * ROOM_W, 0, 0]}>
          <RoomFront number={n} detailed={n === 301} />
        </group>
      ))}

      <HallwayRailing />
      <Label show={showLabels} position={[x2 + 1.8, 1.6, 1.5]} tone="light" size="text-[13px]">
        {label} · Rooms {rooms[0]}–{rooms[rooms.length - 1]}
      </Label>
    </group>
  )
}

/** Roof slab; hidden whenever the camera is above it so the top floor stays visible. */
function Roof() {
  const ref = useRef()
  useFrame(({ camera }) => {
    ref.current.visible = camera.position.y < ROOF_TOP + 0.3
  })
  return (
    <group ref={ref}>
      <Box
        min={[STAIR.x1 - 0.1, ROOF_TOP - 0.2, -ROOM.depth - 0.2]}
        max={[BUILDING.x2 + 0.2, ROOF_TOP, HALL_Z + 0.1]}
        color="#b9b3a5"
        shadow={false}
      />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Concrete switchback staircase (left end, beside Room 301)           */
/* ------------------------------------------------------------------ */

const STEPS = 10
const RISE = STORY / 2 / STEPS
const TREAD = 2.8 / STEPS
const SLOPE = Math.atan2(STORY / 2, 2.8)

function Flight({ base, up }) {
  // up = true: flight 1 (outer side) climbs toward -z; false: flight 2 (beside Room 301) climbs toward +z
  return Array.from({ length: STEPS }, (_, i) => {
    const t = base + (i + 0.5) * RISE
    const [z1, z2] = up ? [0.1 - (i + 1) * TREAD, 0.1 - i * TREAD] : [-2.7 + i * TREAD, -2.7 + (i + 1) * TREAD]
    const [x1, x2] = up ? [FLIGHT_OUT.x1, FLIGHT_OUT.x2] : [FLIGHT_IN.x1, FLIGHT_IN.x2]
    return <Box key={i} min={[x1, t - 0.3, z1]} max={[x2, t, z2]} color={i % 2 ? COLORS.concrete : COLORS.concreteLight} />
  })
}

function Staircase({ showLabels }) {
  return (
    <group>
      {[0, STORY].map((f) => {
        const mid = f + STORY / 2
        return (
          <group key={f}>
            <Flight base={f} up />
            <Box min={[STAIR.x1, mid - 0.2, -4.3]} max={[STAIR.x2, mid, -2.7]} color={COLORS.concrete} />
            <Flight base={mid} up={false} />
            {/* Concrete parapets: outer edge + divider along flight 1, mid-landing edge */}
            {[STAIR.x1 + 0.05, STAIR_DIVIDER].map((x) => (
              <Block
                key={x}
                position={[x, f + STORY / 4 + 0.45, -1.3]}
                size={[0.1, 0.9, Math.hypot(2.8, STORY / 2)]}
                rotation={[SLOPE, 0, 0]}
                color={COLORS.concrete}
              />
            ))}
            <Box min={[STAIR.x1, mid, -4.3]} max={[STAIR.x1 + 0.1, mid + 0.9, -2.7]} color={COLORS.concrete} />
          </group>
        )
      })}
      {/* Stairwell back wall */}
      <Box min={[STAIR.x1, 0, -4.4]} max={[STAIR.x2, ROOF_TOP - 0.2, -4.3]} color={COLORS.wall} />
      <Box min={[STAIR.x1, 0, -4.3]} max={[STAIR.x2, 0.3, -4.26]} color={COLORS.baseboard} />
      {/* Same waist wall + green grille on the upper landings' open left side
          (rotated so local +x runs from the hallway edge back toward z = 0.1) */}
      {[STORY, TOP_Y].map((y) => (
        <group key={y} position={[STAIR.x1 + PARAPET_T / 2, y, HALL_Z - PARAPET_T]} rotation={[0, Math.PI / 2, 0]}>
          <HallwayBarrier length={HALL_Z - PARAPET_T - 0.1} />
        </group>
      ))}
      <Label show={showLabels} side="hallway" position={[(STAIR.x1 + STAIR.x2) / 2, TOP_Y + 2.4, 1.6]}>
        Stair landing · Top floor
      </Label>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Room B 301 interior (room-local coordinates)                        */
/* ------------------------------------------------------------------ */

/** Dark wooden student armchair with a writing tablet on the right; faces -z (front). */
function Armchair({ x, z }) {
  const legs = []
  for (const dx of [-0.18, 0.18]) for (const dz of [-0.18, 0.18]) legs.push([dx, dz])
  return (
    <group position={[x, 0, z]}>
      <Block position={[0, 0.45, 0]} size={[0.42, 0.04, 0.42]} color={COLORS.wood} />
      <Block position={[0, 0.74, 0.2]} size={[0.42, 0.3, 0.03]} color={COLORS.wood} />
      <Block position={[0.25, 0.73, -0.1]} size={[0.24, 0.025, 0.5]} color={COLORS.wood} />
      <Block position={[0.33, 0.6, 0.05]} size={[0.03, 0.27, 0.03]} color={COLORS.woodDark} />
      {legs.map(([dx, dz]) => (
        <Block key={`${dx}${dz}`} position={[dx, 0.215, dz]} size={[0.03, 0.43, 0.03]} color={COLORS.woodDark} />
      ))}
    </group>
  )
}

function FluorescentLight({ x, z }) {
  return (
    <group position={[x, WALL_H - 0.12, z]}>
      <Block position={[0, 0, 0]} size={[1.25, 0.05, 0.22]} color="#e5e7eb" shadow={false} />
      <Block
        position={[0, -0.035, 0]}
        size={[1.15, 0.025, 0.07]}
        color="#ffffff"
        mat={{ emissive: '#ffffff', emissiveIntensity: 1.6, toneMapped: false }}
        shadow={false}
      />
      {[-0.5, 0.5].map((dx) => (
        <Block key={dx} position={[dx, 0.07, 0]} size={[0.015, 0.1, 0.015]} color="#9ca3af" shadow={false} />
      ))}
    </group>
  )
}

function HardHat({ position }) {
  return (
    <group position={position}>
      <mesh castShadow>
        <sphereGeometry args={[0.13, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#f97316" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.006, 0]}>
        <cylinderGeometry args={[0.165, 0.165, 0.012, 24]} />
        <meshStandardMaterial color="#ea580c" roughness={0.4} />
      </mesh>
    </group>
  )
}

/** Safety equipment display on the side wall near the door. */
function SafetyDisplay() {
  const sign = useTextTexture('SAFETY EQUIPMENT', {
    w: 512,
    h: 96,
    font: 'bold 52px Arial, Helvetica, sans-serif',
    bg: '#15803d',
    fg: '#ffffff',
  })
  const wx = ROOM.x2 - 0.05 // inner face of the right side wall (partition to Room 302), near the door
  const rows = [0.95, 1.33, 1.71, 2.09] // shelf tops: 4 clean rows
  const cols = [-2.3, -1.85, -1.4, -0.95]
  const [z1, z2] = [-2.55, -0.75]
  return (
    <group>
      {/* Wall-mounted rack: two uprights + 4 shelves, each holding 4 orange safety helmets */}
      {[z1, z2 - 0.03].map((z) => (
        <Box key={z} min={[wx - 0.32, 0.75, z]} max={[wx, 2.35, z + 0.03]} color={COLORS.woodDark} />
      ))}
      <Box min={[wx - 0.02, 0.75, z1]} max={[wx, 2.35, z2]} color={COLORS.wood} shadow={false} />
      {rows.map((y) => (
        <group key={y}>
          <Box min={[wx - 0.32, y - 0.035, z1]} max={[wx, y, z2]} color={COLORS.wood} />
          {cols.map((z) => (
            <HardHat key={z} position={[wx - 0.17, y, z]} />
          ))}
        </group>
      ))}
      <mesh position={[wx - 0.005, 2.55, (z1 + z2) / 2]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[1.2, 0.22]} />
        <meshBasicMaterial map={sign} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** Red fire extinguisher on a wall bracket with a sign. Local +z faces away from the wall. */
function FireExtinguisher({ position }) {
  const sign = useTextTexture('FIRE EXTINGUISHER', {
    w: 512,
    h: 96,
    font: 'bold 46px Arial, Helvetica, sans-serif',
    bg: '#dc2626',
    fg: '#ffffff',
  })
  return (
    <group position={position}>
      <Block position={[0, 0.98, 0.03]} size={[0.14, 0.06, 0.06]} color="#111" />
      <mesh position={[0, 0.7, 0.1]} castShadow>
        <cylinderGeometry args={[0.08, 0.08, 0.5, 20]} />
        <meshStandardMaterial color="#dc2626" roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.99, 0.1]}>
        <cylinderGeometry args={[0.03, 0.04, 0.08, 12]} />
        <meshStandardMaterial color="#1f2937" metalness={0.6} />
      </mesh>
      <Block position={[0.06, 1.01, 0.13]} size={[0.1, 0.015, 0.02]} color="#111" shadow={false} />
      <mesh position={[0, 1.25, 0.006]}>
        <planeGeometry args={[0.42, 0.08]} />
        <meshBasicMaterial map={sign} toneMapped={false} />
      </mesh>
    </group>
  )
}

/**
 * Electric wall fan (bracket, motor, guard, spinning blades).
 * Local +z points away from the wall; the head tilts down toward the room.
 */
function WallFan({ position, rotY }) {
  const blades = useRef()
  useFrame((_, dt) => {
    blades.current.rotation.z += dt * 14
  })
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <Block position={[0, 0, 0.03]} size={[0.14, 0.14, 0.06]} color="#e5e7eb" />
      <Block position={[0, -0.02, 0.12]} size={[0.04, 0.04, 0.14]} color="#d1d5db" shadow={false} />
      <group position={[0, -0.04, 0.2]} rotation={[0.35, 0, 0]}>
        <mesh position={[0, 0, 0.02]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.065, 0.075, 0.14, 20]} />
          <meshStandardMaterial color="#f3f4f6" roughness={0.4} />
        </mesh>
        <group position={[0, 0, 0.15]}>
          <mesh>
            <torusGeometry args={[0.21, 0.008, 8, 40]} />
            <meshStandardMaterial color="#9ca3af" metalness={0.5} />
          </mesh>
          <mesh position={[0, 0, 0.012]}>
            <circleGeometry args={[0.21, 32]} />
            <meshStandardMaterial color="#cbd5e1" transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <group ref={blades}>
            {[0, 1, 2].map((i) => (
              <group key={i} rotation={[0, 0, (i * 2 * Math.PI) / 3]}>
                <mesh position={[0, 0.1, 0]}>
                  <boxGeometry args={[0.07, 0.17, 0.005]} />
                  <meshStandardMaterial color="#60a5fa" transparent opacity={0.85} />
                </mesh>
              </group>
            ))}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.03, 0.03, 0.03, 12]} />
              <meshStandardMaterial color="#e5e7eb" />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  )
}

/**
 * Power extension strip near the base of the equipment wall (inside, left of the door),
 * plugged into a wall outlet, with the cord running up to the network shelf.
 */
function PowerExtension({ showLabels }) {
  const z = -0.1 // inner face of the front wall
  return (
    <group>
      {/* Wall outlet plate */}
      <Block position={[0.25, 0.42, z - 0.006]} size={[0.08, 0.12, 0.012]} color="#f5f5f4" shadow={false} />
      <Block position={[0.25, 0.42, z - 0.013]} size={[0.03, 0.05, 0.004]} color="#374151" shadow={false} />
      {/* Extension strip with 4 sockets and a lit switch */}
      <Block position={[0.72, 0.45, z - 0.03]} size={[0.42, 0.06, 0.06]} color="#fafafa" />
      {[-0.13, -0.05, 0.03, 0.11].map((dx) => (
        <Block key={dx} position={[0.72 + dx, 0.45, z - 0.061]} size={[0.045, 0.035, 0.004]} color="#1f2937" shadow={false} />
      ))}
      <Block
        position={[0.9, 0.45, z - 0.061]}
        size={[0.03, 0.025, 0.006]}
        color="#f97316"
        mat={{ emissive: '#f97316', emissiveIntensity: 1.2 }}
        shadow={false}
      />
      {/* Cords: outlet -> strip, strip -> shelf */}
      <Line points={[[0.25, 0.4, z - 0.02], [0.4, 0.38, z - 0.02], [0.5, 0.44, z - 0.03]]} color="#e5e7eb" lineWidth={2} />
      <Line points={[[0.55, 0.47, z - 0.04], [0.48, 0.6, z - 0.02], [0.48, 2.56, z - 0.02], [0.6, 2.62, z - 0.2]]} color="#9ca3af" lineWidth={2} />
      <Label show={showLabels} side="classroom" position={[0.72, 0.7, -0.3]}>
        Power extension
      </Label>
    </group>
  )
}

function Room301Interior({ showLabels }) {
  const D = -ROOM.depth
  const cols = [-4.8, -3.7, -2.6, -1.5, -0.4]
  const rows = [-1.7, -2.6, -3.5, -4.4]
  return (
    <group>
      {/* Lower dark brown border on the inside faces */}
      <Box min={[ROOM.x1 + 0.05, 0, D]} max={[ROOM.x2 - 0.05, 0.3, D + 0.04]} color={COLORS.baseboard} />
      <Box min={[ROOM.x1 + 0.05, 0, D]} max={[ROOM.x1 + 0.09, 0.3, -0.1]} color={COLORS.baseboard} />
      <Box min={[ROOM.x2 - 0.09, 0, D]} max={[ROOM.x2 - 0.05, 0.3, -0.1]} color={COLORS.baseboard} />

      {/* Front wall (solid, opposite the windows) holds ALL boards:
          mini-whiteboard | main green chalkboard | whiteboard. The window wall has none. */}
      <Box min={[-4.5, 0.95, D]} max={[-0.7, 2.35, D + 0.03]} color="#5a3a1e" />
      <Box min={[-4.4, 1.0, D + 0.03]} max={[-0.8, 2.3, D + 0.05]} color="#1f4d34" mat={{ roughness: 0.95 }} />
      <Box min={[-4.4, 0.92, D + 0.03]} max={[-0.8, 0.95, D + 0.12]} color="#5a3a1e" />
      {[
        { a: -5.6, b: -4.85, y1: 1.3, y2: 2.0 }, // mini-whiteboard
        { a: -0.3, b: 2.1, y1: 1.0, y2: 2.2 }, // whiteboard
      ].map(({ a, b, y1, y2 }) => (
        <group key={a}>
          <Box min={[a, y1, D]} max={[b, y2, D + 0.03]} color={COLORS.aluminum} mat={{ metalness: 0.6 }} />
          <Box min={[a + 0.04, y1 + 0.04, D + 0.03]} max={[b - 0.04, y2 - 0.04, D + 0.045]} color="#fafafa" mat={{ roughness: 0.2 }} />
        </group>
      ))}

      {/* Electric wall fans, centred on the middle of each side wall */}
      <WallFan position={[ROOM.x1 + 0.05, 2.55, D / 2]} rotY={Math.PI / 2} />
      <WallFan position={[ROOM.x2 - 0.05, 2.55, D / 2]} rotY={-Math.PI / 2} />

      {/* Teacher's desk + chair */}
      <Block position={[2.4, 0.76, -5.0]} size={[1.4, 0.05, 0.7]} color={COLORS.wood} />
      <Block position={[2.4, 0.37, -5.12]} size={[1.3, 0.72, 0.4]} color="#3d2414" />
      <Block position={[2.4, 0.45, -5.6]} size={[0.45, 0.05, 0.45]} color={COLORS.woodDark} />
      <Block position={[2.4, 0.75, -5.82]} size={[0.45, 0.5, 0.04]} color={COLORS.woodDark} />

      {/* Student armchairs in rows facing the front */}
      {cols.map((x) => rows.map((z) => <Armchair key={`${x}${z}`} x={x} z={z} />))}

      {/* Overhead fluorescent fixtures + their light */}
      {[-3.8, -1.0, 1.8].map((x) => [-1.8, -4.2].map((z) => <FluorescentLight key={`${x}${z}`} x={x} z={z} />))}
      <pointLight position={[-2.4, 2.8, -3]} intensity={6} color="#f4f8ff" />
      <pointLight position={[1.8, 2.8, -2]} intensity={5} color="#f4f8ff" />

      <SafetyDisplay />
      <PowerExtension showLabels={showLabels} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Hardware: indoor face-recognition terminals                         */
/* ------------------------------------------------------------------ */

const BLUE = new THREE.Color(COLORS.scanBlue)
const GREEN = new THREE.Color(COLORS.scanGreen)
const IDLE_SCREEN = new THREE.Color('#0c1a3a')

/**
 * Hikvision-style terminal. Local +z is the side facing the person.
 * `beamLength` is the distance to where the student stands.
 */
function Terminal({ id, position, rotationY = 0, beamLength = 0.75 }) {
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
      <mesh ref={sweep} visible={false} position={[0, 0, 0.05 + beamLength - 0.06]}>
        <planeGeometry args={[0.36, 0.012]} />
        <meshBasicMaterial ref={sweepMat} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <pointLight ref={light} position={[0, 0, 0.25]} intensity={0} distance={2} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Hardware: indoor network & SMS shelf above the door                 */
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

/**
 * DITO ZTE K10: a white capsule ("pill") base lying on the shelf, two thick
 * vertical paddle antennas, and a dark status strip with red "DITO" branding.
 * Local -z faces into the classroom.
 */
function DitoRouter() {
  const R = 0.07 // base radius
  const brand = useTextTexture('DITO', {
    w: 160,
    h: 48,
    font: 'bold 40px Arial, Helvetica, sans-serif',
    bg: '#111827',
    fg: '#ef1c24',
  })
  const white = { color: '#f8f8f6', roughness: 0.35 }
  return (
    <group position={DEVICES.dito}>
      {/* Pill-shaped base: capsule lying along x */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
        <capsuleGeometry args={[R, 0.2, 8, 24]} />
        <meshStandardMaterial {...white} />
      </mesh>
      {/* Two thick vertical paddle antennas (flattened capsules) */}
      {[-0.1, 0.1].map((x) => (
        <mesh key={x} position={[x, R + 0.11, 0.02]} scale={[1, 1, 0.45]} castShadow>
          <capsuleGeometry args={[0.035, 0.16, 6, 16]} />
          <meshStandardMaterial {...white} />
        </mesh>
      ))}
      {/* Dark central status / indicator strip with red DITO branding */}
      <Block position={[0, 0, -R - 0.004]} size={[0.17, 0.045, 0.01]} color="#111827" shadow={false} />
      <mesh position={[-0.015, 0, -R - 0.0095]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.09, 0.027]} />
        <meshBasicMaterial map={brand} toneMapped={false} />
      </mesh>
      <Led position={[0.06, 0, -R - 0.01]} color="#22c55e" hit="dito" size={0.01} />
    </group>
  )
}

function NetworkShelf({ showLabels }) {
  const front = -0.415 // z of the device faces (facing into the room)
  return (
    <group>
      {/* Shelf board + brackets, mounted on the inside face of the front wall */}
      <Box min={[0.42, SHELF_Y - 0.04, -0.46]} max={[2.72, SHELF_Y, -0.1]} color={COLORS.wood} />
      {[0.5, 2.64].map((x) => (
        <Box key={x} min={[x - 0.015, SHELF_Y - 0.2, -0.4]} max={[x + 0.015, SHELF_Y - 0.04, -0.1]} color={COLORS.metal} />
      ))}

      {/* DITO ZTE K10 home router: cellular internet for the Mini PC */}
      <DitoRouter />

      {/* Mini PC: central node, linked to the cloud database */}
      <Block position={DEVICES.miniPc} size={[0.28, 0.1, 0.28]} color="#4b5563" mat={{ metalness: 0.5, roughness: 0.4 }} />
      <Led position={[DEVICES.miniPc[0] - 0.07, DEVICES.miniPc[1], front - 0.005]} color="#60a5fa" hit="miniPc" />

      {/* Mercusys AC12G (black router, 4 antennas): LAN connector for the Hikvision scanners */}
      <Block position={DEVICES.mercusys} size={[0.42, 0.05, 0.26]} color="#111111" mat={{ roughness: 0.3 }} />
      {[-0.18, -0.06, 0.06, 0.18].map((dx) => (
        <Block key={dx} position={[DEVICES.mercusys[0] + dx, SHELF_Y + 0.15, -0.16]} size={[0.025, 0.2, 0.012]} color="#111111" />
      ))}
      {[-0.1, -0.05, 0, 0.05].map((dx) => (
        <Led
          key={dx}
          position={[DEVICES.mercusys[0] + dx, DEVICES.mercusys[1] + 0.012, front]}
          color="#22c55e"
          hit="mercusys"
          size={0.012}
        />
      ))}

      {/* ESP32 + attached GSM module on a small base */}
      <Block position={DEVICES.esp} size={[0.42, 0.03, 0.22]} color="#1f2937" />
      <Block position={[2.29, SHELF_Y + 0.04, -0.3]} size={[0.2, 0.02, 0.08]} color="#1e3a8a" />
      <Block position={[2.26, SHELF_Y + 0.055, -0.3]} size={[0.08, 0.012, 0.06]} color="#cbd5e1" mat={{ metalness: 0.8 }} />
      <Led position={[2.36, SHELF_Y + 0.055, -0.32]} color="#3b82f6" hit="esp" size={0.012} />
      <Block position={[2.5, SHELF_Y + 0.04, -0.3]} size={[0.12, 0.02, 0.12]} color="#b91c1c" />
      <Led position={[2.47, SHELF_Y + 0.055, -0.34]} color="#f59e0b" hit="esp" size={0.012} />
      <mesh position={[2.53, SHELF_Y + 0.13, -0.3]} castShadow>
        <cylinderGeometry args={[0.008, 0.008, 0.18, 8]} />
        <meshStandardMaterial color="#111" />
      </mesh>

      <Label show={showLabels} side="classroom" position={[0.5, 3.12, -0.3]}>DITO ZTE K10</Label>
      <Label show={showLabels} side="classroom" position={[1.1, 2.86, -0.45]}>Mini PC</Label>
      <Label show={showLabels} side="classroom" position={[1.72, 3.04, -0.3]}>Mercusys AC12G</Label>
      <Label show={showLabels} side="classroom" position={[2.6, 2.9, -0.4]}>ESP32 + GSM</Label>
    </group>
  )
}

function Wires() {
  const wire = { color: '#2b2b2b', lineWidth: 2.2 }
  return (
    <group>
      {/* LAN cables: scanners -> Mercusys -> Mini PC */}
      <Line points={WIRES.entryWire.pts} {...wire} color="#1e40af" />
      <Line points={WIRES.exitWire.pts} {...wire} color="#1e40af" />
      <Line points={WIRES.lan.pts} {...wire} color="#1e40af" />
      {/* DITO internet link + ESP32 trigger cable */}
      <Line points={WIRES.ditoLink.pts} {...wire} color="#6d28d9" />
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

/** Expanding radio rings + the official SMS bubble from the GSM antenna. */
function GsmSignal({ smsText }) {
  const rings = [useRef(), useRef(), useRef()]
  const bubble = useRef()
  useSimFrame(({ tl, t }) => {
    const active = tl && t >= tl.sms[0] && t <= tl.sms[1]
    rings.forEach((r, i) => {
      const local = active ? ((((t - tl.sms[0]) - i * 0.33) % 1) + 1) % 1 : 0
      const show = active && t - tl.sms[0] >= i * 0.33
      r.current.visible = show
      if (show) {
        r.current.scale.setScalar(0.6 + local * 3.5)
        r.current.material.opacity = 1 - local
      }
    })
    if (bubble.current) {
      bubble.current.style.opacity = active ? '1' : '0'
      bubble.current.style.transform = active ? 'scale(1)' : 'scale(0.8)'
    }
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
      <Html position={[-0.2, 0.55, -0.3]} center distanceFactor={8} zIndexRange={[12, 0]} style={{ pointerEvents: 'none' }}>
        <div
          ref={bubble}
          className="pointer-events-none w-56 rounded-xl bg-amber-400 px-3 py-2 text-[11px] leading-snug text-amber-950 shadow-xl transition duration-300"
          style={{ opacity: 0 }}
        >
          <p className="text-[9px] font-bold uppercase tracking-wider">SMS · GSM module → Parent (DITO)</p>
          <p className="mt-0.5 font-semibold">{smsText}</p>
        </div>
      </Html>
    </group>
  )
}

function CloudNode({ showLabels }) {
  const group = useRef()
  const mats = useRef([])
  const puffs = [
    [0, 0, 0, 0.3],
    [0.3, -0.05, 0, 0.23],
    [-0.3, -0.07, 0, 0.22],
    [0.1, 0.18, 0, 0.22],
  ]
  useSimFrame(({ tl, t, state }) => {
    group.current.position.y = DEVICES.cloud[1] + Math.sin(state.clock.elapsedTime * 1.2) * 0.06
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
      <Label show={showLabels} position={[0, 0.55, 0]}>Cloud Database</Label>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Grade 10 student (world coordinates)                                */
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
  const sim = useContext(SimContext)
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
      const w = tl.walks.find((wk) => t >= wk.from && t <= wk.to)
      if (w) {
        const seg = samplePath(w.path, progress(t, [w.from, w.to]), tmp)
        root.current.position.copy(tmp)
        const d = w.path.dirs[seg]
        if (d.x || d.z) target = Math.atan2(d.x, d.z)
        moving = true
      } else {
        const prev = [...tl.walks].reverse().find((wk) => t > wk.to)
        if (prev) {
          root.current.position.copy(prev.path.pts[prev.path.pts.length - 1])
          target = prev.face ?? null
        } else {
          root.current.position.copy(tl.walks[0].path.pts[0])
        }
      }
    }
    sim.current.studentPos.copy(root.current.position)
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
    <group ref={root} position={COURTYARD_START} rotation={COURTYARD_ROT}>
      <group ref={body}>
        <Leg x={-0.08} limbRef={legL} />
        <Leg x={0.08} limbRef={legR} />
        {/* White school polo + ID lanyard */}
        <Block position={[0, 1.1, 0]} size={[0.38, 0.52, 0.22]} color="#f8fafc" />
        <Block position={[0, 1.18, 0.112]} size={[0.025, 0.3, 0.005]} color="#1d4ed8" shadow={false} />
        <Block position={[0, 1.0, 0.115]} size={[0.07, 0.09, 0.006]} color="#ffffff" shadow={false} />
        <Arm x={-0.245} limbRef={armL} />
        <Arm x={0.245} limbRef={armR} />
        <Block position={[0, 1.39, 0]} size={[0.08, 0.06, 0.08]} color={SKIN} />
        <mesh position={[0, 1.52, 0]} castShadow>
          <sphereGeometry args={[0.13, 24, 24]} />
          <meshStandardMaterial color={SKIN} />
        </mesh>
        <mesh position={[0, 1.565, -0.02]} scale={[1.05, 0.8, 1.05]} castShadow>
          <sphereGeometry args={[0.13, 24, 24]} />
          <meshStandardMaterial color="#141414" />
        </mesh>
        <Block position={[0, 1.1, -0.17]} size={[0.3, 0.38, 0.12]} color="#2563eb" />
      </group>
      <Label show={showLabels} position={[0, 1.9, 0]} tone="light">
        Grade 10 Student
      </Label>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Camera rig                                                          */
/* ------------------------------------------------------------------ */

/**
 * Orbit controls + smooth camera transitions between VIEWS.
 * Manual preset buttons or the active timeline's `cameras` cues set the goal.
 * The `follow` goal tracks the student every frame. Dragging cancels a transition.
 */
function CameraRig({ viewRequest, autoFollow }) {
  const sim = useContext(SimContext)
  const camera = useThree((s) => s.camera)
  const controls = useRef()
  const goal = useRef({ key: 'hallway', moving: false })
  const goalPos = useMemo(() => new THREE.Vector3(), [])
  const goalTarget = useMemo(() => new THREE.Vector3(), [])

  const setGoal = (key) => {
    goal.current = { key, moving: true }
    if (key !== 'follow') {
      goalPos.set(...VIEWS[key].pos)
      goalTarget.set(...VIEWS[key].target)
    }
  }

  // Manual preset buttons (n changes on every click).
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
    if (goal.current.key === 'follow') {
      goalPos.copy(sim.current.studentPos).add(FOLLOW_OFFSET)
      goalTarget.copy(sim.current.studentPos).y += 1.2
    }
    const k = 1 - Math.exp(-dt * 2.5)
    camera.position.lerp(goalPos, k)
    c.target.lerp(goalTarget, k)
    if (
      goal.current.key !== 'follow' &&
      camera.position.distanceTo(goalPos) < 0.02 &&
      c.target.distanceTo(goalTarget) < 0.02
    ) {
      goal.current.moving = false
    }
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={VIEWS.hallway.target}
      maxPolarAngle={Math.PI / 2.05}
      minDistance={1.5}
      maxDistance={70}
      enableDamping
      onStart={() => (goal.current.moving = false)}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

function Scene({ showLabels, viewRequest, autoFollow, smsText }) {
  return (
    <>
      <color attach="background" args={['#dbe6f0']} />
      <hemisphereLight args={['#ffffff', '#d6cfc0', 0.85]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[14, 30, 24]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-far={90}
        shadow-bias={-0.0004}
      />

      {/* Building B: 3 stories, 3 classrooms each, stairwell beside Room 301 */}
      <Courtyard />
      {FLOORS.map((f) => (
        <FloorLevel key={f.level} {...f} showLabels={showLabels} />
      ))}
      <Staircase showLabels={showLabels} />
      <Roof />

      {/* Room B 301 interior + all hardware (room-local coordinates) */}
      <group position={[0, TOP_Y, 0]}>
        <Room301Interior showLabels={showLabels} />
        {/* Fire extinguisher: OUTSIDE on the hallway wall, right next to the doorway */}
        <FireExtinguisher position={[DOOR.x2 + 0.4, 0, 0.1]} />
        {/* Entry terminal: OUTSIDE on the hallway wall, between the window and the door frame */}
        <Terminal id="entry" position={[0.6, 1.45, 0.1]} beamLength={0.8} />
        {/* Exit terminal: INSIDE wall, right of the door frame, facing into the room */}
        <Terminal id="exit" position={[2.6, 1.45, -0.1]} rotationY={Math.PI} />
        <Label show={showLabels} side="hallway" position={[0.45, 1.8, 0.3]}>Entry Terminal (Hikvision)</Label>
        <Label show={showLabels} side="classroom" position={[2.75, 1.8, -0.3]}>Exit Terminal (Hikvision)</Label>
        <NetworkShelf showLabels={showLabels} />
        <Wires />
        <Pulses />
        <GsmSignal smsText={smsText} />
        <CloudNode showLabels={showLabels} />
      </group>

      <Student showLabels={showLabels} />
      <CameraRig viewRequest={viewRequest} autoFollow={autoFollow} />
    </>
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

function Dashboard({ mode, reached, smsText }) {
  const tl = mode ? TIMELINES[mode] : null
  const status = tl ? [...tl.status].reverse().find((s) => s.at <= reached) : null
  const tone = status?.tone ?? 'standby'
  const smsRevealed = tl?.logs.some((l) => l.sms && l.at <= reached)

  return (
    <div className="pointer-events-auto absolute left-3 top-3 z-20 max-h-[calc(100vh-7rem)] w-[23rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/85 p-4 text-white shadow-2xl backdrop-blur-md">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">Bantay · Smart Student Monitoring</p>
      <h1 className="mt-1 text-sm font-bold leading-snug">Claro M. Recto High School - Grade 10 Diamond (Room B 301)</h1>

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

      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-400">Status</span>
        <span className={`rounded-full px-2.5 py-1 text-right font-semibold ${TONE_STYLES[tone]}`}>
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
                <span className={`w-4 shrink-0 text-center ${done ? 'text-emerald-300' : ''}`}>{done ? log.icon : '•'}</span>
                <span>{log.text}</span>
              </li>
            )
          })}
        </ul>
      )}

      {smsRevealed && (
        <div className="mt-3 rounded-xl border border-amber-300/30 bg-amber-400/10 p-2.5 text-xs">
          <p className="text-[10px] uppercase tracking-wider text-amber-300">SMS preview · to Parent/Guardian</p>
          <p className="mt-1 text-amber-50">{smsText}</p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/10 pt-2 text-[10px] text-slate-400">
        {[
          ['bg-sky-400', 'LAN data'],
          ['bg-violet-400', 'Cloud link (internet via DITO)'],
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

function Controls({ running, location, onEntry, onExit, showLabels, onToggleLabels, onView, autoFollow, onToggleAuto }) {
  const base = 'rounded-xl px-5 py-2.5 text-sm font-semibold shadow-lg transition disabled:cursor-not-allowed disabled:opacity-40'
  const small = 'rounded-lg px-3 py-1.5 text-xs font-medium shadow transition'
  return (
    <>
      <div className="pointer-events-auto absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onEntry}
            disabled={running || location !== 'courtyard'}
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
            : location === 'courtyard'
              ? 'Student is in the ground-floor courtyard. Run the entry simulation.'
              : 'Student is inside Room B 301. Run the exit simulation.'}
        </p>
      </div>
      <div className="pointer-events-auto absolute right-3 top-3 z-20 flex flex-col items-end gap-2">
        <div className="flex gap-1.5 rounded-xl bg-slate-900/70 p-1.5">
          {Object.entries(VIEWS).map(([key, v]) => (
            <button key={key} type="button" onClick={() => onView(key)} className={`${small} bg-white/10 text-white hover:bg-white/20`}>
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
          <button type="button" onClick={onToggleLabels} className={`${small} bg-slate-900/80 text-white hover:bg-slate-800`}>
            {showLabels ? 'Hide labels' : 'Show labels'}
          </button>
        </div>
        <p className="hidden rounded-lg bg-slate-900/60 px-2 py-1 text-right text-[10px] text-slate-200 sm:block">
          Drag to orbit · Scroll to zoom · Right-drag to pan
          <br />
          The roof hides automatically when viewed from above
        </p>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const sim = useRef({ mode: null, start: 0, location: 'courtyard', studentPos: new THREE.Vector3(...COURTYARD_START) })
  const [mode, setMode] = useState(null) // mode of the current / last simulation
  const [running, setRunning] = useState(false)
  const [location, setLocation] = useState('courtyard')
  const [reached, setReached] = useState(0)
  const [smsText, setSmsText] = useState('')
  const [showLabels, setShowLabels] = useState(true)
  const [autoFollow, setAutoFollow] = useState(true)
  const [viewRequest, setViewRequest] = useState({ key: 'hallway', n: 0 })

  const start = (next) => {
    if (running) return
    sim.current.mode = next
    sim.current.start = now()
    setMode(next)
    setRunning(true)
    setReached(0)
    setSmsText(smsMessage(next, manilaStamp()))
  }

  return (
    <SimContext.Provider value={sim}>
      <div className="relative h-screen w-full overflow-hidden bg-slate-200 font-sans">
        <Canvas shadows dpr={[1, 2]} camera={{ position: VIEWS.hallway.pos, fov: 45, near: 0.1, far: 300 }}>
          <Scene showLabels={showLabels} viewRequest={viewRequest} autoFollow={autoFollow} smsText={smsText} />
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
          <Dashboard mode={mode} reached={reached} smsText={smsText} />
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
