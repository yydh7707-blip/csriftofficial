import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Activity, ArrowRight, Bell,
  Check, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, CircleHelp,
  ChevronLeft, Cpu, ExternalLink, FileArchive, FileClock, FileCog, FileSearch,
  Gauge, Gamepad2, HardDrive, HeartPulse, History, LayoutDashboard, LoaderCircle,
  Library, LogOut, Maximize2, Minus, Monitor, MoreHorizontal, Network, Pencil, Plus, RefreshCw, RotateCcw,
  Save, Search, Settings2, Shield, ShieldCheck, Sparkles, Square, Trash2,
  TriangleAlert, Wifi, X, Zap,
  type LucideIcon,
} from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type WheelEvent } from 'react'
import type { PanInfo } from 'framer-motion'
import { readOnboarding, ONBOARDING_STORAGE_KEY, type AppLanguage, type LegalConsent, type OnboardingProgress } from './onboarding-state'

const OnboardingFlow = lazy(() => import('./onboarding').then((module) => ({ default: module.OnboardingFlow })))
const LegalDocumentsDialog = lazy(() => import('./onboarding').then((module) => ({ default: module.LegalDocumentsDialog })))

type PageId = 'dashboard' | 'library' | 'fps' | 'network' | 'monitor' | 'config' | 'optimize' | 'recovery' | 'settings'
type GameId = 'cs2' | 'pubg' | 'valorant' | 'fc-online'
type GameInstallation = { gameId: GameId; installPath: string; executablePath: string; source: 'STEAM' | 'RIOT' | 'NEXON' | 'MANUAL' }
type GameProfile = {
  id: GameId
  name: string
  subtitle: string
  description: string
  banner: string
  logo?: string
  accent: string
  accentSoft: string
  platform: string
}

const gameProfiles: GameProfile[] = [
  { id: 'cs2', name: 'COUNTER-STRIKE 2', subtitle: 'PRECISION / COMPETITIVE FPS', description: 'Bring your CS2 installation, local configuration and Windows performance tools into one focused workspace.', banner: '/assets/cs2-banner.png', accent: '#f28c28', accentSoft: 'rgba(242,140,40,.12)', platform: 'STEAM · APP 730' },
  { id: 'pubg', name: 'PUBG: BATTLEGROUNDS', subtitle: 'SURVIVAL / BATTLE ROYALE', description: 'Keep an eye on your local system and connection while your PUBG install stays clearly identified.', banner: '/assets/pubg-banner.png', accent: '#d8a85e', accentSoft: 'rgba(216,168,94,.12)', platform: 'STEAM · APP 578080' },
  { id: 'valorant', name: 'VALORANT', subtitle: 'TACTICAL / COMPETITIVE FPS', description: 'Locate the Riot client installation and use CSRIFT’s PC-wide monitoring and network tools.', banner: '/assets/valorant-banner.png', accent: '#ff5364', accentSoft: 'rgba(255,83,100,.12)', platform: 'RIOT CLIENT · NON-STEAM' },
  { id: 'fc-online', name: 'EA SPORTS FC ONLINE', subtitle: 'FOOTBALL / NEXON', description: 'Find your Nexon installation and keep real Windows performance and network signals close at hand.', banner: '/assets/fc-online-banner.png', logo: '/assets/fc-online-mark.png', accent: '#00d879', accentSoft: 'rgba(0,216,121,.12)', platform: 'NEXON · NON-STEAM' },
]

const MANUAL_GAME_PATHS_KEY = 'csrift-desktop-manual-game-paths-v1'

function readManualGamePaths(): Partial<Record<GameId, string>> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(MANUAL_GAME_PATHS_KEY) ?? '{}')
    if (stored == null || typeof stored !== 'object' || Array.isArray(stored)) return {}
    return Object.fromEntries(gameProfiles.flatMap(({ id }) => {
      const path = (stored as Record<string, unknown>)[id]
      return typeof path === 'string' && path.trim() ? [[id, path]] : []
    }))
  } catch {
    return {}
  }
}

function readSelectedGame(): GameId {
  try {
    const stored = localStorage.getItem('csrift-desktop-selected-game-v1')
    return gameProfiles.some((game) => game.id === stored) ? stored as GameId : 'cs2'
  } catch {
    return 'cs2'
  }
}

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
  runningGameIds: GameId[]
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
  jitterMs: number | null
  latenciesMs: string[]
  measuredAtMs: number
}

type ConfigStatus = { detected: boolean; path: string | null; files: string[]; changedFiles: string[]; comparedBackupId: string | null }
type ConfigBackup = { id: string; createdAtMs: number; files: string[]; directory: string }
type ConfigProfile = { id: string; name: string; createdAtMs: number; backupId: string; files: string[] }
type StartupEntry = { name: string; command: string; source: string }
type TempScan = { directory: string; eligibleFiles: number; totalBytes: number }
type PowerPlan = { name: string | null; guid: string | null; available: boolean }
type Cs2OptimizationStatus = { gameModeEnabled: boolean | null; activePowerPlan: PowerPlan; highPerformanceAvailable: boolean; canRestoreGameMode: boolean; canRestorePowerPlan: boolean }
type Cs2OptimizationSetting = 'gameMode' | 'powerPlan'
type DnsServer = { address: string }
type GameDetection = { detected: boolean; installPath: string | null; steamPaths: string[]; libraryPaths: string[]; executableFound: boolean; configFiles: string[]; launchOptionsFound: boolean; steamRunning: boolean; source: string | null }
type ScanProgress = { step: string; percent: number }
type ScanFinding = { label: string; status: 'GOOD' | 'NEEDS ATTENTION' | 'NOT SUPPORTED'; detail: string; recommendation: string }
type ScanReport = { completedAtMs: number; durationMs: number; findings: ScanFinding[]; goodCount: number; attentionCount: number; unsupportedCount: number }
type DesktopSettings = { accent: 'ember' | 'amber'; reduceMotion: boolean; introEnabled: boolean; notificationsEnabled: boolean }
type Toast = { id: number; title: string; message: string; tone: 'success' | 'error' | 'info' }
type ActivityItem = { id: number; title: string; detail: string; time: number; tone: 'success' | 'info' }
type SteamProfile = { steamId: string; personaName: string; avatarUrl: string | null; profileUrl: string }
type SteamSession = { accessToken: string; expiresAt: number; profile: SteamProfile }
type SteamGame = { appId: number; name: string; playtimeForeverMinutes: number; iconUrl: string | null }
type SteamLibrary = { games: SteamGame[]; syncedAt: number; cached: boolean }
type InstalledSteamGame = { appId: number; installPath: string }
type SteamAuthFlow = { flowId: string; pollSecret: string; loginUrl: string; expiresInSeconds: number }
type SteamAuthPoll = { status: 'pending' | 'cancelled' | 'failed' | 'complete'; error?: string; profile?: SteamProfile }

const STEAM_API_BASE = (import.meta.env.VITE_CSRIFT_API_URL || 'https://csrift-api.yydh7707.workers.dev').replace(/\/+$/, '')

const steamErrors: Record<string, string> = {
  AUTH_CANCELLED: 'Steam 로그인이 취소되었습니다.',
  AUTH_FAILED: 'Steam 인증에 실패했습니다. 다시 시도해 주세요.',
  AUTH_RESPONSE_EXPIRED: 'Steam 인증 응답이 만료되었습니다. 다시 시도해 주세요.',
  AUTH_FLOW_NOT_FOUND: '인증 요청이 만료되었습니다. 다시 연결해 주세요.',
  AUTH_HANDOFF_UNAVAILABLE: '인증이 만료되었거나 이미 완료되었습니다. 다시 연결해 주세요.',
  AUTH_HANDOFF_ALREADY_USED: '인증이 이미 처리되었습니다. 다시 연결해 주세요.',
  INVALID_AUTH_RESPONSE: 'Steam 인증 응답을 확인할 수 없습니다. 다시 시도해 주세요.',
  OPENID_VERIFICATION_FAILED: 'Steam에서 인증 응답을 확인하지 못했습니다.',
  SESSION_EXPIRED: 'Steam 연결이 만료되었습니다. 다시 연결해 주세요.',
  STEAM_API_KEY_MISSING: '서버에 Steam Web API 키가 아직 설정되지 않았습니다.',
  STEAM_API_UNAVAILABLE: 'Steam 게임 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
  STEAM_LIBRARY_PRIVATE: 'Steam 게임 세부 정보가 비공개이거나 Steam에서 제공되지 않습니다. Steam 개인정보 설정에서 게임 세부 정보를 공개한 뒤 다시 동기화해 주세요.',
  STEAM_PROFILE_UNAVAILABLE: 'Steam 프로필 정보를 불러오지 못했습니다.',
  TOO_MANY_REQUESTS: '요청이 너무 많습니다. 잠시 기다린 뒤 다시 시도해 주세요.',
}

async function steamApiRequest<T>(path: string, accessToken?: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${STEAM_API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new Error('CSRIFT 서버에 연결할 수 없습니다. 인터넷 연결이나 서버 배포 상태를 확인해 주세요.')
  }
  const payload = await response.json().catch(() => null) as { error?: string } | null
  if (!response.ok) {
    const code = payload?.error ?? (response.status === 401 ? 'SESSION_EXPIRED' : 'SERVICE_UNAVAILABLE')
    throw new Error(steamErrors[code] ?? `CSRIFT 서버 요청에 실패했습니다 (${response.status}). 잠시 후 다시 시도해 주세요.`)
  }
  return payload as T
}

