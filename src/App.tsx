import { AnimatePresence, motion, MotionConfig, useReducedMotion, type Variants } from 'framer-motion'
import { useEffect, useState } from 'react'

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
  { q: 'Does CSRIFT require an account?', a: 'Account requirements have not been confirmed. We will share the final onboarding details before the first release.' },
  { q: 'Is CSRIFT safe to use?', a: 'CSRIFT is designed around clear user consent, reviewable changes, backups, and recovery. It does not use game-memory manipulation or DLL injection, and does not provide features that interfere with VAC or CS2 anti-cheat.' },
  { q: 'Can I restore my previous settings?', a: 'Backup and recovery are core parts of the planned experience. The exact restore coverage will be documented before release; always review an action and its backup status before applying changes.' },
  { q: 'Which Windows versions are supported?', a: 'Supported Windows versions have not yet been announced. We will list tested versions and requirements when they are confirmed.' },
]

const steps = [
  ['01', 'DOWNLOAD', 'Get CSRIFT from the official release page.'],
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

function Header() {
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
        <a className="header-download" href="#download">DOWNLOAD <Arrow diagonal /></a>
        <button className={`menu-toggle${menuOpen ? ' is-open' : ''}`} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><span /><span /></button>
      </div>
      <AnimatePresence>{menuOpen && <motion.nav className="mobile-nav" aria-label="Mobile navigation" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>{navItems.map((item, i) => <motion.a key={item.label} href={item.href} onClick={() => setMenuOpen(false)} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.035 }}>{item.label}<Arrow diagonal /></motion.a>)}<a className="mobile-download" href="#download" onClick={() => setMenuOpen(false)}>DOWNLOAD <Arrow diagonal /></a></motion.nav>}</AnimatePresence>
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

function Hero() {
  const reduceMotion = useReducedMotion()
  return (
    <section className="hero" id="home">
      <div className="hero-art" aria-hidden="true"><div className="hero-art-image"><img src="/images/csrift-eyes-cutout.png" alt="" /></div><div className="hero-glow" /><div className="hero-crosshair crosshair-one">+</div><div className="hero-crosshair crosshair-two">+</div></div>
      <div className="hero-content">
        <motion.div className="eyebrow hero-eyebrow" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3, duration: 0.6 }}><span className="eyebrow-mark" /> A CONTROL CENTER FOR CS2 PLAYERS</motion.div>
        <motion.h1 initial={reduceMotion ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.42, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>TAKE CONTROL.<br /><span>OWN EVERY FRAME.</span></motion.h1>
        <motion.p className="hero-copy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.72, duration: 0.6 }}>Optimize your system. Refine your settings.<br className="desktop-break" /> Take control of your CS2 experience.</motion.p>
        <motion.div className="hero-actions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.86, duration: 0.5 }}><a className="button button-primary" href="#about">EXPLORE CSRIFT <Arrow /></a><a className="button button-secondary" href="#features">DISCOVER FEATURES <Arrow diagonal /></a></motion.div>
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
  return <section className="download-section" id="download"><div className="download-art" aria-hidden="true" /><div className="download-content"><span className="eyebrow"><span className="eyebrow-mark" /> YOUR NEXT MOVE</span><h2>READY TO<br /><span>TAKE CONTROL?</span></h2><p>Your setup. Your settings. Your advantage.</p><button className="button button-disabled" disabled aria-disabled="true">WINDOWS RELEASE <span className="coming-soon">COMING SOON</span></button><span className="download-note">The CSRIFT installer is not available yet. Check back for confirmed release details.</span></div><div className="download-corner">CSRIFT&nbsp; / &nbsp;WINDOWS</div></section>
}

function FAQ() {
  const [open, setOpen] = useState<number | null>(0)
  return <section className="section faq-section" id="faq"><div className="section-shell faq-layout"><motion.div className="faq-heading" variants={sectionReveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.25 }}><span className="eyebrow"><span className="eyebrow-mark" /> STRAIGHT ANSWERS</span><h2>GOOD TO<br /><span>KNOW.</span></h2><p>Clear answers on the product, privacy, and what is—and is not—available yet.</p><span className="faq-index">FAQ&nbsp; / &nbsp;001—007</span></motion.div><div className="faq-list">{faqs.map((faq, i) => <motion.div className={`faq-item${open === i ? ' is-open' : ''}`} key={faq.q} variants={sectionReveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }}><button aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}><span className="faq-number">0{i + 1}</span><span>{faq.q}</span><i className="faq-plus" /></button><AnimatePresence initial={false}>{open === i && <motion.div className="faq-answer-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: 'easeInOut' }}><p>{faq.a}</p></motion.div>}</AnimatePresence></motion.div>)}</div></div></section>
}

