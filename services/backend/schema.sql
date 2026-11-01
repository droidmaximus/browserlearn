CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  polar_customer_id TEXT NOT NULL,
  polar_subscription_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  period_end INTEGER NOT NULL,
  period_key TEXT NOT NULL,
  install_id TEXT,
  remaining INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS claim_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  entitlement_id TEXT NOT NULL REFERENCES entitlements(id),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_install_id TEXT
);

CREATE TABLE IF NOT EXISTS license_issues (
  id TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL REFERENCES entitlements(id),
  install_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS compile_events (
  id TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL REFERENCES entitlements(id),
  install_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS compile_rate (
  entitlement_id TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS compile_idempotency (
  key TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