function waitForAuthPoll(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Authentication cancelled', 'AbortError'))
      return
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, delayMs)
    const abort = () => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(new DOMException('Authentication cancelled', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

const navigation: { id: PageId; label: string; icon: LucideIcon; group: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'OVERVIEW' },
  { id: 'library', label: 'Game Library', icon: Library, group: 'PLAY' },
  { id: 'fps', label: 'FPS Center', icon: Gauge, group: 'PLAY' },
  { id: 'network', label: 'Network Lab', icon: Wifi, group: 'PLAY' },
  { id: 'monitor', label: 'System Monitor', icon: Activity, group: 'PLAY' },
  { id: 'config', label: 'CS2 Config', icon: Gamepad2, group: 'MANAGE' },
  { id: 'optimize', label: 'Windows Optimize', icon: Zap, group: 'MANAGE' },
  { id: 'recovery', label: 'Recovery Center', icon: History, group: 'MANAGE' },
  { id: 'settings', label: 'Settings', icon: Settings2, group: 'PREFERENCES' },
]

const pageCopy: Record<PageId, { title: string; eyebrow: string; description: string }> = {
  dashboard: { title: 'Game Center', eyebrow: 'ONE CONTROL ROOM / YOUR GAMES', description: 'Browse your PC game profiles, verify local installations and open the tools CSRIFT can actually support.' },
  library: { title: 'Game Library', eyebrow: 'STEAM / OWNED GAMES', description: 'Browse games reported by Steam and keep ownership separate from local installation detection.' },
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
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const notify = useCallback((title: string, message: string, tone: Toast['tone'] = 'info') => {
    if (!enabledRef.current && tone !== 'error') return
    const id = Date.now() + Math.random()
    setToasts((items) => [...items.slice(-3), { id, title, message, tone }])
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4600)
  }, [])

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

function SteamMark() {
  return <img className="steam-mark" src="/images/steam-logo-circle.png" alt="" aria-hidden="true" />
}

function AppCard({ className = '', children }: { className?: string; children: ReactNode }) {
  return <section className={`app-card ${className}`}>{children}</section>
}

function SteamConnectionCard({ profile, gameCount, loading, onConnect, onLibrary, onDisconnect }: {
  profile: SteamProfile | null
  gameCount: number | null
  loading: boolean
  onConnect: () => void
  onLibrary: () => void
  onDisconnect: () => void
}) {
  return (
    <AppCard className={`steam-connection-card ${profile ? 'is-connected' : ''}`}>
      <span className="steam-card-icon"><SteamMark /></span>
      <div className="steam-card-copy">
        <span className="eyebrow"><i /> STEAM / GAME LIBRARY</span>
        <h3>{profile ? `CONNECTED TO STEAM · ${profile.personaName}` : 'Connect your Steam account.'}</h3>
        <p>{profile ? `${profile.steamId} · ${gameCount == null ? 'Library has not been synced' : `${gameCount} games reported by Steam`}` : 'Connect your Steam account to discover your game library and manage your games with CSRIFT.'}</p>
      </div>
      {profile ? <>
        <span className="steam-connected-pill"><i /> CONNECTED</span>
        <button className="button button-outline" onClick={onLibrary} disabled={loading}><Library size={13} /> {loading ? 'SYNCING…' : 'OPEN LIBRARY'}</button>
        <button className="steam-disconnect-button" title="Log out of CSRIFT. Your Steam browser session stays unchanged." aria-label="Log out of CSRIFT" onClick={onDisconnect}><LogOut size={13} /> LOG OUT</button>
      </> : <button className="button button-primary steam-connect-button" onClick={onConnect}><SteamMark /> CONNECT YOUR STEAM ACCOUNT <ArrowRight size={14} /></button>}
    </AppCard>
  )
}

function GameCarousel({ snapshot, installations, selectedGameId, gameDetection, reduceMotion, scanning, onSelectGame, onScanGames, onPickGame, onLaunchGame, onPage, onGameDetection }: {
  snapshot: SystemSnapshot | null
  installations: GameInstallation[]
  selectedGameId: GameId
  gameDetection: GameDetection | null
  reduceMotion: boolean
  scanning: boolean
  onSelectGame: (gameId: GameId) => void
  onScanGames: () => void
  onPickGame: (gameId: GameId) => void
  onLaunchGame: (installation: GameInstallation) => void
  onPage: (page: PageId) => void
  onGameDetection: () => void
}) {
  const activeIndex = Math.max(0, gameProfiles.findIndex((game) => game.id === selectedGameId))
  const game = gameProfiles[activeIndex]
  const [slideDirection, setSlideDirection] = useState(1)
  const wheelCooldown = useRef<number | null>(null)
  const installation = installations.find((item) => item.gameId === game.id)
    ?? (game.id === 'cs2' && gameDetection?.detected && gameDetection.installPath && gameDetection.executableFound
      ? { gameId: 'cs2', installPath: gameDetection.installPath, executablePath: gameDetection.installPath, source: 'MANUAL' as const }
      : undefined)
  const running = snapshot?.runningGameIds.includes(game.id) === true
  const profileStyle = { '--game-accent': game.accent, '--game-accent-soft': game.accentSoft } as CSSProperties
  const move = (direction: -1 | 1) => {
    setSlideDirection(direction)
    const next = (activeIndex + direction + gameProfiles.length) % gameProfiles.length
    onSelectGame(gameProfiles[next].id)
  }
  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x < -72 || info.velocity.x < -520) move(1)
    if (info.offset.x > 72 || info.velocity.x > 520) move(-1)
  }
  const handleHorizontalWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaX) < 20 || Math.abs(event.deltaX) < Math.abs(event.deltaY)) return
    event.preventDefault()
    if (wheelCooldown.current != null) return
    move(event.deltaX > 0 ? 1 : -1)
    wheelCooldown.current = window.setTimeout(() => { wheelCooldown.current = null }, 320)
  }
  useEffect(() => {
    for (const profile of gameProfiles) {
      const image = new Image()
      image.src = profile.banner
    }
  }, [])
  useEffect(() => () => {
    if (wheelCooldown.current != null) window.clearTimeout(wheelCooldown.current)
  }, [])

  return (
    <section className="game-hub" style={profileStyle} aria-label="Game management">
      <div className="game-hub-heading"><div><span className="eyebrow"><i /> CSRIFT / GAME MANAGEMENT</span><h2>ONE CONTROL ROOM.<br /><span>YOUR GAMES.</span></h2></div><span className="game-hub-count">{String(activeIndex + 1).padStart(2, '0')} <i /> {String(gameProfiles.length).padStart(2, '0')}</span></div>
      <div className="game-carousel-shell" onWheel={handleHorizontalWheel}>
        <button className="game-carousel-arrow game-carousel-prev" onClick={() => move(-1)} aria-label="Previous game"><ChevronLeft size={19} /></button>
        <AnimatePresence mode="wait" initial={false}>
        <motion.div
          className="game-carousel-banner"
          key={game.id}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={.06}
          onDragEnd={handleDragEnd}
          whileDrag={{ cursor: 'grabbing', scale: .995 }}
          initial={{ opacity: reduceMotion ? 1 : .76, x: reduceMotion ? 0 : slideDirection * 18 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: reduceMotion ? 1 : 0, x: reduceMotion ? 0 : slideDirection * -18 }}
          transition={{ duration: reduceMotion ? .08 : .32, ease: [.22, .7, .2, 1] }}
          style={{ backgroundImage: `linear-gradient(90deg,rgba(6,8,10,.42),rgba(6,8,10,.04) 86%),url("${game.banner}")` }}
        >
          <div className="game-carousel-copy">
            <span className="game-platform-label">{game.logo ? <img src={game.logo} alt="" /> : <i />}{game.platform}</span>
            <span className="game-carousel-subtitle">{game.subtitle}</span>
            <h3>{game.name}</h3>
            <p>{game.description}</p>
            <div className="game-carousel-status">
              <span className={running ? 'is-running' : installation ? 'is-installed' : ''}><i />{running ? 'RUNNING' : installation ? 'INSTALLED · VERIFIED' : 'NOT DETECTED'}</span>
              {installation && <code title={installation.installPath}>{installation.installPath}</code>}
            </div>
            <div className="game-carousel-actions">
              <button className="button button-primary game-hub-primary" onClick={installation ? () => onLaunchGame(installation) : onScanGames} disabled={scanning}>{scanning ? <LoaderCircle size={14} className="spin" /> : <Gamepad2 size={15} />}{scanning ? 'SEARCHING…' : installation ? 'LAUNCH GAME' : 'FIND THIS GAME'}{!scanning && <ArrowRight size={14} />}</button>
              {game.id === 'cs2'
                ? <button className="button button-outline" onClick={onGameDetection}><Search size={14} /> GAME DETECTION</button>
                : <button className="button button-outline" onClick={() => onPickGame(game.id)}><ExternalLink size={14} /> SELECT GAME EXE</button>}
            </div>
          </div>
          <span className="game-banner-index">CSRIFT&nbsp; / &nbsp;{game.id.toUpperCase()}</span>
          <span className="game-banner-platform">{game.platform}</span>
        </motion.div>
        </AnimatePresence>
        <button className="game-carousel-arrow game-carousel-next" onClick={() => move(1)} aria-label="Next game"><ChevronRight size={19} /></button>
      </div>
      <div className="game-carousel-footer">
        <div className="game-carousel-dots" role="tablist" aria-label="Select a game">{gameProfiles.map((profile, index) => <button key={profile.id} className={profile.id === game.id ? 'is-active' : ''} style={{ '--dot-accent': profile.accent } as CSSProperties} onClick={() => { setSlideDirection(index >= activeIndex ? 1 : -1); onSelectGame(profile.id) }} role="tab" aria-selected={profile.id === game.id} aria-label={`Show ${profile.name}`}><span />{String(index + 1).padStart(2, '0')}<small>{profile.name}</small></button>)}</div>
        <div className="game-hub-tools">
          <span className="game-hub-tool-label">AVAILABLE TOOLS</span>
          <button onClick={() => onPage('monitor')}><Activity size={13} />SYSTEM MONITOR</button>
          <button onClick={() => onPage('fps')}><Gauge size={13} />FRAME / SYSTEM</button>
          <button onClick={() => onPage('network')}><Network size={13} />NETWORK LAB</button>
          {game.id === 'cs2' && <button onClick={() => onPage('config')}><FileCog size={13} />CS2 CONFIG</button>}
          {game.id !== 'cs2' && <span className="game-tools-note">No game files or graphics settings are modified.</span>}
        </div>
      </div>
      <div className="game-hub-management">
        <div><span className="eyebrow"><i /> GAME-SCOPED CONTROL</span><b>{game.name}</b><small>{game.id === 'cs2' ? 'Config backups, system tools, network diagnostics and local detection.' : 'Windows telemetry, measured network diagnostics, installation path and verified launch only.'}</small></div>
        <div><span className="game-hub-capability"><CheckCircle2 size={12} /> SYSTEM MONITOR</span><span className="game-hub-capability"><CheckCircle2 size={12} /> NETWORK / JITTER</span><span className="game-hub-capability"><CheckCircle2 size={12} /> INSTALL / LAUNCH</span>{game.id === 'cs2' && <span className="game-hub-capability"><CheckCircle2 size={12} /> CONFIG BACKUP</span>}</div>
        <p>In-game FPS and graphics telemetry are not read by CSRIFT. Frame stability is shown through measured Windows CPU / memory samples; no FPS value is estimated.</p>
      </div>
    </section>
  )
}

function DashboardPage({
  snapshot, history, latestPing, config, gameDetection, steamSession, steamLibrary,
  steamLibraryLoading, installations, selectedGameId, onSelectGame, onScanGames, onPickGame,
  onLaunchGame, onPage, onGameDetection, onConnectSteam, onOpenLibrary, onDisconnectSteam, reduceMotion, scanning,
}: {
  snapshot: SystemSnapshot | null; history: number[]; latestPing: PingResult | null; config: ConfigStatus | null; gameDetection: GameDetection | null
  steamSession: SteamSession | null; steamLibrary: SteamLibrary | null; steamLibraryLoading: boolean
  installations: GameInstallation[]; selectedGameId: GameId; onSelectGame: (gameId: GameId) => void
  reduceMotion: boolean
  scanning: boolean
  onScanGames: () => void; onPickGame: (gameId: GameId) => void; onLaunchGame: (installation: GameInstallation) => void
  onPage: (page: PageId) => void; onGameDetection: () => void; onConnectSteam: () => void
  onOpenLibrary: () => void; onDisconnectSteam: () => void
}) {
  const systemClear = snapshot != null && snapshot.cpuUsagePercent != null && snapshot.cpuUsagePercent < 85 && snapshot.memoryUsagePercent != null && snapshot.memoryUsagePercent < 92
  const selectedGame = gameProfiles.find((game) => game.id === selectedGameId) ?? gameProfiles[0]
  const steamSupported = selectedGame.id === 'cs2' || selectedGame.id === 'pubg'
  return (
    <div className="page-stack">
      <GameCarousel
        snapshot={snapshot}
        installations={installations}
        selectedGameId={selectedGameId}
        gameDetection={gameDetection}
        reduceMotion={reduceMotion}
        scanning={scanning}
        onSelectGame={onSelectGame}
        onScanGames={onScanGames}
        onPickGame={onPickGame}
        onLaunchGame={onLaunchGame}
        onPage={onPage}
        onGameDetection={onGameDetection}
      />

      {steamSupported && <SteamConnectionCard
        profile={steamSession?.profile ?? null}
        gameCount={steamLibrary?.games.length ?? null}
        loading={steamLibraryLoading}
        onConnect={onConnectSteam}
        onLibrary={onOpenLibrary}
        onDisconnect={onDisconnectSteam}
      />}

      <div className="status-ribbon">
        <span className={`system-beacon ${systemClear ? 'is-good' : 'is-review'}`}><i /></span>
        <div><strong>{snapshot ? systemClear ? 'SYSTEM IN RANGE' : 'SYSTEM CHECK' : 'CONNECTING TO WINDOWS'}</strong><small>{snapshot?.osName ?? 'Reading local hardware signals'}</small></div>
        <span className="ribbon-divider" />
        <span className="cs-status"><i className={snapshot?.runningGameIds.includes(selectedGame.id) ? 'is-active' : ''} /><span>{selectedGame.name} {snapshot ? snapshot.runningGameIds.includes(selectedGame.id) ? 'RUNNING' : 'NOT RUNNING' : 'CHECKING'}</span></span>
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
          {selectedGame.id === 'cs2' && <button className="quick-row" onClick={() => onPage('config')}><span className="quick-icon"><FileCog size={15} /></span><span><b>CS2 CONFIG</b><small>{config?.detected ? `${config.files.length} supported files found` : 'Check for local settings'}</small></span><ChevronRight size={15} /></button>}
          <button className="quick-row" onClick={() => onPage('optimize')}><span className="quick-icon"><Sparkles size={15} /></span><span><b>WINDOWS OPTIMIZE</b><small>Review before you make a change</small></span><ChevronRight size={15} /></button>
        </AppCard>
      </div>

      <div className="micro-footnote"><span><i /> CPU / MEMORY / PROCESS DATA FROM WINDOWS</span><span>NO FPS PROMISES. JUST A CLEARER PICTURE.</span></div>
    </div>
  )
}

