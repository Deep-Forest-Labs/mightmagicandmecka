#!/usr/bin/env python3
"""Crop/scale helper. Usage: python3 tools/crop.py IN OUT x y w h [--scale 2] [--grid 4]  (--grid tiles IN NxN for swarm mocks)"""
import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA')
if '--grid' in sys.argv:
    n = int(sys.argv[sys.argv.index('--grid') + 1]); w, h = im.size
    g = Image.new('RGBA', (w * n, h * n))
    for i in range(n):
        for j in range(n): g.paste(im, (i * w, j * h))
    im = g
else:
    x, y, w, h = map(int, sys.argv[3:7]); im = im.crop((x, y, x + w, y + h))
if '--scale' in sys.argv:
    s = float(sys.argv[sys.argv.index('--scale') + 1]); im = im.resize((int(im.width * s), int(im.height * s)), Image.NEAREST)
im.save(out); print(out, im.size)
