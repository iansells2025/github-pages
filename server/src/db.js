"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS listings (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  board       TEXT NOT NULL,
  host        TEXT NOT NULL,
  path        TEXT NOT NULL,
  title       TEXT NOT NULL,
  price_now   REAL,
  price_was   REAL,
  bid         INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  bid_at      INTEGER NOT NULL,
  owner_token TEXT,
  status      TEXT NOT NULL DEFAULT 'live'
);
CREATE INDEX IF NOT EXISTS listings_rank ON listings(status, bid DESC, bid_at ASC);
CREATE INDEX IF NOT EXISTS listings_board ON listings(board, status);

-- Every payment attempt, whatever became of it. Nothing reaches the board
-- without a row here that reached status 'applied'.
CREATE TABLE IF NOT EXISTS bids (
  id             TEXT PRIMARY KEY,
  listing_key    TEXT NOT NULL,
  board          TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  charge         INTEGER NOT NULL,
  basis          INTEGER NOT NULL,
  status         TEXT NOT NULL,
  title          TEXT,
  price_now      REAL,
  price_was      REAL,
  email          TEXT,
  owner_token    TEXT NOT NULL,
  provider       TEXT NOT NULL,
  session_id     TEXT,
  payment_intent TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  applied_at     INTEGER,
  note           TEXT
);
CREATE INDEX IF NOT EXISTS bids_session ON bids(session_id);
CREATE INDEX IF NOT EXISTS bids_status ON bids(status, created_at);

CREATE TABLE IF NOT EXISTS activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL,
  title      TEXT NOT NULL,
  board      TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  rank       INTEGER,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_at ON activity(at DESC);

-- Webhooks are retried by Stripe; this is what makes applying a bid idempotent.
CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,
  type        TEXT,
  received_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS visits (
  day     TEXT NOT NULL,
  visitor TEXT NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (day, visitor)
);
`;

/* Columns added after the first release. SQLite has no "ADD COLUMN IF NOT
   EXISTS", so check what is already there and add the rest. */
const MIGRATIONS = [
  { table: "listings", column: "last_checked", ddl: "ALTER TABLE listings ADD COLUMN last_checked INTEGER" },
  { table: "listings", column: "check_status", ddl: "ALTER TABLE listings ADD COLUMN check_status TEXT" },
  { table: "listings", column: "check_note", ddl: "ALTER TABLE listings ADD COLUMN check_note TEXT" },
  { table: "listings", column: "flagged", ddl: "ALTER TABLE listings ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0" }
];

function migrate(db) {
  MIGRATIONS.forEach((m) => {
    const cols = db.prepare("PRAGMA table_info(" + m.table + ")").all().map((c) => c.name);
    if (!cols.includes(m.column)) db.exec(m.ddl);
  });
  db.exec("CREATE INDEX IF NOT EXISTS listings_flagged ON listings(flagged, status)");
  db.exec("CREATE INDEX IF NOT EXISTS listings_checked ON listings(status, last_checked)");
}

function open(dbPath) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

module.exports = { open, migrate, SCHEMA };