function SteamLibraryPage({ session, library, installedGames, installCheckComplete, installError, localLoading, localError, loading, error, onConnect, onSync, onDisconnect, onRefreshLocal }: {
  session: SteamSession | null
  library: SteamLibrary | null
  installedGames: InstalledSteamGame[]
  installCheckComplete: boolean
  installError: string | null
  localLoading: boolean
  localError: string | null
  loading: boolean
  error: string | null
  onConnect: () => void
  onSync: () => void
  onDisconnect: () => void
  onRefreshLocal: () => void
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'name' | 'playtime'>('name')
  const [installedOnly, setInstalledOnly] = useState(false)
  const installedByAppId = useMemo(() => new Map(installedGames.map((game) => [game.appId, game])), [installedGames])
  const filteredGames = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return [...(library?.games ?? [])]
      .filter((game) => !search || game.name.toLocaleLowerCase().includes(search) || String(game.appId).includes(search))
      .filter((game) => !installedOnly || !installCheckComplete || installedByAppId.has(game.appId))
      .sort((left, right) => sort === 'name'
        ? left.name.localeCompare(right.name)
        : right.playtimeForeverMinutes - left.playtimeForeverMinutes)
  }, [installedByAppId, installCheckComplete, installedOnly, library, query, sort])
  const installedCount = library?.games.filter((game) => installedByAppId.has(game.appId)).length ?? 0

  return (
    <div className="page-stack">
      <SectionTitle
        overline="STEAM / OWNED GAMES"
        title="Your library, on your terms."
        detail="Steam ownership comes from your account. Local installation is verified separately on this PC."
        action={session
          ? <div className="toolbar-actions"><button className="button button-outline" onClick={onSync} disabled={loading}><RefreshCw size={13} className={loading ? 'spin' : ''} /> {loading ? 'SYNCING…' : 'SYNC LIBRARY'}</button><button className="button button-outline" title="Revoke the CSRIFT session; this does not sign you out of Steam Community." aria-label="Log out of CSRIFT" onClick={onDisconnect}><LogOut size={13} /> LOG OUT</button></div>
          : <button className="button button-primary" onClick={onConnect}><Gamepad2 size={14} /> CONNECT YOUR STEAM ACCOUNT</button>}
      />
      <AppCard className="local-steam-games">
        <div className="card-heading"><div><span className="eyebrow"><i /> LOCAL / STEAM APP MANIFESTS</span><h3>Installed on this PC</h3></div><button className="button button-outline" onClick={onRefreshLocal} disabled={localLoading}><RefreshCw size={13} className={localLoading ? 'spin' : ''} /> {localLoading ? 'SCANNING…' : 'SCAN PC'}</button></div>
        <p className="local-steam-description">Read-only scan of Steam library folders on this PC. This works independently of Steam sign-in and the Steam Web API.</p>
        {localError ? <div className="steam-library-error"><CircleAlert size={14} />{localError}</div>
          : localLoading && !installedGames.length ? <div className="local-steam-empty"><LoaderCircle size={15} className="spin" /> SCANNING STEAM LIBRARIES</div>
            : installedGames.length ? <div className="local-steam-list">{installedGames.map((game) => <div className="local-steam-row" key={game.appId}><span className="local-steam-appid">APP {game.appId}</span><b>{game.appId === 730 ? 'COUNTER-STRIKE 2' : `STEAM GAME · ${game.appId}`}</b><code title={game.installPath}>{game.installPath}</code><span className={`library-tag ${game.appId === 730 ? 'supported' : 'unsupported'}`}>{game.appId === 730 ? 'CSRIFT SUPPORTED' : 'NOT SUPPORTED'}</span></div>)}</div>
              : <div className="local-steam-empty"><HardDrive size={16} /> NO INSTALLED STEAM GAMES DETECTED</div>}
      </AppCard>
      {session && <AppCard className="library-account-card">
        {session.profile.avatarUrl ? <img src={session.profile.avatarUrl} alt="" className="library-avatar" referrerPolicy="no-referrer" /> : <span className="library-avatar library-avatar-fallback"><Gamepad2 size={18} /></span>}
        <div className="library-account-copy"><span className="steam-connected-pill"><i /> CONNECTED</span><b>{session.profile.personaName}</b><small>STEAM ID · {session.profile.steamId}</small></div>
        <div className="library-account-stats"><span><b>{library?.games.length ?? '—'}</b><small>OWNED / REPORTED</small></span><span><b>{installCheckComplete ? installedCount : '—'}</b><small>{installCheckComplete ? 'DETECTED ON THIS PC' : 'LOCAL CHECK PENDING'}</small></span><span><b>{library ? new Date(library.syncedAt * 1000).toLocaleString() : '—'}</b><small>LAST SYNC</small></span></div>
      </AppCard>}
      {error && <div className="steam-library-error"><CircleAlert size={15} /><span>{error}</span><button className="text-button" onClick={onSync}>TRY AGAIN <ArrowRight size={13} /></button></div>}
      {installError && <div className="steam-library-error"><CircleAlert size={15} /><span>{installError}</span></div>}
      {!session
        ? <AppCard className="library-empty"><Library size={27} /><h3>Connect Steam to view your games.</h3><p>Sign-in happens on Steam Community. Your Steam password is never entered into CSRIFT.</p><button className="button button-primary" onClick={onConnect}><Gamepad2 size={14} /> CONNECT YOUR STEAM ACCOUNT <ArrowRight size={14} /></button></AppCard>
        : <AppCard className="library-games-card">
          <div className="library-tools"><label className="library-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search games or App ID" aria-label="Search Steam games" /></label><label className="library-sort"><span>SORT</span><select value={sort} onChange={(event) => setSort(event.target.value as 'name' | 'playtime')}><option value="name">Name</option><option value="playtime">Play time</option></select></label><label className="library-installed-filter"><input type="checkbox" checked={installedOnly} disabled={!installCheckComplete} onChange={(event) => setInstalledOnly(event.target.checked)} /> INSTALLED ON THIS PC</label></div>
          {loading && !library ? <div className="library-empty"><LoaderCircle size={20} className="spin" /><p>Loading your Steam library…</p></div>
            : filteredGames.length ? <div className="library-game-grid">{filteredGames.map((game) => {
              const installation = installedByAppId.get(game.appId)
              const detectedCs2 = installCheckComplete && game.appId === 730 && installation != null
              const playHours = Math.floor(game.playtimeForeverMinutes / 60)
              const playMinutes = game.playtimeForeverMinutes % 60
              return <article className="library-game-card" key={game.appId}>
                <div className="library-game-art">{game.iconUrl ? <img src={game.iconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true }} /> : <Gamepad2 size={22} />}</div>
                <div className="library-game-details"><h3 title={game.name}>{game.name}</h3><small>STEAM APP ID · {game.appId}</small><div className="library-game-tags"><span className="library-tag owned">OWNED</span><span className={`library-tag ${!installCheckComplete ? 'not-installed' : detectedCs2 ? 'detected' : installation ? 'installed' : 'not-installed'}`}>{!installCheckComplete ? 'LOCAL CHECK UNVERIFIED' : detectedCs2 ? 'DETECTED' : installation ? 'INSTALLED' : 'NOT INSTALLED'}</span><span className={`library-tag ${game.appId === 730 ? 'supported' : 'unsupported'}`}>{game.appId === 730 ? 'CS2 SUPPORTED' : 'NOT SUPPORTED'}</span></div><p>{installation ? installation.installPath : `${playHours}h ${playMinutes}m played · ${installCheckComplete ? 'Not detected in local Steam libraries' : 'Local installation not verified'}`}</p></div>
              </article>
            })}</div> : <div className="library-empty"><Library size={22} /><h3>{library?.games.length ? 'No games match this view.' : 'Steam reported an empty library.'}</h3><p>{installedOnly ? 'No owned games were detected as installed in this PC’s Steam libraries.' : 'Steam did not report any owned games for this account.'}</p></div>}
          <p className="library-local-note"><ShieldCheck size={13} /> OWNED BY STEAM AND INSTALLED ON THIS PC ARE DIFFERENT STATES. CSRIFT ONLY MARKS VERIFIED LOCAL INSTALLATIONS.</p>
        </AppCard>}
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
        <AppCard className="ping-card"><div className="card-heading"><div><span className="eyebrow"><i /> LIVE TEST / IPV4 + IPV6</span><h3>Run a real ping.</h3></div><span className="ping-icon"><Wifi size={18} /></span></div><form className="ping-form" onSubmit={(event) => void submit(event)}><label htmlFor="ping-target">IP ADDRESS</label><div className="ping-input-row"><div className="target-prefix">IP</div><input id="ping-target" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="1.1.1.1" maxLength={45} spellCheck={false} /><button className="button button-primary" type="submit" disabled={busy || !target.trim()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Activity size={15} />} {busy ? 'TESTING' : 'RUN TEST'} <ArrowRight size={14} /></button></div></form><p className="ping-helper">Sends 4 standard ICMP echo requests using Windows <code>ping</code>. Jitter is the average absolute change between measured replies; resolver ping is not a game-server ping.</p>{error && <div className="inline-error"><CircleAlert size={14} />{error}</div>}{latestPing && <div className="ping-results"><div className="ping-result-main"><span>AVERAGE RESPONSE</span><strong>{latestPing.averageLatencyMs == null ? latestPing.received ? '<1 ms' : 'No reply' : `${latestPing.averageLatencyMs.toFixed(1)} ms`}</strong><small>{latestPing.target} · {latestPing.received}/{latestPing.sent} responses</small></div><div className="ping-result-stats"><div><span>PACKET LOSS</span><b>{latestPing.packetLossPercent}%</b></div><div><span>JITTER</span><b>{latestPing.jitterMs == null ? 'NOT ENOUGH SAMPLES' : `${latestPing.jitterMs.toFixed(1)} ms`}</b></div><div><span>RESPONSE STATUS</span><b className={latestPing.packetLossPercent === 0 ? 'status-text-good' : 'status-text-warn'}>{latestPing.packetLossPercent === 0 ? 'ALL REPLIED' : latestPing.received ? 'PACKET LOSS' : 'UNREACHABLE'}</b></div></div></div>}</AppCard>
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
      <AppCard className="optimize-principle"><div className="optimize-shield"><ShieldCheck size={21} /></div><div><span className="eyebrow"><i /> SAFETY / FIRST</span><h3>Review what will change. Every time.</h3><p>CSRIFT only changes the listed Game Mode or power-plan setting after confirmation, saves the previous value for restore, and never stops Windows services.</p></div><span className="policy-badge">NO SILENT CHANGES</span></AppCard>
      <div className="optimize-grid">
        <AppCard className="cleanup-card"><div className="card-heading"><div><span className="eyebrow"><i /> TEMPORARY FILES / WINDOWS</span><h3>A measured cleanup.</h3></div><Trash2 size={17} className="muted-icon" /></div><p>Review files directly inside your user temporary folder that have been untouched for more than 24 hours. Active files, folders, and system locations are skipped.</p><div className="temp-summary"><div><span>ELIGIBLE FILES</span><b>{scan?.eligibleFiles ?? '—'}</b></div><div><span>SPACE TO REVIEW</span><b>{scan ? bytes(scan.totalBytes) : '—'}</b></div></div><div className="temp-path">{scan?.directory ?? 'Folder scan required'}</div><div className="cleanup-actions"><button className="button button-outline" onClick={() => void onScan()} disabled={busy != null}><Search size={14} /> {busy === 'scan' ? 'SCANNING…' : 'SCAN AGAIN'}</button><button className="button button-primary" onClick={() => void onCleanup()} disabled={!scan?.eligibleFiles || busy != null}><Trash2 size={14} /> {busy === 'cleanup' ? 'CLEANING…' : 'REVIEW & CLEAN'}</button></div><span className="cleanup-footnote"><Shield size={12} /> Files in use or less than 24 hours old are skipped.</span></AppCard>
        <AppCard className="startup-card"><div className="card-heading"><div><span className="eyebrow"><i /> LOGIN / STARTUP ITEMS</span><h3>Your startup, in plain sight.</h3></div><Settings2 size={17} className="muted-icon" /></div><p>Entries are read from Windows startup registry keys. CSRIFT will not disable or remove an item automatically.</p>{startup?.length ? <div className="startup-list">{startup.map((entry) => <div className="startup-row" key={`${entry.source}-${entry.name}`}><span className="startup-icon"><Activity size={13} /></span><span><b>{entry.name}</b><small>{entry.source} · {entry.command}</small></span><span className="read-only-badge">REVIEW</span></div>)}</div> : startup ? <EmptyState icon={CheckCircle2} title="No registry startup entries found" detail="This scan checks the current-user and system Run keys only." /> : <div className="row-placeholder"><LoaderCircle size={14} className="spin" />Reading startup registry entries</div>}<div className="read-only-note"><ShieldCheck size={14} /><span>Read-only. To manage login startup, use Windows Settings → Apps → Startup.</span></div></AppCard>
      </div>
      <AppCard className="power-note"><span className="power-icon"><Zap size={15} /></span><div><b>Windows power plan · {powerPlan?.name ?? 'unavailable'}</b><p>{powerPlan?.guid ? `Active plan ${powerPlan.guid}.` : 'The active plan could not be identified.'} The CS2 session panel can activate the existing High performance plan after confirmation and save this plan for restoration.</p></div><span className="not-scanned">{powerPlan?.available ? 'REVIEW & CONFIRM' : 'UNAVAILABLE'}</span></AppCard>
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

