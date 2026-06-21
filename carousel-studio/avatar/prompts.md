# Avatar prompts — your cartoon host

This is the source of truth for how "you" get turned into the carousel host.
`generate_avatar.py` builds these prompts automatically; this file is here so
you can read, tweak, or paste them into any generator by hand.

## The master prompt (image-to-image, from your photo)

> A **soft cel-shaded flat modern vector illustration** of the SAME person shown
> in the reference photo. Keep their real face, hairstyle, and skin tone clearly
> recognizable. **Full body, head to feet**, wearing casual streetwear with the
> shirt/top in the brand accent color **#2E6BFF**. Friendly, confident
> expression. Pose: _{pose}_. Centered single character, **plain transparent
> background**, no ground shadow, no text, no border. Consistent character
> design across renders so multiple poses look like the same illustrated person.

Feeding your actual photo into the **edits** endpoint (not text-to-image) is what
keeps your face consistent across all five poses.

## The five poses

| filename                         | pose direction                                            | use on slide   |
|----------------------------------|-----------------------------------------------------------|----------------|
| `pose-casual-cutout.png`         | standing relaxed, hands at sides, friendly smile          | step / list    |
| `pose-pointing-cutout.png`       | presenting, one arm extended pointing at content          | cover, big-stat|
| `pose-victory-cutout.png`        | one fist raised in victory, energetic                     | CTA            |
| `pose-arms-crossed-cutout.png`   | arms crossed, self-assured                                | step / list    |
| `pose-holding-phone-cutout.png`  | holding a smartphone, looking at viewer                   | cover, CTA     |

## Customization knobs (the "regenerate until approved" loop)

Re-run `generate_avatar.py` with any of these until you're happy:

- **Outfit color / style** — `--outfit "charcoal hoodie"` (the *top* always picks
  up the accent unless you say otherwise).
- **Hair** — `--hair "short curly fade"`.
- **Glasses** — add `--glasses`.
- **Expression** — edit the master prompt ("warm smile", "neutral pro", etc.).
- **Flat vs 3D** — `--style flat` (default) or `--style 3d` for a soft 3D look.
- **Accent** — `--accent "#FF5A36"` to retint the outfit to match a rebrand.

## Background removal

`gpt-image-1` outputs transparency natively via `background=transparent`, so the
PNGs are already cutouts. If you ever switch to a generator that bakes in a
background, add `--rembg` (needs `pip install rembg`) or run Higgsfield's
`remove_background`.

## Placeholder vs. real

Until you run `generate_avatar.py`, the files in `assets/` are clean
flat-vector **placeholders** drawn by `make_placeholder_avatars.py`. They exist
so the whole studio renders end-to-end today. Generating the real you overwrites
the same filenames — nothing downstream changes.
