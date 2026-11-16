import { AnimatePresence, motion, MotionConfig, useReducedMotion, type Variants } from 'framer-motion'
import { AlertCircle, CheckCircle2, Gamepad2, LoaderCircle, LogOut, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

type SteamWebProfile = { steamId: string; personaName: string; avatarUrl: string | null; profileUrl: string }
type SteamWebSession = { accessToken: string; expiresAt: number; profile: SteamWebProfile }
type SteamWebFlow = { flowId: string; pollSecret: string; loginUrl: string; expiresInSeconds: number }
type SteamWebPoll = { status: 'pending' | 'cancelled' | 'failed' | 'complete'; error?: string; profile?: SteamWebProfile }
type SteamWebStage = 'preparing' | 'waiting' | 'connected' | 'error'

const STEAM_API = 'https://csrift-api.yydh7707.workers.dev'
const STEAM_LOGIN_ERRORS: Record<string, string> = {
  AUTH_CANCELLED: 'Steam sign-in was cancelled.',
  AUTH_FAILED: 'Steam could not verify this sign-in. Please try again.',
  AUTH_FLOW_NOT_FOUND: 'This sign-in request expired. Please start again.',
  AUTH_RESPONSE_EXPIRED: 'Steam sign-in expired. Please try again.',
  OPENID_VERIFICATION_FAILED: 'Steam could not verify the OpenID response.',
}

async function steamRequest<T>(path: string, accessToken?: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${STEAM_API}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new Error('CSRIFT Steam sign-in is currently unreachable. Please try again later.')
  }
  const payload = await response.json().catch(() => null) as { error?: string } | null
  if (!response.ok) {
    throw new Error(STEAM_LOGIN_ERRORS[payload?.error ?? ''] ?? `Steam sign-in could not continue (${response.status}).`)
  }
  return payload as T
}

function authDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Sign-in cancelled', 'AbortError'))
      return
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(new DOMException('Sign-in cancelled', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

const navItems = [
  { label: 'HOME', href: '#home' },
  { label: 'FEATURES', href: '#features' },
  { label: 'PERFORMANCE', href: '#performance' },
  { label: 'ABOUT', href: '#about' },
  { label: 'FAQ', href: '#faq' },
]

const features = [
  { number: '01', title: 'FPS CENTER', type: 'fps', description: 'See the signals behind your frame delivery. Review live system load and keep an eye on stability while you play.' },
  { number: '02', title: 'NETWORK LAB', type: 'network', description: 'Get a clearer view of connection quality with latency checks, packet-loss visibility, and practical diagnostics.' },
  { number: '03', title: 'CS2 CONFIG', type: 'config', description: 'Keep CS2 settings organized. Create profiles, make a backup, and bring your preferred setup back when you need it.' },
  { number: '04', title: 'SYSTEM OPTIMIZE', type: 'optimize', description: 'Review Windows settings and startup apps in one place. You choose what to change—nothing is applied without your say.' },
  { number: '05', title: 'SYSTEM MONITOR', type: 'monitor', description: 'Check CPU, GPU, and memory activity at a glance to understand what your setup is doing.' },
  { number: '06', title: 'RECOVERY CENTER', type: 'recovery', description: 'Keep track of reviewed changes, save a restore point first, and reverse supported settings individually.' },
]

const faqs = [
  { q: 'What is CSRIFT?', a: 'CSRIFT is a PC setup and management companion being designed for CS2 players. It brings system checks, configuration organization, network diagnostics, and change recovery into one focused control center.' },
  { q: 'Is CSRIFT designed for Counter-Strike 2?', a: 'Yes. CSRIFT is being developed with CS2 players and their PC setup workflows in mind. It is an independent product, not an official Valve product.' },
  { q: 'Does CSRIFT require an internet connection?', a: 'The final connectivity requirements have not been announced. We will publish confirmed requirements here before release.' },
  { q: 'Does CSRIFT require an account?', a: 'No CSRIFT account is required to use the desktop app. Connecting Steam is optional. Steam sign-in is available on this website and the desktop app when you choose to link your SteamID; it does not require a Steam Web API key.' },
  { q: 'Is CSRIFT safe to use?', a: 'CSRIFT is designed around clear user consent, reviewable changes, backups, and recovery. It does not use game-memory manipulation or DLL injection, and does not provide features that interfere with VAC or CS2 anti-cheat.' },
  { q: 'Can I restore my previous settings?', a: 'Backup and recovery are core parts of the planned experience. The exact restore coverage will be documented before release; always review an action and its backup status before applying changes.' },
  { q: 'Which Windows versions are supported?', a: 'Supported Windows versions have not yet been announced. We will list tested versions and requirements when they are confirmed.' },
]

const steps = [
  ['01', 'DOWNLOAD', 'Download the Windows x64 installer directly from CSRIFT.'],
  ['02', 'SYSTEM SCAN', 'Review the environment and available system information.'],
  ['03', 'ANALYZE', 'Understand findings and read the recommendations.'],
  ['04', 'OPTIMIZE', 'Choose which supported changes you want to apply.'],
  ['05', 'REVIEW', 'Check the change history and restore where available.'],
]

const sectionReveal: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] as const } },
}