function SettingsPage({ settings, dataPath, saveSettings, notify, language, onLanguageChange, onOpenLegal }: { settings: DesktopSettings; dataPath: string | null; saveSettings: (next: DesktopSettings) => Promise<void>; notify: (title: string, message: string, tone?: Toast['tone']) => void; language: AppLanguage; onLanguageChange: (language: AppLanguage) => void; onOpenLegal: (document: 'privacy' | 'terms') => void }) {
  const languageCopy = {
    en: { title: 'Language', detail: 'Language for first-run setup and legal documents.', privacy: 'Privacy Policy', terms: 'Terms of Service' },
    ko: { title: '언어', detail: '최초 설정과 법적 문서에 사용할 언어입니다.', privacy: '개인정보 처리방침', terms: '서비스 이용약관' },
    ja: { title: '言語', detail: '初回設定と法的文書で使用する言語です。', privacy: 'プライバシーポリシー', terms: '利用規約' },
  }[language]
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
      <div className="settings-columns"><AppCard className="settings-card"><div className="card-heading"><div><span className="eyebrow"><i /> EXPERIENCE</span><h3>Your workspace.</h3></div><Settings2 size={17} className="muted-icon" /></div><SettingRow icon={Monitor} title="Accent finish" detail="A restrained highlight, used consistently across the app."><select className="setting-select" value={settings.accent} onChange={(event) => void update('accent', event.target.value as DesktopSettings['accent'])}><option value="ember">Ember · CSRIFT orange</option><option value="amber">Amber · warm gold</option></select></SettingRow><SettingRow icon={Sparkles} title="Intro animation" detail="Show the short branded introduction when the app launches."><Toggle checked={settings.introEnabled} onChange={(checked) => void update('introEnabled', checked)} label="Intro animation" /></SettingRow><SettingRow icon={Activity} title="Reduce motion" detail="Use shorter transitions and suppress decorative movement."><Toggle checked={settings.reduceMotion} onChange={(checked) => void update('reduceMotion', checked)} label="Reduce motion" /></SettingRow><SettingRow icon={Bell} title="In-app notifications" detail="Choose whether local actions create toast notifications."><Toggle checked={settings.notificationsEnabled} onChange={(checked) => void update('notificationsEnabled', checked)} label="In-app notifications" /></SettingRow></AppCard><AppCard className="settings-card"><div className="card-heading"><div><span className="eyebrow"><i /> APPLICATION</span><h3>Local by design.</h3></div><ShieldCheck size={17} className="muted-icon" /></div><SettingRow icon={Activity} title={languageCopy.title} detail={languageCopy.detail}><select className="setting-select" value={language} onChange={(event) => onLanguageChange(event.target.value as AppLanguage)} aria-label={languageCopy.title}><option value="en">English</option><option value="ko">한국어</option><option value="ja">日本語</option></select></SettingRow><div className="settings-legal-links"><span>LEGAL DOCUMENTS / 2026-11-16</span><button onClick={() => onOpenLegal('privacy')}>{languageCopy.privacy} <ChevronRight size={13} /></button><button onClick={() => onOpenLegal('terms')}>{languageCopy.terms} <ChevronRight size={13} /></button></div><SettingRow icon={Zap} title="Start on sign-in" detail="Automatic startup integration is not configured in this preview build."><span className="planned-badge">NOT CONFIGURED</span></SettingRow><SettingRow icon={HardDrive} title="Application data" detail={dataPath ?? 'Reading the local CSRIFT application-data folder.'}><span className="local-data-badge"><ShieldCheck size={12} /> LOCAL</span></SettingRow><div className="about-block"><div className="about-logo"><span>C</span><div><b>CSRIFT</b><small>YOUR ENVIRONMENT. UNDER CONTROL.</small></div></div><div className="about-version"><span>APPLICATION VERSION</span><b>0.1.0 · PREVIEW</b><span>CS2-INDEPENDENT / WINDOWS 10 + 11</span></div></div><p className="license-note">Not affiliated with, endorsed by, or sponsored by Valve Corporation.</p><p className="settings-copyright">© 2026 CSRIFT. All rights reserved.</p></AppCard></div>
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
  return <motion.div className="boot-intro" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0.15 : 0.42 }}><motion.div className="intro-eye" initial={{ opacity: 0, scale: reduceMotion ? 1 : .97, y: reduceMotion ? 0 : 7 }} animate={{ opacity: .9, scale: 1, y: 0 }} transition={{ duration: reduceMotion ? .12 : .42, ease: [0.22, 1, 0.36, 1] }}><img src="/images/csrift-eyes-cutout.png" alt="" fetchPriority="high" decoding="async" /></motion.div><motion.div className="intro-wordmark" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduceMotion ? 0 : .16, duration: reduceMotion ? .12 : .28, ease: 'easeOut' }}><span>C</span><b>CSRIFT</b></motion.div><div className="intro-progress"><i /></div><button className="intro-skip" onClick={onSkip}>SKIP INTRO <ArrowRight size={13} /></button></motion.div>
}

function GameDetectionScreen({ detection, busy, progress, error, steamProfile, installations, selectedGameId, steamBusy, managedBusy, onSelectGame, onConnectSteam, onDisconnectSteam, onOpenLibrary, onFind, onPick, onScan, onScanManagedGame, onPickManagedGame, onLaunchGame, onContinue, onOptimize, reduceMotion }: {
  detection: GameDetection | null
  busy: boolean
  progress: ScanProgress | null
  error: string | null
  steamProfile: SteamProfile | null
  installations: GameInstallation[]
  selectedGameId: GameId
  steamBusy: boolean
  managedBusy: boolean
  onSelectGame: (gameId: GameId) => void
  onConnectSteam: () => void
  onDisconnectSteam: () => void
  onOpenLibrary: () => void
  onFind: (path?: string) => Promise<void>
  onPick: () => Promise<void>
  onScan: () => void
  onScanManagedGame: () => void
  onPickManagedGame: (gameId: GameId) => void
  onLaunchGame: (installation: GameInstallation) => void
  onContinue: () => void
  onOptimize: () => void
  reduceMotion: boolean
}) {
  const [posterUnavailable, setPosterUnavailable] = useState(false)
  const game = gameProfiles.find((profile) => profile.id === selectedGameId) ?? gameProfiles[0]
  const isCs2 = game.id === 'cs2'
  const installation = installations.find((item) => item.gameId === game.id) ?? null
  const detected = isCs2 ? detection?.detected === true : installation !== null
  const scanBusy = isCs2 ? busy : managedBusy
  const scanError = isCs2 ? error : null
  const title = game.id === 'fc-online' ? 'EA SPORTS FC ONLINE' : game.id === 'pubg' ? 'PUBG: BATTLEGROUNDS' : game.name
  return (
    <motion.main className="game-entry-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? .1 : .45 }}>
      <div className="game-entry-grid" />
      <button className="button button-outline game-detection-back" onClick={onContinue}><ChevronLeft size={14} /> BACK TO DASHBOARD</button>
      {isCs2 && <button className="button button-outline game-optimize-trigger" onClick={onOptimize}><Zap size={14} /> OPTIMIZE FOR CS2</button>}
      <div className="game-entry-copy">
        <span className="recommended-badge detection-recommended-badge"><Sparkles size={11} /> RECOMMENDED FIRST STEP</span>
        <span className="eyebrow"><i /> GAME DETECTION / {String(gameProfiles.findIndex((profile) => profile.id === game.id) + 1).padStart(3, '0')}</span>
        <h1>{isCs2 ? <>YOUR NEXT<br /><span>ROUND STARTS HERE.</span></> : <>FIND YOUR<br /><span>{game.name}.</span></>}</h1>
        <p>{isCs2 ? 'Find your local Counter-Strike 2 installation. A scan reads local game and system data and sends diagnostic pings to reachable public resolver endpoints.' : `Find your local ${game.name} installation. CSRIFT verifies supported local game paths without modifying game files.`}</p>
        <div className="game-entry-assurance"><span><ShieldCheck size={14} /> LOCAL FILE CHECK</span><span><Activity size={14} /> NO GAME MODIFICATION</span></div>
      </div>
      <motion.section className={`game-detection-card ${detected ? 'is-detected' : ''}`} style={{ '--game-accent': game.accent } as CSSProperties} initial={{ opacity: 0, y: reduceMotion ? 0 : 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduceMotion ? 0 : .12, duration: .5 }}>
        <div className="game-detection-game-picker" role="tablist" aria-label="Select a game to detect">{gameProfiles.map((profile) => <button key={profile.id} role="tab" aria-selected={profile.id === game.id} className={profile.id === game.id ? 'is-selected' : ''} style={{ '--detection-accent': profile.accent } as CSSProperties} onClick={() => { setPosterUnavailable(false); onSelectGame(profile.id) }}>{profile.name}</button>)}</div>
        <div className={`game-poster ${isCs2 ? '' : 'game-poster-wide'} ${posterUnavailable ? 'poster-fallback' : ''}`}>
          {!posterUnavailable
            ? <img src={isCs2 ? '/assets/cs2-cover.png' : game.banner} alt={`${game.name} game artwork`} onError={() => setPosterUnavailable(true)} />
            : <div className="poster-fallback-art"><span>{isCs2 ? '730' : game.platform.split(' · ')[0]}</span><b>{isCs2 ? 'CS2' : game.name}</b><i>{game.subtitle}</i><small>GAME ARTWORK NOT INCLUDED</small></div>}
          <span className="poster-index">CSRIFT / {isCs2 ? '730' : game.id.toUpperCase()}</span>
        </div>
        <div className="game-card-meta"><span className={`game-state-tag ${steamProfile && isCs2 ? 'detected' : ''}`}><i />{steamProfile && isCs2 ? 'STEAM CONNECTED' : game.platform}</span><span className="eyebrow"><i />{isCs2 ? 'STEAM APP ID / 730' : game.id === 'pubg' ? 'STEAM APP ID / 578080' : 'LOCAL GAME DETECTION'}</span></div>
        <h2>{title}</h2>
        <p className="game-detection-label">{detected ? 'GAME FOUND · VERIFIED LOCAL EXECUTABLE' : isCs2 && steamProfile ? `CONNECTED AS ${steamProfile.personaName.toUpperCase()}` : 'GAME NOT DETECTED ON THIS PC'}</p>
        {detected && (isCs2 ? detection?.installPath : installation?.installPath) && <div className="detected-path"><span>VERIFIED INSTALLATION</span><code title={isCs2 ? detection?.installPath ?? '' : installation?.installPath}>{isCs2 ? detection?.installPath : installation?.installPath}</code>{isCs2 && detection && <small>{detection.configFiles.length} CS2 settings file{detection.configFiles.length === 1 ? '' : 's'} · {detection.libraryPaths.length} Steam librar{detection.libraryPaths.length === 1 ? 'y' : 'ies'} checked</small>}</div>}
        {scanBusy && <div className="game-search-progress"><div className="game-search-label"><LoaderCircle size={13} className="spin" /><span>{isCs2 ? progress?.step ?? 'SEARCHING FOR STEAM' : 'CHECKING GAME INSTALLATIONS'}</span><b>{isCs2 ? progress?.percent ?? 0 : '…'}</b></div><div className="progress-track"><div className="progress-fill" style={{ width: `${isCs2 ? progress?.percent ?? 0 : 65}%` }} /></div></div>}
        {scanError && <p className="game-detection-error"><CircleAlert size={14} />{scanError}</p>}
        <div className="game-entry-actions">
          {isCs2 ? <>
            {steamProfile
              ? <button className="button button-primary game-primary-action" onClick={onOpenLibrary}><Library size={15} /> OPEN GAME LIBRARY <ArrowRight size={15} /></button>
              : <button className="button button-primary game-primary-action steam-connect-button" onClick={onConnectSteam} disabled={steamBusy}><SteamMark /> CONNECT YOUR STEAM ACCOUNT <ArrowRight size={15} /></button>}
            <p className="steam-connect-explainer">Connect your Steam account to discover your game library and manage your games with CSRIFT.</p>
            {steamProfile && <button className="button button-outline game-manual-action" onClick={onDisconnectSteam}><LogOut size={14} /> LOG OUT OF CSRIFT</button>}
            {detected && <button className="button button-outline game-manual-action" onClick={onScan}><EyeMark /> SCAN CS2 SYSTEM</button>}
            <button className="button button-outline game-manual-action" onClick={() => void onFind()} disabled={scanBusy}><Search size={14} /> {scanBusy ? 'SEARCHING…' : detected ? 'REFRESH LOCAL CS2 DETECTION' : 'FIND CS2 ON THIS PC'}</button>
            {!detected && <button className="button button-outline game-manual-action" onClick={() => void onPick()} disabled={scanBusy}><ExternalLink size={14} /> SELECT INSTALLATION FOLDER</button>}
          </> : <>
            {detected && installation && <button className="button button-primary game-primary-action" onClick={() => onLaunchGame(installation)}><Gamepad2 size={15} /> LAUNCH {game.name} <ArrowRight size={15} /></button>}
            <button className={`button ${detected ? 'button-outline' : 'button-primary game-primary-action'} game-manual-action`} onClick={onScanManagedGame} disabled={scanBusy}><Search size={14} /> {scanBusy ? 'SEARCHING…' : detected ? `REFRESH ${game.name} DETECTION` : `FIND ${game.name} ON THIS PC`}</button>
            <button className="button button-outline game-manual-action" onClick={() => onPickManagedGame(game.id)} disabled={scanBusy}><ExternalLink size={14} /> SELECT GAME EXECUTABLE</button>
          </>}
        </div>
        {isCs2 && detection && !detected && !busy && <button className="game-continue-link" onClick={onContinue}>CONTINUE WITHOUT CS2 <ArrowRight size={13} /></button>}
      </motion.section>
      <div className="game-entry-footer"><span>CSRIFT / LOCAL GAME CHECK</span><span>NO MEMORY ACCESS · NO INJECTION · NO ANTICHEAT INTERFERENCE</span></div>
    </motion.main>
  )
}

