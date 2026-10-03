"use strict";

/* The database layer, with two interchangeable drivers behind one interface:

   - `pg` against a real Postgres (Neon / Vercel Postgres) in production.
   - PGlite — Postgres compiled to WASM — for local dev and the test suite, so
     tests run the exact SQL production runs without a server to install.

   Both expose { query, tx, close }. `query` normalizes to { rows, rowCount };
   `tx` runs a function inside a transaction and rolls back if it throws. */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS listings (
  id           text PRIMARY KEY,
  key          text NOT NULL UNIQUE,
  board        text NOT NULL,
  host         text NOT NULL,
  path         text NOT NULL,
  title        text NOT NULL,
  price_now    double precision,
  price_was    double precision,
  bid          integer NOT NULL,
  created_at   bigint NOT NULL,
  bid_at       bigint NOT NULL,
  owner_token  text,
  status       text NOT NULL DEFAULT 'live',
  last_checked bigint,
  check_status text,
  check_note   text,
  flagged      boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS listings_rank ON listings (status, bid DESC, bid_at ASC);
CREATE INDEX IF NOT EXISTS listings_board ON listings (board, status);
CREATE INDEX IF NOT EXISTS listings_flagged ON listings (flagged, status);
CREATE INDEX IF NOT EXISTS listings_checked ON listings (status, last_checked);

-- Every payment attempt, whatever became of it. Nothing reaches the board
-- without a row here that reached status 'applied'.
CREATE TABLE IF NOT EXISTS bids (
  id             text PRIMARY KEY,
  listing_key    text NOT NULL,
  board          text NOT NULL,
  amount         integer NOT NULL,
  charge         integer NOT NULL,
  basis          integer NOT NULL,
  status         text NOT NULL,
  title          text,
  price_now      double precision,
  price_was      double precision,
  email          text,
  owner_token    text NOT NULL,
  provider       text NOT NULL,
  session_id     text,
  payment_intent text,
  created_at     bigint NOT NULL,
  updated_at     bigint NOT NULL,
  applied_at     bigint,
  note           text
);
CREATE INDEX IF NOT EXISTS bids_session ON bids (session_id);
CREATE INDEX IF NOT EXISTS bids_intent ON bids (payment_intent);
CREATE INDEX IF NOT EXISTS bids_status ON bids (status, created_at);

CREATE TABLE IF NOT EXISTS activity (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id text NOT NULL,
  title      text NOT NULL,
  board      text NOT NULL,
  amount     integer NOT NULL,
  rank       integer,
  at         bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_at ON activity (at DESC);

-- Stripe delivers at least once; this is what makes applying a bid idempotent.
CREATE TABLE IF NOT EXISTS webhook_events (
  id          text PRIMARY KEY,
  type        text,
  received_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS visits (
  day     text NOT NULL,
  visitor text NOT NULL,
  at      bigint NOT NULL,
  PRIMARY KEY (day, visitor)
);
`;

function normalize(res) {
  return {
    rows: res.rows || [],
    // pg reports rowCount; PGlite reports affectedRows.
    rowCount: res.rowCount != null ? res.rowCount : (res.affectedRows != null ? res.affectedRows : (res.rows || []).length)
  };
}

async function createPgDriver(url) {
  const pg = require("pg");
  // node-postgres hands back int8 as a string, PGlite as a number. Epoch
  // milliseconds are far below 2^53, so parsing to Number is exact and keeps
  // the two drivers returning identical shapes.
  pg.types.setTypeParser(20, Number);

  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    // One connection per serverless invocation; use a pooled connection string
    // (Neon's -pooler host) so the database is not swamped by concurrent lambdas.
    max: Number(process.env.PG_POOL_MAX || 1),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    ssl: local ? false : { rejectUnauthorized: true }
  });
  pool.on("error", (err) => console.error("idle postgres client error", err.message));

  return {
    driver: "pg",
    async query(text, params) {
      return normalize(await pool.query(text, params));
    },
    // Multi-statement DDL. node-postgres uses the simple query protocol when no
    // parameters are given, which is the only one that accepts several
    // statements at once.
    async exec(text) { await pool.query(text); },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          query: async (text, params) => normalize(await client.query(text, params))
        });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch (e) { /* connection already gone */ }
        throw err;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); }
  };
}

async function createPgliteDriver(dataDir) {
  const { PGlite } = require("@electric-sql/pglite");
  const db = dataDir ? await PGlite.create(dataDir) : await PGlite.create();

  return {
    driver: "pglite",
    async query(text, params) {
      return normalize(await db.query(text, params));
    },
    async exec(text) { await db.exec(text); },
    async tx(fn) {
      return db.transaction(async (t) => fn({
        query: async (text, params) => normalize(await t.query(text, params))
      }));
    },
    async close() { await db.close(); }
  };
}

/* Pick a driver. A DATABASE_URL means real Postgres; otherwise fall back to
   PGlite so `npm test` and local dev need nothing installed. */
async function createDb(options) {
  const o = options || {};
  const url = o.url !== undefined ? o.url : process.env.DATABASE_URL;
  const db = url ? await createPgDriver(url) : await createPgliteDriver(o.dataDir);
  if (o.migrate !== false) await db.exec(SCHEMA);
  return db;
}

module.exports = { createDb, SCHEMA };