function Footer() {
  return <footer className="site-footer"><div className="footer-main"><div className="footer-brand"><Wordmark /><p>CONTROL YOUR ENVIRONMENT.</p><a href="https://csrift.xyz">CSRIFT.XYZ <Arrow diagonal /></a></div><div className="footer-links"><div><span className="footer-label">EXPLORE</span><a href="/#home">HOME</a><a href="/#features">FEATURES</a><a href="/#download">DOWNLOAD</a><a href="/#faq">FAQ</a></div><div><span className="footer-label">INFORMATION</span><a href="/privacy.html">PRIVACY POLICY</a><a href="/terms.html">TERMS OF SERVICE</a></div></div><div className="footer-signoff"><span>PERFORMANCE.</span><span>PRECISION.</span><span>STABILITY.</span><span>CONTROL.</span></div></div>  <div className="footer-bottom"><span>© 2026 CSRIFT. ALL RIGHTS RESERVED.</span><span>NOT AFFILIATED WITH VALVE CORPORATION.</span><a href="https://csrift.xyz">CSRIFT.XYZ</a></div></footer>
}

function LandingPage() {
  return <><Intro /><Header /><main><Hero /><Features /><Performance /><HowItWorks /><Safety /><Download /><FAQ /></main><Footer /></>
}

const policies = {
  privacy: {
    eyebrow: 'INFORMATION / 01',
    title: 'PRIVACY<br /><span>POLICY.</span>',
    updated: 'Effective date: November 16, 2026',
    intro: 'This notice describes the privacy approach for the CSRIFT public website at csrift.xyz.',
    sections: [
      ['Website data', 'This website is a static product information site. It does not provide account registration, sign-in, contact forms, or backend services. We do not intentionally collect personal information through this site.'],
      ['Downloads and analytics', 'No CSRIFT installer is currently offered from this website. We do not claim to operate analytics, advertising, or download-tracking services here. Your browser or hosting provider may process standard connection data to deliver the site under its own policies.'],
      ['External services', 'The site may load web fonts from Google Fonts. Requests to that service are handled according to Google’s privacy terms. You can use browser settings or extensions to limit external requests; fallback system fonts are provided.'],
      ['Changes to this notice', 'If the website or its data practices change, this page will be updated before new collection practices are introduced. A future CSRIFT application may have a separate privacy notice.'],
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
      ['No software download', 'There is currently no CSRIFT installer available from this website. Do not rely on third-party files claiming to be an official CSRIFT release.'],
      ['Independent product', 'CSRIFT is an independent project. It is not affiliated with, endorsed by, or sponsored by Valve Corporation. Counter-Strike 2 and Valve are the property of their respective owners.'],
      ['Use of this website', 'Do not misuse the website or attempt to disrupt its availability. Website content is provided for general information and may be updated as product details are confirmed.'],
      ['Updates', 'These terms may be updated as the website or product changes. Updated terms will be published on this page.'],
      ['Contact', 'A dedicated legal contact has not yet been published. Please check this page for updates.'],
    ],
  },
}

function PolicyPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const policy = policies[kind]
  return <><Header /><main className="policy-page"><div className="policy-hero"><span className="eyebrow"><span className="eyebrow-mark" /> {policy.eyebrow}</span><h1 dangerouslySetInnerHTML={{ __html: policy.title }} /><p>{policy.updated}</p><div className="policy-line" /></div><div className="policy-content"><p className="policy-intro">{policy.intro}</p>{policy.sections.map(([title, copy], i) => <section key={title}><span className="policy-number">0{i + 1}</span><div><h2>{title}</h2><p>{copy}</p></div></section>)}<a className="text-link" href="/">BACK TO CSRIFT <Arrow /></a></div></main><Footer /></>
}

export default function App() {
  const isPrivacy = window.location.pathname.endsWith('/privacy.html')
  const isTerms = window.location.pathname.endsWith('/terms.html')
  useEffect(() => {
    document.title = isPrivacy ? 'Privacy — CSRIFT' : isTerms ? 'Terms — CSRIFT' : 'CSRIFT — Take control. Own every frame.'
  }, [isPrivacy, isTerms])
  return <MotionConfig reducedMotion="user">{isPrivacy || isTerms ? <PolicyPage kind={isPrivacy ? 'privacy' : 'terms'} /> : <LandingPage />}</MotionConfig>
}
