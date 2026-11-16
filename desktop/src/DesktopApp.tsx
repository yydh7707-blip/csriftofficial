import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Activity, ArrowRight, Bell,
  Check, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, CircleHelp,
  Cpu, ExternalLink, FileArchive, FileClock, FileCog, FileSearch,
  Gauge, Gamepad2, HardDrive, HeartPulse, History, LayoutDashboard, LoaderCircle,
  Maximize2, Minus, Monitor, MoreHorizontal, Network, Pencil, Plus, RefreshCw, RotateCcw,
  Save, Search, Settings2, Shield, ShieldCheck, Sparkles, Square, Trash2,
  TriangleAlert, Wifi, X, Zap,
  type LucideIcon,
} from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'

type PageId = 'dashboard' | 'fps' | 'network' | 'monitor' | 'config' | 'optimize' | 'recovery' | 'settings'

type SystemSnapshot = {
  osName: string | null
  cpuName: string
  cpuUsagePercent: number | null
  cpuTemperatureC: number | null
  memoryTotalBytes: number
  memoryUsedBytes: number
  memoryUsagePercent: number | null
  gpuName: string | null
  gpuUsagePercent: number | null
  gpuTemperatureC: number | null
  vramTotalBytes: number | null
  cs2Running: boolean
  activeProcessCount: number
  processes: { name: string; cpuPercent: number; memoryBytes: number }[]
  disks: { name: string; totalBytes: number; availableBytes: number }[]
  networkInterfaces: string[]
  capturedAtMs: number
}

type PingResult = {
  target: string
  sent: number
  received: number
  packetLossPercent: number
  averageLatencyMs: number | null
  latenciesMs: string[]
  measuredAtMs: number
}

type ConfigStatus = { detected: boolean; path: string | null; files: string[]; changedFiles: string[]; comparedBackupId: string | null }
type ConfigBackup = { id: string; createdAtMs: number; files: string[]; directory: string }
type ConfigProfile = { id: string; name: string; createdAtMs: number; backupId: string; files: string[] }
type StartupEntry = { name: string; command: string; source: string }
type TempScan = { directory: string; eligibleFiles: number; totalBytes: number }
type PowerPlan = { name: string | null; guid: string | null; available: boolean }
type DnsServer = { address: string }
type DesktopSettings = { accent: 'ember' | 'amber'; reduceMotion: boolean; introEnabled: boolean; notificationsEnabled: boolean }
type Toast = { id: number; title: string; message: string; tone: 'success' | 'error' | 'info' }
type ActivityItem = { id: number; title: string; detail: string; time: number; tone: 'success' | 'info' }

const navigation: { id: PageId; label: string; icon: LucideIcon; group: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'OVERVIEW' },
  { id: 'fps', label: 'FPS Center', icon: Gauge, group: 'PLAY' },
  { id: 'network', label: 'Network Lab', icon: Wifi, group: 'PLAY' },
  { id: 'monitor', label: 'System Monitor', icon: Activity, group: 'PLAY' },
  { id: 'config', label: 'CS2 Config', icon: Gamepad2, group: 'MANAGE' },
  { id: 'optimize', label: 'Windows Optimize', icon: Zap, group: 'MANAGE' },
  { id: 'recovery', label: 'Recovery Center', icon: History, group: 'MANAGE' },
  { id: 'settings', label: 'Settings', icon: Settings2, group: 'PREFERENCES' },
]

const pageCopy: Record<PageId, { title: string; eyebrow: string; description: string }> = {
  dashboard: { title: 'Dashboard', eyebrow: 'YOUR ENVIRONMENT, AT A GLANCE', description: 'A clear view of your PC and CS2 setup. No synthetic scores, just the signals your hardware reports.' },
  fps: { title: 'FPS Center', eyebrow: 'FRAME DELIVERY / SYSTEM CONTEXT', description: 'Review CPU pressure, active processes, and the system signals around frame stability.' },
  network: { title: 'Network Lab', eyebrow: 'CONNECTION DIAGNOSTICS', description: 'Measure a real route from your PC. A public resolver is only a comparison point, not your CS2 server.' },
  monitor: { title: 'System Monitor', eyebrow: 'LIVE / LOCAL HARDWARE TELEMETRY', description: 'Follow available CPU, memory, process, and disk data directly from Windows.' },
  config: { title: 'CS2 Config', eyebrow: 'CONFIGURATION / LOCAL FILES', description: 'Find, back up, and restore the CS2 settings files on this PC. Every backup stays local.' },
  optimize: { title: 'Windows Optimize', eyebrow: 'REVIEW / USER-CONTROLLED', description: 'Inspect startup entries and safely review temporary files before cleanup.' },
  recovery: { title: 'Recovery Center', eyebrow: 'BACKUPS / CHANGE HISTORY', description: 'Restore a supported CS2 configuration backup with a safety backup made first.' },
  settings: { title: 'Settings', eyebrow: 'YOUR APP / YOUR PREFERENCES', description: 'Small, local preferences. No account, sync, or cloud dependency.' },
}

const defaultSettings: DesktopSettings = {
  accent: 'ember',
  reduceMotion: false,
  introEnabled: true,
  notificationsEnabled: true,
}

function bytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = value
  let index = -1
  do {
    amount /= 1024
    index++
  } while (amount >= 1024 && index < units.length - 1)
  return `${amount.toFixed(amount < 10 ? 1 : 0)} ${units[index]}`
}

