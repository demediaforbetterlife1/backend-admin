/**
 * Database setup — SQLite via better-sqlite3.
 *
 * FIX C-01: Admin seed now requires ADMIN_SEED_PASSWORD env var,
 *           uses uppercase 'ADMIN' role, and async-safe bcrypt cost 12.
 */

const Database = require('better-sqlite3');
const path = require('path');

// FIX: Use /tmp in production (Fly.io) since app directory is read-only
const DB_PATH = process.env.DB_PATH || (process.env.NODE_ENV === 'production' 
  ? '/tmp/app.db' 
  : path.join(__dirname, '..', 'data', 'app.db'));

const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                    TEXT PRIMARY KEY,
    username              TEXT NOT NULL UNIQUE,
    email                 TEXT UNIQUE,
    phone                 TEXT UNIQUE,
    password_hash         TEXT,
    avatar                TEXT,
    role                  TEXT NOT NULL DEFAULT 'USER',
    status                TEXT NOT NULL DEFAULT 'active',
    agent_code            TEXT UNIQUE,
    svip_level            INTEGER,
    is_banned             BOOLEAN NOT NULL DEFAULT 0,
    ban_expires_at        INTEGER,
    ban_type              TEXT,
    social_provider       TEXT,
    social_provider_id    TEXT UNIQUE,
    invited_by            TEXT REFERENCES users(id),
    created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at            INTEGER NOT NULL DEFAULT (unixepoch()),
    display_name          TEXT,
    bio                   TEXT,
    gender                TEXT,
    birthday              TEXT,
    country_code          TEXT,
    interests             TEXT,
    agency_name           TEXT,
    team_size             TEXT,
    offered_services      TEXT
  );

  CREATE TABLE IF NOT EXISTS agents (
    id              TEXT PRIMARY KEY REFERENCES users(id),
    invite_code     TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'pending',
    commission_rate REAL NOT NULL DEFAULT 0.10,
    total_invites   INTEGER NOT NULL DEFAULT 0,
    active_invites  INTEGER NOT NULL DEFAULT 0,
    total_earnings  REAL NOT NULL DEFAULT 0,
    cycle_start     INTEGER NOT NULL DEFAULT (unixepoch()),
    approved_at     INTEGER,
    approved_by     TEXT REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS hosts (
    id              TEXT PRIMARY KEY REFERENCES users(id),
    status          TEXT NOT NULL DEFAULT 'pending',
    commission_rate REAL NOT NULL DEFAULT 0.50,
    total_room_time INTEGER NOT NULL DEFAULT 0,
    total_gifts     REAL NOT NULL DEFAULT 0,
    total_earnings  REAL NOT NULL DEFAULT 0,
    approved_at     INTEGER,
    approved_by     TEXT REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS invitations (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL REFERENCES agents(id),
    invitee_id  TEXT NOT NULL REFERENCES users(id),
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(agent_id, invitee_id)
  );

  CREATE TABLE IF NOT EXISTS gifts (
    id          TEXT PRIMARY KEY,
    sender_id   TEXT NOT NULL REFERENCES users(id),
    receiver_id TEXT NOT NULL REFERENCES users(id),
    room_id     TEXT,
    amount      REAL NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS earnings (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    type        TEXT NOT NULL,
    amount      REAL NOT NULL,
    ref_id      TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS targets (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    role        TEXT NOT NULL,
    metric      TEXT NOT NULL,
    goal        REAL NOT NULL,
    current     REAL NOT NULL DEFAULT 0,
    cycle       TEXT NOT NULL,
    period      TEXT NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(user_id, metric, period)
  );

  CREATE TABLE IF NOT EXISTS room_sessions (
    id          TEXT PRIMARY KEY,
    host_id     TEXT NOT NULL REFERENCES users(id),
    room_id     TEXT NOT NULL,
    started_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    ended_at    INTEGER,
    duration    INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_users_invited_by   ON users(invited_by);
  CREATE INDEX IF NOT EXISTS idx_invitations_agent  ON invitations(agent_id);
  CREATE INDEX IF NOT EXISTS idx_gifts_sender       ON gifts(sender_id);
  CREATE INDEX IF NOT EXISTS idx_gifts_receiver     ON gifts(receiver_id);
  CREATE INDEX IF NOT EXISTS idx_earnings_user      ON earnings(user_id);
  CREATE INDEX IF NOT EXISTS idx_targets_user       ON targets(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_host      ON room_sessions(host_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS agency_types (
    id              TEXT PRIMARY KEY,
    agent_id        TEXT NOT NULL REFERENCES agents(id),
    type            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    wallet_address  TEXT,
    diamond_credit_limit INTEGER,
    region          TEXT,
    country_code    TEXT,
    max_transfer_cap REAL,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(agent_id, type)
  );

  CREATE TABLE IF NOT EXISTS subordinate_agents (
    id              TEXT PRIMARY KEY,
    master_id       TEXT NOT NULL REFERENCES agents(id),
    subordinate_id  TEXT NOT NULL REFERENCES agents(id),
    commission_rate REAL NOT NULL DEFAULT 0.08,
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(master_id, subordinate_id)
  );

  CREATE TABLE IF NOT EXISTS referral_log (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL REFERENCES agents(id),
    invitee_id  TEXT NOT NULL REFERENCES users(id),
    event_type  TEXT NOT NULL DEFAULT 'registration',
    event_ref   TEXT,
    commission  REAL NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id              TEXT PRIMARY KEY,
    agent_id        TEXT NOT NULL REFERENCES agents(id),
    amount          REAL NOT NULL,
    method          TEXT NOT NULL,
    account_details TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    rejection_reason TEXT,
    requested_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    resolved_at     INTEGER,
    resolved_by     TEXT REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS recharge_orders (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    diamond_amount  INTEGER NOT NULL,
    price_egp       REAL NOT NULL,
    gateway         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    tx_id           TEXT,
    wallet_address  TEXT,
    fawry_ref       TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS usdt_settlements (
    id              TEXT PRIMARY KEY,
    agent_id        TEXT NOT NULL REFERENCES agents(id),
    tx_id           TEXT NOT NULL,
    diamond_amount  INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    rejection_reason TEXT,
    submitted_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    resolved_at     INTEGER,
    resolved_by     TEXT REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS bonuses (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL REFERENCES agents(id),
    type        TEXT NOT NULL,
    amount      REAL NOT NULL,
    period      TEXT NOT NULL,
    claimed     INTEGER NOT NULL DEFAULT 0,
    claimed_at  INTEGER,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_agency_types_agent    ON agency_types(agent_id);
  CREATE INDEX IF NOT EXISTS idx_subordinates_master   ON subordinate_agents(master_id);
  CREATE INDEX IF NOT EXISTS idx_referral_agent        ON referral_log(agent_id);
  CREATE INDEX IF NOT EXISTS idx_withdrawals_agent     ON withdrawals(agent_id);
  CREATE INDEX IF NOT EXISTS idx_recharge_user         ON recharge_orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_usdt_agent            ON usdt_settlements(agent_id);
  CREATE INDEX IF NOT EXISTS idx_bonuses_agent         ON bonuses(agent_id);
`);

// Migrate existing SQLite databases with new profile columns
const profileColumns = [
  ['display_name', 'TEXT'],
  ['bio', 'TEXT'],
  ['gender', 'TEXT'],
  ['birthday', 'TEXT'],
  ['country_code', 'TEXT'],
  ['interests', 'TEXT'],
  ['agency_name', 'TEXT'],
  ['team_size', 'TEXT'],
  ['offered_services', 'TEXT'],
];
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
for (const [col, type] of profileColumns) {
  if (!userCols.includes(col)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
  }
}

// ---------------------------------------------------------------------------
// FIX C-01: Secure admin seed — requires ADMIN_SEED_PASSWORD env var,
//           uses uppercase 'ADMIN' role, bcrypt cost 12.
// ---------------------------------------------------------------------------
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const adminExists = db.prepare(
  `SELECT id FROM users WHERE role IN ('ADMIN','SUPER_ADMIN') LIMIT 1`
).get();

if (!adminExists) {
  const adminPassword = process.env.ADMIN_SEED_PASSWORD;
  if (!adminPassword || adminPassword.length < 12) {
    console.warn(
      '[db] ADMIN_SEED_PASSWORD env var must be set (min 12 chars) — skipping admin seed.\n' +
      '     Set ADMIN_SEED_PASSWORD in your .env file to create the initial admin account.'
    );
  } else {
    // Use synchronous hash here since db.js runs at module load time (before server starts)
    const hash = bcrypt.hashSync(adminPassword, 12);
    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, role)
      VALUES (?, 'admin', 'admin@app.com', ?, 'ADMIN')
    `).run(uuidv4(), hash);
    console.log('[db] default admin created → admin@app.com');
  }
}

module.exports = db;
