# CSRIFT Cloudflare API

This Worker implements Steam OpenID 2.0 sign-in, short-lived desktop handoff codes, revocable bearer sessions, profile lookup, and cached owned-game lookup. Steam credentials are entered only on Steam Community. `STEAM_API_KEY` is a Worker secret and must never be placed in frontend configuration.

## Local setup

From the repository root:

```powershell
npm install
npm run api:dev
```

For local Steam callback testing, use the HTTPS tunnel URL printed by Wrangler and configure `STEAM_OPENID_RETURN_URL` and `PUBLIC_SITE_URL` in `workers/wrangler.jsonc`. Copy `.dev.vars.example` to `.dev.vars` and provide a Steam Web API key there; `.dev.vars` is ignored by Wrangler and must not be committed.

## Cloudflare deployment

The production D1 database `csrift-production` is provisioned and migration `0001_init.sql` has been applied. The database binding and ID are in `workers/wrangler.jsonc`.

The Worker is deployed at `https://csrift-api.yydh7707.workers.dev` and uses that hostname for its Steam OpenID callback. The existing website remains on Render and its Gabia DNS has not been changed. Confirm the API responds at `https://csrift-api.yydh7707.workers.dev/health`.

To move later to `api.csrift.xyz`, first add `csrift.xyz` as a Cloudflare zone, import and verify the existing Render, mail, and TXT DNS records, then update nameservers at Gabia only after reviewing the imported records. Set the Worker route and callback to the new hostname before deploying. Do not change nameservers until the existing records are verified.

Steam sign-in also requires the site owner's Steam Web API key. Add it as a Cloudflare secret from the repository root:

```powershell
npx wrangler secret put STEAM_API_KEY --config workers/wrangler.jsonc
```

Paste the key only into Wrangler's local prompt. Never put it in chat, frontend configuration, `.dev.vars.example`, or source control. The OpenID callback is fixed to `https://csrift-api.yydh7707.workers.dev/v1/auth/steam/callback`; Steam passwords are entered only on Steam Community.

## Desktop Steam session

The desktop app opens the Steam sign-in page in the system browser. The Worker verifies the full OpenID response server-side and returns a short-lived, single-use handoff code to the requesting desktop flow. The resulting bearer token is kept in app memory, expires after 30 days, and is revoked on disconnect. Closing CSRIFT clears the in-memory token; reconnect from the app on the next launch.

Steam does not provide private game libraries through `GetOwnedGames`. Such responses are surfaced as a private/unavailable library; no games or playtime are fabricated. Local installation detection remains a separate check on the PC.
