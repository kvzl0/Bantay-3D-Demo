/**
 * WelcomeSplash.jsx
 * Welcome modal styled to match bantay-eight.vercel.app exactly.
 *
 * Font source (from QRifyED/index.html + tailwind.config.js):
 *   font-display = Space Grotesk (wght 500;700)
 *   font-sans    = Plus Jakarta Sans
 *
 * Logo (from QRifyED/src/components/Logo.jsx):
 *   <span font-display font-bold border-2 border-white bg-brand-green text-black px-1>Ban</span>
 *   <span font-display font-bold text-white>tay</span>
 *
 * Brand colors (from QRifyED/tailwind.config.js):
 *   navy   #1E3A5F   orange #F97316
 *   amber  #F59E0B   cyan   #22D3EE
 *   green  #22C55E   red    #EF4444
 *
 * Box shadows:
 *   brutal-sm  2px 2px 0 #000
 *   brutal     4px 4px 0 #000
 *   brutal-lg  8px 8px 0 #000
 */
import { useState, useEffect } from 'react'

export default function WelcomeSplash({ onEnter }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 40)
    return () => clearTimeout(t)
  }, [])

  const handleEnter = () => {
    setVisible(false)
    setTimeout(onEnter, 320)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        backgroundColor: 'rgba(10,20,40,0.55)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.32s ease',
      }}
    >
      {/* Card — brand navy bg, same as the LandingPage hero */}
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-2xl px-10 py-10 text-center shadow-2xl"
        style={{ backgroundColor: '#1E3A5F' }}
      >
        {/*
         * Floating shapes — 2px solid black border on squares/diamonds,
         * no border on the green circle. Positions mirror the site hero.
         */}
        {/* Orange – top-left */}
        <div aria-hidden="true" className="absolute" style={{ top:'5%', left:'5%', width:52, height:52, backgroundColor:'#F97316', border:'2px solid #111', transform:'rotate(-10deg)' }} />
        {/* Orange – top-right */}
        <div aria-hidden="true" className="absolute" style={{ top:'5%', right:'5%', width:38, height:38, backgroundColor:'#F97316', border:'2px solid #111', transform:'rotate(8deg)' }} />
        {/* Green circle – right-center, solid fill no border */}
        <div aria-hidden="true" className="absolute rounded-full" style={{ top:'42%', right:'4%', width:18, height:18, backgroundColor:'#22C55E' }} />
        {/* Cyan diamond – bottom-left */}
        <div aria-hidden="true" className="absolute" style={{ bottom:'7%', left:'5%', width:34, height:34, backgroundColor:'#22D3EE', border:'2px solid #111', transform:'rotate(45deg)' }} />
        {/* Cyan small – right lower */}
        <div aria-hidden="true" className="absolute" style={{ bottom:'20%', right:'4%', width:20, height:20, backgroundColor:'#22D3EE', border:'2px solid #111' }} />
        {/* Red – bottom-right */}
        <div aria-hidden="true" className="absolute" style={{ bottom:'5%', right:'5%', width:44, height:44, backgroundColor:'#EF4444', border:'2px solid #111', transform:'rotate(8deg)' }} />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center">

          {/* Logo — exact copy of Logo.jsx (dark=true variant) */}
          <div className="font-display mb-4 tracking-tight" style={{ fontSize: 'clamp(2.2rem, 6vw, 3.4rem)', lineHeight: 1 }}>
            <span
              className="font-bold px-1 border-2 border-white"
              style={{ backgroundColor: '#22C55E', color: '#111' }}
            >
              Ban
            </span>
            <span className="font-bold text-white">tay</span>
          </div>

          {/* Tagline — font-display bold uppercase, same as LandingPage h2 */}
          <h1
            className="font-display font-bold uppercase text-white mb-4"
            style={{ fontSize: 'clamp(1.1rem, 3vw, 1.7rem)', lineHeight: 1.15, maxWidth: '22rem' }}
          >
            Smarter schools start at the door.
          </h1>

          {/* Description — font-sans */}
          <p className="font-sans mb-7 max-w-sm text-sm leading-relaxed text-slate-300 sm:text-[0.95rem]">
            An interactive 3D demo of the smart student monitoring system for{' '}
            <span className="font-bold text-white">Claro M. Recto High School</span>.
            Watch the entry and exit flow, the local network data path, and the
            parent SMS alert in real time.
          </p>

          {/* CTA button — matches LandingPage: amber, border-4 black, brutal shadow */}
          <button
            type="button"
            onClick={handleEnter}
            className="font-display font-bold w-full border-4 border-black uppercase tracking-widest transition-all hover:-translate-x-1 hover:-translate-y-1 active:translate-x-0 active:translate-y-0"
            style={{
              backgroundColor: '#F59E0B',
              color: '#111',
              boxShadow: '4px 4px 0 #000',
              fontSize: 'clamp(0.72rem, 1.8vw, 0.85rem)',
              letterSpacing: '0.1em',
              padding: '0.85em 1em',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '8px 8px 0 #000' }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '4px 4px 0 #000' }}
          >
            Explore the Demo
          </button>

          <p className="font-sans mt-5 text-[11px] text-slate-500">Capstone Project · Kiev Gonzales</p>
        </div>
      </div>
    </div>
  )
}