function Wordmark({ compact = false }: { compact?: boolean }) {
  return <a className={`wordmark${compact ? ' wordmark-compact' : ''}`} href="/#home" aria-label="CSRIFT home"><span className="wordmark-symbol">C</span><span>CSRIFT</span></a>
}

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" className="arrow-icon"><path d={diagonal ? 'M4 12 12 4M5 4h7v7' : 'M2.5 8h10m-4-4 4 4-4 4'} /></svg>
}

function Preview({ type }: { type: string }) {
  return (
    <div className={`feature-preview preview-${type}`} aria-label={`${type} interface preview`}>
      <div className="preview-top"><span className="preview-dots"><i /><i /><i /></span><span>CSRIFT <b>/</b> {type.toUpperCase()}</span><span className="preview-live"><i /> PREVIEW</span></div>
      {type === 'fps' && <div className="fps-screen"><div><span className="preview-label">FRAME DELIVERY</span><strong>STEADY<span className="status-dot" /></strong><small>MONITORING PREVIEW</small></div><div className="waveform" aria-hidden="true">{Array.from({ length: 30 }, (_, i) => <i key={i} style={{ height: `${18 + ((i * 13 + 19) % 46)}%` }} />)}</div></div>}
      {type === 'network' && <div className="network-screen"><div className="network-orbit"><span /><i /><b /></div><div className="network-legend"><span>LATENCY <b>CHECK</b></span><span>PACKET LOSS <b>DIAGNOSTIC</b></span><small>ILLUSTRATIVE INTERFACE</small></div></div>}
      {type === 'config' && <div className="config-screen"><span className="preview-label">CONFIG PROFILES</span>{['COMPETITIVE', 'PRACTICE', 'BACKUP'].map((name, i) => <div className="config-row" key={name}><span className="config-index">0{i + 1}</span><b>{name}</b><span>{i === 0 ? 'ACTIVE' : 'SAVED'}</span><i>↗</i></div>)}</div>}
      {type === 'optimize' && <div className="optimize-screen"><div className="optimize-ring"><span>REVIEW<br />FIRST</span></div><div className="optimize-list"><span><i /> STARTUP APPS <b>REVIEW</b></span><span><i /> SYSTEM SETTINGS <b>OPT-IN</b></span><span><i /> CHANGE CONTROL <b>READY</b></span></div></div>}
      {type === 'monitor' && <div className="monitor-screen">{[['CPU', 'SYSTEM LOAD'], ['GPU', 'GRAPHICS'], ['RAM', 'MEMORY']].map(([label, hint], i) => <div className="monitor-row" key={label}><span>{label}<small>{hint}</small></span><div className="monitor-bars">{Array.from({ length: 11 }, (_, j) => <i className={j < 5 + i ? 'is-lit' : ''} key={j} />)}</div><b>—</b></div>)}</div>}
      {type === 'recovery' && <div className="recovery-screen"><span className="preview-label">CHANGE HISTORY</span><div className="recovery-entry"><i>✓</i><span><b>Backup created</b><small>BEFORE APPLYING A CHANGE</small></span><span className="history-tag">SAVED</span></div><div className="recovery-entry"><i>↶</i><span><b>Restore available</b><small>SUPPORTED SETTINGS</small></span><span className="history-tag">REVIEW</span></div></div>}
    </div>
  )
}

