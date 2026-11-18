# Bantay-3D-Demo

Interactive 3D demo for the capstone project **"A Cloud-based Smart Student Monitoring System with Performance Tracking and Alert System for Claro M. Recto High School"**.

It models the 3-story school building: the ground floor (Rooms 101–103), the middle floor (201–203) and the top floor (301–303). A concrete switchback staircase stands on the left end of the building. Its top landing opens onto the open-air top-floor hallway, with Room B 301 (Grade 10 Diamond) right beside it and 302 and 303 further along. On every floor, the hallway's open side is a solid waist-level wall, painted pale yellow with a dark brown lower border, with green metal grid grilles mounted on top. A red fire extinguisher hangs on the hallway wall beside Room B 301's door.

Inside Room B 301, all boards are on the solid front wall opposite the windows: a mini-whiteboard, the main green chalkboard and a whiteboard. The room also has:

- electric fans centred on both side walls
- a 4-row rack of orange safety helmets
- a power extension strip near the base of the equipment wall

The Entry terminal (Hikvision) is mounted outside on the hallway wall, between the window and the door. The Exit terminal and the network shelf (Mini PC, DITO ZTE K10, Mercusys AC12G, ESP32 + GSM) are inside the room, around the door.

### Network topology (all inside Room B 301)

| From | To | Purpose |
| --- | --- | --- |
| Entry / Exit Hikvision terminals | Mercusys AC12G (black router) | Local LAN connection for the scanners |
| Mercusys AC12G | Mini PC | Scan data into the central node |
| DITO ZTE K10 | Mini PC | Cellular internet access |
| Mini PC | Cloud database | Attendance / exit log |
| Mini PC | ESP32 + GSM module | Trigger for the parent SMS |

SMS wording: `Bantay: Juan Dela Cruz checked in at [time] on [date] (Manila Time)`. Exit messages use `checked out`. The time and date use the `Asia/Manila` time zone.

**Author:** Kiev Gonzales ([@kvzl0](https://github.com/kvzl0))

## Tech

- React 19, `@react-three/fiber` 9, `@react-three/drei` 10, Three.js
- Tailwind CSS 4 (via `@tailwindcss/vite`)
- Vite 8

Everything is built from primitives (`boxGeometry`, `planeGeometry`, `meshStandardMaterial`, etc.). No GLTF/GLB models or external assets are loaded. The "B 301" sign and floor tiles are drawn on in-memory canvases.

All animation uses `useFrame`. `framer-motion-3d` is deprecated on npm, so it is not used.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Using it as a single-file artifact

The whole demo lives in [`src/App.jsx`](src/App.jsx) and default-exports `App`. Its only imports are `react`, `three`, `@react-three/fiber`, and `@react-three/drei`, and it is styled with Tailwind utility classes. You can paste it into any React artifact/sandbox that provides those packages and Tailwind.

## How to use the demo

- **Simulate Entry** (student starts in the ground-floor courtyard): the student climbs the left-side stairs, walks along the top-floor hallway, and scans at the outdoor entry terminal (blue turns green). The door swings inward and the student steps inside. Pulses then run scanner → Mercusys → Mini PC → cloud, and Mini PC → ESP32 + GSM, which shows the official SMS bubble.
- **Simulate Exit** (student in the room): the student scans at the indoor exit terminal, the door swings outward, and the student walks out to the hallway and back down the stairs. The exit SMS goes out through the same network path.
- The buttons are enabled based on where the student currently is.
- Camera presets (Hallway / Classroom / Overview), an **Auto camera** toggle that follows the student, and a label toggle are at the top right. Drag to orbit, scroll to zoom. The roof hides automatically when the camera is above it.

The student name and LRN are mock data (`MOCK_STUDENT` at the top of `src/App.jsx`). Timings for every step are in the `RAW_TIMELINES` object in the same file.

## Project layout

```
index.html
vite.config.js
src/
  main.jsx      # mounts <App />
  index.css     # Tailwind import
  App.jsx       # the entire 3D scene, simulation timelines, and UI overlay
scripts/
  commit.sh     # commit helper that records Kiev Gonzales as author and committer
```

## Contributing / commits

All commits in this repository are authored by **Kiev Gonzales (kvzl0)**. Use the helper so the author and committer are set correctly on any machine, without touching your git config:

```bash
git add <files>
npm run commit -- "feat: your message"
# or: sh scripts/commit.sh -a "fix: your message"   (stages tracked changes first)
```

The script sets `GIT_AUTHOR_NAME/EMAIL` and `GIT_COMMITTER_NAME/EMAIL` to `Kiev Gonzales <kvzl0@users.noreply.github.com>` for that one commit.
