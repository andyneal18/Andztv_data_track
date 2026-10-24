"""Build data/library.json from the spreadsheet export.

Run once to seed the app. Re-running will NOT overwrite an existing library
unless you pass --force (so edits made in the app are safe).

    python3 tools/build_library.py [--force]
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "spreadsheet_export.json"
OUT = ROOT / "data" / "library.json"


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def parse_date(v):
    if not v:
        return None
    for fmt in ("%m/%d/%Y %H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def parse_year(v):
    # Some rows have two years like "1999/2000"; take the first.
    m = re.search(r"\d{4}", str(v or ""))
    return int(m.group()) if m else None


def clean(v):
    if v is None:
        return None
    v = str(v).strip().strip(";").strip()
    return v or None


def main():
    if OUT.exists() and "--force" not in sys.argv:
        print(f"{OUT} already exists; pass --force to rebuild from the spreadsheet")
        return
    raw = json.loads(SRC.read_text())
    items, seen = [], set()

    for row in raw["Owned Movies"]:
        year = parse_year(row.get("Year"))
        # Hand-typed rows are shifted one column: "Movie" lands in Path.
        path = row.get("Path")
        if path == "Movie":
            path = None
        iid = f"m-{slug(row['Name'])}-{year or ''}".rstrip("-")
        if iid in seen:
            continue
        seen.add(iid)
        items.append({
            "id": iid,
            "title": row["Name"].strip(),
            "year": year,
            "type": "movie",
            "status": "downloaded",
            "genres": [g.strip() for g in (row.get("Genres") or "").split(";") if g.strip()],
            "runtime": clean(row.get("Runtime")),
            "rating": clean(row.get("Rating")),
            "resolution": clean(row.get("Resolution")),
            "path": path,
            "dateAdded": parse_date(row.get("DateAdded")),
        })

    for row in raw["Owned TV"]:
        year = parse_year(row.get("Year"))
        iid = f"tv-{slug(row['Name'])}-{year or ''}".rstrip("-")
        if iid in seen:
            continue
        seen.add(iid)
        items.append({
            "id": iid,
            "title": row["Name"].strip(),
            "year": year,
            "type": "tv",
            "status": "downloaded",
            "genres": [g.strip() for g in (row.get("Genres") or "").split(";") if g.strip()],
            "network": clean(row.get("Network")),
            "runtime": clean(row.get("Runtime")),
            "rating": clean(row.get("Rating")),
            "dateAdded": parse_date(row.get("DateAdded")),
        })

    OUT.write_text(json.dumps({"version": 1, "items": items, "collections": []}, indent=1))
    print(f"wrote {len(items)} items to {OUT}")


if __name__ == "__main__":
    main()
