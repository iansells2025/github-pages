/*
 * Fetches each configured Windsor.ai connector, aggregates rows into ISO weeks
 * (Monday-anchored), and writes data/windsor.json for the dashboard to load.
 *
 * Connectors with unset env vars are skipped silently so you can wire them up
 * one at a time. Per-connector failures are logged but do not abort the run.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { CONNECTORS } from './windsor-config.mjs';

const OUT_PATH = path.resolve('data/windsor.json');

function toMondayISO(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  return [];
}

async function fetchConnector(connector) {
  const url = process.env[connector.envUrl];
  if (!url) {
    console.log(`[${connector.name}] skipped (env ${connector.envUrl} not set)`);
    return null;
  }
  console.log(`[${connector.name}] fetching…`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return extractRows(json);
}

function aggregate(rows, connector) {
  // weekStart -> { metricKey -> { values: [], lastDate: '' } }
  const buckets = new Map();
  for (const row of rows) {
    const weekStart = toMondayISO(row[connector.dateField]);
    if (!weekStart) continue;
    if (!buckets.has(weekStart)) buckets.set(weekStart, {});
    const bucket = buckets.get(weekStart);
    for (const [metricKey, def] of Object.entries(connector.metrics)) {
      const raw = row[def.field];
      if (raw === undefined || raw === null || raw === '') continue;
      const num = Number(raw);
      if (Number.isNaN(num)) continue;
      if (!bucket[metricKey]) bucket[metricKey] = { values: [], lastDate: '', lastVal: 0 };
      bucket[metricKey].values.push(num);
      const rowDate = String(row[connector.dateField]);
      if (rowDate >= bucket[metricKey].lastDate) {
        bucket[metricKey].lastDate = rowDate;
        bucket[metricKey].lastVal = num;
      }
    }
  }

  const out = {};
  for (const [weekStart, metrics] of buckets) {
    out[weekStart] = {};
    for (const [metricKey, def] of Object.entries(connector.metrics)) {
      const b = metrics[metricKey];
      if (!b) continue;
      let value;
      switch (def.agg) {
        case 'last': value = b.lastVal; break;
        case 'max':  value = Math.max(...b.values); break;
        case 'sum':
        default:     value = b.values.reduce((a, c) => a + c, 0);
      }
      out[weekStart][metricKey] = value;
    }
  }
  return out;
}

function mergeWeek(target, source, mergeStrategy) {
  for (const [k, v] of Object.entries(source)) {
    if (target[k] === undefined) {
      target[k] = v;
    } else if (mergeStrategy[k] === 'last') {
      // Overwrite (later connector wins for snapshot-style metrics)
      target[k] = v;
    } else {
      // Default: additive across connectors (e.g., paid clicks from Google + Meta)
      target[k] = (Number(target[k]) || 0) + (Number(v) || 0);
    }
  }
}

async function main() {
  const merged = {};            // weekStart -> { metric: value, ... }
  const strategy = {};          // metric -> 'last' if any connector uses 'last', else 'sum'

  for (const conn of CONNECTORS) {
    for (const [k, def] of Object.entries(conn.metrics)) {
      if (def.agg === 'last') strategy[k] = 'last';
    }
  }

  for (const conn of CONNECTORS) {
    try {
      const rows = await fetchConnector(conn);
      if (!rows) continue;
      console.log(`[${conn.name}] ${rows.length} rows`);
      const weekly = aggregate(rows, conn);
      for (const [weekStart, metrics] of Object.entries(weekly)) {
        if (!merged[weekStart]) merged[weekStart] = {};
        mergeWeek(merged[weekStart], metrics, strategy);
      }
    } catch (err) {
      console.error(`[${conn.name}] failed: ${err.message}`);
    }
  }

  const weeks = Object.entries(merged)
    .map(([weekStart, metrics]) => ({ weekStart, ...metrics }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  const payload = {
    updatedAt: new Date().toISOString(),
    source: 'windsor.ai',
    weeks,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote ${weeks.length} weeks → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