function Header({ steamSession, onConnectSteam, onDisconnectSteam, steamBusy }: {
  steamSession: SteamWebSession | null
  onConnectSteam: () => void
  onDisconnectSteam: () => void
  steamBusy: boolean
}) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [active, setActive] = useState('#home')

  useEffect(() => {
    const updateScroll = () => setScrolled(window.scrollY > 24)
    window.addEventListener('scroll', updateScroll, { passive: true })
    updateScroll()
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActive(`#${entry.target.id}`)
      })
    }, { rootMargin: '-35% 0px -55% 0px' })
    document.querySelectorAll('main section[id]').forEach((section) => observer.observe(section))
    return () => {
      window.removeEventListener('scroll', updateScroll)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    document.body.classList.toggle('menu-open', menuOpen)
    return () => document.body.classList.remove('menu-open')
  }, [menuOpen])

  return (
    <header className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
      <div className="header-inner"><Wordmark />
        <nav className="desktop-nav" aria-label="Main navigation">{navItems.map((item) => <a className={active === item.href ? 'is-active' : ''} href={item.href} key={item.label}>{item.label}</a>)}</nav>
        <button className={`header-steam-button${steamSession ? ' is-connected' : ''}`} onClick={steamSession ? onDisconnectSteam : onConnectSteam} disabled={steamBusy} title={steamSession ? `Connected Steam ID: ${steamSession.profile.steamId} · Click to disconnect` : 'Connect your Steam account'}>
          {steamSession ? <><span className="steam-online-dot" /> STEAM · {steamSession.profile.steamId.slice(-6)} <LogOut size={13} /></> : <><Gamepad2 size={14} /> CONNECT STEAM</>}
        </button>
        <a className="header-download" href="#download">DOWNLOAD <Arrow diagonal /></a>
        <button className={`menu-toggle${menuOpen ? ' is-open' : ''}`} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><span /><span /></button>
      </div>
      <AnimatePresence>{menuOpen && <motion.nav className="mobile-nav" aria-label="Mobile navigation" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>{navItems.map((item, i) => <motion.a key={item.label} href={item.href} onClick={() => setMenuOpen(false)} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.035 }}>{item.label}<Arrow diagonal /></motion.a>)}<button className="mobile-steam-connect" onClick={() => { setMenuOpen(false); steamSession ? onDisconnectSteam() : onConnectSteam() }}>{steamSession ? 'DISCONNECT STEAM' : 'CONNECT YOUR STEAM ACCOUNT'}<Gamepad2 size={14} /></button><a className="mobile-download" href="#download" onClick={() => setMenuOpen(false)}>DOWNLOAD <Arrow diagonal /></a></motion.nav>}</AnimatePresence>
    </header>
  )
}

function Intro() {
  const [show, setShow] = useState(() => {
    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
    try {
      return !localStorage.getItem('csrift-intro-seen')
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (!show) return
    try {
      localStorage.setItem('csrift-intro-seen', 'true')
    } catch {
      // The intro is optional when browser storage is unavailable.
    }
    const timer = window.setTimeout(() => setShow(false), 1250)
    return () => window.clearTimeout(timer)
  }, [show])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="intro"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          aria-hidden="true"
        >
          <motion.img
            src="/images/csrift-eyes-cutout.png"
            alt=""
            initial={{ opacity: 0, scale: 1.04, filter: 'blur(10px)' }}
            animate={{ opacity: 0.45, scale: 1, filter: 'blur(0px)' }}
            transition={{ duration: 0.8 }}
          />
          <motion.div
            className="intro-mark"
            initial={{ opacity: 0, filter: 'blur(12px)', y: 8 }}
            animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
            transition={{ delay: 0.25, duration: 0.65 }}
          >
            <Wordmark />
            <span>CONTROL YOUR ENVIRONMENT</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Hero({ onConnectSteam }: { onConnectSteam: () => void }) {
  const reduceMotion = useReducedMotion()
  return (
    <section className="hero" id="home">
      <div className="hero-art" aria-hidden="true"><div className="hero-art-image"><img src="/images/csrift-eyes-cutout.png" alt="" /></div><div className="hero-glow" /><div className="hero-crosshair crosshair-one">+</div><div className="hero-crosshair crosshair-two">+</div></div>
      <div className="hero-content">
        <motion.div className="eyebrow hero-eyebrow" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3, duration: 0.6 }}><span className="eyebrow-mark" /> A CONTROL CENTER FOR CS2 PLAYERS</motion.div>
        <motion.h1 initial={reduceMotion ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.42, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>TAKE CONTROL.<br /><span>OWN EVERY FRAME.</span></motion.h1>
        <motion.p className="hero-copy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.72, duration: 0.6 }}>Optimize your system. Refine your settings.<br className="desktop-break" /> Take control of your CS2 experience.</motion.p>
        <motion.div className="hero-actions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.86, duration: 0.5 }}><button className="button button-primary" onClick={onConnectSteam}><Gamepad2 size={15} /> CONNECT YOUR STEAM ACCOUNT</button><a className="button button-secondary" href="#features">DISCOVER FEATURES <Arrow diagonal /></a></motion.div>
        <div className="hero-caption"><span>01</span><i /> PERFORMANCE&nbsp; / &nbsp;PRECISION&nbsp; / &nbsp;CONTROL</div>
      </div>
      <a className="scroll-cue" href="#features"><span>SCROLL TO EXPLORE</span><i /></a>
      <div className="hero-index">CSRIFT&nbsp; / &nbsp;EST. 2026</div>
    </section>
  )
}

function Features() {
  return <section className="section features-section" id="features"><div className="section-shell"><motion.div className="section-heading" variants={sectionReveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.25 }}><div><span className="eyebrow"><span className="eyebrow-mark" /> THE CONTROL CENTER</span><h2>BUILT AROUND<br /><span>YOUR SETUP.</span></h2></div><p>One place to inspect your system, organize your CS2 setup, and make informed changes—on your terms.</p></motion.div><div className="feature-grid">{features.map((feature, i) => <motion.article className="feature-card" key={feature.type} variants={sectionReveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.13 }} transition={{ delay: (i % 3) * 0.08 }}><div className="feature-card-top"><span>{feature.number} <i /> MODULE</span><span>CSRIFT / 0{i + 1}</span></div><Preview type={feature.type} /><div className="feature-card-copy"><div><h3>{feature.title}</h3><span className="feature-arrow"><Arrow diagonal /></span></div><p>{feature.description}</p></div></motion.article>)}</div></div></section>
}

