#!/usr/bin/env python3
"""Blind A/B prep for critics. Copies OURS and REF into OUT/A.png and OUT/B.png in a random order
and writes OUT/key.json. Judge A.png vs B.png FIRST, then read key.json to unmask.
Usage: python3 tools/ab.py --ours X.png --ref Y.jpg --out DIR [--crop x,y,w,h] [--refcrop x,y,w,h] [--scale 1]
Both images are resized to the same size (the ours size) so nothing leaks via dimensions."""
import argparse, json, os, random, sys
from PIL import Image
ap = argparse.ArgumentParser()
ap.add_argument('--ours', required=True); ap.add_argument('--ref', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--crop'); ap.add_argument('--refcrop'); ap.add_argument('--size')
a = ap.parse_args()
def load(p, crop):
    im = Image.open(p).convert('RGB')
    if crop:
        x, y, w, h = map(int, crop.split(',')); im = im.crop((x, y, x + w, y + h))
    return im
ours = load(a.ours, a.crop); ref = load(a.ref, a.refcrop or a.crop)
size = tuple(map(int, a.size.split('x'))) if a.size else ours.size
ours = ours.resize(size, Image.LANCZOS) if ours.size != size else ours
ref = ref.resize(size, Image.LANCZOS) if ref.size != size else ref
os.makedirs(a.out, exist_ok=True)
flip = random.random() < 0.5
(ours if not flip else ref).save(os.path.join(a.out, 'A.png'))
(ref if not flip else ours).save(os.path.join(a.out, 'B.png'))
json.dump({'A': 'ref' if flip else 'ours', 'B': 'ours' if flip else 'ref', 'ours': a.ours, 'ref': a.ref, 'crop': a.crop, 'refcrop': a.refcrop}, open(os.path.join(a.out, 'key.json'), 'w'), indent=1)
print(a.out, '-> judge A.png vs B.png, THEN read key.json')