function percent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)}%`
}

function temperature(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 'Not reported' : `${Math.round(value)}°C`
}

function timeLabel(value: number): string {
  return new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function useToasts(enabled: boolean) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const notify = useCallback((title: string, message: string, tone: Toast['tone'] = 'info') => {
    if (!enabled && tone !== 'error') return
    const id = Date.now() + Math.random()
    setToasts((items) => [...items.slice(-3), { id, title, message, tone }])
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4600)
  }, [enabled])
  const dismiss = useCallback((id: number) => setToasts((items) => items.filter((item) => item.id !== id)), [])
  return { toasts, notify, dismiss }
}

function EyeMark({ className = '' }: { className?: string }) {
  return <span className={`eye-mark ${className}`} aria-label="CSRIFT"><img src="/images/csrift-eyes-cutout.png" alt="" /></span>
}

function Sparkline({ values, color = 'var(--accent)' }: { values: number[]; color?: string }) {
  if (values.length < 2) return <div className="chart-empty">Collecting local samples</div>
  const width = 300
  const height = 68
  const max = Math.max(...values, 10)
  const points = values.map((value, i) => `${(i / (values.length - 1)) * width},${height - (Math.min(value, max) / max) * (height - 8)}`).join(' ')
  const area = `0,${height} ${points} ${width},${height}`
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Graph of measured system samples">
      <defs><linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".22" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <polygon points={area} fill="url(#spark-fill)" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function ProgressBar({ value, tone = 'accent' }: { value: number | null | undefined; tone?: 'accent' | 'neutral' }) {
  const safe = value == null || !Number.isFinite(value) ? null : Math.max(0, Math.min(value, 100))
  return <div className={`progress-track ${tone}`}><div className="progress-fill" style={{ width: safe == null ? '0%' : `${safe}%` }} /></div>
}

function SectionTitle({ overline, title, detail, action }: { overline: string; title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="section-title">
      <div><span className="eyebrow"><i />{overline}</span><h2>{title}</h2><p>{detail}</p></div>
      {action}
    </div>
  )
}

function EmptyState({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={18} /></span><h3>{title}</h3><p>{detail}</p></div>
}

function AppCard({ className = '', children }: { className?: string; children: ReactNode }) {
  return <section className={`app-card ${className}`}>{children}</section>
}

function DashboardPage({
  snapshot, history, latestPing, config, onPage,
}: {
  snapshot: SystemSnapshot | null; history: number[]; latestPing: PingResult | null; config: ConfigStatus | null; onPage: (page: PageId) => void
}) {
  const systemClear = snapshot != null && snapshot.cpuUsagePercent != null && snapshot.cpuUsagePercent < 85 && snapshot.memoryUsagePercent != null && snapshot.memoryUsagePercent < 92
  return (
    <div className="page-stack">
      <section className="welcome-panel">
        <div className="welcome-grid" />
        <div className="welcome-copy">
          <span className="eyebrow"><i /> PERSONAL / LOCAL / PRIVATE</span>
          <h1>WELCOME TO <span>CSRIFT.</span></h1>
          <p>Your CS2 environment, under control.</p>
          <div className="welcome-pills"><span><Check size={12} /> LOCAL-FIRST</span><span><ShieldCheck size={12} /> ALWAYS YOUR CHOICE</span></div>
        </div>
        <EyeMark className="welcome-eye" />
        <div className="welcome-corner">EST. 2026&nbsp;&nbsp; / &nbsp;&nbsp; BUILD 0.1.0</div>
      </section>

      <div className="status-ribbon">
        <span className={`system-beacon ${systemClear ? 'is-good' : 'is-review'}`}><i /></span>
        <div><strong>{snapshot ? systemClear ? 'SYSTEM IN RANGE' : 'SYSTEM CHECK' : 'CONNECTING TO WINDOWS'}</strong><small>{snapshot?.osName ?? 'Reading local hardware signals'}</small></div>
        <span className="ribbon-divider" />
        <span className="cs-status"><i className={snapshot?.cs2Running ? 'is-active' : ''} /><span>CS2 {snapshot ? snapshot.cs2Running ? 'RUNNING' : 'NOT RUNNING' : 'CHECKING'}</span></span>
        <span className="ribbon-spacer" />
        <span className="local-tag"><ShieldCheck size={13} /> YOUR PC ONLY</span>
      </div>

      <div className="metric-grid">
        <MetricCard icon={Cpu} label="CPU LOAD" value={percent(snapshot?.cpuUsagePercent)} sub={snapshot?.cpuName || 'Waiting for processor data'} progress={snapshot?.cpuUsagePercent} tone="accent" />
        <MetricCard icon={Monitor} label="GPU LOAD" value={percent(snapshot?.gpuUsagePercent)} sub={snapshot?.gpuName ?? 'GPU utilization not available'} progress={snapshot?.gpuUsagePercent} tone="neutral" />
        <MetricCard icon={Activity} label="MEMORY" value={percent(snapshot?.memoryUsagePercent)} sub={snapshot ? `${bytes(snapshot.memoryUsedBytes)} / ${bytes(snapshot.memoryTotalBytes)}` : 'Waiting for memory data'} progress={snapshot?.memoryUsagePercent} tone="neutral" />
        <MetricCard icon={HeartPulse} label="THERMALS" value={temperature(snapshot?.cpuTemperatureC)} sub={snapshot?.gpuTemperatureC == null ? 'CPU sensor only · GPU sensor unavailable' : `GPU ${temperature(snapshot.gpuTemperatureC)}`} progress={null} tone="neutral" />
      </div>

      <div className="dashboard-lower">
        <AppCard className="overview-card">
          <div className="card-heading"><div><span className="eyebrow"><i /> LIVE / SYSTEM LOAD</span><h3>Performance overview</h3></div><span className="live-tag"><i /> {snapshot ? 'LOCAL SAMPLE' : 'AWAITING DATA'}</span></div>
          <div className="overview-main">
            <div className="overview-chart"><Sparkline values={history} /><div className="chart-axis"><span>EARLIEST SAMPLE</span><span>{snapshot ? `LAST ${timeLabel(snapshot.capturedAtMs)}` : 'NO SAMPLE YET'}</span></div></div>
            <div className="overview-load"><span className="load-label">CURRENT CPU LOAD</span><strong>{percent(snapshot?.cpuUsagePercent)}</strong><span className="load-context">{snapshot ? `${snapshot.activeProcessCount} active processes` : 'Not measured yet'}</span></div>
          </div>
          <div className="overview-footer"><span>Samples captured by Windows · no estimated values</span><button className="text-button" onClick={() => onPage('monitor')}>OPEN MONITOR <ArrowRight size={14} /></button></div>
        </AppCard>
        <AppCard className="quick-card">
          <div className="card-heading"><div><span className="eyebrow"><i /> QUICK ACCESS</span><h3>Pick up where you left off.</h3></div></div>
          <button className="quick-row" onClick={() => onPage('network')}><span className="quick-icon"><Network size={15} /></span><span><b>NETWORK LAB</b><small>{latestPing ? `${latestPing.target} · ${latestPing.received}/${latestPing.sent} responses` : 'Run a real connection check'}</small></span><ChevronRight size={15} /></button>
          <button className="quick-row" onClick={() => onPage('config')}><span className="quick-icon"><FileCog size={15} /></span><span><b>CS2 CONFIG</b><small>{config?.detected ? `${config.files.length} supported files found` : 'Check for local settings'}</small></span><ChevronRight size={15} /></button>
          <button className="quick-row" onClick={() => onPage('optimize')}><span className="quick-icon"><Sparkles size={15} /></span><span><b>WINDOWS OPTIMIZE</b><small>Review before you make a change</small></span><ChevronRight size={15} /></button>
        </AppCard>
      </div>

      <div className="micro-footnote"><span><i /> CPU / MEMORY / PROCESS DATA FROM WINDOWS</span><span>NO FPS PROMISES. JUST A CLEARER PICTURE.</span></div>
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, sub, progress, tone }: { icon: LucideIcon; label: string; value: string; sub: string; progress: number | null | undefined; tone: 'accent' | 'neutral' }) {
  return <AppCard className="metric-card"><div className="metric-head"><span className="metric-icon"><Icon size={15} strokeWidth={1.7} /></span><span>{label}</span><MoreHorizontal size={15} /></div><div className="metric-value">{value}</div><div className="metric-sub" title={sub}>{sub}</div><ProgressBar value={progress} tone={tone} /></AppCard>
}

function FpsPage({ snapshot, history, onRefresh, loading }: { snapshot: SystemSnapshot | null; history: number[]; onRefresh: () => void; loading: boolean }) {
  const cpuPressure = snapshot?.cpuUsagePercent == null ? null : snapshot.cpuUsagePercent >= 85
  const memoryPressure = snapshot?.memoryUsagePercent == null ? null : snapshot.memoryUsagePercent >= 90
  return (
    <div className="page-stack">
      <SectionTitle overline="FRAME DELIVERY / SYSTEM CONTEXT" title="Understand the signals." detail="CSRIFT does not inject into the game or claim to measure FPS. This is system-level context around your setup." action={<button className="button button-outline" onClick={onRefresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> REFRESH SAMPLE</button>} />
      <div className="fps-overview-grid">
        <AppCard className="fps-score-card"><div className="card-heading"><div><span className="eyebrow"><i /> SYSTEM READINESS</span><h3>A readout, not a score.</h3></div></div><div className="fps-focus"><div className="focus-ring"><div><span>{snapshot ? cpuPressure || memoryPressure ? 'REVIEW' : 'READY' : '—'}</span><small>{snapshot ? 'SYSTEM' : 'NO DATA'}</small></div></div><p>{snapshot ? cpuPressure ? 'CPU load is currently high. Close only applications you recognize and do not need.' : memoryPressure ? 'Memory use is elevated. Review the process list before making a change.' : 'No high CPU or memory pressure was measured in this sample.' : 'A Windows hardware sample is required before CSRIFT can assess system load.'}</p></div><div className="focus-caveat"><Shield size={14} /><span>Read-only observation. This does not predict in-game performance.</span></div></AppCard>
        <AppCard className="fps-chart-card"><div className="card-heading"><div><span className="eyebrow"><i /> CPU / REAL WINDOWS SAMPLES</span><h3>Recent processor load</h3></div><span className="live-tag"><i /> {history.length ? `${history.length} SAMPLES` : 'NO HISTORY'}</span></div><div className="tall-chart"><Sparkline values={history} /><div className="chart-axis"><span>LOWER LOAD</span><span>MEASURED LOCALLY</span><span>HIGHER LOAD</span></div></div><div className="metric-line"><span>Current CPU usage</span><b>{percent(snapshot?.cpuUsagePercent)}</b></div><div className="metric-line"><span>GPU utilization</span><b>{snapshot?.gpuUsagePercent == null ? 'Unsupported sensor' : percent(snapshot.gpuUsagePercent)}</b></div></AppCard>
      </div>
      <AppCard><div className="card-heading"><div><span className="eyebrow"><i /> PROCESS REVIEW</span><h3>Busy right now</h3></div><span className="live-tag"><i /> CURRENT SAMPLE</span></div>{snapshot?.processes.length ? <div className="process-list"><div className="process-head"><span>PROCESS</span><span>CPU</span><span>MEMORY</span></div>{snapshot.processes.slice(0, 7).map((process, i) => <div className="process-row" key={`${process.name}-${i}`}><span className="process-name"><i />{process.name}</span><span>{percent(process.cpuPercent)}</span><span>{bytes(process.memoryBytes)}</span></div>)}</div> : <EmptyState icon={Cpu} title="No process sample yet" detail="Refresh system telemetry to review real Windows process usage." />}</AppCard>
      <AppCard className="notice-card"><ShieldCheck size={18} /><div><b>Game safety by design</b><p>CSRIFT never reads game memory, injects a DLL, or communicates with the CS2 process. It displays measured Windows system context only.</p></div></AppCard>
    </div>
  )
}

function NetworkPage({ latestPing, pingHistory, onPing }: { latestPing: PingResult | null; pingHistory: PingResult[]; onPing: (target: string) => Promise<void> }) {
  const [target, setTarget] = useState('1.1.1.1')
  const [busy, setBusy] = useState(false)
  const [interfaces, setInterfaces] = useState<string[] | null>(null)
  const [dnsServers, setDnsServers] = useState<DnsServer[] | null>(null)
  const [error, setError] = useState('')
  const [dnsError, setDnsError] = useState('')

  const refreshInterfaces = useCallback(async () => {
    try {
      const snapshot = await invoke<SystemSnapshot>('get_system_snapshot')
      setInterfaces(snapshot.networkInterfaces)
    } catch (reason) {
      setError(String(reason))
    }
  }, [])

  useEffect(() => { void refreshInterfaces() }, [refreshInterfaces])
  useEffect(() => {
    invoke<DnsServer[]>('list_dns_servers')
      .then(setDnsServers)
      .catch((reason: unknown) => setDnsError(String(reason)))
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await onPing(target)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }

  const resultValues = pingHistory.flatMap((result) => result.latenciesMs.map((value) => Number.parseFloat(value) || 0))
  return (
    <div className="page-stack">
      <SectionTitle overline="CONNECTION DIAGNOSTICS" title="Test your route." detail="Measure actual ICMP responses from this PC. Results reflect this target only—not your CS2 game server." />
      <div className="network-grid">
        <AppCard className="ping-card"><div className="card-heading"><div><span className="eyebrow"><i /> LIVE TEST / IPV4 + IPV6</span><h3>Run a real ping.</h3></div><span className="ping-icon"><Wifi size={18} /></span></div><form className="ping-form" onSubmit={(event) => void submit(event)}><label htmlFor="ping-target">IP ADDRESS</label><div className="ping-input-row"><div className="target-prefix">IP</div><input id="ping-target" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="1.1.1.1" maxLength={45} spellCheck={false} /><button className="button button-primary" type="submit" disabled={busy || !target.trim()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Activity size={15} />} {busy ? 'TESTING' : 'RUN TEST'} <ArrowRight size={14} /></button></div></form><p className="ping-helper">Sends 4 standard ICMP echo requests using Windows <code>ping</code>. No server connection is made.</p>{error && <div className="inline-error"><CircleAlert size={14} />{error}</div>}{latestPing &&         <div className="ping-results"><div className="ping-result-main"><span>AVERAGE RESPONSE</span><strong>{latestPing.averageLatencyMs == null ? latestPing.received ? '<1 ms' : 'No reply' : `${latestPing.averageLatencyMs.toFixed(1)} ms`}</strong><small>{latestPing.target} · {latestPing.received}/{latestPing.sent} responses</small></div><div className="ping-result-stats"><div><span>PACKET LOSS</span><b>{latestPing.packetLossPercent}%</b></div><div><span>RESPONSE STATUS</span><b className={latestPing.packetLossPercent === 0 ? 'status-text-good' : 'status-text-warn'}>{latestPing.packetLossPercent === 0 ? 'ALL REPLIED' : latestPing.received ? 'PACKET LOSS' : 'UNREACHABLE'}</b></div></div></div>}</AppCard>
        <AppCard className="network-chart-card"><div className="card-heading"><div><span className="eyebrow"><i /> MEASURED REPLIES / THIS SESSION</span><h3>Response history</h3></div><span className="live-tag"><i /> {pingHistory.length ? `${pingHistory.length} TESTS` : 'EMPTY'}</span></div>{resultValues.length > 1 ? <div className="network-history-chart"><Sparkline values={resultValues} color="#ffb347" /><div className="chart-axis"><span>EARLIEST REPLY</span><span>{latestPing ? timeLabel(latestPing.measuredAtMs) : ''}</span></div></div> : <EmptyState icon={Activity} title="No measurements yet" detail="Run a ping to build a graph from actual replies. This graph never generates sample data." />}<div className="target-note"><CircleHelp size={13} /><span>Ping to 1.1.1.1 is not equivalent to ping to a CS2 match server.</span></div></AppCard>
      </div>
      <div className="network-bottom-grid">
        <AppCard><div className="card-heading"><div><span className="eyebrow"><i /> WINDOWS NETWORK DEVICES</span><h3>Local adapters</h3></div><Network size={16} className="muted-icon" /></div>{interfaces == null ? <div className="row-placeholder"><LoaderCircle size={14} className="spin" />Reading Windows adapter names</div> : interfaces.length ? <div className="adapter-list">{interfaces.map((name) => <div className="adapter-row" key={name}><span className="adapter-symbol"><Wifi size={13} /></span><span>{name}</span><span className="adapter-readonly">LOCAL INTERFACE</span></div>)}</div> : <EmptyState icon={Network} title="No adapter was reported" detail="Windows did not report an active network interface." />}</AppCard>
        <AppCard><div className="card-heading"><div><span className="eyebrow"><i /> DNS / WINDOWS SETTINGS</span><h3>Kept under your control.</h3></div><ShieldCheck size={16} className="muted-icon" /></div>{dnsError ? <div className="row-placeholder dns-error"><CircleAlert size={14} />{dnsError}</div> : dnsServers == null ? <div className="row-placeholder"><LoaderCircle size={14} className="spin" />Reading local DNS settings</div> : dnsServers.length ? <div className="dns-server-list">{dnsServers.map((server) => <div className="dns-server-row" key={server.address}><span className="adapter-symbol"><Network size={13} /></span><code>{server.address}</code><span className="adapter-readonly">READ-ONLY</span></div>)}</div> : <div className="row-placeholder">No DNS resolver was reported by Windows.</div>}<div className="dns-note"><div className="dns-icon"><Shield size={16} /></div><p>CSRIFT does not change DNS settings. A different resolver cannot guarantee lower in-game latency.</p></div></AppCard>
      </div>
    </div>
  )
}

function MonitorPage({ snapshot, history, monitoring, onToggle, onRefresh, loading }: { snapshot: SystemSnapshot | null; history: number[]; monitoring: boolean; onToggle: () => void; onRefresh: () => void; loading: boolean }) {
  return (
    <div className="page-stack">
      <SectionTitle overline="LIVE / LOCAL HARDWARE TELEMETRY" title="The signal, uninterrupted." detail="Only Windows-reported values appear here. Sensors that Windows does not expose stay clearly marked unavailable." action={<div className="toolbar-actions"><button className="button button-outline" onClick={onRefresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> REFRESH</button><button className={`button ${monitoring ? 'button-stop' : 'button-primary'}`} onClick={onToggle}>{monitoring ? <Square size={13} /> : <Activity size={14} />}{monitoring ? ' STOP MONITOR' : ' START MONITOR'}</button></div>} />
      <div className="monitor-status"><span className={`system-beacon ${monitoring ? 'is-good' : 'is-idle'}`}><i /></span><span><b>{monitoring ? 'LIVE SAMPLING' : 'SAMPLING PAUSED'}</b><small>{monitoring ? 'A local snapshot is captured every 2 seconds.' : snapshot ? `Last measured ${timeLabel(snapshot.capturedAtMs)} · click Start to resume.` : 'No values are shown until Windows provides a sample.'}</small></span><span className="monitor-private"><ShieldCheck size={14} /> NO CLOUD</span></div>
      <div className="metric-grid monitor-metrics">
        <MetricCard icon={Cpu} label="CPU UTILIZATION" value={percent(snapshot?.cpuUsagePercent)} sub={snapshot?.cpuName || 'Hardware data unavailable'} progress={snapshot?.cpuUsagePercent} tone="accent" />
        <MetricCard icon={Activity} label="RAM IN USE" value={percent(snapshot?.memoryUsagePercent)} sub={snapshot ? `${bytes(snapshot.memoryUsedBytes)} of ${bytes(snapshot.memoryTotalBytes)}` : 'Hardware data unavailable'} progress={snapshot?.memoryUsagePercent} tone="neutral" />
        <MetricCard icon={Monitor} label="GPU UTILIZATION" value={percent(snapshot?.gpuUsagePercent)} sub={snapshot?.gpuName ?? 'No supported GPU counter exposed'} progress={snapshot?.gpuUsagePercent} tone="neutral" />
        <MetricCard icon={HeartPulse} label="GPU TEMPERATURE" value={temperature(snapshot?.gpuTemperatureC)} sub={snapshot?.gpuTemperatureC == null ? 'Sensor unavailable on this system' : 'Detected hardware component'} progress={null} tone="neutral" />
      </div>
      <div className="monitor-content-grid">
        <AppCard><div className="card-heading"><div><span className="eyebrow"><i /> CAPTURED SAMPLES</span><h3>Processor activity</h3></div><span className="live-tag"><i /> {history.length} POINTS</span></div><div className="tall-chart"><Sparkline values={history} /><div className="chart-axis"><span>OLDER</span><span>CPU LOAD %</span><span>NEWER</span></div></div><div className="metric-line"><span>CPU temperature</span><b>{temperature(snapshot?.cpuTemperatureC)}</b></div></AppCard>
        <AppCard><div className="card-heading"><div><span className="eyebrow"><i /> STORAGE / AVAILABLE DRIVES</span><h3>Disk usage</h3></div><HardDrive size={16} className="muted-icon" /></div>{snapshot?.disks.length ? <div className="drive-list">{snapshot.disks.map((disk) => { const used = disk.totalBytes - disk.availableBytes; const usedPercent = disk.totalBytes ? used / disk.totalBytes * 100 : null; return <div className="drive-row" key={disk.name}><div className="drive-head"><b>{disk.name}</b><span>{percent(usedPercent)}</span></div><ProgressBar value={usedPercent} tone="neutral" /><small>{bytes(used)} used · {bytes(disk.availableBytes)} available</small></div> })}</div> : <EmptyState icon={HardDrive} title="Storage not reported" detail="Windows did not return disk capacity data." />}</AppCard>
      </div>
      <AppCard><div className="card-heading"><div><span className="eyebrow"><i /> TOP WINDOWS PROCESSES</span><h3>Current activity</h3></div><span className="live-tag"><i /> READ-ONLY</span></div>{snapshot?.processes.length ? <div className="process-list"><div className="process-head"><span>PROCESS</span><span>CPU</span><span>MEMORY</span></div>{snapshot.processes.slice(0, 8).map((process, index) => <div className="process-row" key={`${process.name}-${index}`}><span className="process-name"><i />{process.name}</span><span>{percent(process.cpuPercent)}</span><span>{bytes(process.memoryBytes)}</span></div>)}</div> : <EmptyState icon={Activity} title="No process data yet" detail="A local system sample will appear here when available." />}</AppCard>
      <div className="sensor-note"><TriangleAlert size={14} /><span>GPU utilization, VRAM and some temperature sensors are not exposed by every driver. CSRIFT deliberately does not estimate missing readings.</span></div>
    </div>
  )
}

function ConfigPage({ status, backups, profiles, busy, onBackup, onOpenFolder, onRefresh, onRestore, onCreateProfile, onRenameProfile, onDeleteProfile }: {
  status: ConfigStatus | null; backups: ConfigBackup[]; profiles: ConfigProfile[]; busy: string | null; onBackup: () => Promise<void>; onOpenFolder: () => Promise<void>; onRefresh: () => void; onRestore: (id: string) => Promise<void>; onCreateProfile: (name: string, backupId: string) => Promise<void>; onRenameProfile: (id: string, name: string) => Promise<void>; onDeleteProfile: (id: string) => Promise<void>
}) {
  const [profileName, setProfileName] = useState('')
  const [selectedBackup, setSelectedBackup] = useState('')
  const [editingProfile, setEditingProfile] = useState<string | null>(null)
  const [editedProfileName, setEditedProfileName] = useState('')
  const latestBackup = backups[0]
  return (
    <div className="page-stack">
      <SectionTitle overline="CONFIGURATION / LOCAL FILES" title="Your setup, kept safe." detail="Back up locally stored CS2 .cfg and .vcfg files, create named profiles, and restore a saved snapshot." action={<button className="button button-outline" onClick={() => void onOpenFolder()} disabled={!status?.detected}><ExternalLink size={14} /> OPEN SETTINGS FOLDER</button>} />
      <AppCard className="config-detect-card"><div className="config-detect-icon"><Gamepad2 size={20} /></div><div className="config-detect-main"><span className="eyebrow"><i /> STEAM / CS2 SETTINGS</span><h3>{status?.detected ? 'CS2 settings folder found.' : 'Checking for your settings.'}</h3><p>{status?.detected ? status.path : 'Steam userdata / 730 / local / cfg. If it is not found, launch CS2 once and check again.'}</p></div><span className={`detect-status ${status?.detected ? 'found' : ''}`}><i />{status?.detected ? 'DETECTED' : status ? 'NOT FOUND' : 'SCANNING'}</span><div className="config-changes"><span className={status?.changedFiles.length ? 'has-changes' : ''}>{status?.comparedBackupId ? status.changedFiles.length ? `${status.changedFiles.length} FILES CHANGED` : 'MATCHES LATEST BACKUP' : 'NO COMPARISON BACKUP'}</span><button className="icon-action" onClick={onRefresh} title="Compare current settings with the latest local backup"><RefreshCw size={13} /></button></div></AppCard>
      <div className="config-columns">
        <AppCard><div className="card-heading"><div><span className="eyebrow"><i /> SUPPORTED SETTINGS</span><h3>Files we can protect.</h3></div><FileSearch size={16} className="muted-icon" /></div>{status?.files.length ? <div className="file-list">{status.files.map((file) => <div className="file-row" key={file}><span className="file-type"><FileCog size={14} /></span><span><b>{file}</b><small>LOCAL · CS2 CONFIGURATION</small></span><CheckCircle2 size={14} className="file-check" /></div>)}</div> : <EmptyState icon={FileSearch} title={status?.detected ? 'No supported settings files yet' : 'CS2 settings not detected'} detail="Only files Windows has reported are listed; nothing is generated for you." />}</AppCard>
        <AppCard><div className="card-heading"><div><span className="eyebrow"><i /> LOCAL BACKUPS</span><h3>Roll back with confidence.</h3></div><FileArchive size={16} className="muted-icon" /></div><div className="backup-stats"><div><strong>{backups.length.toString().padStart(2, '0')}</strong><span>BACKUPS</span></div><div><strong>{profiles.length.toString().padStart(2, '0')}</strong><span>PROFILES</span></div></div><p className="backup-location">Saved on this PC in a private CSRIFT application folder.</p><button className="button button-primary full-button" onClick={() => void onBackup()} disabled={!status?.detected || busy != null}>{busy === 'backup' ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />} {busy === 'backup' ? 'CREATING SAFETY COPY…' : 'BACK UP CURRENT SETTINGS'} <ArrowRight size={14} /></button></AppCard>
      </div>
      <div className="config-columns">
        <AppCard><div className="card-heading"><div><span className="eyebrow"><i /> NAMED CONFIG / PROFILES</span><h3>Save a personal profile.</h3></div><Plus size={16} className="muted-icon" /></div>{latestBackup && <form className="profile-form" onSubmit={(event) => { event.preventDefault(); void onCreateProfile(profileName, latestBackup.id).then(() => setProfileName('')) }}><label htmlFor="profile-name">PROFILE NAME</label><div className="profile-input-row"><input id="profile-name" value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={32} placeholder="e.g. Premier" /><button className="icon-action accent-action" type="submit" disabled={!profileName.trim() || busy != null} aria-label="Save named profile"><Plus size={16} /></button></div><small>Saved from the latest local backup · up to 32 characters</small></form>}{profiles.length ? <div className="profile-list">{profiles.map((profile) => <div className="profile-row" key={profile.id}><span className="profile-symbol"><Gamepad2 size={14} /></span>{editingProfile === profile.id ? <form className="rename-profile-form" onSubmit={(event) => { event.preventDefault(); void onRenameProfile(profile.id, editedProfileName).then(() => setEditingProfile(null)) }}><input aria-label="Rename configuration profile" autoFocus maxLength={32} value={editedProfileName} onChange={(event) => setEditedProfileName(event.target.value)} /><button className="icon-action accent-action" type="submit" disabled={!editedProfileName.trim() || busy != null} aria-label="Save profile name"><Check size={13} /></button><button className="icon-action" type="button" onClick={() => setEditingProfile(null)} aria-label="Cancel profile rename"><X size={13} /></button></form> : <><span className="profile-label"><b>{profile.name}</b><small>{profile.files.length} SAVED FILES · {new Date(profile.createdAtMs).toLocaleDateString()}</small></span><button className="icon-action" onClick={() => { setEditingProfile(profile.id); setEditedProfileName(profile.name) }} disabled={busy != null} title="Rename profile"><Pencil size={12} /></button><button className="icon-action" onClick={() => void onRestore(profile.backupId)} disabled={busy != null} title="Restore this profile"><RotateCcw size={14} /></button><button className="icon-action danger-action" onClick={() => void onDeleteProfile(profile.id)} disabled={busy != null} title="Delete profile"><Trash2 size={13} /></button></>}</div>)}</div> : !latestBackup && <p className="empty-inline">Create a settings backup first to save a named profile.</p>}</AppCard>
        <AppCard><div className="card-heading"><div><span className="eyebrow"><i /> RESTORE / PREVIEW</span><h3>Recover a saved snapshot.</h3></div><RotateCcw size={16} className="muted-icon" /></div><p className="restore-copy">A second safety copy is created immediately before any restore. You confirm each restore action before a configuration file is replaced.</p><label className="select-label" htmlFor="restore-backup">CHOOSE BACKUP</label><div className="select-wrap"><select id="restore-backup" value={selectedBackup} onChange={(event) => setSelectedBackup(event.target.value)}><option value="">Select a local backup…</option>{backups.map((backup) => <option value={backup.id} key={backup.id}>{new Date(backup.createdAtMs).toLocaleString()} · {backup.files.length} files</option>)}</select><ChevronDown size={14} /></div><button className="button button-outline full-button" disabled={!selectedBackup || busy != null} onClick={() => void onRestore(selectedBackup)}>{busy === 'restore' ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />} RESTORE SELECTED SNAPSHOT <ArrowRight size={14} /></button></AppCard>
      </div>
      <div className="sensor-note"><ShieldCheck size={14} /><span>All backed-up files stay on this PC. CSRIFT makes a safety backup before restoring, and never modifies active game processes.</span></div>
    </div>
  )
}

function OptimizePage({ startup, scan, powerPlan, busy, onRefresh, onScan, onCleanup }: { startup: StartupEntry[] | null; scan: TempScan | null; powerPlan: PowerPlan | null; busy: string | null; onRefresh: () => void; onScan: () => Promise<void>; onCleanup: () => Promise<void> }) {
  return (
    <div className="page-stack">
      <SectionTitle overline="REVIEW / USER-CONTROLLED" title="Deliberate, not destructive." detail="Inspect startup items and clean only individual temporary files older than one day. Important services are never stopped." action={<button className="button button-outline" onClick={onRefresh} disabled={busy != null}><RefreshCw size={14} /> REFRESH REVIEW</button>} />
      <AppCard className="optimize-principle"><div className="optimize-shield"><ShieldCheck size={21} /></div><div><span className="eyebrow"><i /> SAFETY / FIRST</span><h3>Review what will change. Every time.</h3><p>CSRIFT does not apply background tweaks, edit your registry, stop Windows services, or make changes without your explicit confirmation.</p></div><span className="policy-badge">NO SILENT CHANGES</span></AppCard>
      <div className="optimize-grid">
        <AppCard className="cleanup-card"><div className="card-heading"><div><span className="eyebrow"><i /> TEMPORARY FILES / WINDOWS</span><h3>A measured cleanup.</h3></div><Trash2 size={17} className="muted-icon" /></div><p>Review files directly inside your user temporary folder that have been untouched for more than 24 hours. Active files, folders, and system locations are skipped.</p><div className="temp-summary"><div><span>ELIGIBLE FILES</span><b>{scan?.eligibleFiles ?? '—'}</b></div><div><span>SPACE TO REVIEW</span><b>{scan ? bytes(scan.totalBytes) : '—'}</b></div></div><div className="temp-path">{scan?.directory ?? 'Folder scan required'}</div><div className="cleanup-actions"><button className="button button-outline" onClick={() => void onScan()} disabled={busy != null}><Search size={14} /> {busy === 'scan' ? 'SCANNING…' : 'SCAN AGAIN'}</button><button className="button button-primary" onClick={() => void onCleanup()} disabled={!scan?.eligibleFiles || busy != null}><Trash2 size={14} /> {busy === 'cleanup' ? 'CLEANING…' : 'REVIEW & CLEAN'}</button></div><span className="cleanup-footnote"><Shield size={12} /> Files in use or less than 24 hours old are skipped.</span></AppCard>
        <AppCard className="startup-card"><div className="card-heading"><div><span className="eyebrow"><i /> LOGIN / STARTUP ITEMS</span><h3>Your startup, in plain sight.</h3></div><Settings2 size={17} className="muted-icon" /></div><p>Entries are read from Windows startup registry keys. CSRIFT will not disable or remove an item automatically.</p>{startup?.length ? <div className="startup-list">{startup.map((entry) => <div className="startup-row" key={`${entry.source}-${entry.name}`}><span className="startup-icon"><Activity size={13} /></span><span><b>{entry.name}</b><small>{entry.source} · {entry.command}</small></span><span className="read-only-badge">REVIEW</span></div>)}</div> : startup ? <EmptyState icon={CheckCircle2} title="No registry startup entries found" detail="This scan checks the current-user and system Run keys only." /> : <div className="row-placeholder"><LoaderCircle size={14} className="spin" />Reading startup registry entries</div>}<div className="read-only-note"><ShieldCheck size={14} /><span>Read-only. To manage login startup, use Windows Settings → Apps → Startup.</span></div></AppCard>
      </div>
      <AppCard className="power-note"><span className="power-icon"><Zap size={15} /></span><div><b>Windows power plan · {powerPlan?.name ?? 'unavailable'}</b><p>{powerPlan?.guid ? `Active plan ${powerPlan.guid}.` : 'The active plan could not be identified.'} CSRIFT reads this setting only and does not change it.</p></div><span className="not-scanned">{powerPlan?.available ? 'READ ONLY' : 'UNAVAILABLE'}</span></AppCard>
    </div>
  )
}

function RecoveryPage({ backups, profiles, activity, onRefresh, onRestore, onOpenData }: { backups: ConfigBackup[]; profiles: ConfigProfile[]; activity: ActivityItem[]; onRefresh: () => void; onRestore: (id: string) => Promise<void>; onOpenData: () => Promise<void> }) {
  return (
    <div className="page-stack">
      <SectionTitle overline="BACKUPS / CHANGE HISTORY" title="Nothing changed behind your back." detail="Every history item is local. Supported restores create a safety copy first and ask before replacing files." action={<button className="button button-outline" onClick={onRefresh}><RefreshCw size={14} /> REFRESH RECORDS</button>} />
      <div className="recovery-summary-grid"><AppCard className="recovery-summary"><span className="recovery-summary-icon"><FileArchive size={17} /></span><span className="eyebrow">LOCAL BACKUPS</span><strong>{backups.length.toString().padStart(2, '0')}</strong><small>ON THIS PC</small></AppCard><AppCard className="recovery-summary"><span className="recovery-summary-icon"><FileCog size={17} /></span><span className="eyebrow">SAVED PROFILES</span><strong>{profiles.length.toString().padStart(2, '0')}</strong><small>JSON MANIFESTS</small></AppCard><AppCard className="recovery-summary recovery-location"><span className="recovery-summary-icon"><HardDrive size={17} /></span><span className="eyebrow">STORAGE</span><strong>LOCAL</strong><small>PRIVATE APP DATA</small><button className="text-button" onClick={() => void onOpenData()}>OPEN FOLDER <ExternalLink size={13} /></button></AppCard></div>
      <div className="recovery-columns"><AppCard><div className="card-heading"><div><span className="eyebrow"><i /> CONFIG / BACKUP HISTORY</span><h3>Recoverable snapshots.</h3></div><FileClock size={17} className="muted-icon" /></div>{backups.length ? <div className="backup-history-list">{backups.map((backup, index) => <div className="backup-history-row" key={backup.id}><span className="history-rail"><i />{index < backups.length - 1 && <b />}</span><span className="backup-time">{new Date(backup.createdAtMs).toLocaleString()}</span><span className="backup-details"><b>{backup.files.length} settings files</b><small>{backup.directory}</small></span><span className="history-available"><CheckCircle2 size={13} /> SAVED</span><button className="icon-action" onClick={() => void onRestore(backup.id)} title="Restore this backup"><RotateCcw size={14} /></button></div>)}</div> : <EmptyState icon={FileArchive} title="No backups yet" detail="Back up your CS2 settings before changing or restoring them." />}</AppCard><AppCard><div className="card-heading"><div><span className="eyebrow"><i /> APP / LOCAL ACTIVITY</span><h3>Recent CSRIFT actions.</h3></div><History size={17} className="muted-icon" /></div>{activity.length ? <div className="activity-list">{activity.slice(0, 9).map((item) => <div className="activity-row" key={item.id}><span className={`activity-check ${item.tone}`}>{item.tone === 'success' ? <Check size={12} /> : <Activity size={12} />}</span><span><b>{item.title}</b><small>{item.detail}</small></span><time>{new Date(item.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</time></div>)}</div> : <EmptyState icon={History} title="No recent actions" detail="When you complete a local CSRIFT action, it will appear here." />}</AppCard></div>
      <div className="notice-card"><ShieldCheck size={17} /><div><b>Restores are carefully scoped</b><p>Only configuration files recorded in CSRIFT backups can be restored. Each restore automatically makes another backup first.</p></div></div>
    </div>
  )
}

function SettingsPage({ settings, dataPath, saveSettings, notify }: { settings: DesktopSettings; dataPath: string | null; saveSettings: (next: DesktopSettings) => Promise<void>; notify: (title: string, message: string, tone?: Toast['tone']) => void }) {
  const update = async (key: keyof DesktopSettings, value: DesktopSettings[keyof DesktopSettings]) => {
    const next = { ...settings, [key]: value } as DesktopSettings
    try {
      await saveSettings(next)
      notify('Settings saved', 'Your preference was saved locally on this PC.', 'success')
    } catch (error) {
      notify('Settings were not saved', String(error), 'error')
    }
  }
  return (
    <div className="page-stack">
      <SectionTitle overline="YOUR APP / YOUR PREFERENCES" title="Make CSRIFT yours." detail="Preferences are stored in a local JSON file on this PC. No account or synchronization service is used." />
      <div className="settings-columns"><AppCard className="settings-card"><div className="card-heading"><div><span className="eyebrow"><i /> EXPERIENCE</span><h3>Your workspace.</h3></div><Settings2 size={17} className="muted-icon" /></div><SettingRow icon={Monitor} title="Accent finish" detail="A restrained highlight, used consistently across the app."><select className="setting-select" value={settings.accent} onChange={(event) => void update('accent', event.target.value as DesktopSettings['accent'])}><option value="ember">Ember · CSRIFT orange</option><option value="amber">Amber · warm gold</option></select></SettingRow><SettingRow icon={Sparkles} title="Intro animation" detail="Show the short branded introduction when the app launches."><Toggle checked={settings.introEnabled} onChange={(checked) => void update('introEnabled', checked)} label="Intro animation" /></SettingRow><SettingRow icon={Activity} title="Reduce motion" detail="Use shorter transitions and suppress decorative movement."><Toggle checked={settings.reduceMotion} onChange={(checked) => void update('reduceMotion', checked)} label="Reduce motion" /></SettingRow><SettingRow icon={Bell} title="In-app notifications" detail="Choose whether local actions create toast notifications."><Toggle checked={settings.notificationsEnabled} onChange={(checked) => void update('notificationsEnabled', checked)} label="In-app notifications" /></SettingRow></AppCard><AppCard className="settings-card"><div className="card-heading"><div><span className="eyebrow"><i /> APPLICATION</span><h3>Local by design.</h3></div><ShieldCheck size={17} className="muted-icon" /></div><SettingRow icon={Activity} title="Language" detail="CSRIFT is currently available in English. Korean support is planned."><select className="setting-select" value="en" disabled aria-label="Application language"><option value="en">English</option></select></SettingRow><SettingRow icon={Zap} title="Start on sign-in" detail="Automatic startup integration is not configured in this preview build."><span className="planned-badge">NOT CONFIGURED</span></SettingRow><SettingRow icon={HardDrive} title="Application data" detail={dataPath ?? 'Reading the local CSRIFT application-data folder.'}><span className="local-data-badge"><ShieldCheck size={12} /> LOCAL</span></SettingRow><div className="about-block"><div className="about-logo"><span>C</span><div><b>CSRIFT</b><small>YOUR ENVIRONMENT. UNDER CONTROL.</small></div></div><div className="about-version"><span>APPLICATION VERSION</span><b>0.1.0 · PREVIEW</b><span>CS2-INDEPENDENT / WINDOWS 10 + 11</span></div></div><p className="license-note">Not affiliated with, endorsed by, or sponsored by Valve Corporation.</p></AppCard></div>
    </div>
  )
}

function SettingRow({ icon: Icon, title, detail, children }: { icon: LucideIcon; title: string; detail: string; children: ReactNode }) {
  return <div className="setting-row"><span className="setting-icon"><Icon size={15} /></span><div className="setting-copy"><b>{title}</b><small>{detail}</small></div><div className="setting-control">{children}</div></div>
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <button type="button" className={`toggle ${checked ? 'is-on' : ''}`} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><i /></button>
}

function WindowControls() {
  if (!isTauri()) return null
  const appWindow = getCurrentWindow()
  return (
    <div className="window-controls" data-tauri-drag-region="false" aria-label="Window controls">
      <button title="Minimize" aria-label="Minimize window" onClick={() => void appWindow.minimize()}><Minus size={13} /></button>
      <button title="Toggle maximize" aria-label="Toggle maximize" onClick={() => void appWindow.toggleMaximize()}><Maximize2 size={12} /></button>
      <button className="close-control" title="Close" aria-label="Close window" onClick={() => void appWindow.close()}><X size={14} /></button>
    </div>
  )
}

function BootIntro({ onSkip, reduceMotion }: { onSkip: () => void; reduceMotion: boolean }) {
  return <motion.div className="boot-intro" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0.15 : 0.5 }}><motion.div className="intro-eye" initial={{ opacity: 0, scale: .94, filter: 'blur(10px)' }} animate={{ opacity: .8, scale: 1, filter: 'blur(0px)' }} transition={{ duration: reduceMotion ? .15 : .65 }}><img src="/images/csrift-eyes-cutout.png" alt="" /></motion.div><motion.div className="intro-wordmark" initial={{ opacity: 0, y: 7, filter: 'blur(7px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ delay: reduceMotion ? 0 : .3, duration: reduceMotion ? .15 : .45 }}><span>C</span><b>CSRIFT</b></motion.div><div className="intro-progress"><i /></div><button className="intro-skip" onClick={onSkip}>SKIP INTRO <ArrowRight size={13} /></button></motion.div>
}

const activityStorageKey = 'csrift-desktop-activity-v1'

function readActivity(): ActivityItem[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(activityStorageKey) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is ActivityItem => typeof item?.id === 'number' && typeof item?.title === 'string').slice(0, 20) : []
  } catch {
    return []
  }
}

function readPingHistory(): PingResult[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('csrift-desktop-ping-history-v1') ?? '[]')
    return Array.isArray(value)
      ? value.filter((item): item is PingResult => typeof item?.target === 'string' && typeof item?.measuredAtMs === 'number').slice(-6)
      : []
  } catch {
    return []
  }
}

function DesktopApp() {
  const [page, setPage] = useState<PageId>('dashboard')
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null)
  const [telemetryHistory, setTelemetryHistory] = useState<number[]>([])
  const [latestPing, setLatestPing] = useState<PingResult | null>(null)
  const [pingHistory, setPingHistory] = useState<PingResult[]>(readPingHistory)
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null)
  const [backups, setBackups] = useState<ConfigBackup[]>([])
  const [profiles, setProfiles] = useState<ConfigProfile[]>([])
  const [startupEntries, setStartupEntries] = useState<StartupEntry[] | null>(null)
  const [tempScan, setTempScan] = useState<TempScan | null>(null)
  const [activePowerPlan, setActivePowerPlan] = useState<PowerPlan | null>(null)
  const [settings, setSettings] = useState<DesktopSettings>(defaultSettings)
  const [dataPath, setDataPath] = useState<string | null>(null)
  const [activity, setActivity] = useState<ActivityItem[]>(readActivity)
  const [monitoring, setMonitoring] = useState(false)
  const [booting, setBooting] = useState(true)
  const [introEnabledOnBoot, setIntroEnabledOnBoot] = useState(false)
  const [loadingSnapshot, setLoadingSnapshot] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ title: string; detail: string; confirmLabel: string; run: () => Promise<void> } | null>(null)
  const { toasts, notify, dismiss } = useToasts(settings.notificationsEnabled)
  const prefersReducedMotion = useReducedMotion()
  const motionDisabled = Boolean(settings.reduceMotion || prefersReducedMotion)
  const currentPage = pageCopy[page]

  const recordActivity = useCallback((title: string, detail: string, tone: ActivityItem['tone'] = 'success') => {
    setActivity((items) => [{ id: Date.now() + Math.random(), title, detail, time: Date.now(), tone }, ...items].slice(0, 20))
  }, [])

  const refreshSnapshot = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingSnapshot(true)
    try {
      const next = await invoke<SystemSnapshot>('get_system_snapshot')
      setSnapshot(next)
      if (next.cpuUsagePercent != null) {
        setTelemetryHistory((items) => [...items.slice(-23), next.cpuUsagePercent!])
      }
    } catch (error) {
      if (!quiet) notify('Windows telemetry unavailable', String(error), 'error')
    } finally {
      setLoadingSnapshot(false)
    }
  }, [notify])

  const refreshConfig = useCallback(async () => {
    try {
      const [status, savedBackups, savedProfiles] = await Promise.all([
        invoke<ConfigStatus>('get_cs2_config_status'),
        invoke<ConfigBackup[]>('list_config_backups'),
        invoke<ConfigProfile[]>('list_config_profiles'),
      ])
      setConfigStatus(status)
      setBackups(savedBackups)
      setProfiles(savedProfiles)
    } catch (error) {
      notify('Could not read local CS2 settings', String(error), 'error')
    }
  }, [notify])

  const refreshStartup = useCallback(async () => {
    try {
      setStartupEntries(await invoke<StartupEntry[]>('list_startup_entries'))
    } catch (error) {
      notify('Startup review is unavailable', String(error), 'error')
    }
  }, [notify])

  const refreshTempScan = useCallback(async (quiet = false) => {
    try {
      const result = await invoke<TempScan>('scan_temporary_files')
      setTempScan(result)
    } catch (error) {
      if (!quiet) notify('Could not scan temporary files', String(error), 'error')
    }
  }, [notify])

  const refreshPowerPlan = useCallback(async () => {
    try {
      setActivePowerPlan(await invoke<PowerPlan>('get_active_power_plan'))
    } catch (error) {
      notify('Could not read the Windows power plan', String(error), 'error')
    }
  }, [notify])

  useEffect(() => {
    let active = true
    void (async () => {
      const [savedSettings, savedDataPath] = await Promise.all([
        invoke<DesktopSettings>('load_desktop_settings'),
        invoke<string>('get_local_data_directory'),
      ])
      if (!active) return
      setSettings(savedSettings)
      setDataPath(savedDataPath)
      setIntroEnabledOnBoot(savedSettings.introEnabled)
      await Promise.all([refreshSnapshot(true), refreshConfig(), refreshStartup(), refreshTempScan(true), refreshPowerPlan()])
      if (active) {
        if (savedSettings.introEnabled) {
          window.setTimeout(() => { if (active) setBooting(false) }, savedSettings.reduceMotion ? 350 : 1450)
        } else {
          setBooting(false)
        }
      }
    })().catch((error: unknown) => {
      if (active) {
        notify('CSRIFT could not load local settings', String(error), 'error')
        setBooting(false)
      }
    })
    return () => { active = false }
  }, [notify, refreshConfig, refreshPowerPlan, refreshSnapshot, refreshStartup, refreshTempScan])

  useEffect(() => {
    try { localStorage.setItem(activityStorageKey, JSON.stringify(activity)) } catch { /* Activity stays available for this session. */ }
  }, [activity])

  useEffect(() => {
    try { localStorage.setItem('csrift-desktop-ping-history-v1', JSON.stringify(pingHistory.slice(-6))) } catch { /* Ping history stays available for this session. */ }
  }, [pingHistory])

  useEffect(() => {
    document.documentElement.dataset.accent = settings.accent
    document.documentElement.dataset.reduceMotion = String(motionDisabled)
  }, [settings.accent, motionDisabled])

  useEffect(() => {
    const delay = page === 'monitor' && monitoring ? 2200 : 12000
    const timer = window.setInterval(() => { void refreshSnapshot(true) }, delay)
    return () => window.clearInterval(timer)
  }, [monitoring, page, refreshSnapshot])

  const groups = useMemo(() => [...new Set(navigation.map((item) => item.group))], [])

  const saveSettings = async (next: DesktopSettings) => {
    await invoke('save_desktop_settings', { settings: next })
    setSettings(next)
  }

  const runPing = async (target: string) => {
    const result = await invoke<PingResult>('run_ping_test', { target })
    setLatestPing(result)
    setPingHistory((items) => [...items.slice(-5), result])
    recordActivity(`Pinged ${result.target}`, `${result.received}/${result.sent} replies · ${result.packetLossPercent}% loss`, result.received ? 'success' : 'info')
    notify(result.received ? 'Ping test complete' : 'Target did not respond', `${result.target} · ${result.received}/${result.sent} replies · ${result.packetLossPercent}% packet loss`, result.received ? 'success' : 'info')
  }

  const createBackup = async () => {
    setBusyAction('backup')
    try {
      const backup = await invoke<ConfigBackup>('create_config_backup')
      await refreshConfig()
      recordActivity('CS2 settings backed up', `${backup.files.length} file${backup.files.length === 1 ? '' : 's'} saved locally.`)
      notify('Safety backup created', `${backup.files.length} CS2 settings files saved on this PC.`, 'success')
    } catch (error) {
      notify('Backup could not be created', String(error), 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const openFolder = async () => {
    try {
      await invoke('open_cs2_config_folder')
      notify('Settings folder opened', 'Your local CS2 configuration folder is open in File Explorer.', 'success')
    } catch (error) {
      notify('Could not open the settings folder', String(error), 'error')
    }
  }

  const restoreBackup = async (id: string) => {
    const selected = backups.find((backup) => backup.id === id)
    if (!selected) return
    setConfirmAction({
      title: 'Restore these CS2 settings?',
      detail: `CSRIFT will replace ${selected.files.length} supported configuration files. A separate safety backup is created immediately before restoring.`,
      confirmLabel: 'CREATE SAFETY COPY & RESTORE',
      run: async () => {
        setBusyAction('restore')
        try {
          const safety = await invoke<ConfigBackup>('restore_config_backup', { backupId: id })
          await refreshConfig()
          recordActivity('CS2 configuration restored', `${selected.files.length} files · safety copy ${safety.id}.`)
          notify('Configuration restored', `A pre-restore safety copy is available in Recovery Center.`, 'success')
        } catch (error) {
          notify('Restore was not completed', String(error), 'error')
        } finally {
          setBusyAction(null)
        }
      },
    })
  }

  const createProfile = async (name: string, backupId: string) => {
    setBusyAction('profile')
    try {
      await invoke('create_config_profile', { name, backupId })
      await refreshConfig()
      recordActivity('Configuration profile saved', `“${name.trim()}” points to a local settings backup.`)
      notify('Profile saved', `“${name.trim()}” is available on this PC.`, 'success')
    } catch (error) {
      notify('Profile was not saved', String(error), 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const renameProfile = async (id: string, name: string) => {
    setBusyAction('profile')
    try {
      const renamed = await invoke<ConfigProfile>('rename_config_profile', { profileId: id, name })
      await refreshConfig()
      recordActivity('Configuration profile renamed', `Saved as “${renamed.name}”.`)
      notify('Profile renamed', `“${renamed.name}” is saved locally.`, 'success')
    } catch (error) {
      notify('Profile was not renamed', String(error), 'error')
    } finally {
      setBusyAction(null)
    }
  }

  const deleteProfile = async (id: string) => {
    const profile = profiles.find((item) => item.id === id)
    if (!profile) return
    setConfirmAction({
      title: `Delete “${profile.name}”?`,
      detail: 'Only the named profile is deleted. Its linked backup files are kept and remain available in Recovery Center.',
      confirmLabel: 'DELETE PROFILE',
      run: async () => {
        setBusyAction('profile')
        try {
          await invoke('delete_config_profile', { profileId: id })
          await refreshConfig()
          recordActivity('Configuration profile deleted', `“${profile.name}” removed; associated backups kept.`)
          notify('Profile removed', 'Its linked safety backup is still available.', 'success')
        } catch (error) {
          notify('Profile could not be removed', String(error), 'error')
        } finally {
          setBusyAction(null)
        }
      },
    })
  }

  const scanTemporary = async () => {
    setBusyAction('scan')
    await refreshTempScan()
    setBusyAction(null)
  }

  const cleanTemporary = async () => {
    if (!tempScan?.eligibleFiles) return
    setConfirmAction({
      title: 'Clean reviewed temporary files?',
      detail: `CSRIFT will remove only ${tempScan.eligibleFiles} top-level regular file${tempScan.eligibleFiles === 1 ? '' : 's'} older than 24 hours from your user temp folder. Folders, symlinks, active files, and system services are untouched.`,
      confirmLabel: 'CLEAN REVIEWED FILES',
      run: async () => {
        setBusyAction('cleanup')
        try {
          const result = await invoke<{ removedFiles: number; freedBytes: number; skippedFiles: number }>('clean_temporary_files')
          await refreshTempScan(true)
          recordActivity('Temporary file cleanup completed', `${result.removedFiles} files removed · ${bytes(result.freedBytes)} freed.`)
          notify(result.skippedFiles ? 'Cleanup partially completed' : 'Cleanup completed', `${result.removedFiles} files removed · ${bytes(result.freedBytes)} freed · ${result.skippedFiles} skipped.`, result.skippedFiles ? 'info' : 'success')
        } catch (error) {
          notify('Cleanup was not completed', String(error), 'error')
        } finally {
          setBusyAction(null)
        }
      },
    })
  }

  const openDataFolder = async () => {
    try {
      const path = await invoke<string>('get_local_data_directory')
      await invoke('open_local_data_folder')
      notify('Local storage stays on this PC', path, 'info')
    } catch (error) {
      notify('Could not open local data', String(error), 'error')
    }
  }

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <DashboardPage snapshot={snapshot} history={telemetryHistory} latestPing={latestPing} config={configStatus} onPage={setPage} />
      case 'fps': return <FpsPage snapshot={snapshot} history={telemetryHistory} onRefresh={() => void refreshSnapshot()} loading={loadingSnapshot} />
      case 'network': return <NetworkPage latestPing={latestPing} pingHistory={pingHistory} onPing={runPing} />
      case 'monitor': return <MonitorPage snapshot={snapshot} history={telemetryHistory} monitoring={monitoring} onToggle={() => setMonitoring((value) => !value)} onRefresh={() => void refreshSnapshot()} loading={loadingSnapshot} />
      case 'config': return <ConfigPage status={configStatus} backups={backups} profiles={profiles} busy={busyAction} onBackup={createBackup} onOpenFolder={openFolder} onRefresh={() => void refreshConfig()} onRestore={restoreBackup} onCreateProfile={createProfile} onRenameProfile={renameProfile} onDeleteProfile={deleteProfile} />
      case 'optimize': return <OptimizePage startup={startupEntries} scan={tempScan} powerPlan={activePowerPlan} busy={busyAction} onRefresh={() => { void refreshStartup(); void refreshTempScan(); void refreshPowerPlan() }} onScan={scanTemporary} onCleanup={cleanTemporary} />
      case 'recovery': return <RecoveryPage backups={backups} profiles={profiles} activity={activity} onRefresh={() => { void refreshConfig() }} onRestore={restoreBackup} onOpenData={openDataFolder} />
      case 'settings': return <SettingsPage settings={settings} dataPath={dataPath} saveSettings={saveSettings} notify={notify} />
    }
  }

  return (
    <div className={`desktop-shell ${settings.accent === 'amber' ? 'accent-amber' : ''}`}>
      <div className="titlebar" data-tauri-drag-region>
        <div className="titlebar-brand" data-tauri-drag-region><span>C</span><b>CSRIFT</b><i /></div>
        <div className="titlebar-center" data-tauri-drag-region><span>CONTROL CENTER</span><ChevronRight size={12} />{currentPage.title}</div>
        <div className="titlebar-right"><span className="local-only-label"><i /> LOCAL SESSION</span><WindowControls /></div>
      </div>

      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar-brand"><span className="brand-symbol">C</span><span><b>CSRIFT</b><small>PRECISION / CONTROL</small></span><span className="brand-presence"><i /></span></div>
          <div className="sidebar-rule" />
          <nav className="sidebar-nav" aria-label="Application pages">{groups.map((group) => <div className="nav-group" key={group}><span className="nav-group-label">{group}</span>{navigation.filter((item) => item.group === group).map((item) => { const Icon = item.icon; return <button className={`nav-item ${page === item.id ? 'is-current' : ''}`} key={item.id} onClick={() => setPage(item.id)} aria-current={page === item.id ? 'page' : undefined}><Icon size={16} strokeWidth={1.7} /><span>{item.label}</span>{page === item.id && <i className="nav-active-mark" />}</button> })}</div>)}</nav>
          <div className="sidebar-bottom">
            <div className="sidebar-system"><span className="sidebar-section-label">SYSTEM STATUS</span><div className="sidebar-health"><i className={snapshot ? 'healthy' : 'pending'} /><span>{snapshot ? 'WINDOWS CONNECTED' : 'READING SYSTEM'}</span></div><div className="sidebar-mini-metrics"><span><Cpu size={12} /> CPU <b>{percent(snapshot?.cpuUsagePercent)}</b></span><span><Activity size={12} /> RAM <b>{percent(snapshot?.memoryUsagePercent)}</b></span></div></div>
            <button className="sidebar-settings" onClick={() => setPage('settings')}><span className="side-avatar">C</span><span><b>CSRIFT DESKTOP</b><small>PREVIEW BUILD 0.1.0</small></span><ChevronDown size={13} /></button>
          </div>
        </aside>

        <main className="main-panel">
          <header className="content-header">
            <div className="content-heading"><span className="eyebrow"><i />{currentPage.eyebrow}</span><h1>{currentPage.title}</h1><p>{currentPage.description}</p></div>
            <div className="content-tools"><button className="tool-button" title="Refresh system data" onClick={() => void refreshSnapshot()} disabled={loadingSnapshot}><RefreshCw size={15} className={loadingSnapshot ? 'spin' : ''} /></button><span className="header-separator" /><button className="session-button" onClick={() => setPage('recovery')}><span className="session-icon"><ShieldCheck size={13} /></span><span><b>LOCAL & SAFE</b><small>{snapshot ? snapshot.osName ?? 'WINDOWS DESKTOP' : 'AWAITING SYSTEM'}</small></span></button></div>
          </header>

          <div className="content-scroll">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={page} className="page-transition" initial={{ opacity: 0, y: motionDisabled ? 0 : 9 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: motionDisabled ? 0 : -5 }} transition={{ duration: motionDisabled ? .08 : .22, ease: 'easeOut' }}>
                {renderPage()}
              </motion.div>
            </AnimatePresence>
            <footer className="main-footer"><span>CSRIFT / OFFLINE-CAPABLE BY DESIGN</span><span>NEVER INJECTS INTO THE GAME</span><span>0.1.0 PREVIEW</span></footer>
          </div>
        </main>
      </div>

      <AnimatePresence>{booting && introEnabledOnBoot && <BootIntro reduceMotion={motionDisabled} onSkip={() => setBooting(false)} />}</AnimatePresence>

      <AnimatePresence>{toasts.map((toast) => <motion.div key={toast.id} className={`toast toast-${toast.tone}`} initial={{ opacity: 0, y: 12, x: 8 }} animate={{ opacity: 1, y: 0, x: 0 }} exit={{ opacity: 0, y: 7, x: 8 }}><span className="toast-icon">{toast.tone === 'success' ? <CheckCircle2 size={16} /> : toast.tone === 'error' ? <CircleAlert size={16} /> : <Activity size={16} />}</span><span><b>{toast.title}</b><small>{toast.message}</small></span><button aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}><X size={13} /></button></motion.div>)}</AnimatePresence>

      <AnimatePresence>{confirmAction && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" initial={{ opacity: 0, scale: .97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .98, y: 6 }}><span className="modal-icon"><ShieldCheck size={20} /></span><span className="eyebrow"><i /> YOUR CONFIRMATION IS REQUIRED</span><h2 id="confirm-title">{confirmAction.title}</h2><p>{confirmAction.detail}</p><div className="modal-actions"><button className="button button-outline" onClick={() => setConfirmAction(null)}>CANCEL</button><button className="button button-primary" onClick={() => { const action = confirmAction; setConfirmAction(null); void action.run() }}><Check size={14} /> {confirmAction.confirmLabel}</button></div></motion.div></motion.div>}</AnimatePresence>
    </div>
  )
}

export default DesktopApp