function Performance() {
  const dimensions = [
    { no: '01', name: 'FPS STABILITY', sub: 'FRAME DELIVERY' },
    { no: '02', name: 'SYSTEM PERFORMANCE', sub: 'HARDWARE ACTIVITY' },
    { no: '03', name: 'NETWORK LATENCY', sub: 'CONNECTION QUALITY' },
    { no: '04', name: 'CONFIGURATION CONTROL', sub: 'SETUP MANAGEMENT' },
  ]
  return <section className="section performance-section" id="performance"><div className="performance-grid-bg" /><div className="section-shell performance-layout"><motion.div className="performance-heading" variants={sectionReveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.25 }}><span className="eyebrow"><span className="eyebrow-mark" /> THE DETAILS ADD UP</span><h2>EVERY FRAME<br /><span>MATTERS.</span></h2><p>No magic numbers. No empty promises. Just a clearer picture of the factors that shape your setup.</p><span className="sample-stamp"><i /> PRODUCT PREVIEW — NO PERFORMANCE CLAIMS</span></motion.div><motion.div className="performance-panel" variants={sectionReveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }}><div className="panel-heading"><span>PERFORMANCE OVERVIEW</span><span>PREVIEW <i /></span></div><div className="signal-visual"><div className="signal-ring ring-outer" /><div className="signal-ring ring-middle" /><div className="signal-ring ring-inner" /><div className="signal-core"><span>CS</span><small>CONTROL<br />CENTER</small></div><i className="signal-sweep" /></div><div className="signal-legend">{dimensions.map((d) => <div key={d.no}><span className="legend-number">{d.no}</span><span className="legend-name">{d.name}<small>{d.sub}</small></span><i className="legend-indicator" /></div>)}</div><div className="panel-footnote">ILLUSTRATIVE UI · NOT A LIVE MEASUREMENT</div></motion.div></div></section>
}

function HowItWorks() {
  return <section className="section workflow-section" id="about"><div className="section-shell"><motion.div className="workflow-intro" variants={sectionReveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.3 }}><span className="eyebrow"><span className="eyebrow-mark" /> YOUR SETUP. YOUR CALL.</span><h2>INFORMED BY DESIGN.</h2><p>Take a deliberate path from system check to changes you understand.</p></motion.div><div className="workflow-steps">{steps.map(([no, title, copy], i) => <motion.article className="workflow-step" key={no} variants={sectionReveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.4 }} transition={{ delay: i * 0.08 }}><div className="step-track"><span>{no}</span><i /></div><h3>{title}</h3><p>{copy}</p></motion.article>)}</div></div></section>
}

