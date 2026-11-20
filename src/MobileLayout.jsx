/**
 * MobileLayout.jsx
 * Mobile-optimized overlay UI for the Bantay 3D Demo.
 * Mobile only — rendered when viewport < 640px (sm breakpoint).
 *
 * Layout:
 *   - Top bar (always visible): branding, school name, status badge, hide/show toggle
 *   - 3D canvas fills the remaining space (rendered by Canvas in App.jsx behind this overlay)
 *   - Bottom sheet (slides up/down): tabs (Info | Log | Camera) + action buttons
 *
 * When hidden: full 3D view, top bar stays so user always sees context.
 * When shown: bottom sheet covers ~55vh.
 */
import { useState } from 'react'

const TONE_STYLES = {
  standby: 'bg-slate-700 text-slate-200',
  idle: 'bg-slate-600 text-white',
  scan: 'bg-blue-600 text-white animate-pulse',
  ok: 'bg-emerald-500 text-emerald-950',
}

function IconInfo({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
    </svg>
  )
}
function IconList({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  )
}
function IconCamera({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
    </svg>
  )
}
function IconChevronUp({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  )
}
function IconChevronDown({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

export default function MobileLayout({
  mode, reached, smsText, running, location,
  timelines, mockStudent, views,
  showLabels, autoFollow,
  onEntry, onExit, onToggleLabels, onView, onToggleAuto,
}) {
  const [activeTab, setActiveTab] = useState('info')
  const [sheetOpen, setSheetOpen] = useState(true)

  const tl = mode ? timelines[mode] : null
  const status = tl ? [...tl.status].reverse().find((s) => s.at <= reached) : null
  const tone = status?.tone ?? 'standby'
  const smsRevealed = tl?.logs.some((l) => l.sms && l.at <= reached)
  const initials = mockStudent.name.split(' ').map((p) => p[0]).slice(0, 2).join('')

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col">

      {/* ── Top bar — always visible ─────────────────────────── */}
      <div className="pointer-events-auto flex items-center justify-between gap-2 bg-slate-900/90 px-3 py-2 backdrop-blur-md">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-sky-300">
            Bantay · Smart Student Monitoring
          </p>
          <p className="text-[11px] font-bold text-white leading-tight">
            Claro M. Recto HS – Grade 10 Diamond
          </p>
        </div>

        {/* Status badge */}
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${TONE_STYLES[tone]}`}>
          {status?.text ?? 'Standby'}
        </span>
      </div>

      {/* ── Spacer — 3D canvas shows through here ────────────── */}
      <div className="flex-1" />

      {/*
       * Toggle handle when sheet is CLOSED — absolute-pinned to bottom-center
       * so it always appears at the bottom of the screen, never floats.
       * Hidden when sheet is open (the handle inside the sheet takes over).
       */}
      {!sheetOpen && (
        <div className="pointer-events-auto absolute bottom-0 left-0 right-0 flex justify-center">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex items-center gap-1 rounded-t-xl bg-slate-900/90 px-4 py-1.5 text-[10px] font-medium text-slate-300 shadow-lg backdrop-blur-md"
          >
            <IconChevronUp />
            <span>Show panel</span>
          </button>
        </div>
      )}

      {/* ── Bottom sheet — slides in/out from bottom ─────────── */}
      <div
        className="pointer-events-auto flex flex-col transition-transform duration-300"
        style={{ transform: sheetOpen ? 'translateY(0)' : 'translateY(100%)' }}
      >
        {/* Handle at top of sheet — visible when sheet is open */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setSheetOpen(false)}
            className="flex items-center gap-1 rounded-t-xl bg-slate-900/90 px-4 py-1.5 text-[10px] font-medium text-slate-300 shadow-lg backdrop-blur-md"
          >
            <IconChevronDown />
            <span>Hide panel</span>
          </button>
        </div>
        {/* Tab switcher */}
        <div className="flex border-t border-b border-white/10 bg-slate-900/95 backdrop-blur-md">
          {[
            { key: 'info',   label: 'Info',   icon: <IconInfo /> },
            { key: 'log',    label: 'Log',    icon: <IconList /> },
            { key: 'camera', label: 'Camera', icon: <IconCamera /> },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition ${
                activeTab === tab.key
                  ? 'border-b-2 border-sky-400 text-sky-300'
                  : 'text-slate-400'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="max-h-[36vh] overflow-y-auto bg-slate-900/95 p-3 backdrop-blur-md">

          {/* Info tab */}
          {activeTab === 'info' && (
            <div className="space-y-3 text-xs text-white">
              <div className="flex items-center gap-3 rounded-xl bg-white/5 p-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p><span className="text-slate-400">Student:</span> <span className="font-semibold">{mockStudent.name}</span></p>
                  <p className="truncate text-slate-400">LRN {mockStudent.lrn} · mock data</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Status</span>
                <span className={`rounded-full px-2.5 py-1 font-semibold ${TONE_STYLES[tone]}`}>
                  {status?.text ?? 'Standby – choose a simulation'}
                </span>
              </div>
              {smsRevealed && (
                <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 p-2.5">
                  <p className="text-[9px] uppercase tracking-wider text-amber-300">SMS preview · to Parent/Guardian</p>
                  <p className="mt-1 text-amber-50">{smsText}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-white/10 pt-2 text-[10px] text-slate-400">
                {[['bg-sky-400','LAN data'],['bg-violet-400','Cloud (cellular)'],['bg-amber-400','SMS trigger']].map(([dot, text]) => (
                  <span key={text} className="flex items-center gap-1.5">
                    <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
                    {text}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Log tab */}
          {activeTab === 'log' && (
            <div>
              {tl ? (
                <ul className="space-y-1.5 text-xs">
                  {tl.logs.map((log) => {
                    const done = log.at <= reached
                    return (
                      <li key={log.text} className={`flex gap-2 rounded-lg px-2 py-1.5 transition-colors duration-300 ${done ? 'bg-emerald-500/15 text-white' : 'bg-white/5 text-slate-500'}`}>
                        <span className={`w-4 shrink-0 text-center ${done ? 'text-emerald-300' : ''}`}>{done ? log.icon : '•'}</span>
                        <span>{log.text}</span>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-center text-xs text-slate-500">Run a simulation to see the event log.</p>
              )}
            </div>
          )}

          {/* Camera tab */}
          {activeTab === 'camera' && (
            <div className="space-y-3 text-xs text-white">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Camera presets</p>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(views).map(([key, v]) => (
                  <button key={key} type="button" onClick={() => onView(key)}
                    className="rounded-xl bg-white/10 py-2.5 text-xs font-medium text-white transition active:scale-95 hover:bg-white/20">
                    {v.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
                <button type="button" onClick={onToggleAuto} aria-pressed={autoFollow}
                  className={`w-full rounded-xl py-2.5 text-xs font-medium transition active:scale-95 ${autoFollow ? 'bg-sky-500 text-sky-950' : 'bg-white/10 text-white hover:bg-white/20'}`}>
                  Auto camera: {autoFollow ? 'On' : 'Off'}
                </button>
                <button type="button" onClick={onToggleLabels}
                  className="w-full rounded-xl bg-white/10 py-2.5 text-xs font-medium text-white transition hover:bg-white/20 active:scale-95">
                  {showLabels ? 'Hide labels' : 'Show labels'}
                </button>
              </div>
              <p className="text-center text-[10px] text-slate-500">Pinch to zoom · Drag to orbit</p>
            </div>
          )}
        </div>

        {/* Action buttons — always at the bottom of the sheet */}
        <div className="grid grid-cols-2 gap-2 border-t border-white/10 bg-slate-900/95 px-3 py-3 backdrop-blur-md">
          <button type="button" onClick={onEntry} disabled={running || location !== 'courtyard'}
            className="rounded-2xl bg-emerald-500 py-3 text-sm font-bold text-emerald-950 shadow-lg transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">
            Simulate Entry
          </button>
          <button type="button" onClick={onExit} disabled={running || location !== 'classroom'}
            className="rounded-2xl bg-rose-500 py-3 text-sm font-bold text-white shadow-lg transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">
            Simulate Exit
          </button>
          <p className="col-span-2 text-center text-[10px] text-slate-400">
            {running ? 'Simulation running…' : location === 'courtyard' ? 'Student is in the courtyard.' : 'Student is in Room B 301.'}
          </p>
        </div>
      </div>

    </div>
  )
}
