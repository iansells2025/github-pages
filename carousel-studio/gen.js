#!/usr/bin/env node
/* =============================================================================
   CAROUSEL STUDIO — gen.js
   Reads a carousel spec (JSON) and writes one self-contained, deterministically
   renderable HTML file per slide into slides/, plus slides/manifest.json.

   Each slide:
     * links ../base.css and ../vendor/gsap.min.js (relative, file:// safe)
     * carries an inline GSAP timeline built in buildTimeline(tl)
     * understands ?render&frame=F&fps=N  -> seeks the timeline to that frame and
       freezes, so every frame is reproducible (no wall-clock, no randomness)
     * without those params it just plays, so you can open it in a browser to preview

   Usage:
     node gen.js carousel.json
     node gen.js carousel.json --out slides
   ============================================================================= */
const fs = require("fs");
const path = require("path");

let simpleIcons = null;
try { simpleIcons = require("simple-icons"); } catch (_) {}

// ---- args ------------------------------------------------------------------
const args = process.argv.slice(2);
const specPath = args.find(a => !a.startsWith("--")) || "carousel.json";
const outDir = (args.includes("--out") ? args[args.indexOf("--out") + 1] : "slides");
const ROOT = __dirname;
const spec = JSON.parse(fs.readFileSync(path.resolve(ROOT, specPath), "utf8"));

const brand = Object.assign(
  { accent: "#2E6BFF", bg: "#0B1220", bgGlow: "#1B2C4D", plate: "#0E1626",
    tile: "#FFFFFF", ink: "#0B1220", handle: "@yourhandle" },
  spec.brand || {});
const FPS = spec.fps || 30;

const SLIDES_DIR = path.resolve(ROOT, outDir);
const ICONS_DIR = path.resolve(ROOT, "icons");
fs.mkdirSync(SLIDES_DIR, { recursive: true });
fs.mkdirSync(ICONS_DIR, { recursive: true });

// per-template default durations (seconds) ----------------------------------
const DUR = { cover: 3.4, step: 2.8, list: 2.8, stat: 3.2, cta: 3.6 };

// ---- helpers ---------------------------------------------------------------
const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function findIcon(slug) {
  if (!simpleIcons || !slug) return null;
  const key = "si" + slug.replace(/[^a-z0-9]/gi, "")
    .replace(/^./, c => c.toUpperCase());
  return simpleIcons[key] || null;
}

/* Export a brand icon (in its official color) to icons/<slug>.svg, or fall back
   to a neutral lettered glyph tile if simple-icons doesn't know it. Returns the
   inner HTML for an .icon-tile. */
function iconTile(slug, onDark = false) {
  const cls = "icon-tile" + (onDark ? " on-dark" : "");
  if (!slug) return `<div class="${cls}"></div>`;
  const ic = findIcon(slug);
  if (ic) {
    const file = path.join(ICONS_DIR, `${slug}.svg`);
    const svg = `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#${ic.hex}"><path d="${ic.path}"/></svg>`;
    fs.writeFileSync(file, svg);
    return `<div class="${cls}"><img src="../icons/${slug}.svg" alt="${esc(ic.title)}"></div>`;
  }
  const letter = esc(String(slug)[0] || "•").toUpperCase();
  return `<div class="${cls}"><span style="font-weight:900;font-size:60px;color:var(--brand-accent)">${letter}</span></div>`;
}

function avatarTag(name, opts = {}) {
  if (!name) return "";
  const cls = "avatar" + (opts.side === "left" ? " left" : "") + (opts.sm ? " sm" : "");
  return `<img class="${cls}" src="../assets/pose-${esc(name)}-cutout.png" alt="">`;
}

function footer(idx, total) {
  const dots = Array.from({ length: total }, (_, i) =>
    `<i class="${i === idx ? "on" : ""}"></i>`).join("");
  return `<div class="footer"><span class="handle">${esc(brand.handle)}</span>
    <span class="progress">${dots}</span></div>`;
}

// ---- the render runtime injected into every slide --------------------------
const RUNTIME = `
const P = new URLSearchParams(location.search);
const RENDER = P.has('render');
const FPS = +(P.get('fps')||${FPS});
const FRAME = +(P.get('frame')||0);
function boot(build){
  const tl = gsap.timeline({paused:true, defaults:{ease:'power3.out', duration:0.8}});
  build(tl, DURATION);
  if (tl.duration() < DURATION) tl.to({}, {duration: DURATION - tl.duration()});
  window.__DURATION = tl.duration();
  // Renderer hook: jump to an exact frame deterministically (no wall clock).
  window.__seek = function(frame){ tl.pause(); tl.time(Math.min(frame/FPS, tl.duration())); };
  const ready = Promise.all([
    (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve(),
    new Promise(r => (document.readyState === 'complete') ? r() : addEventListener('load', r))
  ]);
  ready.then(() => requestAnimationFrame(() => {
    if (RENDER) { tl.pause(); tl.time(Math.min(FRAME/FPS, tl.duration()));
      document.documentElement.setAttribute('data-ready','1'); }
    else { tl.play(0); document.documentElement.setAttribute('data-ready','1'); }
  }));
}`;

