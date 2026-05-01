/*
 * Coordinator for direct-API source fetchers.
 *
 * Each source module under ./sources/ exports `fetchWeeklyMetrics()` that
 * returns `{ weeks: [{ weekStart, ...metrics }], diagnostics }`. Sources
 * with missing credentials are skipped. Sources that throw are logged but
 * don't kill the whole run.
 *
 * Output: data/direct.json with merged weeks + per-source breakdown for
 * dashboard auditing.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_PATH = path.resolve('data/direct.json');

const SOURCES = [
  { name: 'stripe',  envVar: 'STRIPE_API_KEY',              import: './sources/stripe.mjs'  },
  { name: 'hubspot', envVar: 'HUBSPOT_PRIVATE_APP_TOKEN',   import: './sources/hubspot.mjs' },
];

async function main() {
  const sources = {};       // name -> { ok, weekCount?, error?, diagnostics? }
  const weeksBySource = {}; // weekStart -> source -> metrics
  const merged = {};        // weekStart -> metrics (last writer wins per metric)

  for (const src of SOURCES) {
    if (!process.env[src.envVar]) {
      console.log(`[${src.name}] skipped (${src.envVar} not set)`);
      sources[src.name] = { ok: false, skipped: true };
      continue;
    }
    try {
      const mod = await import(src.import);
      const result = await mod.fetchWeeklyMetrics();
      const weeks = result.weeks || [];
      sources[src.name] = {
        ok: true,
        weekCount: weeks.length,
        diagnostics: result.diagnostics || {},
      };
      console.log(`[${src.name}] returned ${weeks.length} weeks`);
      for (const week of weeks) {
        const { weekStart, ...metrics } = week;
        if (!weeksBySource[weekStart]) weeksBySource[weekStart] = {};
        weeksBySource[weekStart][src.name] = metrics;
        if (!merged[weekStart]) merged[weekStart] = {};
        for (const [k, v] of Object.entries(metrics)) {
          if (v === null || v === undefined || v === '') continue;
          merged[weekStart][k] = v;
        }
      }
    } catch (err) {
      console.error(`[${src.name}] failed: ${err.message}`);
      sources[src.name] = { ok: false, error: err.message };
    }
  }

  const weeks = Object.entries(merged)
    .map(([weekStart, metrics]) => ({ weekStart, ...metrics }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  const payload = {
    updatedAt: new Date().toISOString(),
    sources,
    weeks,
    weeksBySource,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote ${weeks.length} weeks → ${OUT_PATH}`);
  for (const [name, status] of Object.entries(sources)) {
    if (status.skipped) continue;
    if (status.ok)      console.log(`  ${name}: ok (${status.weekCount} weeks)`);
    else                console.log(`  ${name}: FAILED — ${status.error}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
