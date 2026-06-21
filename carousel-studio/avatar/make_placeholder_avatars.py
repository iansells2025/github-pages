#!/usr/bin/env python3
"""
Placeholder avatar generator.

Draws a clean, flat-vector "host" figure in 5 poses and writes each as a
transparent PNG to assets/pose-<name>-cutout.png. These are stand-ins: the
real pipeline (avatar/generate_avatar.py) overwrites the SAME filenames with a
cartoon of you, so the rest of the studio never has to change.

Technique: everything is drawn on a 3x supersampled canvas and downscaled with
LANCZOS, which gives smooth, anti-aliased edges that read as "vector" rather
than the blocky look you'd get drawing at 1x.

Usage:
    python3 avatar/make_placeholder_avatars.py [--accent "#2E6BFF"]
"""
import argparse, math, os
from PIL import Image, ImageDraw

# ---- palette ---------------------------------------------------------------
SKIN    = (236, 200, 170, 255)
SKIN_SH = (214, 175, 146, 255)   # cel-shade tone
HAIR    = (58, 46, 42, 255)
PANTS   = (40, 44, 54, 255)
SHOE    = (26, 28, 36, 255)
OUTLINE = (20, 24, 32, 255)
WHITE   = (245, 247, 250, 255)

S = 3                # supersample factor
W, H = 620, 1040     # output cutout size (portrait, suits 4:5 slides)


def hex_to_rgba(h, a=255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def shade(rgba, f=0.82):
    r, g, b, a = rgba
    return (int(r * f), int(g * f), int(b * f), a)


class Canvas:
    """Draws at supersampled scale; coords are given in base (W,H) units."""
    def __init__(self):
        self.img = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)

    def _s(self, v):
        return v * S

    def capsule(self, p1, p2, r, fill, outline=OUTLINE, ow=6):
        """A thick rounded limb: line core + circular end caps."""
        (x1, y1), (x2, y2) = p1, p2
        x1, y1, x2, y2, r = (self._s(x1), self._s(y1), self._s(x2),
                             self._s(y2), self._s(r))
        ow = self._s(ow)
        # outline pass (slightly fatter), then fill pass
        for col, rr in ((outline, r + ow), (fill, r)):
            self.d.line([(x1, y1), (x2, y2)], fill=col, width=int(rr * 2),
                        joint="curve")
            for (cx, cy) in ((x1, y1), (x2, y2)):
                self.d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=col)

    def rrect(self, box, radius, fill, outline=OUTLINE, ow=6):
        x0, y0, x1, y1 = [self._s(v) for v in box]
        ow = self._s(ow)
        if outline:
            self.d.rounded_rectangle([x0 - ow, y0 - ow, x1 + ow, y1 + ow],
                                     radius=self._s(radius) + ow, fill=outline)
        self.d.rounded_rectangle([x0, y0, x1, y1], radius=self._s(radius),
                                 fill=fill)

    def ellipse(self, box, fill, outline=OUTLINE, ow=6):
        x0, y0, x1, y1 = [self._s(v) for v in box]
        ow = self._s(ow)
        if outline:
            self.d.ellipse([x0 - ow, y0 - ow, x1 + ow, y1 + ow], fill=outline)
        self.d.ellipse([x0, y0, x1, y1], fill=fill)

    def circle(self, cx, cy, r, fill, outline=OUTLINE, ow=6):
        self.ellipse([cx - r, cy - r, cx + r, cy + r], fill, outline, ow)

    def save(self, path):
        out = self.img.resize((W, H), Image.LANCZOS)
        out.save(path)


