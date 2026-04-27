/*
 * Fetches Windsor.ai's blended endpoint, splits rows by `data_source`,
 * applies per-source field mappings, aggregates into ISO weeks, and writes
 * data/windsor.json.
 *
 * The output JSON includes:
 *  - weeks:           merged effective values used by the dashboard
 *  - weeksBySource:   per-source per-week breakdown for auditing
 *  - sourcesDiscovered / sourcesUnmapped / sampleRowKeys: debugging aid
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { BLENDED_SOURCES, DATE_FIELD, SOURCE_FIELD } from './windsor-config.mjs';

const OUT_PATH = path.resolve('data/windsor.json');

function toMondayISO(dateStr) {
  if (dateStr === null || dateStr === undefined || dateStr === '') return null;
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

// Resolve a logical field name against a row, tolerating snake_case,
// camelCase, and "Title Case" variants.
function getField(row, fieldName) {
  if (row == null) return undefined;
  const variants = new Set([
    fieldName,
    fieldName.toLowerCase(),
    fieldName.toUpperCase(),
    fieldName.replace(/_/g, ''),
    fieldName.replace(/_/g, ' '),
    fieldName.replace(/_(.)/g, (_, c) => c.toUpperCase()),
    fieldName.split('_').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' '),
    fieldName.split('_').map(w => w[0]?.toUpperCase() + w.slice(1)).join(''),
  ]);
  for (const v of variants) {
    if (Object.prototype.hasOwnProperty.call(row, v)) return row[v];
  }
  return undefined;
}

async function main() {
  const url = process.env.WINDSOR_BLENDED_URL;
  if (!url) {
    console.error('WINDSOR_BLENDED_URL is not set. Add it as a GitHub secret.');
    process.exit(1);
  }

  console.log('Fetching Windsor blended endpoint…');
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  const rows = extractRows(json);
  console.log(`Got ${rows.length} rows`);

  if (rows.length === 0) {
    console.warn('No rows returned. Check Windsor: is the date range non-empty? Are connectors active?');
  } else {
    console.log('Sample row keys:', Object.keys(rows[0]).join(', '));
  }

  // Tally distinct Data Source values and which are mapped.
  const sourcesSeen = new Map();
  for (const row of rows) {
    const src = String(getField(row, SOURCE_FIELD) ?? '').trim().toLowerCase();
    if (!src) continue;
    sourcesSeen.set(src, (sourcesSeen.get(src) || 0) + 1);
  }
  console.log('Distinct Data Sources:');
  for (const [src, count] of [...sourcesSeen].sort((a, b) => b[1] - a[1])) {
    const mapped = BLENDED_SOURCES[src] ? '✓ mapped' : '⚠ no mapping (skipped)';
    console.log(`  ${src.padEnd(20)} ${String(count).padStart(6)} rows  ${mapped}`);
  }

  // Bucket per week → per source → per metric.
  // weekStart -> source -> metric -> { values: [], lastDate, lastVal }
  const buckets = {};
  let usableRows = 0;
  let droppedNoSource = 0;
  let droppedUnmapped = 0;
  let droppedNoDate = 0;

  for (const row of rows) {
    const src = String(getField(row, SOURCE_FIELD) ?? '').trim().toLowerCase();
    if (!src) { droppedNoSource++; continue; }
    const cfg = BLENDED_SOURCES[src];
    if (!cfg) { droppedUnmapped++; continue; }
    const weekStart = toMondayISO(getField(row, DATE_FIELD));
    if (!weekStart) { droppedNoDate++; continue; }

    if (!buckets[weekStart]) buckets[weekStart] = {};
    if (!buckets[weekStart][src]) buckets[weekStart][src] = {};
    const sourceBucket = buckets[weekStart][src];

    let touched = false;
    for (const [metricKey, def] of Object.entries(cfg.metrics)) {
      const raw = getField(row, def.field);
      if (raw === null || raw === undefined || raw === '') continue;
      const num = Number(raw);
      if (Number.isNaN(num)) continue;
      const slot = sourceBucket[metricKey] || { values: [], lastDate: '', lastVal: 0 };
      slot.values.push(num);
      const rowDate = String(getField(row, DATE_FIELD));
      if (rowDate >= slot.lastDate) {
        slot.lastDate = rowDate;
        slot.lastVal = num;
      }
      sourceBucket[metricKey] = slot;
      touched = true;
    }
    if (touched) usableRows++;
  }

  console.log(`Usable rows: ${usableRows} · dropped (no source: ${droppedNoSource}, unmapped: ${droppedUnmapped}, no date: ${droppedNoDate})`);

  // Aggregate slots according to each metric's `agg` strategy.
  const weeksBySource = {};
  for (const [weekStart, sources] of Object.entries(buckets)) {
    weeksBySource[weekStart] = {};
    for (const [src, metrics] of Object.entries(sources)) {
      const cfg = BLENDED_SOURCES[src];
      const out = {};
      for (const [metricKey, slot] of Object.entries(metrics)) {
        const def = cfg.metrics[metricKey];
        let value;
        switch (def.agg) {
          case 'last': value = slot.lastVal; break;
          case 'max':  value = Math.max(...slot.values); break;
          case 'sum':
          default:     value = slot.values.reduce((a, c) => a + c, 0);
        }
        out[metricKey] = +value.toFixed(4);
      }
      weeksBySource[weekStart][src] = out;
    }
  }

  // Determine per-metric merge strategy across sources.
  // If any source uses 'last' for a metric (e.g. MRR), the latest source's
  // value wins; otherwise we sum across sources (e.g. paid clicks from
  // Google + Meta + TikTok all add up).
  const strategy = {};
  for (const cfg of Object.values(BLENDED_SOURCES)) {
    for (const [k, def] of Object.entries(cfg.metrics)) {
      if (def.agg === 'last') strategy[k] = 'last';
    }
  }

  const merged = {};
  for (const [weekStart, sources] of Object.entries(weeksBySource)) {
    merged[weekStart] = {};
    for (const metrics of Object.values(sources)) {
      for (const [metricKey, value] of Object.entries(metrics)) {
        if (strategy[metricKey] === 'last') {
          merged[weekStart][metricKey] = value;
        } else {
          merged[weekStart][metricKey] = (merged[weekStart][metricKey] || 0) + value;
        }
      }
    }
  }

  const weeks = Object.entries(merged)
    .map(([weekStart, metrics]) => {
      const rounded = {};
      for (const [k, v] of Object.entries(metrics)) rounded[k] = +(+v).toFixed(2);
      return { weekStart, ...rounded };
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  const sourcesDiscovered = [...sourcesSeen.keys()].sort();
  const sourcesUnmapped = sourcesDiscovered.filter(s => !BLENDED_SOURCES[s]);

  const payload = {
    updatedAt: new Date().toISOString(),
    source: 'windsor.ai',
    endpoint: 'blended',
    weeks,
    weeksBySource,
    sourcesDiscovered,
    sourcesMapped: sourcesDiscovered.filter(s => BLENDED_SOURCES[s]),
    sourcesUnmapped,
    sampleRowKeys: rows.length > 0 ? Object.keys(rows[0]) : [],
    rowCount: rows.length,
    usableRowCount: usableRows,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote ${weeks.length} weeks → ${OUT_PATH}`);
  if (sourcesUnmapped.length) {
    console.warn(`Unmapped sources (add to scripts/windsor-config.mjs): ${sourcesUnmapped.join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
