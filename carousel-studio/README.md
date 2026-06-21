# Carousel Studio

Turn a topic into a finished, **animated Instagram carousel** — one MP4 per
slide, native **1080×1350 (4:5)** — fronted by a cartoon **avatar of you**.

It's not a black box. Four small, readable pieces:

| File | What it does |
|------|--------------|
| `avatar/` | Turns your photo into a flat-vector cartoon host in 5 poses (transparent PNGs). |
| `base.css` | The premium "spatial" design system. **Rebrand everything via 6 variables.** |
| `gen.js` | Reads a `carousel.json` spec → one self-contained, animated HTML file per slide. |
| `render.js` / `render.sh` | Screenshots every frame with headless Chrome → ffmpeg → one MP4 per slide. |

```
carousel-studio/
├── avatar/        photo → cartoon pipeline + prompts
├── assets/        pose-<name>-cutout.png  (your avatar, transparent)
├── icons/         real app icons (exported from simple-icons on demand)
├── slides/        generated <NN>-<type>.html + manifest.json
├── frames/        per-slide PNG frames (regenerable; git-ignored)
├── output/        the deliverable: <slide>.mp4  (+ qa/ static previews)
├── vendor/        gsap.min.js + Inter font (vendored, no CDN at render time)
├── base.css  gen.js  render.js  render.sh  carousel.json
```

---

## 1. Your avatar (do this first)

The studio ships with clean **placeholder** avatars so everything renders today.
To become the real host, turn a photo of yourself into a cartoon:

```bash
export OPENAI_API_KEY=sk-...
pip install requests
python3 avatar/generate_avatar.py --photo /path/to/me.jpg
```

This calls OpenAI `gpt-image` (latest) with your photo as a reference (so your
face stays recognizable), generates 5 poses, and writes transparent cutouts to
`assets/pose-<name>-cutout.png` — the **same filenames** the placeholders use, so
nothing else changes.

Five poses, mapped to slide roles:

| file | pose | used on |
|------|------|---------|
| `pose-casual-cutout.png` | hands at sides | step / list |
| `pose-pointing-cutout.png` | presenting | cover, stat |
| `pose-victory-cutout.png` | fist up | CTA |
| `pose-arms-crossed-cutout.png` | arms crossed | step / list |
| `pose-holding-phone-cutout.png` | holding a phone | cover, CTA |

Customize and re-run until you approve:

```bash
python3 avatar/generate_avatar.py --photo me.jpg \
  --outfit "charcoal hoodie" --hair "short curly fade" --glasses --style flat
```

See `avatar/prompts.md` for the exact prompts and all knobs. The placeholders
themselves are drawn by `avatar/make_placeholder_avatars.py` (pure Python/Pillow).

---

## 2. Make a carousel

1. **Pick a topic and a comment keyword** (for the CTA).
2. **Write the outline** in `carousel.json`: a `cover`, 4–6 content slides
   (`step` / `list` / `stat`), and a `cta`. Reference real tools by their
   [simple-icons](https://simpleicons.org) slug (e.g. `figma`, `notion`,
   `github`, `claude`).
3. **Generate the slides:**
   ```bash
   node gen.js carousel.json
   ```
4. **QA as static frames (fast)** — catches layout issues before the slow render:
   ```bash
   ./render.sh --qa      # → output/qa/<slide>.png
   ```
   Fix layout, regenerate, repeat.
5. **Full render to MP4:**
   ```bash
   ./render.sh           # → output/<slide>.mp4  (one per slide)
   ```

### Spec format (`carousel.json`)

```jsonc
{
  "brand": { "accent": "#2E6BFF", "handle": "@you" },   // see "Rebrand" below
  "fps": 30,
  "slides": [
    { "type": "cover", "kicker": "...", "title": "...", "titleAccent": "word",
      "subtitle": "...", "avatar": "pointing",
      "icons": ["claude","notion","figma","github","instagram"] },
    { "type": "step", "kicker": "Step 1", "index": 1, "icon": "notion",
      "title": "...", "body": "one line", "avatar": "casual" },
    { "type": "stat", "kicker": "...", "value": "92%", "label": "...",
      "body": "...", "avatar": "pointing" },          // numeric values count up
    { "type": "cta", "title": "Want it?", "keyword": "GUIDE",
      "body": "...", "avatar": "victory" }
  ]
}
```

---

## 3. Rebrand in 6 variables

Open `base.css`, edit the six `--brand-*` tokens (or set them per-carousel in
`carousel.json` `brand`), and the entire system re-skins:

```css
--brand-accent: #2E6BFF;  /* the ONE accent color  */
--brand-bg:     #0B1220;  /* deep background       */
--brand-bg-glow:#1B2C4D;  /* radial light bloom    */
--brand-plate:  #0E1626;  /* dark headline plates  */
--brand-tile:   #FFFFFF;  /* floating content tiles*/
--brand-ink:    #0B1220;  /* text on light tiles   */
```

To recolor the avatar's outfit to match, regenerate with `--accent`, or for the
placeholders: `python3 avatar/make_placeholder_avatars.py --accent "#FF5A36"`.

---

## 4. How rendering stays deterministic

Each slide HTML carries an inline GSAP timeline built in `buildTimeline(tl)`.
With `?render&frame=F&fps=N` in the URL the page **seeks the timeline to an exact
frame and freezes** (no wall-clock, no randomness), and exposes `window.__seek(f)`
so the renderer jumps frame-to-frame without reloading. The renderer waits for
fonts + layout (`data-ready`) before each screenshot. Result: byte-stable frames.

`render.js` uses low parallelism (`PAR`, default 2) plus a **retry pass** that
re-renders any frame that came out missing or suspiciously small, then ffmpeg
encodes each slide's frames to H.264 `yuv420p` at native size.

**Chrome**: `$CHROME_BIN` → system `google-chrome`/`chromium` → bundled
`.chrome/`. **ffmpeg**: `$FFMPEG` → `ffmpeg-static` → system `ffmpeg`.

---

## 5. Richer motion (optional)

For counters, logo outros, kinetic captions, or data charts, pull a HyperFrames
component into a slide:

```bash
npx hyperframes add <component-name>   # github.com/heygen-com/hyperframes
```

---

## Setup

```bash
npm install          # gsap, simple-icons, playwright-core, ffmpeg-static, Inter
```

Requires Node 18+. For the real avatar: Python 3 + `requests` + an
`OPENAI_API_KEY`. Chrome and ffmpeg are auto-detected (or bundled).

### Premium rules (baked into the templates)
Fill the frame, no dead white space · one idea per slide · one accent color ·
native 1080×1350 · the avatar **hosts** the slide, never just decoration ·
always QA frames before the slow render.
