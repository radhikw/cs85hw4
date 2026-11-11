#!/usr/bin/env python3
"""
Download the public-domain paintings used by "Seeing like a brain" from Wikimedia Commons.

    python3 scripts/fetch_paintings.py

What it does
  - reads data/paintings.json
  - downloads each painting's thumbnail from upload.wikimedia.org
  - crops it if the catalogue gives a crop box (the Seurat detail)
  - shrinks it to at most `maxSide` pixels and saves assets/paintings/<file>
  - writes assets/paintings/CREDITS.md

Requires Pillow (pip install pillow). Safe to re-run; existing files are skipped unless --force.
The app also works without these files: it falls back to loading the same images straight
from Wikimedia at runtime, but local copies are faster and keep the site self-contained.
"""
import argparse
import io
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
UA = "SeeingLikeABrain/1.0 (university course project; contact: see repository README)"


def download(url: str, tries: int = 4) -> bytes:
    delay = 2.0
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == tries:
                raise
            print(f"    retry {attempt}/{tries - 1} after error: {e}")
            time.sleep(delay)
            delay *= 2
    raise RuntimeError("unreachable")


def process(raw: bytes, crop, max_side: int) -> Image.Image:
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    if crop:
        w, h = im.size
        x0, y0, x1, y1 = crop
        im = im.crop((round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h)))
    if max(im.size) > max_side:
        s = max_side / max(im.size)
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    return im


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--catalog", default=str(ROOT / "data" / "paintings.json"))
    ap.add_argument("--out", default=str(ROOT / "assets" / "paintings"))
    ap.add_argument("--force", action="store_true", help="re-download files that already exist")
    args = ap.parse_args()

    catalog = json.loads(Path(args.catalog).read_text(encoding="utf-8"))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    failures = []
    for p in catalog:
        dest = out / p["file"]
        if dest.exists() and not args.force:
            print(f"skip   {p['file']} (exists)")
            continue
        print(f"fetch  {p['file']}  <-  {p['commons']}")
        try:
            im = process(download(p["remote"]), p.get("crop"), p.get("maxSide", 1500))
            im.save(dest, "JPEG", quality=88, optimize=True, progressive=True)
            print(f"       saved {im.width}x{im.height}, {dest.stat().st_size // 1024} KB")
        except Exception as e:  # keep going; report at the end
            failures.append((p["file"], str(e)))
            print(f"       FAILED: {e}")

    lines = [
        "# Image credits",
        "",
        "All images are public-domain reproductions of two-dimensional works, via Wikimedia Commons.",
        "Run `python3 scripts/fetch_paintings.py` to (re)create the files in this folder.",
        "",
    ]
    for p in catalog:
        lines.append(f"- **{p['artist']}, *{p['title']}*, {p['year']}.** {p['medium']}; {p['collection']}. "
                     f"[Commons file page]({p['creditUrl']}). {p['license']}.")
    (out / "CREDITS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    if failures:
        print("\nSome downloads failed:")
        for f, e in failures:
            print(f"  {f}: {e}")
        print("The app will still load those paintings from Wikimedia at runtime.")
        return 1
    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
