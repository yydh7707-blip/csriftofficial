PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS steam_users (
    steam_id TEXT PRIMARY KEY,
    persona_name TEXT NOT NULL,
    avatar_url TEXT,
    profile_url TEXT NOT NULL,
    profile_updated_at INTEGER NOT NULL,
    library_json TEXT,
    library_updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS steam_sessions (
    token_hash TEXT PRIMARY KEY,
    steam_id TEXT NOT NULL REFERENCES steam_users(steam_id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS steam_sessions_expires_at
    ON steam_sessions(expires_at);

CREATE TABLE IF NOT EXISTS steam_auth_flows (
    flow_id TEXT PRIMARY KEY,
    state_hash TEXT NOT NULL,
    poll_secret_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'complete', 'cancelled', 'failed', 'consumed')),
    steam_id TEXT REFERENCES steam_users(steam_id) ON DELETE CASCADE,
    handoff_code TEXT,
    error_code TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS steam_auth_flows_expires_at
    ON steam_auth_flows(expires_at);

CREATE TABLE IF NOT EXISTS steam_openid_nonces (
    response_nonce TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_rate_limits (
    bucket TEXT NOT NULL,
    subject_hash TEXT NOT NULL,
    window_started_at INTEGER NOT NULL,
    request_count INTEGER NOT NULL,
    PRIMARY KEY (bucket, subject_hash)
);
