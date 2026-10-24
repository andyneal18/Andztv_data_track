"""Find and undo bad automatic matches.

    python3 tools/audit_matches.py          # report + fix
    python3 tools/enrich.py --retry         # then re-match the cleared titles

1. A title whose Wikipedia match has a different name (e.g. a documentary that
   got matched to a big film from the same year) loses that match and poster.
   Matches that a curated list set on purpose are kept.
2. A title sitting in a curated collection it doesn't belong to (no entry in
   that list looks like it) is taken out of the collection.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from enrich import similar  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "data" / "library.json"
POSTERS = ROOT / "posters"


def main():
    lib = json.loads(LIB.read_text())
    curated = {}
    for f in sorted((ROOT / "data" / "curated").glob("*.json")):
        for col in json.loads(f.read_text())["collections"]:
            curated[col["id"]] = col["items"]
    intended = {(e.get("wiki") or "").lower() for items in curated.values() for e in items}
    intended.discard("")

    cleared = []
    for i in lib["items"]:
        w = i.get("wiki")
        if not w or similar(i["title"], w):
            continue
        if w.lower() in intended and any(
                (e.get("wiki") or "").lower() == w.lower() and
                any(similar(i["title"], t) for t in [e["title"], *e.get("aka", [])])
                for items in curated.values() for e in items):
            continue  # a curated list deliberately points this title at that article
        cleared.append(f"{i['title']} ({i.get('year')}) was matched to '{w}'")
        for k in ("wikidata", "description", "matchScore"):
            i.pop(k, None)
        i["wiki"] = None
        if i.get("poster"):
            (POSTERS / i["poster"]).unlink(missing_ok=True)
            i.pop("poster")

    by_id = {i["id"]: i for i in lib["items"]}
    removed = []
    for c in lib["collections"]:
        entries = curated.get(c["id"])
        if not entries:
            continue
        names = [t for e in entries for t in [e["title"], *e.get("aka", [])]]
        keep = []
        for x in c["items"]:
            i = by_id.get(x)
            if i and (i.get("addedBy") == "manual" or any(similar(i["title"], n) for n in names)):
                keep.append(x)
            elif i:
                removed.append(f"{i['title']} ({i.get('year')}) removed from {c['name']}")
        c["items"] = keep

    LIB.write_text(json.dumps(lib, indent=1))
    print(f"{len(cleared)} bad matches cleared:")
    print("\n".join("  " + x for x in cleared))
    print(f"{len(removed)} titles taken out of collections they don't belong to:")
    print("\n".join("  " + x for x in removed))


if __name__ == "__main__":
    main()
