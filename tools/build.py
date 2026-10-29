#!/usr/bin/env python3
"""Baut das Installationspaket neu: Assets und Szenen-Collections aus brand/brand.json.

  python3 tools/build.py            Szenen-Collections (schnell)
  python3 tools/build.py --assets   zusätzlich Platzhalter-Grafiken und -Videos (dauert ca. 2 Minuten)
"""
import sys

import build_collection

if __name__ == "__main__":
    if "--assets" in sys.argv:
        import gen_assets
        gen_assets.main()
    build_collection.write_all()