function Safety() {
  const safeguards = ['No setting changes without your consent', 'Back up before changes; review supported recovery options', 'Review your change history', 'Avoid unsafe or opaque system modifications', 'No game-memory manipulation or DLL injection', 'No VAC or CS2 anti-cheat interference features']
  return <section className="section safety-section"><div className="section-shell safety-layout"><motion.div className="safety-heading" variants={sectionReveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.25 }}><span className="eyebrow"><span className="eyebrow-mark" /> TRUST IS PART OF PERFORMANCE</span><h2>YOUR PC.<br /><span>YOUR RULES.</span></h2><p>Tools that touch your system should put you in control. CSRIFT is being built around visible, reversible, user-approved actions.</p><a className="text-link" href="#faq">READ THE FAQ <Arrow /></a></motion.div><motion.div className="safety-list" variants={sectionReveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.18 }}>{safeguards.map((item, i) => <div className="safety-item" key={item}><span className="safety-check">0{i + 1}</span><p>{item}</p><span className="safety-status">POLICY</span></div>)}<p className="independence-note">CSRIFT is an independent project. Not affiliated with, endorsed by, or sponsored by Valve Corporation.</p></motion.div></div></section>
}

function Download() {
  return <section className="download-section" id="download"><div className="download-art" aria-hidden="true" /><div className="download-content"><span className="eyebrow"><span className="eyebrow-mark" /> YOUR NEXT MOVE</span><h2>READY TO<br /><span>TAKE CONTROL?</span></h2><p>Your setup. Your settings. Your advantage.</p><a className="button button-primary download-button" href="/downloads/CSRIFT_0.1.0_x64-setup.exe" download><span>DOWNLOAD FOR WINDOWS <small>VERSION 0.1.0 · X64</small></span><Arrow diagonal /></a><span className="download-note">Windows installer · 2.3 MB · Distributed directly by CSRIFT. Windows may show a security prompt because this early release is not code-signed.</span></div><div className="download-corner">CSRIFT&nbsp; / &nbsp;WINDOWS</div></section>
}

function FAQ() {
  const [open, setOpen] = useState<number | null>(0)
  return <section className="section faq-section" id="faq"><div className="section-shell faq-layout"><motion.div className="faq-heading" variants={sectionReveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.25 }}><span className="eyebrow"><span className="eyebrow-mark" /> STRAIGHT ANSWERS</span><h2>GOOD TO<br /><span>KNOW.</span></h2><p>Clear answers on the product, privacy, and what is—and is not—available yet.</p><span className="faq-index">FAQ&nbsp; / &nbsp;001—007</span></motion.div><div className="faq-list">{faqs.map((faq, i) => <motion.div className={`faq-item${open === i ? ' is-open' : ''}`} key={faq.q} variants={sectionReveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }}><button aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}><span className="faq-number">0{i + 1}</span><span>{faq.q}</span><i className="faq-plus" /></button><AnimatePresence initial={false}>{open === i && <motion.div className="faq-answer-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: 'easeInOut' }}><p>{faq.a}</p></motion.div>}</AnimatePresence></motion.div>)}</div></div></section>
}

function Footer() {
  return <footer className="site-footer"><div className="footer-main"><div className="footer-brand"><Wordmark /><p>CONTROL YOUR ENVIRONMENT.</p><a href="https://csrift.xyz">CSRIFT.XYZ <Arrow diagonal /></a></div><div className="footer-links"><div><span className="footer-label">EXPLORE</span><a href="/#home">HOME</a><a href="/#features">FEATURES</a><a href="/#download">DOWNLOAD</a><a href="/#faq">FAQ</a></div><div><span className="footer-label">INFORMATION</span><a href="/privacy.html">PRIVACY POLICY</a><a href="/terms.html">TERMS OF SERVICE</a></div></div><div className="footer-signoff"><span>PERFORMANCE.</span><span>PRECISION.</span><span>STABILITY.</span><span>CONTROL.</span></div></div>  <div className="footer-bottom"><span>© 2026 CSRIFT. ALL RIGHTS RESERVED.</span><span>NOT AFFILIATED WITH VALVE CORPORATION.</span><a href="https://csrift.xyz">CSRIFT.XYZ</a></div></footer>
}

function LandingPage({ steamSession, steamBusy, onConnectSteam, onDisconnectSteam }: {
  steamSession: SteamWebSession | null
  steamBusy: boolean
  onConnectSteam: () => void
  onDisconnectSteam: () => void
}) {
  return <><Intro /><Header steamSession={steamSession} steamBusy={steamBusy} onConnectSteam={onConnectSteam} onDisconnectSteam={onDisconnectSteam} /><main><Hero onConnectSteam={onConnectSteam} /><Features /><Performance /><HowItWorks /><Safety /><Download /><FAQ /></main><Footer /></>
}

