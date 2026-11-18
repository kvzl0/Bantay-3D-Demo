# Bantay-3D-Demo

Interactive 3D demo for the capstone project **"A Cloud-based Smart Student Monitoring System with Performance Tracking and Alert System for Claro M. Recto High School"**.

It recreates the 2nd-floor hallway and Room B 301 (Grade 10 Diamond) and animates the full entry/exit flow: face scan at the Hikvision terminal, door swing, student movement, and the data path through the Mini PC, Mercusys AC12G, DITO ZTE K10, the cloud database, and the ESP32 + GSM module that sends the parent SMS.

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

- **Simulate Entry** (student in the hallway): walk to the hallway terminal, blue scan turns green, the door swings inward, the student walks in, a data pulse goes to the Mini PC and DITO router and up to the cloud, and a second pulse triggers the ESP32 + GSM module (SMS rings).
- **Simulate Exit** (student in the room): scan at the interior terminal, the door swings outward, the student returns to the hallway, and the cloud log and ESP32 + GSM exit SMS fire.
- The buttons are enabled based on where the student currently is.
- Camera presets (Hallway / Classroom / Overview), an **Auto camera** toggle that follows the action, and a label toggle are at the top right. Drag to orbit, scroll to zoom.

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