def draw_body(c, shirt):
    """Head, hair, torso, legs, shoes, face. Returns shoulder anchor points."""
    cx = W / 2
    # ---- legs + shoes ----
    c.capsule((cx - 70, 720), (cx - 80, 940), 46, PANTS)
    c.capsule((cx + 70, 720), (cx + 80, 940), 46, PANTS)
    c.rrect([cx - 128, 930, cx - 36, 980], 22, SHOE)
    c.rrect([cx + 36, 930, cx + 128, 980], 22, SHOE)
    # ---- torso (shirt) ----
    c.rrect([cx - 132, 470, cx + 132, 760], 70, shirt)
    # subtle cel-shade on the left third
    sh = Image.new("RGBA", c.img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        [(cx - 132) * S, 470 * S, (cx - 20) * S, 760 * S],
        radius=70 * S, fill=shade(shirt, 0.88)[:3] + (90,))
    c.img.alpha_composite(sh)
    # ---- neck ----
    c.rrect([cx - 34, 408, cx + 34, 500], 24, SKIN, ow=0)
    # ---- head ----
    c.ellipse([cx - 96, 232, cx + 96, 452], SKIN)
    # ---- hair ----
    c.ellipse([cx - 104, 214, cx + 104, 360], HAIR)
    c.rrect([cx - 104, 286, cx + 104, 330], 30, HAIR, ow=0)  # squared sides
    # face notch back to skin (forehead/face area)
    c.ellipse([cx - 84, 286, cx + 84, 452], SKIN, ow=0)
    # ---- face ----
    c.circle(cx - 38, 360, 9, OUTLINE, ow=0)   # eyes
    c.circle(cx + 38, 360, 9, OUTLINE, ow=0)
    # friendly smile (arc)
    c.d.arc([(cx - 40) * S, (cx_y := 360) * S, (cx + 40) * S, 410 * S],
            start=20, end=160, fill=OUTLINE, width=int(7 * S))
    return (cx - 120, 520), (cx + 120, 520)  # L/R shoulder anchors


def pose_arms(c, name, shirt):
    L, R = (W / 2 - 120, 520), (W / 2 + 120, 520)
    sleeve = shirt
    if name == "casual":
        c.capsule(L, (L[0] - 30, 720), 40, sleeve)
        c.capsule(R, (R[0] + 30, 720), 40, sleeve)
        c.circle(L[0] - 30, 740, 30, SKIN)
        c.circle(R[0] + 30, 740, 30, SKIN)
    elif name == "pointing":
        c.capsule(L, (L[0] - 30, 720), 40, sleeve)
        c.circle(L[0] - 30, 740, 30, SKIN)
        # right arm extended out presenting (kept inside frame)
        elbow = (R[0] + 55, 560)
        hand = (R[0] + 150, 500)
        c.capsule(R, elbow, 40, sleeve)
        c.capsule(elbow, hand, 34, SKIN)
        c.circle(hand[0], hand[1], 34, SKIN)  # open hand
    elif name == "victory":
        c.capsule(L, (L[0] - 30, 720), 40, sleeve)
        c.circle(L[0] - 30, 740, 30, SKIN)
        # right fist raised up
        elbow = (R[0] + 40, 430)
        fist = (R[0] + 60, 250)
        c.capsule(R, elbow, 40, sleeve)
        c.capsule(elbow, fist, 34, SKIN)
        c.circle(fist[0], fist[1], 40, SKIN)
    elif name == "arms-crossed":
        # both forearms cross over chest
        c.capsule(L, (W / 2 + 40, 640), 40, sleeve)
        c.capsule(R, (W / 2 - 40, 600), 40, sleeve)
        c.circle(W / 2 + 40, 640, 30, SKIN)
        c.circle(W / 2 - 40, 600, 30, SKIN)
    elif name == "holding-phone":
        c.capsule(L, (L[0] - 30, 720), 40, sleeve)
        c.circle(L[0] - 30, 740, 30, SKIN)
        # right forearm bent up holding a phone
        elbow = (R[0] + 30, 660)
        hand = (W / 2 + 40, 560)
        c.capsule(R, elbow, 40, sleeve)
        c.capsule(elbow, hand, 32, SKIN)
        c.rrect([W / 2 + 6, 470, W / 2 + 78, 600], 14, (24, 28, 36, 255))
        c.rrect([W / 2 + 14, 486, W / 2 + 70, 584], 8, (60, 130, 255, 255), ow=0)


POSES = ["casual", "pointing", "victory", "arms-crossed", "holding-phone"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--accent", default="#2E6BFF")
    ap.add_argument("--out", default=os.path.join(
        os.path.dirname(__file__), "..", "assets"))
    args = ap.parse_args()
    shirt = hex_to_rgba(args.accent)
    os.makedirs(args.out, exist_ok=True)
    for name in POSES:
        c = Canvas()
        draw_body(c, shirt)
        pose_arms(c, name, shirt)
        path = os.path.join(args.out, f"pose-{name}-cutout.png")
        c.save(path)
        print("wrote", os.path.relpath(path))


if __name__ == "__main__":
    main()
