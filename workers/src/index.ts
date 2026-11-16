interface D1Result<T = unknown> {
  results?: T[]
  success: boolean
  meta: { changes: number }
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run(): Promise<D1Result>
}

interface D1Database {
  prepare(query: string): D1Statement
}

interface Env {
  DB: D1Database
  STEAM_API_KEY?: string
  PUBLIC_SITE_URL?: string
  STEAM_OPENID_RETURN_URL?: string
}

interface SteamProfile {
  steamId: string
  personaName: string
  avatarUrl: string | null
  profileUrl: string
}

interface SteamGame {
  appId: number
  name: string
  playtimeForeverMinutes: number
  iconUrl: string | null
}

interface AuthFlow {
  flow_id: string
  state_hash: string
  poll_secret_hash: string
  status: string
  steam_id: string | null
  handoff_code: string | null
  error_code: string | null
  expires_at: number
}

interface SessionRecord {
  token_hash: string
  steam_id: string
  expires_at: number
}

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
const AUTH_FLOW_TTL_SECONDS = 10 * 60
const LIBRARY_CACHE_TTL_SECONDS = 15 * 60
const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login'
const STEAM_OPENID_NAMESPACE = 'http://specs.openid.net/auth/2.0'
const STEAM_ID_PATTERN = /^https:\/\/steamcommunity\.com\/openid\/id\/([0-9]{17})\/?$/
const CORS_ORIGINS = new Set([
  'https://csrift.xyz',
  'https://www.csrift.xyz',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'http://localhost:1420',
  'http://127.0.0.1:1420',
])

function json(data: unknown, status = 200, origin?: string): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  if (origin && CORS_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
  }
  return new Response(JSON.stringify(data), { status, headers })
}

function html(title: string, message: string, status = 200): Response {
  const safeTitle = escapeHtml(title)
  const safeMessage = escapeHtml(message)
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="referrer" content="no-referrer"><title>${safeTitle} · CSRIFT</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090a0c;color:#eceef1;font:16px system-ui}main{max-width:480px;margin:24px;padding:32px;border:1px solid #292d35;background:#15181e}b{color:#ffb347;letter-spacing:.12em}p{color:#a1a7b0;line-height:1.6}</style><main><b>CSRIFT / STEAM</b><h1>${safeTitle}</h1><p>${safeMessage}</p><p>You can close this browser tab and return to CSRIFT.</p></main></html>`,
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        'Content-Type': 'text/html; charset=utf-8',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  )
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function callbackUrl(env: Env): URL {
  const value = env.STEAM_OPENID_RETURN_URL ?? 'https://api.csrift.xyz/v1/auth/steam/callback'
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.pathname !== '/v1/auth/steam/callback') {
    throw new Error('Steam OpenID callback must be a fixed HTTPS callback URL.')
  }
  return url
}

function allowedOrigin(request: Request): string | undefined {
  const origin = request.headers.get('Origin') ?? undefined
  return origin && CORS_ORIGINS.has(origin) ? origin : undefined
}

function validApiOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin')
  return !origin || CORS_ORIGINS.has(origin)
}

async function enforceRateLimit(
  env: Env,
  request: Request,
  bucket: string,
  maximum: number,
  windowSeconds: number,
): Promise<boolean> {
  const subject = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const subjectHash = await digest(subject)
  const now = Math.floor(Date.now() / 1000)
  const windowStartedAt = Math.floor(now / windowSeconds) * windowSeconds
  const row = await env.DB.prepare(
    `INSERT INTO api_rate_limits (bucket, subject_hash, window_started_at, request_count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(bucket, subject_hash) DO UPDATE SET
       request_count = CASE
         WHEN api_rate_limits.window_started_at = excluded.window_started_at
           THEN api_rate_limits.request_count + 1
         ELSE 1
       END,
       window_started_at = excluded.window_started_at
     RETURNING request_count`,
  ).bind(bucket, subjectHash, windowStartedAt).first<{ request_count: number }>()
  return (row?.request_count ?? maximum + 1) <= maximum
}