const policies = {
  privacy: {
    eyebrow: 'INFORMATION / 01',
    title: 'PRIVACY<br /><span>POLICY.</span>',
    updated: 'Effective date: November 16, 2026',
    intro: 'This notice describes the privacy approach for the CSRIFT public website at csrift.xyz.',
    sections: [
      ['Steam sign-in', 'If you choose Connect your Steam account, Steam authenticates you on its official Community website and returns an OpenID response to CSRIFT’s Cloudflare Worker for verification. CSRIFT receives your SteamID, not your Steam password. The Worker stores the SteamID and a basic linked-account record, and creates a hashed server-side session record; the browser keeps its session token in memory until you disconnect or reload the page. Sign-in flow state and hashed request identifiers are also used to prevent replay and limit abuse.'],
      ['Owned games and API keys', 'Steam OpenID sign-in and local game detection do not require a Steam Web API key. Fetching an owned-games list is a separate optional feature and requires a server-side Steam Web API key. This public website does not currently request or display an owned-games list. Steam may disclose your account identifier to CSRIFT when you approve sign-in.'],
      ['Downloads and hosting', 'The website offers the CSRIFT Windows installer as a static file download. CSRIFT does not operate download analytics or advertising on this site. Your browser, website host, Cloudflare, and Steam may process connection or authentication data under their own policies when you use their services.'],
      ['Downloads and analytics', 'The website offers the CSRIFT Windows installer as a static file download. CSRIFT does not operate download analytics or advertising on this site. Your browser and hosting provider may process standard connection data to deliver the site and file under their own policies.'],
      ['External services', 'The site may load web fonts from Google Fonts. Requests to that service are handled according to Google’s privacy terms. You can use browser settings or extensions to limit external requests; fallback system fonts are provided.'],
      ['Changes to this notice', 'If the website or its data practices change, this page will be updated. A future CSRIFT application may have a separate privacy notice.'],
      ['Contact', 'A dedicated privacy contact has not yet been published. Please check this page for updates.'],
    ],
  },
  terms: {
    eyebrow: 'INFORMATION / 02',
    title: 'TERMS OF<br /><span>SERVICE.</span>',
    updated: 'Effective date: November 16, 2026',
    intro: 'These terms apply to your use of the CSRIFT public website at csrift.xyz.',
    sections: [
      ['Website information', 'This site provides general product information about CSRIFT. Features and interface visuals may be previews of a planned product, not a representation that a release is currently available. The website does not make performance, FPS, or network-improvement guarantees.'],
      ['Software download', 'The CSRIFT Windows x64 installer is provided as-is from this website. Only download it from csrift.xyz. This early release is not code-signed, so Windows may display an unknown-publisher warning. Review any Windows prompts before choosing whether to run the installer.'],
      ['Independent product', 'CSRIFT is an independent project. It is not affiliated with, endorsed by, or sponsored by Valve Corporation. Counter-Strike 2 and Valve are the property of their respective owners.'],
      ['Use of this website', 'Do not misuse the website or attempt to disrupt its availability. Website content is provided for general information and may be updated as product details are confirmed.'],
      ['Updates', 'These terms may be updated as the website or product changes. Updated terms will be published on this page.'],
      ['Contact', 'A dedicated legal contact has not yet been published. Please check this page for updates.'],
    ],
  },
}

function PolicyPage({ kind, steamSession, steamBusy, onConnectSteam, onDisconnectSteam }: {
  kind: 'privacy' | 'terms'
  steamSession: SteamWebSession | null
  steamBusy: boolean
  onConnectSteam: () => void
  onDisconnectSteam: () => void
}) {
  const policy = policies[kind]
  return <><Header steamSession={steamSession} steamBusy={steamBusy} onConnectSteam={onConnectSteam} onDisconnectSteam={onDisconnectSteam} /><main className="policy-page"><div className="policy-hero"><span className="eyebrow"><span className="eyebrow-mark" /> {policy.eyebrow}</span><h1 dangerouslySetInnerHTML={{ __html: policy.title }} /><p>{policy.updated}</p><div className="policy-line" /></div><div className="policy-content"><p className="policy-intro">{policy.intro}</p>{policy.sections.map(([title, copy], i) => <section key={title}><span className="policy-number">0{i + 1}</span><div><h2>{title}</h2><p>{copy}</p></div></section>)}<a className="text-link" href="/">BACK TO CSRIFT <Arrow /></a></div></main><Footer /></>
}