type SteamAuthStage = 'preparing' | 'waiting' | 'verified' | 'error'

function SteamConnectionOverlay({ stage, error, reduceMotion, onCancel, onRetry, onClose }: {
  stage: SteamAuthStage
  error: string | null
  reduceMotion: boolean
  onCancel: () => void
  onRetry: () => void
  onClose: () => void
}) {
  const connected = stage === 'verified'
  return (
    <motion.section className={`steam-auth-overlay ${connected ? 'is-connected' : ''}`} role="dialog" aria-modal="true" aria-label="Connect your Steam account" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? .1 : .28 }}>
      <div className="steam-auth-grid" />
      <motion.div className="steam-auth-card" initial={{ opacity: 0, y: reduceMotion ? 0 : 12, scale: reduceMotion ? 1 : .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: reduceMotion ? .12 : .35 }}>
        <span className="eyebrow"><i /> CSRIFT / STEAM OPENID</span>
        <h1>{connected ? 'CONNECTED TO STEAM.' : stage === 'error' ? 'CONNECTION INTERRUPTED.' : 'CONNECT YOUR STEAM ACCOUNT.'}</h1>
        <p>{connected ? 'Steam verified your account. Your library is ready to open.' : stage === 'error' ? 'Steam account connection was not completed.' : 'Sign in only on the official Steam Community page. CSRIFT never asks for or handles your Steam password.'}</p>
        <div className={`steam-auth-connection ${connected ? 'is-connected' : ''}`}>
          <div className="steam-auth-node"><span className="steam-auth-brand">C</span><small>CSRIFT</small></div>
          <div className="steam-auth-link"><i /></div>
          <div className="steam-auth-node steam-auth-node-steam"><span><SteamMark /></span><small>STEAM</small></div>
        </div>
        <div className={`steam-auth-status ${connected ? 'is-connected' : stage === 'error' ? 'is-error' : ''}`}>
          {stage !== 'error' && <LoaderCircle size={13} className={connected ? '' : 'spin'} />}
          {connected ? 'CONNECTED TO STEAM' : stage === 'error' ? 'SIGN-IN NOT COMPLETED' : stage === 'waiting' ? 'WAITING FOR STEAM CONFIRMATION' : 'PREPARING SECURE SIGN-IN'}
        </div>
        {error && <p className="steam-auth-error"><CircleAlert size={14} />{error}</p>}
        <div className="steam-auth-actions">
          {stage === 'error'
            ? <><button className="button button-outline" onClick={onClose}>CLOSE</button><button className="button button-primary" onClick={onRetry}><RefreshCw size={14} /> RETRY</button></>
            : connected
              ? <button className="button button-primary" onClick={onClose}><Library size={14} /> OPEN GAME LIBRARY <ArrowRight size={14} /></button>
              : <button className="button button-outline" onClick={onCancel}><X size={13} /> CANCEL CONNECTION</button>}
        </div>
      </motion.div>
    </motion.section>
  )
}