async function readJson<T>(request: Request): Promise<T | null> {
  const contentType = request.headers.get('Content-Type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) return null
  try {
    return await request.json() as T
  } catch {
    return null
  }
}

async function authenticate(request: Request, env: Env): Promise<SessionRecord | null> {
  const authorization = request.headers.get('Authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  const tokenHash = await digest(token)
  const session = await env.DB.prepare(
    'SELECT token_hash, steam_id, expires_at FROM steam_sessions WHERE token_hash = ? AND expires_at > ?',
  ).bind(tokenHash, Math.floor(Date.now() / 1000)).first<SessionRecord>()
  return session
}

function openIdSteamProfile(steamId: string): SteamProfile {
  return {
    steamId,
    personaName: 'Steam account',
    avatarUrl: null,
    profileUrl: `https://steamcommunity.com/profiles/${steamId}`,
  }
}

async function persistSteamProfile(env: Env, profile: SteamProfile): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO steam_users (steam_id, persona_name, avatar_url, profile_url, profile_updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(steam_id) DO UPDATE SET
       persona_name = excluded.persona_name,
       avatar_url = excluded.avatar_url,
       profile_url = excluded.profile_url,
       profile_updated_at = excluded.profile_updated_at`,
  ).bind(profile.steamId, profile.personaName, profile.avatarUrl, profile.profileUrl, Math.floor(Date.now() / 1000)).run()
}

async function profileForSession(env: Env, steamId: string): Promise<SteamProfile | null> {
  return env.DB.prepare(
    'SELECT steam_id AS steamId, persona_name AS personaName, avatar_url AS avatarUrl, profile_url AS profileUrl FROM steam_users WHERE steam_id = ?',
  ).bind(steamId).first<SteamProfile>()
}

function errorResponse(error: unknown, origin?: string): Response {
  if (error instanceof ApiError) {
    return json({ error: error.code }, error.status, origin)
  }
  return json({ error: 'INTERNAL_ERROR' }, 500, origin)
}

class ApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
  }
}

async function startSteamLogin(request: Request, env: Env): Promise<Response> {
  const origin = allowedOrigin(request)
  if (!validApiOrigin(request)) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, origin)
  if (!await enforceRateLimit(env, request, 'steam-start', 5, 600)) {
    return json({ error: 'TOO_MANY_REQUESTS' }, 429, origin)
  }
  const flowId = randomToken(16)
  const state = randomToken()
  const pollSecret = randomToken()
  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare(
    `INSERT INTO steam_auth_flows (flow_id, state_hash, poll_secret_hash, status, created_at, expires_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`,
  ).bind(flowId, await digest(state), await digest(pollSecret), now, now + AUTH_FLOW_TTL_SECONDS).run()

  const callback = callbackUrl(env)
  const returnTo = new URL(callback)
  returnTo.searchParams.set('flow', flowId)
  returnTo.searchParams.set('state', state)
  const loginUrl = new URL(STEAM_OPENID_ENDPOINT)
  loginUrl.searchParams.set('openid.ns', STEAM_OPENID_NAMESPACE)
  loginUrl.searchParams.set('openid.mode', 'checkid_setup')
  loginUrl.searchParams.set('openid.return_to', returnTo.toString())
  loginUrl.searchParams.set('openid.realm', `${callback.origin}/`)
  loginUrl.searchParams.set('openid.identity', 'http://specs.openid.net/auth/2.0/identifier_select')
  loginUrl.searchParams.set('openid.claimed_id', 'http://specs.openid.net/auth/2.0/identifier_select')
  return json({ flowId, pollSecret, loginUrl: loginUrl.toString(), expiresInSeconds: AUTH_FLOW_TTL_SECONDS }, 200, origin)
}

function validateOpenIdResponse(params: URLSearchParams, env: Env): { flowId: string; state: string; steamId: string } {
  const callback = callbackUrl(env)
  const flowId = params.get('flow') ?? ''
  const state = params.get('state') ?? ''
  const mode = params.get('openid.mode')
  if (!/^[a-f0-9]{32}$/.test(flowId) || !/^[a-f0-9]{64}$/.test(state)) {
    throw new ApiError('INVALID_AUTH_RESPONSE', 400)
  }
  if (mode === 'cancel') throw new ApiError('AUTH_CANCELLED', 400)
  if (mode !== 'id_res') throw new ApiError('INVALID_AUTH_RESPONSE', 400)
  if (params.get('openid.ns') !== STEAM_OPENID_NAMESPACE ||
      params.get('openid.op_endpoint') !== STEAM_OPENID_ENDPOINT) {
    throw new ApiError('INVALID_AUTH_RESPONSE', 400)
  }
  const expectedReturnTo = new URL(callback)
  expectedReturnTo.searchParams.set('flow', flowId)
  expectedReturnTo.searchParams.set('state', state)
  if (params.get('openid.return_to') !== expectedReturnTo.toString()) {
    throw new ApiError('INVALID_AUTH_RESPONSE', 400)
  }
  const signedFields = new Set((params.get('openid.signed') ?? '').split(','))
  for (const required of ['op_endpoint', 'return_to', 'response_nonce', 'claimed_id', 'identity']) {
    if (!signedFields.has(required)) throw new ApiError('INVALID_AUTH_RESPONSE', 400)
  }
  const claimedId = params.get('openid.claimed_id') ?? ''
  const identity = params.get('openid.identity') ?? ''
  const claimedMatch = STEAM_ID_PATTERN.exec(claimedId)
  if (!claimedMatch || identity !== claimedId) throw new ApiError('INVALID_STEAM_ID', 400)
  const nonce = params.get('openid.response_nonce') ?? ''
  const nonceTimestamp = Date.parse(nonce.slice(0, 20))
  if (!Number.isFinite(nonceTimestamp) || Math.abs(Date.now() - nonceTimestamp) > 10 * 60 * 1000) {
    throw new ApiError('AUTH_RESPONSE_EXPIRED', 400)
  }
  return { flowId, state, steamId: claimedMatch[1] }
}

async function verifyOpenIdWithSteam(params: URLSearchParams): Promise<boolean> {
  const body = new URLSearchParams()
  for (const [key, value] of params) {
    if (key.startsWith('openid.')) body.set(key, value)
  }
  body.set('openid.mode', 'check_authentication')
  const response = await fetch(STEAM_OPENID_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/plain' },
    body,
  })
  if (!response.ok) return false
  const text = await response.text()
  return /^is_valid:true\s*$/m.test(text)
}

async function finishSteamCallback(request: Request, env: Env): Promise<Response> {
  const params = new URL(request.url).searchParams
  let validated: ReturnType<typeof validateOpenIdResponse>
  try {
    validated = validateOpenIdResponse(params, env)
  } catch (error) {
    if (error instanceof ApiError && error.code === 'AUTH_CANCELLED') {
      const flowId = params.get('flow') ?? ''
      if (/^[a-f0-9]{32}$/.test(flowId)) {
        await env.DB.prepare(
          "UPDATE steam_auth_flows SET status = 'cancelled', error_code = ? WHERE flow_id = ? AND status = 'pending'",
        ).bind(error.code, flowId).run()
      }
      return html('Steam sign-in cancelled', 'No Steam account was connected.')
    }
    return html('Steam sign-in could not be verified', 'The authentication response was invalid or expired. Return to CSRIFT and try again.', 400)
  }

  const now = Math.floor(Date.now() / 1000)
  const flow = await env.DB.prepare(
    'SELECT * FROM steam_auth_flows WHERE flow_id = ? AND expires_at > ?',
  ).bind(validated.flowId, now).first<AuthFlow>()
  if (!flow || flow.status !== 'pending' || flow.state_hash !== await digest(validated.state)) {
    return html('Steam sign-in expired', 'This sign-in request could not be matched to the waiting CSRIFT session. Return to CSRIFT and try again.', 400)
  }
  if (!await verifyOpenIdWithSteam(params)) {
    await env.DB.prepare(
      "UPDATE steam_auth_flows SET status = 'failed', error_code = 'OPENID_VERIFICATION_FAILED' WHERE flow_id = ? AND status = 'pending'",
    ).bind(validated.flowId).run()
    return html('Steam sign-in could not be verified', 'Steam did not confirm the OpenID response. Return to CSRIFT and retry.', 400)
  }
  const nonce = params.get('openid.response_nonce')!
  const nonceInsert = await env.DB.prepare(
    'INSERT OR IGNORE INTO steam_openid_nonces (response_nonce, created_at) VALUES (?, ?)',
  ).bind(nonce, now).run()
  if (nonceInsert.meta.changes !== 1) {
    return html('Steam sign-in response already used', 'For your security, a Steam authentication response can only be used once.', 400)
  }

  const profile = openIdSteamProfile(validated.steamId)
  await persistSteamProfile(env, profile)
  const handoffCode = randomToken()
  const completed = await env.DB.prepare(
    `UPDATE steam_auth_flows
     SET status = 'complete', steam_id = ?, handoff_code = ?
     WHERE flow_id = ? AND state_hash = ? AND status = 'pending' AND expires_at > ?`,
  ).bind(validated.steamId, handoffCode, validated.flowId, flow.state_hash, now).run()
  if (completed.meta.changes !== 1) {
    return html('CSRIFT sign-in expired', 'Return to CSRIFT and start a new Steam connection.')
  }
  return html('Connected to Steam', `Steam confirmed the account ID ${validated.steamId}. Return to CSRIFT to finish connecting.`)
}

async function checkSteamLogin(request: Request, env: Env): Promise<Response> {
  const origin = allowedOrigin(request)
  if (!validApiOrigin(request)) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, origin)
  const body = await readJson<{ flowId?: string; pollSecret?: string }>(request)
  if (!body || !/^[a-f0-9]{32}$/.test(body.flowId ?? '') || !/^[a-f0-9]{64}$/.test(body.pollSecret ?? '')) {
    return json({ error: 'INVALID_REQUEST' }, 400, origin)
  }
  const flow = await env.DB.prepare(
    'SELECT * FROM steam_auth_flows WHERE flow_id = ? AND expires_at > ?',
  ).bind(body.flowId, Math.floor(Date.now() / 1000)).first<AuthFlow>()
  if (!flow || flow.poll_secret_hash !== await digest(body.pollSecret!)) {
    return json({ error: 'AUTH_FLOW_NOT_FOUND' }, 404, origin)
  }
  if (flow.status === 'cancelled') return json({ status: 'cancelled' }, 200, origin)
  if (flow.status === 'failed') return json({ status: 'failed', error: flow.error_code ?? 'AUTH_FAILED' }, 200, origin)
  if (flow.status !== 'complete' || !flow.steam_id || !flow.handoff_code) {
    return json({ status: 'pending' }, 200, origin)
  }
  const profile = await profileForSession(env, flow.steam_id)
  if (!profile) return json({ status: 'failed', error: 'STEAM_PROFILE_UNAVAILABLE' }, 200, origin)
  return json({ status: 'complete', profile }, 200, origin)
}

async function exchangeSteamHandoff(request: Request, env: Env): Promise<Response> {
  const origin = allowedOrigin(request)
  if (!validApiOrigin(request)) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, origin)
  const body = await readJson<{ flowId?: string; pollSecret?: string }>(request)
  if (!body || !/^[a-f0-9]{32}$/.test(body.flowId ?? '') || !/^[a-f0-9]{64}$/.test(body.pollSecret ?? '')) {
    return json({ error: 'INVALID_REQUEST' }, 400, origin)
  }
  const now = Math.floor(Date.now() / 1000)
  const flow = await env.DB.prepare(
    'SELECT * FROM steam_auth_flows WHERE flow_id = ? AND expires_at > ?',
  ).bind(body.flowId, now).first<AuthFlow>()
  if (!flow || flow.poll_secret_hash !== await digest(body.pollSecret!) || flow.status !== 'complete' || !flow.steam_id || !flow.handoff_code) {
    return json({ error: 'AUTH_HANDOFF_UNAVAILABLE' }, 409, origin)
  }
  const consumed = await env.DB.prepare(
    `UPDATE steam_auth_flows SET status = 'consumed', handoff_code = NULL
     WHERE flow_id = ? AND poll_secret_hash = ? AND handoff_code = ? AND status = 'complete' AND expires_at > ?
     RETURNING steam_id`,
  ).bind(body.flowId, flow.poll_secret_hash, flow.handoff_code, now).first<{ steam_id: string }>()
  if (!consumed) return json({ error: 'AUTH_HANDOFF_ALREADY_USED' }, 409, origin)

  const token = randomToken()
  const expiresAt = now + SESSION_TTL_SECONDS
  await env.DB.prepare(
    'INSERT INTO steam_sessions (token_hash, steam_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).bind(await digest(token), consumed.steam_id, now, expiresAt).run()
  const profile = await profileForSession(env, consumed.steam_id)
  if (!profile) {
    await env.DB.prepare('DELETE FROM steam_sessions WHERE token_hash = ?').bind(await digest(token)).run()
    return json({ error: 'STEAM_PROFILE_UNAVAILABLE' }, 502, origin)
  }
  return json({
    accessToken: token,
    expiresAt,
    profile,
  }, 200, origin)
}

async function cancelSteamLogin(request: Request, env: Env): Promise<Response> {
  const origin = allowedOrigin(request)
  if (!validApiOrigin(request)) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, origin)
  const body = await readJson<{ flowId?: string; pollSecret?: string }>(request)
  if (!body || !/^[a-f0-9]{32}$/.test(body.flowId ?? '') || !/^[a-f0-9]{64}$/.test(body.pollSecret ?? '')) {
    return json({ error: 'INVALID_REQUEST' }, 400, origin)
  }
  const changed = await env.DB.prepare(
    `UPDATE steam_auth_flows SET status = 'cancelled', handoff_code = NULL
     WHERE flow_id = ? AND poll_secret_hash = ? AND status = 'pending' AND expires_at > ?`,
  ).bind(body.flowId, await digest(body.pollSecret!), Math.floor(Date.now() / 1000)).run()
  return json({ ok: changed.meta.changes === 1 }, 200, origin)
}

async function steamLibrary(request: Request, env: Env, session: SessionRecord): Promise<Response> {
  const origin = allowedOrigin(request)
  if (!validApiOrigin(request)) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, origin)
  const user = await env.DB.prepare(
    'SELECT library_json, library_updated_at FROM steam_users WHERE steam_id = ?',
  ).bind(session.steam_id).first<{ library_json: string | null; library_updated_at: number | null }>()
  const now = Math.floor(Date.now() / 1000)
  if (user?.library_json && user.library_updated_at && now - user.library_updated_at < LIBRARY_CACHE_TTL_SECONDS) {
    return json({ games: JSON.parse(user.library_json) as SteamGame[], syncedAt: user.library_updated_at, cached: true }, 200, origin)
  }
  if (!env.STEAM_API_KEY) return json({ error: 'STEAM_API_KEY_MISSING' }, 503, origin)
  const url = new URL('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/')
  url.searchParams.set('key', env.STEAM_API_KEY)
  url.searchParams.set('steamid', session.steam_id)
  url.searchParams.set('include_appinfo', '1')
  url.searchParams.set('include_played_free_games', '1')
  url.searchParams.set('include_free_sub', '1')
  const upstream = await fetch(url, { headers: { Accept: 'application/json' } })
  if (upstream.status === 401 || upstream.status === 403) {
    return json({ error: 'STEAM_LIBRARY_PRIVATE' }, 403, origin)
  }
  if (!upstream.ok) return json({ error: 'STEAM_API_UNAVAILABLE' }, 502, origin)
  const payload = await upstream.json() as {
    response?: {
      game_count?: number
      games?: Array<{ appid?: number; name?: string; playtime_forever?: number; img_icon_url?: string }>
    }
  }
  const response = payload.response
  if (!response || !Number.isInteger(response.game_count) || !Array.isArray(response.games)) {
    return json({ error: 'STEAM_LIBRARY_PRIVATE' }, 403, origin)
  }
  const games: SteamGame[] = response.games
    .filter((game): game is { appid: number; name: string; playtime_forever: number; img_icon_url?: string } =>
      Number.isInteger(game.appid) && game.appid! > 0 && typeof game.name === 'string' &&
      Number.isFinite(game.playtime_forever) && game.playtime_forever! >= 0)
    .map((game) => ({
      appId: game.appid,
      name: game.name.slice(0, 200),
      playtimeForeverMinutes: Math.floor(game.playtime_forever),
      iconUrl: game.img_icon_url
        ? `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${encodeURIComponent(game.img_icon_url)}.jpg`
        : null,
    }))
  await env.DB.prepare(
    'UPDATE steam_users SET library_json = ?, library_updated_at = ? WHERE steam_id = ?',
  ).bind(JSON.stringify(games), now, session.steam_id).run()
  return json({ games, syncedAt: now, cached: false }, 200, origin)
}

function corsPreflight(request: Request): Response {
  const origin = allowedOrigin(request)
  if (!origin) return new Response(null, { status: 403 })
  const headers = new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  })
  return new Response(null, { status: 204, headers })
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const origin = allowedOrigin(request)
  if (request.method === 'OPTIONS') return corsPreflight(request)
  if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true }, 200, origin)
  if (url.pathname === '/v1/auth/steam/callback' && request.method === 'GET') {
    return finishSteamCallback(request, env)
  }
  if (url.pathname === '/v1/auth/steam/start' && request.method === 'POST') {
    try {
      return await startSteamLogin(request, env)
    } catch (error) {
      return errorResponse(error, origin)
    }
  }
  if (url.pathname === '/v1/auth/steam/poll' && request.method === 'POST') {
    try {
      return await checkSteamLogin(request, env)
    } catch (error) {
      return errorResponse(error, origin)
    }
  }
  if (url.pathname === '/v1/auth/steam/exchange' && request.method === 'POST') {
    try {
      return await exchangeSteamHandoff(request, env)
    } catch (error) {
      return errorResponse(error, origin)
    }
  }
  if (url.pathname === '/v1/auth/steam/cancel' && request.method === 'POST') {
    try {
      return await cancelSteamLogin(request, env)
    } catch (error) {
      return errorResponse(error, origin)
    }
  }
  if (url.pathname === '/v1/auth/logout' && request.method === 'POST') {
    try {
      if (!validApiOrigin(request)) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, origin)
      const session = await authenticate(request, env)
      if (!session) return json({ error: 'SESSION_EXPIRED' }, 401, origin)
      await env.DB.prepare('DELETE FROM steam_sessions WHERE token_hash = ?').bind(session.token_hash).run()
      return json({ ok: true }, 200, origin)
    } catch (error) {
      return errorResponse(error, origin)
    }
  }
  if (url.pathname === '/v1/me' && request.method === 'GET') {
    try {
      if (!validApiOrigin(request)) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, origin)
      const session = await authenticate(request, env)
      if (!session) return json({ error: 'SESSION_EXPIRED' }, 401, origin)
      const profile = await profileForSession(env, session.steam_id)
      if (!profile) return json({ error: 'STEAM_PROFILE_UNAVAILABLE' }, 404, origin)
      return json({ profile, expiresAt: session.expires_at }, 200, origin)
    } catch (error) {
      return errorResponse(error, origin)
    }
  }
  if (url.pathname === '/v1/library' && request.method === 'GET') {
    try {
      const session = await authenticate(request, env)
      if (!session) return json({ error: 'SESSION_EXPIRED' }, 401, origin)
      return await steamLibrary(request, env, session)
    } catch (error) {
      return errorResponse(error, origin)
    }
  }
  return json({ error: 'NOT_FOUND' }, 404, origin)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env)
    } catch {
      return json({ error: 'SERVICE_UNAVAILABLE' }, 503, allowedOrigin(request))
    }
  },
}