function SteamWebAuthOverlay({ stage, error, profile, onCancel, onRetry, onClose }: {
  stage: SteamWebStage
  error: string | null
  profile: SteamWebProfile | null
  onCancel: () => void
  onRetry: () => void
  onClose: () => void
}) {
  const connected = stage === 'connected'
  return (
    <motion.div className={`steam-web-overlay${connected ? ' is-connected' : ''}`} role="dialog" aria-modal="true" aria-labelledby="steam-web-title" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .24 }}>
      <motion.section className="steam-web-panel" initial={{ opacity: 0, y: 12, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: .3 }}>
        <button className="steam-web-close" aria-label="Close Steam connection dialog" onClick={connected || stage === 'error' ? onClose : onCancel}><X size={17} /></button>
        <span className="eyebrow"><span className="eyebrow-mark" /> CSRIFT / STEAM OPENID 2.0</span>
        <h2 id="steam-web-title">{connected ? 'STEAM ACCOUNT<br /><span>CONNECTED.</span>' : stage === 'error' ? 'CONNECTION<br /><span>INTERRUPTED.</span>' : 'CONNECT YOUR<br /><span>STEAM ACCOUNT.</span>'}</h2>
        <p>{connected ? 'Steam verified your identity. Your SteamID is connected to this browser session.' : stage === 'error' ? 'Sign-in was not completed. Your Steam account has not been connected.' : 'Continue on the official Steam Community sign-in page. CSRIFT never asks for or receives your Steam password.'}</p>
        <div className={`steam-web-link-visual${connected ? ' complete' : ''}`}>
          <div className="steam-web-node"><b>C</b><small>CSRIFT</small></div>
          <div className="steam-web-line"><i /></div>
          <div className="steam-web-node steam-web-steam"><Gamepad2 size={26} /><small>STEAM</small></div>
        </div>
        {connected && profile
          ? <div className="steam-web-account"><CheckCircle2 size={16} /><span><b>CONNECTED</b><small>STEAMID · {profile.steamId}</small></span><a href={profile.profileUrl} target="_blank" rel="noreferrer">VIEW PROFILE <Arrow diagonal /></a></div>
          : <div className={`steam-web-status ${stage === 'error' ? 'has-error' : ''}`}>{stage === 'error' ? <AlertCircle size={14} /> : <LoaderCircle size={14} className="steam-web-spinner" />}{stage === 'preparing' ? 'PREPARING SECURE SIGN-IN' : stage === 'waiting' ? 'WAITING FOR STEAM CONFIRMATION' : STEAM_LOGIN_ERRORS[error ?? ''] ?? error ?? 'SIGN-IN NOT COMPLETED'}</div>}
        {!connected && stage === 'error' && <p className="steam-web-error">{error}</p>}
        <div className="steam-web-actions">{stage === 'waiting' || stage === 'preparing'
          ? <button className="button button-secondary" onClick={onCancel}>CANCEL CONNECTION <X size={13} /></button>
          : stage === 'error'
            ? <><button className="button button-secondary" onClick={onClose}>CLOSE</button><button className="button button-primary" onClick={onRetry}>RETRY <Arrow /></button></>
            : <button className="button button-primary" onClick={onClose}>DONE <CheckCircle2 size={15} /></button>}</div>
        {connected && <p className="steam-web-note">Login is verified by CSRIFT’s Cloudflare Worker. Owned game lists require a separate Steam Web API key; they are not needed to connect your account.</p>}
      </motion.section>
    </motion.div>
  )
}