function HawkEyeOverlay({ progress, report, error, reduceMotion, gameDetected, onCancel, onContinue, onLaunch, onRetry, onOptimize }: {
  progress: ScanProgress
  report: ScanReport | null
  error: string | null
  reduceMotion: boolean
  gameDetected: boolean
  onCancel: () => void
  onContinue: () => void
  onLaunch: () => void
  onRetry: () => void
  onOptimize: () => void
}) {
  const completed = report != null
  return (
    <motion.section className={`hawk-overlay ${completed ? 'scan-complete' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? .12 : .42 }} aria-label={completed ? 'Scan results' : 'Hawk Eye scan in progress'}>
      <div className="hawk-backdrop-grid" />
      <motion.div className="hawk-eye-glow" animate={reduceMotion ? {} : { opacity: [.46, .74, .52], scale: [1, 1.06, 1] }} transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut' }} />
      <AnimatePresence mode="wait">
        {completed ? (
          <motion.div key="results" className="hawk-results" initial={{ opacity: 0, y: reduceMotion ? 0 : 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: reduceMotion ? .1 : .35 }}>
            <div className="hawk-results-heading"><span className="eyebrow"><i /> HAWK EYE / LOCAL SYSTEM REVIEW</span><span className="scan-finished-tag"><CheckCircle2 size={13} /> COMPLETE</span></div>
            <h1>SCAN <span>COMPLETED.</span></h1>
            <p className="hawk-results-summary">{report.goodCount} GOOD <i /> {report.attentionCount} NEEDS ATTENTION <i /> {report.unsupportedCount} NOT SUPPORTED <i /> {Math.max(5, report.durationMs / 1000).toFixed(1)} SEC</p>
            <div className="hawk-findings">{report.findings.map((item) => <article className={`hawk-finding finding-${item.status.toLowerCase().replaceAll(' ', '-')}`} key={item.label}><span className="finding-state"><i />{item.status}</span><div><h3>{item.label}</h3><p>{item.detail}</p><small>{item.recommendation}</small></div></article>)}</div>
            {error && <p className="hawk-inline-error"><CircleAlert size={14} />{error}</p>}
            <div className="hawk-result-actions">{gameDetected && <button className="button button-primary" onClick={onLaunch}><Gamepad2 size={14} /> LAUNCH COUNTER-STRIKE 2 <ArrowRight size={14} /></button>}<button className="button button-outline" onClick={onContinue}>OPEN DASHBOARD <ArrowRight size={14} /></button><button className="button button-outline" onClick={onRetry}><RefreshCw size={14} /> SCAN AGAIN</button><button className="button button-outline" onClick={onOptimize}><Zap size={14} /> OPTIMIZE FOR CS2</button></div>
            <p className="hawk-readonly-note"><ShieldCheck size={13} /> No files or settings were changed. Live ping samples use public resolver endpoints, not your CS2 match server.</p>
          </motion.div>
        ) : (
          <motion.div key="scan" className="hawk-scanning" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: .985 }} transition={{ duration: reduceMotion ? .1 : .3 }}>
            <motion.img className="hawk-eye-art" src="/images/csrift-eyes-cutout.png" alt="" initial={{ opacity: 0, scale: reduceMotion ? 1 : .92, filter: 'blur(10px)' }} animate={reduceMotion ? { opacity: .9, filter: 'blur(0px)' } : { opacity: [.75, 1, .84], scale: [1, 1.025, 1], filter: 'blur(0px)' }} transition={reduceMotion ? { duration: .12 } : { opacity: { duration: 4.2, repeat: Infinity, ease: 'easeInOut' }, scale: { duration: 6, repeat: Infinity, ease: 'easeInOut' }, filter: { duration: .6 } }} />
            <motion.i className="hawk-scan-line" animate={reduceMotion ? { opacity: .3 } : { y: ['-36vh', '36vh'], opacity: [.15, .75, .15] }} transition={reduceMotion ? { duration: .1 } : { duration: 3.8, repeat: Infinity, ease: 'easeInOut' }} />
            <span className="eyebrow"><i /> CSRIFT / HAWK EYE SYSTEM CHECK</span>
            <h1>SCANNING<span className="scan-ellipsis">...</span></h1>
            <motion.p key={progress.step} className="hawk-stage-copy" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? .1 : .24 }}>{progress.step}</motion.p>
            <div className="hawk-progress"><div className="hawk-progress-label"><span>LOCAL ANALYSIS</span><b>{progress.percent}%</b></div><div className="progress-track"><motion.div className="progress-fill" animate={{ width: `${progress.percent}%` }} transition={{ duration: reduceMotion ? .1 : .3, ease: 'easeOut' }} /></div></div>
            <button className="hawk-cancel" onClick={onCancel}><X size={13} /> CANCEL SCAN</button>
            {error && <p className="hawk-inline-error"><CircleAlert size={14} />{error}</p>}
            <p className="hawk-safety-caption">READ-ONLY REVIEW / NO GAME PROCESS INTERACTION</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}

function Cs2OptimizationPanel({ status, loading, busy, error, onClose, onApply, onRestore }: {
  status: Cs2OptimizationStatus | null
  loading: boolean
  busy: string | null
  error: string | null
  onClose: () => void
  onApply: (setting: Cs2OptimizationSetting) => void
  onRestore: (setting: Cs2OptimizationSetting) => void
}) {
  const activePlanIsHighPerformance = status?.activePowerPlan.guid?.toLowerCase() === '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'
  return (
    <motion.div className="optimization-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <motion.section className="optimization-panel" role="dialog" aria-modal="true" aria-labelledby="optimization-title" initial={{ opacity: 0, y: 12, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .99 }}>
        <div className="optimization-panel-heading"><span className="modal-icon"><Zap size={19} /></span><button className="icon-action" aria-label="Close CS2 optimization panel" onClick={onClose}><X size={15} /></button></div>
        <span className="eyebrow"><i /> USER-CONTROLLED / REVERSIBLE</span>
        <h2 id="optimization-title">Windows performance profile.</h2>
        <p className="optimization-intro">Choose each Windows setting separately. CSRIFT saves its current value before changing it, and does not promise a specific FPS or latency improvement.</p>
        {loading && <div className="optimization-loading"><LoaderCircle size={14} className="spin" /> READING CURRENT WINDOWS SETTINGS</div>}
        {error && <p className="optimization-error"><CircleAlert size={14} />{error}</p>}
        {status && <div className="optimization-settings">
          <article className="optimization-setting">
            <span className="optimization-setting-icon"><Gamepad2 size={17} /></span>
            <div className="optimization-setting-copy"><b>WINDOWS GAME MODE</b><p>{status.gameModeEnabled == null ? 'Current state is not reported.' : status.gameModeEnabled ? 'Currently enabled for this Windows user.' : 'Currently disabled for this Windows user.'} Enabling it changes one current-user setting.</p><small>{status.canRestoreGameMode ? 'PREVIOUS VALUE SAVED · RESTORE AVAILABLE' : 'NO CSRIFT CHANGE TO RESTORE'}</small></div>
            <button className={`button ${status.canRestoreGameMode ? 'button-outline' : 'button-primary'}`} disabled={busy != null || loading || (status.gameModeEnabled === true && !status.canRestoreGameMode)} onClick={() => status.canRestoreGameMode ? onRestore('gameMode') : onApply('gameMode')}>{busy === 'gameMode' ? <LoaderCircle size={13} className="spin" /> : status.canRestoreGameMode ? <RotateCcw size={13} /> : <Zap size={13} />}{status.canRestoreGameMode ? 'RESTORE' : status.gameModeEnabled ? 'ENABLED' : 'ENABLE'}</button>
          </article>
          <article className="optimization-setting">
            <span className="optimization-setting-icon"><Zap size={17} /></span>
            <div className="optimization-setting-copy"><b>HIGH PERFORMANCE POWER PLAN</b><p>{status.activePowerPlan.name ?? 'Current plan unavailable'}{activePlanIsHighPerformance ? ' · already active' : ''}. This plan may use more power and increase heat or fan activity.</p><small>{status.canRestorePowerPlan ? 'PREVIOUS PLAN SAVED · RESTORE AVAILABLE' : 'NO CSRIFT CHANGE TO RESTORE'}</small></div>
            <button className={`button ${status.canRestorePowerPlan ? 'button-outline' : 'button-primary'}`} disabled={busy != null || loading || (!status.canRestorePowerPlan && (!status.highPerformanceAvailable || activePlanIsHighPerformance))} onClick={() => status.canRestorePowerPlan ? onRestore('powerPlan') : onApply('powerPlan')}>{busy === 'powerPlan' ? <LoaderCircle size={13} className="spin" /> : status.canRestorePowerPlan ? <RotateCcw size={13} /> : <Zap size={13} />}{status.canRestorePowerPlan ? 'RESTORE' : status.highPerformanceAvailable ? activePlanIsHighPerformance ? 'ACTIVE' : 'APPLY' : 'UNAVAILABLE'}</button>
          </article>
        </div>}
        <div className="optimization-panel-footer"><ShieldCheck size={14} /><span>No services or network settings are changed. Only the two settings shown here may be changed, and every apply or restore requires confirmation.</span></div>
      </motion.section>
    </motion.div>
  )
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
  const [onboarding, setOnboarding] = useState<OnboardingProgress>(readOnboarding)
  const [onboardingStorageError, setOnboardingStorageError] = useState(false)
  const [legalDocument, setLegalDocument] = useState<'privacy' | 'terms' | null>(null)
  const [entryScreen, setEntryScreen] = useState(false)
  const [selectedGameId, setSelectedGameId] = useState<GameId>(readSelectedGame)
  const [manualGamePaths, setManualGamePaths] = useState<Partial<Record<GameId, string>>>(readManualGamePaths)
  const [managedGameInstallations, setManagedGameInstallations] = useState<GameInstallation[]>([])
  const [managedGamesBusy, setManagedGamesBusy] = useState(false)
  const [gameDetection, setGameDetection] = useState<GameDetection | null>(null)
  const [detectionBusy, setDetectionBusy] = useState(false)
  const [detectionProgress, setDetectionProgress] = useState<ScanProgress | null>(null)
  const [detectionError, setDetectionError] = useState<string | null>(null)
  const [steamSession, setSteamSession] = useState<SteamSession | null>(null)
  const [steamLibrary, setSteamLibrary] = useState<SteamLibrary | null>(null)
  const [steamInstalledGames, setSteamInstalledGames] = useState<InstalledSteamGame[]>([])
  const [steamLibraryLoading, setSteamLibraryLoading] = useState(false)
  const [steamLibraryError, setSteamLibraryError] = useState<string | null>(null)
  const [steamInstallCheckComplete, setSteamInstallCheckComplete] = useState(false)
  const [steamInstallError, setSteamInstallError] = useState<string | null>(null)
  const [steamLocalGamesLoading, setSteamLocalGamesLoading] = useState(false)
  const [steamLocalGamesError, setSteamLocalGamesError] = useState<string | null>(null)
  const [steamAuthStage, setSteamAuthStage] = useState<SteamAuthStage | null>(null)
  const [steamAuthError, setSteamAuthError] = useState<string | null>(null)
  const steamAuthAbortRef = useRef<AbortController | null>(null)
  const steamAuthFlowRef = useRef<SteamAuthFlow | null>(null)
  const [hawkEyeVisible, setHawkEyeVisible] = useState(false)
  const [hawkEyeProgress, setHawkEyeProgress] = useState<ScanProgress>({ step: 'INITIALIZING SCAN', percent: 0 })
  const [hawkEyeReport, setHawkEyeReport] = useState<ScanReport | null>(null)
  const [hawkEyeError, setHawkEyeError] = useState<string | null>(null)
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
  const [optimizationStatus, setOptimizationStatus] = useState<Cs2OptimizationStatus | null>(null)
  const [optimizationOpen, setOptimizationOpen] = useState(false)
  const [optimizationLoading, setOptimizationLoading] = useState(false)
  const [optimizationBusy, setOptimizationBusy] = useState<string | null>(null)
  const [optimizationError, setOptimizationError] = useState<string | null>(null)
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
  const language = onboarding.language ?? 'en'

  const persistOnboarding = useCallback((next: OnboardingProgress) => {
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(next))
      setOnboarding(next)
      setOnboardingStorageError(false)
      return true
    } catch {
      setOnboardingStorageError(true)
      return false
    }
  }, [])

  const chooseOnboardingLanguage = (nextLanguage: AppLanguage) => {
    persistOnboarding({ ...onboarding, language: nextLanguage, step: onboarding.completed ? 'complete' : 'legal', consent: onboarding.completed ? onboarding.consent : null })
  }

  const acceptOnboardingLegal = (consent: LegalConsent) => {
    persistOnboarding({ ...onboarding, consent, step: 'steam' })
  }

  const changeLanguage = (nextLanguage: AppLanguage) => {
    persistOnboarding({ ...onboarding, language: nextLanguage })
  }

  const finishOnboarding = useCallback(() => {
    persistOnboarding({ ...onboarding, step: 'complete', completed: true })
  }, [onboarding, persistOnboarding])

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

  const refreshOptimizationStatus = useCallback(async () => {
    setOptimizationLoading(true)
    setOptimizationError(null)
    try {
      setOptimizationStatus(await invoke<Cs2OptimizationStatus>('get_cs2_optimization_status'))
    } catch (error) {
      setOptimizationStatus(null)
      setOptimizationError(String(error))
      notify('Optimization status unavailable', String(error), 'error')
    } finally {
      setOptimizationLoading(false)
    }
  }, [notify])

  const refreshLocalSteamGames = useCallback(async () => {
    setSteamLocalGamesLoading(true)
    setSteamLocalGamesError(null)
    try {
      setSteamInstalledGames(await invoke<InstalledSteamGame[]>('list_installed_steam_games'))
    } catch (error) {
      setSteamInstalledGames([])
      setSteamLocalGamesError('Installed Steam games could not be checked on this PC.')
      notify('Local Steam library scan unavailable', String(error), 'error')
    } finally {
      setSteamLocalGamesLoading(false)
    }
  }, [notify])

  const refreshManagedGameInstallations = useCallback(async (paths: Partial<Record<GameId, string>> = readManualGamePaths()) => {
    try {
      const installations = await invoke<GameInstallation[]>('detect_managed_game_installations', { manualPaths: paths })
      setManagedGameInstallations(installations)
      return installations
    } catch (error) {
      notify('Game installation scan failed', String(error), 'error')
      return null
    }
  }, [notify])

  const refreshSteamLibrary = useCallback(async (session: SteamSession | null = steamSession) => {
    if (!session) return
    setSteamLibraryLoading(true)
    setSteamLibraryError(null)
    setSteamInstallCheckComplete(false)
    setSteamInstallError(null)
    const localGamesPromise = refreshLocalSteamGames()
    try {
      const library = await steamApiRequest<SteamLibrary>('/v1/library', session.accessToken)
      setSteamLibrary(library)
      await localGamesPromise
      setSteamInstallCheckComplete(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSteamLibraryError(message)
      if (message === steamErrors.SESSION_EXPIRED) {
        setSteamSession(null)
        setSteamLibrary(null)
        setSteamInstalledGames([])
        setSteamInstallCheckComplete(false)
        setSteamInstallError(null)
      }
      notify('Steam library could not be loaded', message, 'error')
    } finally {
      setSteamLibraryLoading(false)
    }
  }, [notify, refreshLocalSteamGames, steamSession])

  const startSteamConnection = useCallback(async () => {
    const connectingDuringOnboarding = !onboarding.completed && onboarding.step === 'steam'
    const controller = new AbortController()
    steamAuthAbortRef.current = controller
    steamAuthFlowRef.current = null
    setSteamAuthStage('preparing')
    setSteamAuthError(null)
    try {
      const flow = await steamApiRequest<SteamAuthFlow>('/v1/auth/steam/start', undefined, {
        method: 'POST',
        body: '{}',
        signal: controller.signal,
      })
      steamAuthFlowRef.current = flow
      if (isTauri()) {
        await openUrl(flow.loginUrl)
      } else {
        const popup = window.open(flow.loginUrl, '_blank', 'noopener,noreferrer')
        if (!popup) throw new Error('Steam sign-in could not be opened. Allow pop-ups and retry.')
      }
      setSteamAuthStage('waiting')

      const pollCount = Math.ceil((flow.expiresInSeconds * 1000) / 1400)
      for (let attempt = 0; attempt < pollCount; attempt += 1) {
        await waitForAuthPoll(1400, controller.signal)
        const result = await steamApiRequest<SteamAuthPoll>('/v1/auth/steam/poll', undefined, {
          method: 'POST',
          body: JSON.stringify({ flowId: flow.flowId, pollSecret: flow.pollSecret }),
          signal: controller.signal,
        })
        if (result.status === 'cancelled') throw new Error(steamErrors.AUTH_CANCELLED)
        if (result.status === 'failed') throw new Error(steamErrors[result.error ?? 'AUTH_FAILED'] ?? steamErrors.AUTH_FAILED)
        if (result.status !== 'complete') continue

        const session = await steamApiRequest<SteamSession>('/v1/auth/steam/exchange', undefined, {
          method: 'POST',
          body: JSON.stringify({ flowId: flow.flowId, pollSecret: flow.pollSecret }),
        })
        if (controller.signal.aborted) {
          try { await steamApiRequest('/v1/auth/logout', session.accessToken, { method: 'POST' }) } catch { /* The local sign-in was cancelled; the short-lived token expires if revocation is unavailable. */ }
          return
        }
        setSteamSession(session)
        setSteamAuthError(null)
        if (connectingDuringOnboarding) {
          setSteamAuthStage('verified')
          await new Promise<void>((resolve) => window.setTimeout(resolve, 1100))
          if (controller.signal.aborted) return
          setSteamAuthStage(null)
          persistOnboarding({ ...onboarding, step: 'intro' })
        } else {
          setSteamAuthStage('verified')
          setPage('library')
          setEntryScreen(false)
          notify('Steam account connected', `Signed in as ${session.profile.personaName}.`, 'success')
        }
        void refreshSteamLibrary(session)
        return
      }
      throw new Error(steamErrors.AUTH_FLOW_NOT_FOUND)
    } catch (error) {
      if (controller.signal.aborted) {
        setSteamAuthStage(null)
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      setSteamAuthError(message)
      setSteamAuthStage('error')
      notify('Steam connection was not completed', message, 'error')
    } finally {
      if (steamAuthAbortRef.current === controller) steamAuthAbortRef.current = null
      steamAuthFlowRef.current = null
    }
  }, [notify, onboarding, persistOnboarding, refreshSteamLibrary])

  const cancelSteamConnection = useCallback(() => {
    const flow = steamAuthFlowRef.current
    steamAuthAbortRef.current?.abort()
    steamAuthAbortRef.current = null
    steamAuthFlowRef.current = null
    setSteamAuthStage(null)
    setSteamAuthError(null)
    if (flow) {
      void steamApiRequest('/v1/auth/steam/cancel', undefined, {
        method: 'POST',
        body: JSON.stringify({ flowId: flow.flowId, pollSecret: flow.pollSecret }),
      }).catch((error: unknown) => notify('Could not cancel the Steam request', String(error), 'error'))
    }
  }, [notify])

  const openSteamLibrary = useCallback(() => {
    setEntryScreen(false)
    setPage('library')
    if (steamSession && !steamLibrary && !steamLibraryLoading) void refreshSteamLibrary(steamSession)
  }, [refreshSteamLibrary, steamLibrary, steamLibraryLoading, steamSession])

  const requestSteamDisconnect = useCallback(() => {
    if (!steamSession) return
    setConfirmAction({
      title: 'Log out of CSRIFT?',
      detail: 'CSRIFT will revoke its server session and clear the connected account and library data from this app session. This does not sign you out of Steam Community or change your Steam account.',
      confirmLabel: 'LOG OUT OF CSRIFT',
      run: async () => {
        try {
          await steamApiRequest('/v1/auth/logout', steamSession.accessToken, { method: 'POST' })
          setSteamSession(null)
          setSteamLibrary(null)
          setSteamInstalledGames([])
          setSteamLibraryError(null)
          setSteamInstallCheckComplete(false)
          setSteamInstallError(null)
          notify('Logged out of CSRIFT', 'The CSRIFT session was revoked. Your Steam account was not changed.', 'success')
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (message === steamErrors.SESSION_EXPIRED) {
            setSteamSession(null)
            setSteamLibrary(null)
            setSteamInstalledGames([])
            setSteamInstallCheckComplete(false)
            setSteamInstallError(null)
            setSteamLibraryError(null)
            notify('Steam session expired', 'The expired CSRIFT session was cleared. Connect again whenever you want.', 'info')
          } else {
            notify('Steam could not be disconnected', message, 'error')
          }
        }
      },
    })
  }, [notify, steamSession])

  useEffect(() => {
    try { localStorage.setItem(activityStorageKey, JSON.stringify(activity)) } catch { /* Activity stays available for this session. */ }
  }, [activity])

  useEffect(() => {
    try { localStorage.setItem('csrift-desktop-ping-history-v1', JSON.stringify(pingHistory.slice(-6))) } catch { /* Ping history stays available for this session. */ }
  }, [pingHistory])

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dataset.accent = settings.accent
    document.documentElement.dataset.reduceMotion = String(motionDisabled)
  }, [language, settings.accent, motionDisabled])

  useEffect(() => {
    try { localStorage.setItem('csrift-desktop-selected-game-v1', selectedGameId) } catch { /* Selection remains available for this session. */ }
  }, [selectedGameId])

  useEffect(() => {
    if (selectedGameId !== 'cs2' && page === 'config') setPage('dashboard')
  }, [page, selectedGameId])

  useEffect(() => {
    if (!onboarding.completed) return
    const delay = page === 'monitor' && monitoring ? 2200 : 12000
    const timer = window.setInterval(() => { void refreshSnapshot(true) }, delay)
    return () => window.clearInterval(timer)
  }, [monitoring, onboarding.completed, page, refreshSnapshot])

  const groups = useMemo(() => [...new Set(navigation.map((item) => item.group))], [])

  const saveSettings = async (next: DesktopSettings) => {
    await invoke('save_desktop_settings', { settings: next })
    setSettings(next)
  }

  const detectGame = useCallback(async (manualPath?: string) => {
    setDetectionBusy(true)
    setDetectionError(null)
    setDetectionProgress({ step: 'SEARCHING FOR STEAM', percent: 0 })
    let unlisten: (() => void) | undefined
    try {
      unlisten = await listen<ScanProgress>('game-detection-progress', (event) => setDetectionProgress(event.payload))
      const detection = await invoke<GameDetection>('detect_cs2_installation', { manualPath: manualPath ?? null })
      setGameDetection(detection)
      setDetectionProgress({ step: 'DETECTION COMPLETE', percent: 100 })
      if (manualPath && !detection.detected) {
        setDetectionError('That folder does not contain a verified CS2 executable. Select the Counter-Strike 2 installation folder.')
      }
    } catch (error) {
      setDetectionError(String(error))
      notify('CS2 detection failed', String(error), 'error')
    } finally {
      unlisten?.()
      setDetectionBusy(false)
    }
  }, [notify])

  const scanSelectedGame = async () => {
    setManagedGamesBusy(true)
    try {
      const installations = await refreshManagedGameInstallations(manualGamePaths)
      if (!installations) return
      if (selectedGameId === 'cs2') {
        await detectGame()
        if (installations.some((installation) => installation.gameId === 'cs2')) {
          notify('Counter-Strike 2 verified', 'Steam manifest and executable are present on this PC.', 'success')
        }
      } else {
        const installation = installations.find((item) => item.gameId === selectedGameId)
        const name = gameProfiles.find((game) => game.id === selectedGameId)?.name ?? selectedGameId
        notify(
          installation ? `${name} detected` : `${name} not found`,
          installation ? `Verified game executable in ${installation.installPath}` : 'No verified install was found. You can select the game executable manually.',
          installation ? 'success' : 'info',
        )
      }
    } finally {
      setManagedGamesBusy(false)
    }
  }

  const pickManagedGame = async (gameId: GameId) => {
    try {
      const executablePath = await invoke<string | null>('pick_managed_game_executable', { gameId })
      if (!executablePath) return
      const nextPaths = { ...manualGamePaths, [gameId]: executablePath }
      setManualGamePaths(nextPaths)
      localStorage.setItem(MANUAL_GAME_PATHS_KEY, JSON.stringify(nextPaths))
      const installations = await refreshManagedGameInstallations(nextPaths)
      if (installations?.some((installation) => installation.gameId === gameId)) {
        const game = gameProfiles.find((profile) => profile.id === gameId)
        notify(`${game?.name ?? gameId} path saved`, 'The selected executable was verified and is available for launch.', 'success')
      }
    } catch (error) {
      notify('Game executable could not be selected', String(error), 'error')
    }
  }

  const launchManagedGame = async (installation: GameInstallation) => {
    try {
      await invoke('launch_managed_game', { gameId: installation.gameId, executablePath: installation.executablePath })
      const game = gameProfiles.find((profile) => profile.id === installation.gameId)
      notify(`${game?.name ?? installation.gameId} launch requested`, 'CSRIFT started the verified game executable or its official launcher.', 'success')
      window.setTimeout(() => { void refreshSnapshot(true) }, 1000)
    } catch (error) {
      notify('Game could not be launched', String(error), 'error')
    }
  }

  const pickGameFolder = async () => {
    try {
      const selectedPath = await invoke<string | null>('pick_cs2_installation_directory')
      if (selectedPath) await detectGame(selectedPath)
    } catch (error) {
      setDetectionError(String(error))
      notify('Could not select the CS2 folder', String(error), 'error')
    }
  }

  const openOptimization = () => {
    setOptimizationOpen(true)
    void refreshOptimizationStatus()
  }

  const confirmOptimizationChange = (setting: Cs2OptimizationSetting, restore = false) => {
    const gameMode = setting === 'gameMode'
    setConfirmAction({
      title: restore
        ? gameMode ? 'Restore the previous Game Mode value?' : 'Restore the previous Windows power plan?'
        : gameMode ? 'Enable Windows Game Mode for CS2?' : 'Switch to High performance for CS2?',
      detail: restore
        ? gameMode
          ? 'CSRIFT will restore the exact current-user Game Mode registry value captured before its change. If Windows changed the value since then, CSRIFT will leave it untouched.'
          : 'CSRIFT will restore the power-plan GUID captured before its change. If the active plan changed outside CSRIFT, CSRIFT will leave it untouched.'
        : gameMode
          ? 'CSRIFT will save the current Game Mode value in its local recovery data, then set the current Windows user’s Game Mode value to enabled. No game files or running processes are touched.'
          : 'CSRIFT will save the currently active power-plan GUID locally, then activate the existing built-in High performance plan. It may increase power use, heat, or fan activity; CSRIFT will not create or tune a plan.',
      confirmLabel: restore ? 'RESTORE SAVED VALUE' : 'BACK UP & APPLY',
      run: async () => {
        setOptimizationBusy(setting)
        try {
          await invoke(restore ? 'restore_cs2_optimization' : 'apply_cs2_optimization', { setting })
          await refreshOptimizationStatus()
          await refreshPowerPlan()
          const label = gameMode ? 'Windows Game Mode' : 'Windows power plan'
          recordActivity(restore ? `${label} restored` : `${label} updated for CS2`, restore ? 'Previous value restored from the local CSRIFT backup.' : 'Previous value saved locally before the change.')
          notify(restore ? 'Previous setting restored' : 'CS2 setting applied', `${label} was ${restore ? 'restored' : 'updated'}.`, 'success')
        } catch (error) {
          notify(restore ? 'Setting was not restored' : 'Setting was not applied', String(error), 'error')
        } finally {
          setOptimizationBusy(null)
        }
      },
    })
  }

  const launchGame = async () => {
    try {
      await invoke('launch_cs2_game')
      setHawkEyeVisible(false)
      setEntryScreen(false)
      notify('Launching Counter-Strike 2', 'Steam received a launch request for the verified CS2 installation.', 'success')
    } catch (error) {
      notify('Could not launch Counter-Strike 2', String(error), 'error')
    }
  }

  const startHawkEyeScan = async () => {
    setHawkEyeVisible(true)
    setHawkEyeReport(null)
    setHawkEyeError(null)
    setHawkEyeProgress({ step: 'INITIALIZING SCAN', percent: 0 })
    let unlisten: (() => void) | undefined
    try {
      unlisten = await listen<ScanProgress>('hawk-eye-progress', (event) => setHawkEyeProgress(event.payload))
      const report = await invoke<ScanReport>('run_hawk_eye_scan')
      setHawkEyeReport(report)
      setHawkEyeProgress({ step: 'FINALIZING SCAN', percent: 100 })
      recordActivity('Hawk Eye scan completed', `${report.goodCount} good · ${report.attentionCount} need attention · ${report.unsupportedCount} unsupported.`)
      notify('Hawk Eye scan complete', 'Review local findings and public-resolver ping samples. No files or settings were changed.', 'success')
    } catch (error) {
      if (String(error).includes('SCAN_CANCELLED')) {
        setHawkEyeVisible(false)
        notify('Scan cancelled', 'No files or settings were changed.', 'info')
      } else {
        setHawkEyeVisible(false)
        notify('Hawk Eye scan failed', String(error), 'error')
      }
    } finally {
      unlisten?.()
    }
  }

  const cancelHawkEyeScan = async () => {
    try {
      await invoke('cancel_hawk_eye_scan')
    } catch (error) {
      setHawkEyeError(`Could not cancel the scan: ${String(error)}`)
    }
  }

  useEffect(() => {
    let active = true
    let introTimer: number | undefined
    void (async () => {
      const [savedSettings, savedDataPath] = await Promise.all([
        invoke<DesktopSettings>('load_desktop_settings'),
        invoke<string>('get_local_data_directory'),
      ])
      if (!active) return
      setSettings(savedSettings)
      setDataPath(savedDataPath)
      setIntroEnabledOnBoot(savedSettings.introEnabled)
      if (!onboarding.completed) {
        setBooting(false)
        return
      }
      if (savedSettings.introEnabled) {
        introTimer = window.setTimeout(() => { if (active) setBooting(false) }, savedSettings.reduceMotion ? 350 : 1250)
      } else {
        setBooting(false)
      }
      await Promise.all([refreshSnapshot(true), refreshConfig(), refreshStartup(), refreshTempScan(true), refreshPowerPlan(), refreshLocalSteamGames(), refreshManagedGameInstallations()])
      if (active) await detectGame()
    })().catch((error: unknown) => {
      if (active) {
        notify('CSRIFT could not load local settings', String(error), 'error')
        setBooting(false)
      }
    })
    return () => {
      active = false
      if (introTimer != null) window.clearTimeout(introTimer)
    }
  }, [detectGame, notify, onboarding.completed, refreshConfig, refreshLocalSteamGames, refreshManagedGameInstallations, refreshPowerPlan, refreshSnapshot, refreshStartup, refreshTempScan])

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
      case 'dashboard': return <DashboardPage snapshot={snapshot} history={telemetryHistory} latestPing={latestPing} config={configStatus} gameDetection={gameDetection} steamSession={steamSession} steamLibrary={steamLibrary} steamLibraryLoading={steamLibraryLoading} installations={managedGameInstallations} selectedGameId={selectedGameId} reduceMotion={motionDisabled} scanning={managedGamesBusy} onSelectGame={setSelectedGameId} onScanGames={() => { void scanSelectedGame() }} onPickGame={(gameId) => { void pickManagedGame(gameId) }} onLaunchGame={(installation) => { void launchManagedGame(installation) }} onPage={setPage} onGameDetection={() => setEntryScreen(true)} onConnectSteam={() => { void startSteamConnection() }} onOpenLibrary={openSteamLibrary} onDisconnectSteam={requestSteamDisconnect} />
      case 'library': return <SteamLibraryPage session={steamSession} library={steamLibrary} installedGames={steamInstalledGames} installCheckComplete={steamInstallCheckComplete} installError={steamInstallError} localLoading={steamLocalGamesLoading} localError={steamLocalGamesError} loading={steamLibraryLoading} error={steamLibraryError} onConnect={() => { void startSteamConnection() }} onSync={() => { void refreshSteamLibrary() }} onDisconnect={requestSteamDisconnect} onRefreshLocal={() => { void refreshLocalSteamGames() }} />
      case 'fps': return <FpsPage snapshot={snapshot} history={telemetryHistory} onRefresh={() => void refreshSnapshot()} loading={loadingSnapshot} />
      case 'network': return <NetworkPage latestPing={latestPing} pingHistory={pingHistory} onPing={runPing} />
      case 'monitor': return <MonitorPage snapshot={snapshot} history={telemetryHistory} monitoring={monitoring} onToggle={() => setMonitoring((value) => !value)} onRefresh={() => void refreshSnapshot()} loading={loadingSnapshot} />
      case 'config': return <ConfigPage status={configStatus} backups={backups} profiles={profiles} busy={busyAction} onBackup={createBackup} onOpenFolder={openFolder} onRefresh={() => void refreshConfig()} onRestore={restoreBackup} onCreateProfile={createProfile} onRenameProfile={renameProfile} onDeleteProfile={deleteProfile} />
      case 'optimize': return <OptimizePage startup={startupEntries} scan={tempScan} powerPlan={activePowerPlan} busy={busyAction} onRefresh={() => { void refreshStartup(); void refreshTempScan(); void refreshPowerPlan() }} onScan={scanTemporary} onCleanup={cleanTemporary} />
      case 'recovery': return <RecoveryPage backups={backups} profiles={profiles} activity={activity} onRefresh={() => { void refreshConfig() }} onRestore={restoreBackup} onOpenData={openDataFolder} />
      case 'settings': return <SettingsPage settings={settings} dataPath={dataPath} saveSettings={saveSettings} notify={notify} language={language} onLanguageChange={changeLanguage} onOpenLegal={setLegalDocument} />
    }
  }

  return (
    <div className={`desktop-shell ${settings.accent === 'amber' ? 'accent-amber' : ''}`}>
      <div className="titlebar" data-tauri-drag-region>
        <div className="titlebar-brand" data-tauri-drag-region><span>C</span><b>CSRIFT</b><i /></div>
        <div className="titlebar-center" data-tauri-drag-region><span>{entryScreen ? 'GAME DETECTION' : 'CONTROL CENTER'}</span><ChevronRight size={12} />{entryScreen ? gameProfiles.find((game) => game.id === selectedGameId)?.name ?? 'COUNTER-STRIKE 2' : currentPage.title}</div>
        <div className="titlebar-right"><span className="local-only-label"><i /> LOCAL SESSION</span><WindowControls /></div>
      </div>

      {entryScreen ? <GameDetectionScreen detection={gameDetection} busy={detectionBusy} progress={detectionProgress} error={detectionError} steamProfile={steamSession?.profile ?? null} installations={managedGameInstallations} selectedGameId={selectedGameId} steamBusy={steamAuthStage !== null} managedBusy={managedGamesBusy} onSelectGame={setSelectedGameId} onConnectSteam={() => { void startSteamConnection() }} onDisconnectSteam={requestSteamDisconnect} onOpenLibrary={openSteamLibrary} onFind={detectGame} onPick={pickGameFolder} onContinue={() => setEntryScreen(false)} onScan={() => { void startHawkEyeScan() }} onScanManagedGame={() => { void scanSelectedGame() }} onPickManagedGame={(gameId) => { void pickManagedGame(gameId) }} onLaunchGame={(installation) => { void launchManagedGame(installation) }} onOptimize={openOptimization} reduceMotion={motionDisabled} /> : <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar-brand"><span className="brand-symbol">C</span><span><b>CSRIFT</b><small>PRECISION / CONTROL</small></span><span className="brand-presence"><i /></span></div>
          <div className="sidebar-rule" />
          <button className={`nav-item game-detection-nav ${entryScreen ? 'is-current' : ''}`} onClick={() => setEntryScreen(true)} aria-current={entryScreen ? 'page' : undefined}><Gamepad2 size={16} strokeWidth={1.7} /><span>Game Detection</span><small className="nav-recommended">RECOMMENDED</small>{entryScreen && <i className="nav-active-mark" />}</button>
          <nav className="sidebar-nav" aria-label="Application pages">{groups.map((group) => <div className="nav-group" key={group}><span className="nav-group-label">{group}</span>{navigation.filter((item) => item.group === group && (item.id !== 'config' || selectedGameId === 'cs2')).map((item) => { const Icon = item.icon; return <button className={`nav-item ${page === item.id ? 'is-current' : ''}`} key={item.id} onClick={() => setPage(item.id)} aria-current={page === item.id ? 'page' : undefined}><Icon size={16} strokeWidth={1.7} /><span>{item.label}</span>{page === item.id && <i className="nav-active-mark" />}</button> })}</div>)}</nav>
          <div className="sidebar-bottom">
            <div className="sidebar-system"><span className="sidebar-section-label">SYSTEM STATUS</span><div className="sidebar-health"><i className={snapshot ? 'healthy' : 'pending'} /><span>{snapshot ? 'WINDOWS CONNECTED' : 'READING SYSTEM'}</span></div><div className="sidebar-mini-metrics"><span><Cpu size={12} /> CPU <b>{percent(snapshot?.cpuUsagePercent)}</b></span><span><Activity size={12} /> RAM <b>{percent(snapshot?.memoryUsagePercent)}</b></span></div></div>
            <button className="sidebar-settings" onClick={() => setPage('settings')}><span className="side-avatar">C</span><span><b>CSRIFT DESKTOP</b><small>PREVIEW BUILD 0.1.0</small></span><ChevronDown size={13} /></button>
          </div>
        </aside>

        <main className="main-panel">
          <header className="content-header">
            <div className="content-heading"><span className="eyebrow"><i />{currentPage.eyebrow}</span><h1>{currentPage.title}</h1><p>{currentPage.description}</p></div>
            <div className="content-tools"><button className="button button-primary optimize-header-button" onClick={openOptimization}><Zap size={13} /> WINDOWS PERFORMANCE</button><button className="tool-button" title="Refresh system data" onClick={() => void refreshSnapshot()} disabled={loadingSnapshot}><RefreshCw size={15} className={loadingSnapshot ? 'spin' : ''} /></button><span className="header-separator" /><button className="session-button" onClick={() => setPage('recovery')}><span className="session-icon"><ShieldCheck size={13} /></span><span><b>LOCAL & SAFE</b><small>{snapshot ? snapshot.osName ?? 'WINDOWS DESKTOP' : 'AWAITING SYSTEM'}</small></span></button></div>
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
      </div>}

      <AnimatePresence>{booting && introEnabledOnBoot && <BootIntro reduceMotion={motionDisabled} onSkip={() => setBooting(false)} />}</AnimatePresence>
      <AnimatePresence>{steamAuthStage && <SteamConnectionOverlay stage={steamAuthStage} error={steamAuthError} reduceMotion={motionDisabled} onCancel={cancelSteamConnection} onRetry={() => { void startSteamConnection() }} onClose={() => { setSteamAuthStage(null); openSteamLibrary() }} />}</AnimatePresence>
      <AnimatePresence>{hawkEyeVisible && <HawkEyeOverlay progress={hawkEyeProgress} report={hawkEyeReport} error={hawkEyeError} reduceMotion={motionDisabled} gameDetected={gameDetection?.detected === true} onCancel={() => { void cancelHawkEyeScan() }} onContinue={() => { setHawkEyeVisible(false); setEntryScreen(false) }} onLaunch={() => { void launchGame() }} onRetry={() => { void startHawkEyeScan() }} onOptimize={openOptimization} />}</AnimatePresence>

      <AnimatePresence>{optimizationOpen && <Cs2OptimizationPanel status={optimizationStatus} loading={optimizationLoading} busy={optimizationBusy} error={optimizationError} onClose={() => setOptimizationOpen(false)} onApply={(setting) => confirmOptimizationChange(setting)} onRestore={(setting) => confirmOptimizationChange(setting, true)} />}</AnimatePresence>
      {!onboarding.completed && <Suspense fallback={<div className="onboarding-loading" />}><AnimatePresence><OnboardingFlow key={language} progress={onboarding} language={language} steamConnected={steamSession !== null} steamStage={steamAuthStage} steamError={steamAuthError} reduceMotion={motionDisabled} storageError={onboardingStorageError} onChooseLanguage={chooseOnboardingLanguage} onAcceptLegal={acceptOnboardingLegal} onConnectSteam={() => { void startSteamConnection() }} onSkipSteam={() => { if (steamAuthStage && steamAuthStage !== 'verified') cancelSteamConnection(); persistOnboarding({ ...onboarding, step: 'intro' }) }} onFinish={finishOnboarding} onBackToLanguage={() => persistOnboarding({ ...onboarding, step: 'language' })} /></AnimatePresence></Suspense>}
      <AnimatePresence>{legalDocument && <Suspense fallback={<div className="onboarding-loading" />}><LegalDocumentsDialog language={language} initialTab={legalDocument} onClose={() => setLegalDocument(null)} /></Suspense>}</AnimatePresence>

      <AnimatePresence>{toasts.map((toast) => <motion.div key={toast.id} className={`toast toast-${toast.tone}`} initial={{ opacity: 0, y: 12, x: 8 }} animate={{ opacity: 1, y: 0, x: 0 }} exit={{ opacity: 0, y: 7, x: 8 }}><span className="toast-icon">{toast.tone === 'success' ? <CheckCircle2 size={16} /> : toast.tone === 'error' ? <CircleAlert size={16} /> : <Activity size={16} />}</span><span><b>{toast.title}</b><small>{toast.message}</small></span><button aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}><X size={13} /></button></motion.div>)}</AnimatePresence>

      <AnimatePresence>{confirmAction && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" initial={{ opacity: 0, scale: .97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .98, y: 6 }}><span className="modal-icon"><ShieldCheck size={20} /></span><span className="eyebrow"><i /> YOUR CONFIRMATION IS REQUIRED</span><h2 id="confirm-title">{confirmAction.title}</h2><p>{confirmAction.detail}</p><div className="modal-actions"><button className="button button-outline" onClick={() => setConfirmAction(null)}>CANCEL</button><button className="button button-primary" onClick={() => { const action = confirmAction; setConfirmAction(null); void action.run() }}><Check size={14} /> {confirmAction.confirmLabel}</button></div></motion.div></motion.div>}</AnimatePresence>
    </div>
  )
}

export default DesktopApp