function page({ idx, total, type, body, anim, extraCSS = "" }) {
  const DURATION = DUR[type] || 3.0;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>slide ${idx + 1} — ${type}</title>
<link rel="stylesheet" href="../base.css">
<style>:root{
  --brand-accent:${brand.accent}; --brand-bg:${brand.bg};
  --brand-bg-glow:${brand.bgGlow}; --brand-plate:${brand.plate};
  --brand-tile:${brand.tile}; --brand-ink:${brand.ink};
}${extraCSS}</style>
</head><body>
<div class="stage"></div>
${body}
${footer(idx, total)}
<script src="../vendor/gsap.min.js"></script>
<script>
const DURATION = ${DURATION};
${RUNTIME}
boot(function(tl, DURATION){
${anim}
});
</script>
</body></html>`;
}

// ---- slide templates -------------------------------------------------------
function ringPositions(n) {
  // ring the plate but stay clear of the bottom-right avatar zone
  const pts = [
    [44, 240], [906, 210], [40, 650], [906, 540], [150, 1010],
  ];
  return pts.slice(0, n);
}

const TEMPLATES = {
  cover(s, idx, total) {
    const icons = (s.icons || []).slice(0, 5);
    const ring = ringPositions(icons.length).map(([x, y], i) =>
      `<div class="ring-i" style="left:${x}px;top:${y}px">${iconTile(icons[i])}</div>`
    ).join("");
    const title = s.titleAccent
      ? esc(s.title).replace(esc(s.titleAccent),
          `<span class="accent">${esc(s.titleAccent)}</span>`)
      : esc(s.title);
    const body = `
<div class="ring">${ring}</div>
<div class="frame" style="align-items:center;justify-content:flex-start;
     padding-top:96px;text-align:center">
  <div class="plate" style="width:720px;padding:66px 56px;display:flex;
       flex-direction:column;align-items:center;gap:28px">
    ${s.kicker ? `<span class="kicker"><span class="dot"></span>${esc(s.kicker)}</span>` : ""}
    <div class="cover-title" style="font-weight:900;font-size:80px;line-height:0.98;
         letter-spacing:-0.03em;text-align:center">${title}</div>
    ${s.subtitle ? `<div class="lead on-dark" style="text-align:center;max-width:640px">${esc(s.subtitle)}</div>` : ""}
  </div>
</div>
${avatarTag(s.avatar || "pointing", { side: s.avatarSide })}`;
    const anim = `
  tl.from('.stage', {opacity:0, duration:0.5}, 0);
  tl.from('.ring-i', {scale:0, opacity:0, stagger:0.07, ease:'back.out(1.7)', duration:0.6}, 0.1);
  tl.from('.plate', {scale:0.9, opacity:0, y:30, duration:0.7}, 0.2);
  tl.from('.kicker', {y:20, opacity:0}, 0.5);
  tl.from('.cover-title', {y:40, opacity:0, duration:0.7}, 0.6);
  tl.from('.lead', {y:24, opacity:0}, 0.85);
  tl.from('.avatar', {y:300, opacity:0, duration:0.9, ease:'power2.out'}, 0.5);`;
    const extraCSS = `
.ring{position:absolute;inset:0}
.ring-i{position:absolute}`;
    return page({ idx, total, type: "cover", body, anim, extraCSS });
  },

  step(s, idx, total) { return stepLike(s, idx, total, "step"); },
  list(s, idx, total) { return stepLike(s, idx, total, "list"); },

  stat(s, idx, total) {
    const m = String(s.value).match(/^([\d.,]+)(.*)$/);
    const num = m ? m[1].replace(/,/g, "") : null;
    const suffix = m ? m[2] : "";
    const valHTML = num
      ? `<span class="stat" data-count="${num}" data-suffix="${esc(suffix)}">0${esc(suffix)}</span>`
      : `<span class="stat">${esc(s.value)}</span>`;
    const body = `
<div class="frame" style="align-items:center;justify-content:flex-start;
     padding-top:120px;text-align:center;gap:26px">
  ${s.kicker ? `<span class="kicker"><span class="dot"></span>${esc(s.kicker)}</span>` : ""}
  ${valHTML}
  <div class="h-2 on-dark" style="color:var(--on-dark);text-align:center;max-width:720px">${esc(s.label)}</div>
  ${s.body ? `<div class="lead on-dark" style="text-align:center;max-width:600px">${esc(s.body)}</div>` : ""}
</div>
${avatarTag(s.avatar || "pointing", { side: s.avatarSide, sm: true })}`;
    const counter = num ? `
  const ne=document.querySelector('[data-count]');
  const end=+ne.dataset.count, suf=ne.dataset.suffix||'';
  const dec=(ne.dataset.count.indexOf('.')>=0);
  const o={v:0};
  tl.to(o,{v:end,duration:1.4,ease:'power2.out',onUpdate:()=>{
    ne.textContent=(dec?o.v.toFixed(1):Math.round(o.v))+suf;}},0.3);` : "";
    const anim = `
  tl.from('.stage',{opacity:0,duration:0.5},0);
  tl.from('.kicker',{y:20,opacity:0},0.2);
  tl.from('.stat',{scale:0.7,opacity:0,duration:0.7,ease:'back.out(1.5)'},0.2);
  ${counter}
  tl.from('.h-2',{y:24,opacity:0},0.9);
  tl.from('.lead',{y:20,opacity:0},1.05);
  tl.from('.avatar',{y:300,opacity:0,duration:0.9},0.4);`;
    return page({ idx, total, type: "stat", body, anim });
  },

  cta(s, idx, total) {
    const body = `
<div class="frame" style="align-items:center;justify-content:flex-start;
     padding-top:120px;text-align:center;gap:38px">
  ${s.kicker ? `<span class="kicker"><span class="dot"></span>${esc(s.kicker)}</span>` : ""}
  <div class="h-1" style="color:var(--on-dark);text-align:center;max-width:760px">${esc(s.title)}</div>
  <div class="plate cta-plate" style="padding:42px 56px;display:flex;align-items:center;gap:24px">
    <span class="lead on-dark" style="color:var(--on-dark)">Comment</span>
    <span class="keyword">${esc(s.keyword)}</span>
  </div>
  ${s.body ? `<div class="lead on-dark" style="text-align:center;max-width:560px">${esc(s.body)}</div>` : ""}
</div>
${avatarTag(s.avatar || "victory", { side: s.avatarSide, sm: true })}`;
    const extraCSS = `
.keyword{font-weight:900;font-size:72px;letter-spacing:-0.02em;color:#fff;
  padding:6px 34px;border-radius:20px;background:var(--brand-accent);
  box-shadow:0 18px 50px -14px var(--brand-accent)}`;
    const anim = `
  tl.from('.stage',{opacity:0,duration:0.5},0);
  tl.from('.kicker',{y:20,opacity:0},0.2);
  tl.from('.h-1',{y:34,opacity:0,duration:0.7},0.35);
  tl.from('.cta-plate',{scale:0.85,opacity:0,duration:0.6,ease:'back.out(1.6)'},0.6);
  tl.from('.lead',{y:20,opacity:0},0.95);
  tl.from('.avatar',{y:320,opacity:0,duration:0.9},0.5);
  tl.to('.keyword',{scale:1.06,duration:0.5,yoyo:true,repeat:3,ease:'sine.inOut'},1.2);`;
    return page({ idx, total, type: "cta", body, anim, extraCSS });
  },
};

function stepLike(s, idx, total, type) {
  const body = `
<div class="frame" style="justify-content:flex-start;gap:0">
  ${s.kicker ? `<span class="kicker" style="align-self:flex-start"><span class="dot"></span>${esc(s.kicker)}</span>` : ""}
  <div class="tile" style="margin-top:30px;flex:1;padding:80px 72px;display:flex;
       flex-direction:column;gap:40px;justify-content:flex-start">
    <div class="row gap-m">
      ${s.index != null ? `<div class="index">${esc(s.index)}</div>` : ""}
      ${s.icon ? iconTile(s.icon) : ""}
    </div>
    <div class="h-1" style="max-width:660px">${esc(s.title)}</div>
    ${s.body ? `<div class="lead" style="max-width:500px">${esc(s.body)}</div>` : ""}
  </div>
</div>
${avatarTag(s.avatar, { side: s.avatarSide })}`;
  const anim = `
  tl.from('.stage',{opacity:0,duration:0.5},0);
  tl.from('.kicker',{x:-20,opacity:0},0.15);
  tl.from('.tile',{y:50,opacity:0,duration:0.7},0.2);
  tl.from('.index',{scale:0,opacity:0,ease:'back.out(1.8)'},0.45);
  tl.from('.icon-tile',{scale:0,opacity:0,ease:'back.out(1.8)'},0.55);
  tl.from('.h-1',{y:30,opacity:0,duration:0.6},0.6);
  tl.from('.lead',{y:20,opacity:0},0.8);
  tl.from('.avatar',{y:300,opacity:0,duration:0.9},0.4);`;
  return page({ idx, total, type, body, anim });
}

// ---- generate --------------------------------------------------------------
const total = spec.slides.length;
const manifest = { fps: FPS, brand, slides: [] };

// clear old slides
for (const f of fs.readdirSync(SLIDES_DIR))
  if (f.endsWith(".html") || f === "manifest.json")
    fs.unlinkSync(path.join(SLIDES_DIR, f));

spec.slides.forEach((s, idx) => {
  const t = TEMPLATES[s.type];
  if (!t) { console.error(`!! unknown slide type "${s.type}" at #${idx + 1}`); return; }
  const html = t(s, idx, total);
  const name = String(idx + 1).padStart(2, "0") + "-" + s.type + ".html";
  fs.writeFileSync(path.join(SLIDES_DIR, name), html);
  manifest.slides.push({ file: name, type: s.type, duration: DUR[s.type] || 3.0 });
  console.log("wrote slides/" + name);
});

fs.writeFileSync(path.join(SLIDES_DIR, "manifest.json"),
  JSON.stringify(manifest, null, 2));
console.log("wrote slides/manifest.json  (" + total + " slides @ " + FPS + "fps)");
