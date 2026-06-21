#!/usr/bin/env node
/* =============================================================================
   CAROUSEL STUDIO — render.js  (the robust renderer engine)
   Drives a real headless Chrome (via the Playwright driver) to screenshot every
   frame of every slide deterministically, then ffmpeg-encodes each slide to its
   own MP4 at native 1080x1350.

   Why this and not bare `chrome --screenshot`? Driving Chrome over DevTools lets
   us WAIT for fonts+layout to be ready and seek the GSAP timeline to an exact
   frame, so frames are reproducible. It also survives the offline sandbox.

   Robustness: low parallelism (PAR, default 2) + a retry pass that re-renders
   any frame that came out missing or suspiciously small.

   Chrome:  $CHROME_BIN, else google-chrome / chromium, else bundled CfT in .chrome/
   ffmpeg:  $FFMPEG,     else ffmpeg-static, else system ffmpeg
   Flags:   --force-device-scale-factor=1 and --allow-file-access-from-files (per brief)

   Usage:
     node render.js            # full render -> output/<slide>.mp4
     node render.js --qa       # fast: final frame of each slide -> output/qa/<slide>.png
     PAR=3 node render.js
   ============================================================================= */
const { chromium } = require("playwright-core");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SLIDES = path.join(ROOT, "slides");
const FRAMES = path.join(ROOT, "frames");
const OUT = path.join(ROOT, "output");
const QA = process.argv.includes("--qa");
const PAR = Math.max(1, +(process.env.PAR || 2));

const manifest = JSON.parse(fs.readFileSync(path.join(SLIDES, "manifest.json"), "utf8"));
const FPS = manifest.fps;

function tryRequire(m) { try { return require(m); } catch (_) { return null; } }

function detectChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN))
    return process.env.CHROME_BIN;
  const cands = [
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  // bundled Chrome for Testing under .chrome/
  const base = path.join(ROOT, ".chrome");
  if (fs.existsSync(base)) {
    const stack = [base];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.name === "chrome" || e.name === "chrome.exe") return p;
      }
    }
  }
  return undefined;
}

function detectFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const ff = tryRequire("ffmpeg-static");
  if (ff) { try { fs.chmodSync(ff, 0o755); } catch (_) {} return ff; }
  return "ffmpeg";
}

const CHROME = detectChrome();
const FFMPEG = detectFfmpeg();
if (!CHROME) {
  console.error("No Chrome found. Install Google Chrome or set CHROME_BIN.");
  process.exit(1);
}

const CHROME_ARGS = [
  "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
  "--force-device-scale-factor=1",        // brief: scale 1
  "--allow-file-access-from-files",        // brief: local asset access
  "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  "--disable-background-networking", "--disable-component-update",
  "--disable-default-apps", "--disable-sync", "--disable-extensions",
  "--disable-breakpad", "--disable-features=Translate,OptimizationHints,MediaRouter",
  "--host-resolver-rules=MAP * 0.0.0.0",   // no slide needs the network
];

const frameName = i => String(i).padStart(5, "0") + ".png";
const baseOf = file => file.replace(/\.html$/, "");
const framesFor = dur => Math.max(1, Math.round(dur * FPS));

function sh(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", d => (err += d));
    p.on("close", c => (c === 0 ? res() : rej(new Error(err.slice(-400)))));
  });
}

async function renderSlide(browser, slide) {
  const base = baseOf(slide.file);
  const total = framesFor(slide.duration);
  const dir = path.join(FRAMES, base);
  fs.mkdirSync(dir, { recursive: true });
  const url = "file://" + path.join(SLIDES, slide.file) + `?render&fps=${FPS}&frame=0`;

  const ctx = await browser.newContext({
    viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1",
    null, { timeout: 15000 });
  await page.waitForFunction(() => typeof window.__seek === "function");

  const wanted = QA ? [total - 1] : Array.from({ length: total }, (_, i) => i);
  for (const f of wanted) {
    await page.evaluate(fr => window.__seek(fr), f);
    const out = QA
      ? path.join(OUT, "qa", base + ".png")
      : path.join(dir, frameName(f));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out });
  }
  await ctx.close();
  return { base, total, dir };
}

// re-render any frame that is missing or < 2KB (a dropped/blank capture)
async function retryPass(browser, slide) {
  const base = baseOf(slide.file);
  const total = framesFor(slide.duration);
  const dir = path.join(FRAMES, base);
  const bad = [];
  for (let f = 0; f < total; f++) {
    const p = path.join(dir, frameName(f));
    if (!fs.existsSync(p) || fs.statSync(p).size < 2048) bad.push(f);
  }
  if (!bad.length) return 0;
  const ctx = await browser.newContext({
    viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto("file://" + path.join(SLIDES, slide.file) + `?render&fps=${FPS}&frame=0`,
    { waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  for (const f of bad) {
    await page.evaluate(fr => window.__seek(fr), f);
    await page.screenshot({ path: path.join(dir, frameName(f)) });
  }
  await ctx.close();
  return bad.length;
}

function encode(slide) {
  const base = baseOf(slide.file);
  const dir = path.join(FRAMES, base);
  const out = path.join(OUT, base + ".mp4");
  return sh(FFMPEG, [
    "-y", "-framerate", String(FPS), "-i", path.join(dir, "%05d.png"),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
    "-preset", "medium", "-movflags", "+faststart", out,
  ]).then(() => out);
}

// simple concurrency pool
async function pool(items, n, fn) {
  const q = items.slice(); const running = [];
  const results = [];
  async function next() {
    if (!q.length) return;
    const item = q.shift();
    const p = fn(item).then(r => results.push(r));
    running.push(p);
    await p;
    running.splice(running.indexOf(p), 1);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, next));
  return results;
}

(async () => {
  console.log(`Renderer: chrome=${path.basename(CHROME)}  ffmpeg=${path.basename(FFMPEG)}  ` +
    `fps=${FPS}  par=${PAR}  mode=${QA ? "QA(static)" : "full(MP4)"}`);
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });

  // 1) capture frames (low parallelism)
  await pool(manifest.slides, PAR, async slide => {
    const r = await renderSlide(browser, slide);
    console.log(`  frames: ${r.base}  ${QA ? "(final)" : r.total + " frames"}`);
  });

  if (!QA) {
    // 2) retry pass for dropped frames
    for (const slide of manifest.slides) {
      const n = await retryPass(browser, slide);
      if (n) console.log(`  retry: ${baseOf(slide.file)} re-rendered ${n} frame(s)`);
    }
    // 3) encode each slide to its own MP4
    await pool(manifest.slides, PAR, async slide => {
      const out = await encode(slide);
      console.log(`  encoded: ${path.relative(ROOT, out)}`);
    });
  }

  await browser.close();
  console.log(QA
    ? `\nQA frames in output/qa/  — review, fix layout, then run a full render.`
    : `\nDone. MP4s in output/  — one per slide, ready for Instagram.`);
})().catch(e => { console.error("render failed:", e); process.exit(1); });