export default function App() {
  const isPrivacy = window.location.pathname.endsWith('/privacy.html')
  const isTerms = window.location.pathname.endsWith('/terms.html')
  const [steamSession, setSteamSession] = useState<SteamWebSession | null>(null)
  const [steamStage, setSteamStage] = useState<SteamWebStage | null>(null)
  const [steamError, setSteamError] = useState<string | null>(null)
  const steamAbort = useRef<AbortController | null>(null)
  const steamFlow = useRef<SteamWebFlow | null>(null)
  const steamPopup = useRef<Window | null>(null)
  const steamBusy = steamStage === 'preparing' || steamStage === 'waiting'

  const connectSteam = useCallback(async () => {
    const popup = window.open('about:blank', '_blank')
    if (!popup) {
      setSteamError('Your browser blocked the Steam sign-in window. Allow pop-ups for csrift.xyz and retry.')
      setSteamStage('error')
      return
    }
    const controller = new AbortController()
    steamAbort.current = controller
    steamPopup.current = popup
    steamFlow.current = null
    setSteamError(null)
    setSteamStage('preparing')
    try {
      const flow = await steamRequest<SteamWebFlow>('/v1/auth/steam/start', undefined, {
        method: 'POST',
        body: '{}',
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      steamFlow.current = flow
      popup.opener = null
      popup.location.replace(flow.loginUrl)
      setSteamStage('waiting')

      const attempts = Math.ceil((flow.expiresInSeconds * 1000) / 1400)
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        await authDelay(1400, controller.signal)
        const result = await steamRequest<SteamWebPoll>('/v1/auth/steam/poll', undefined, {
          method: 'POST',
          body: JSON.stringify({ flowId: flow.flowId, pollSecret: flow.pollSecret }),
          signal: controller.signal,
        })
        if (result.status === 'cancelled') throw new Error(STEAM_LOGIN_ERRORS.AUTH_CANCELLED)
        if (result.status === 'failed') throw new Error(STEAM_LOGIN_ERRORS[result.error ?? ''] ?? STEAM_LOGIN_ERRORS.AUTH_FAILED)
        if (result.status !== 'complete') continue
        const session = await steamRequest<SteamWebSession>('/v1/auth/steam/exchange', undefined, {
          method: 'POST',
          body: JSON.stringify({ flowId: flow.flowId, pollSecret: flow.pollSecret }),
          signal: controller.signal,
        })
        if (controller.signal.aborted) {
          try { await steamRequest('/v1/auth/logout', session.accessToken, { method: 'POST' }) } catch { /* The cancelled browser session expires if revocation is unavailable. */ }
          return
        }
        setSteamSession(session)
        setSteamStage('connected')
        setSteamError(null)
        return
      }
      throw new Error(STEAM_LOGIN_ERRORS.AUTH_FLOW_NOT_FOUND)
    } catch (reason) {
      if (controller.signal.aborted) return
      const message = reason instanceof Error ? reason.message : String(reason)
      setSteamError(message)
      setSteamStage('error')
      if (!popup.closed) popup.close()
    } finally {
      if (steamAbort.current === controller) steamAbort.current = null
      steamFlow.current = null
      steamPopup.current = null
    }
  }, [])

  const cancelSteam = useCallback(() => {
    const flow = steamFlow.current
    const controller = steamAbort.current
    controller?.abort()
    steamAbort.current = null
    steamFlow.current = null
    if (steamPopup.current && !steamPopup.current.closed) steamPopup.current.close()
    steamPopup.current = null
    setSteamStage(null)
    setSteamError(null)
    if (flow) {
      void steamRequest('/v1/auth/steam/cancel', undefined, {
        method: 'POST',
        body: JSON.stringify({ flowId: flow.flowId, pollSecret: flow.pollSecret }),
      }).catch(() => undefined)
    }
  }, [])

  const disconnectSteam = useCallback(async () => {
    if (!steamSession) return
    try {
      await steamRequest('/v1/auth/logout', steamSession.accessToken, { method: 'POST' })
      setSteamSession(null)
      setSteamStage(null)
      setSteamError(null)
    } catch (reason) {
      setSteamError(reason instanceof Error ? reason.message : String(reason))
      setSteamStage('error')
    }
  }, [steamSession])

  useEffect(() => {
    document.title = isPrivacy ? 'Privacy — CSRIFT' : isTerms ? 'Terms — CSRIFT' : 'CSRIFT — Take control. Own every frame.'
  }, [isPrivacy, isTerms])
  return <MotionConfig reducedMotion="user">{isPrivacy || isTerms
    ? <PolicyPage kind={isPrivacy ? 'privacy' : 'terms'} steamSession={steamSession} steamBusy={steamBusy} onConnectSteam={() => { void connectSteam() }} onDisconnectSteam={() => { void disconnectSteam() }} />
    : <LandingPage steamSession={steamSession} steamBusy={steamBusy} onConnectSteam={() => { void connectSteam() }} onDisconnectSteam={() => { void disconnectSteam() }} />}
    <AnimatePresence>{steamStage && <SteamWebAuthOverlay stage={steamStage} error={steamError} profile={steamSession?.profile ?? null} onCancel={cancelSteam} onRetry={() => { void connectSteam() }} onClose={() => setSteamStage(null)} />}</AnimatePresence>
  </MotionConfig>
}
