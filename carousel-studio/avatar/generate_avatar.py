#!/usr/bin/env python3
"""
REAL avatar generator (OpenAI gpt-image, latest).

Turns a photo of you into a flat-vector cartoon host in 5 poses, each saved as a
transparent PNG at assets/pose-<name>-cutout.png -- the exact filenames the
placeholder script uses, so swapping in the real you requires no other changes.

How it works:
  * Uses the Images *edits* endpoint with your photo as the reference image, so
    the model preserves your face / hair / skin tone across all 5 poses.
  * Requests background=transparent, so the result is already a clean cutout
    (no separate rembg step needed). If you ever use a model/path that can't do
    transparency, set --rembg to post-process.

Setup:
    export OPENAI_API_KEY=sk-...
    pip install requests          # (only dependency)

Usage:
    python3 avatar/generate_avatar.py --photo /path/to/me.jpg
    python3 avatar/generate_avatar.py --photo https://.../me.jpg \
        --outfit "charcoal hoodie" --hair "short curly" --glasses --accent "#2E6BFF"
    python3 avatar/generate_avatar.py --photo me.jpg --poses victory cover
    python3 avatar/generate_avatar.py --photo me.jpg --style 3d   # soft 3D look

Review the PNGs in assets/. Not happy? Re-run with different knobs until you
approve -- that's the "regenerate until approved" loop from the brief.
"""
import argparse, base64, io, os, sys, urllib.request

API_URL = "https://api.openai.com/v1/images/edits"
MODEL = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1")  # "latest" gpt-image
SIZE = "1024x1536"  # portrait, good for a full-body host

POSES = {
    "casual":        "standing relaxed, hands at sides, friendly confident smile",
    "pointing":      "presenting, one arm extended outward as if pointing at content",
    "victory":       "one fist raised up in a victory celebration, energetic",
    "arms-crossed":  "arms crossed over chest, self-assured, slight smile",
    "holding-phone": "holding a smartphone in one hand, looking at the viewer",
}


def base_prompt(a):
    style = ("soft cel-shaded flat modern vector illustration, clean bold shapes, "
             "subtle dark outline") if a.style == "flat" else \
            ("soft 3D render, smooth rounded forms, gentle studio lighting, "
             "Pixar-adjacent but minimal")
    glasses = "wearing glasses, " if a.glasses else ""
    return (
        f"A {style} of the SAME person shown in the reference photo. "
        f"Keep their real face, hairstyle ({a.hair}), and skin tone clearly "
        f"recognizable. Full body, head to feet, {glasses}wearing casual "
        f"streetwear ({a.outfit}) with the shirt/top in the brand accent color "
        f"{a.accent}. Friendly, confident expression. "
        f"Pose: {{pose}}. "
        f"Centered single character, plain transparent background, no shadow on "
        f"the ground, no text, no border. Consistent character design across "
        f"renders so multiple poses look like the same illustrated person."
    )


def read_image_bytes(src):
    if src.startswith("http://") or src.startswith("https://"):
        with urllib.request.urlopen(src) as r:
            return r.read()
    with open(src, "rb") as f:
        return f.read()


def post_multipart(api_key, fields, file_bytes, filename):
    """Minimal multipart/form-data POST using only the stdlib + the photo bytes."""
    import requests  # local import so the file is importable without it
    files = {"image": (filename, io.BytesIO(file_bytes), "image/png")}
    headers = {"Authorization": f"Bearer {api_key}"}
    resp = requests.post(API_URL, headers=headers, data=fields, files=files,
                         timeout=180)
    if resp.status_code != 200:
        raise RuntimeError(f"OpenAI API {resp.status_code}: {resp.text[:500]}")
    return resp.json()["data"][0]["b64_json"]


def maybe_rembg(path):
    try:
        from rembg import remove
        from PIL import Image
        img = Image.open(path).convert("RGBA")
        remove(img).save(path)
        print("   rembg: background removed")
    except Exception as e:
        print(f"   rembg skipped ({e}); gpt-image transparency should suffice")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--photo", required=True, help="path or URL to your face photo")
    ap.add_argument("--accent", default="#2E6BFF")
    ap.add_argument("--outfit", default="casual streetwear")
    ap.add_argument("--hair", default="natural, as in the photo")
    ap.add_argument("--glasses", action="store_true")
    ap.add_argument("--style", choices=["flat", "3d"], default="flat")
    ap.add_argument("--poses", nargs="*", default=list(POSES),
                    help=f"subset of: {', '.join(POSES)}")
    ap.add_argument("--rembg", action="store_true",
                    help="post-process with rembg (only if transparency fails)")
    ap.add_argument("--out", default=os.path.join(
        os.path.dirname(__file__), "..", "assets"))
    a = ap.parse_args()

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        sys.exit("ERROR: set OPENAI_API_KEY in your environment first.")

    photo = read_image_bytes(a.photo)
    tmpl = base_prompt(a)
    os.makedirs(a.out, exist_ok=True)

    for name in a.poses:
        if name not in POSES:
            print(f"!! unknown pose '{name}', skipping"); continue
        print(f"-> generating pose: {name}")
        prompt = tmpl.format(pose=POSES[name])
        fields = {"model": MODEL, "prompt": prompt, "size": SIZE, "n": "1",
                  "background": "transparent", "output_format": "png"}
        b64 = post_multipart(api_key, fields, photo, "photo.png")
        path = os.path.join(a.out, f"pose-{name}-cutout.png")
        with open(path, "wb") as f:
            f.write(base64.b64decode(b64))
        if a.rembg:
            maybe_rembg(path)
        print(f"   wrote {os.path.relpath(path)}")

    print("\nDone. Review assets/pose-*-cutout.png and re-run with different "
          "--outfit/--hair/--glasses/--style until you approve.")


if __name__ == "__main__":
    main()
