"""Apply hand-curated collections from data/curated/*.json to the library.

    python3 tools/apply_curated.py
    python3 tools/enrich.py           # afterwards, to fetch posters for new titles

Each curated entry is matched to a title you already have (by Wikipedia article,
then by title/aka + year); anything unmatched is added as "Don't Have".
Smaller auto-found collections that mostly sit inside a curated one
(e.g. "Toy Story" inside "Pixar") are removed so the list stays broad.

Curated collections you've edited in the app (renamed, reordered, removed a
title...) are left alone on re-runs, as are ones you deleted.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "data" / "library.json"
CURATED = ROOT / "data" / "curated"

# A collection is folded into a broader one when this share of it is already there.
OVERLAP = 0.7


def norm(s):
    s = s.lower().replace("&", "and")
    s = re.sub(r"[’'`]", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return re.sub(r"^(the|a|an) ", "", s)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def merge_duplicates(lib, log=print):
    """A gap title that's really something you own (same title, year +/-1, type)
    gets replaced by your copy everywhere."""
    owned = {}
    for i in lib["items"]:
        if i["status"] != "missing":
            owned.setdefault((norm(i["title"]), i["type"]), []).append(i)
    swap = {}
    for i in lib["items"]:
        if i["status"] != "missing" or i.get("request"):
            continue
        for o in owned.get((norm(i["title"]), i["type"]), []):
            if i.get("year") and o.get("year") and abs(i["year"] - o["year"]) <= 1:
                swap[i["id"]] = o["id"]
                o.setdefault("format", i.get("format")) if i.get("format") else None
                break
    for c in lib["collections"]:
        out = []
        for x in c["items"]:
            x = swap.get(x, x)
            if x not in out:
                out.append(x)
        c["items"] = out
    lib["items"] = [i for i in lib["items"] if i["id"] not in swap]
    if swap:
        log(f"  merged {len(swap)} duplicate titles into the copies you own")


def prune(lib, log=print):
    """Drop auto collections that a broader collection already covers, then
    drop collection-only gaps that no longer belong to any collection."""
    colls = lib["collections"]
    broad = [c for c in colls if c.get("source") == "curated"]
    by_id = {i["id"]: i for i in lib["items"]}
    in_curated = {x for c in broad for x in c["items"]}
    removed = []
    for c in list(colls):
        if c.get("source") != "wikidata" or c.get("manual") or not c["items"]:
            continue
        # Judge auto collections by the titles you actually have: if you own none,
        # or most of what you own already sits in a curated list, it's redundant.
        owned = [x for x in c["items"] if by_id.get(x, {}).get("status") != "missing"]
        covered = sum(1 for x in owned if x in in_curated)
        if not owned or covered >= 0.5 * len(owned):
            colls.remove(c)
            removed.append(c)
            if c["id"] not in lib["dismissedCollections"]:
                lib["dismissedCollections"].append(c["id"])
            log(f"  dropped '{c['name']}' (covered by curated lists)")
            continue
        mine = set(c["items"])
        others = broad + [o for o in colls if o is not c and o.get("source") == "wikidata" and len(o["items"]) > len(mine)]
        for o in others:
            if o in removed:
                continue
            if len(mine & set(o["items"])) >= OVERLAP * len(mine):
                colls.remove(c)
                removed.append(c)
                if c["id"] not in lib["dismissedCollections"]:
                    lib["dismissedCollections"].append(c["id"])
                log(f"  folded '{c['name']}' into '{o['name']}'")
                break

    merge_duplicates(lib, log)
    in_any = {i for c in colls for i in c["items"]}
    before = len(lib["items"])
    lib["items"] = [i for i in lib["items"] if not (
        i["id"] not in in_any and i.get("addedBy") == "collection"
        and i["status"] == "missing" and not i.get("request"))]
    log(f"  removed {before - len(lib['items'])} gap titles no longer in any collection")


def main():
    lib = json.loads(LIB.read_text())
    lib.setdefault("dismissedCollections", [])
    dismissed_items = set(lib.setdefault("dismissedItems", []))
    # "collection_id|item_id" pairs you removed from a curated list in the app.
    excluded = set(lib.setdefault("excludedMembers", []))
    items = lib["items"]
    used_ids = {i["id"] for i in items}

    by_wiki, by_title = {}, {}
    for i in items:
        if i.get("wiki"):
            by_wiki.setdefault(i["wiki"].lower(), i)
        by_title.setdefault(norm(i["title"]), []).append(i)

    def find(e):
        w = by_wiki.get((e.get("wiki") or "").lower())
        # Some articles cover several films, so the year must agree too.
        if w and (w.get("year") == e.get("year") or norm(w["title"]) in {norm(t) for t in [e["title"], *e.get("aka", [])]}):
            return w
        best, best_s = None, -1
        for t in [e["title"], *e.get("aka", [])]:
            for i in by_title.get(norm(t), []):
                s = 0
                if i.get("year") and e.get("year"):
                    d = abs(i["year"] - e["year"])
                    if d > 1:
                        continue
                    s += 2 - d
                if i["type"] != e["type"]:
                    continue  # a film and a series that share a name are different works
                if s > best_s:
                    best, best_s = i, s
        return best

    existing = {c["id"]: c for c in lib["collections"]}
    added = matched = 0
    for f in sorted(CURATED.glob("*.json")):
        for col in json.loads(f.read_text())["collections"]:
            cid = col["id"]
            if cid in lib["dismissedCollections"] or existing.get(cid, {}).get("manual"):
                continue
            ids = []
            for e in col["items"]:
                item = find(e)
                if item:
                    matched += 1
                else:
                    if not e.get("year"):
                        continue
                    base = iid = f"{'tv' if e['type'] == 'tv' else 'm'}-{slug(e['title'])}-{e['year']}"
                    if "id:" + base in dismissed_items:
                        continue  # you deleted this one in the app
                    n = 2
                    while iid in used_ids:
                        iid, n = f"{base}-{n}", n + 1
                    used_ids.add(iid)
                    item = {"id": iid, "title": e["title"], "year": e["year"], "type": e["type"],
                            "status": "missing", "addedBy": "collection"}
                    if e.get("wiki"):
                        item["wiki"] = e["wiki"]
                    items.append(item)
                    by_title.setdefault(norm(item["title"]), []).append(item)
                    if e.get("wiki"):
                        by_wiki[e["wiki"].lower()] = item
                    added += 1
                if e.get("format") and not item.get("format"):
                    item["format"] = e["format"]
                if item.get("wikidata") in dismissed_items:
                    continue
                if item["id"] not in ids and f"{cid}|{item['id']}" not in excluded:
                    ids.append(item["id"])
            prev = existing.get(cid) or {}
            existing[cid] = {"id": cid, "name": col["name"], "source": "curated",
                             "kind": col.get("kind", "Franchise"), "items": ids, "_file": f.stem}
            existing[cid].update({k: prev[k] for k in ("pinned", "pinnedAt") if k in prev})  # keep your pins
    # Two curated lists from different files covering the same thing: keep the bigger.
    cur = sorted((c for c in existing.values() if c.get("_file") and c.get("kind") != "Director"),
                 key=lambda c: -len(c["items"]))
    for i, small in enumerate(cur):
        for big in cur[:i]:
            if big["id"] in existing and big["_file"] != small["_file"] and small["items"] and \
                    len(set(small["items"]) & set(big["items"])) >= 0.8 * len(small["items"]):
                print(f"  duplicate: '{small['name']}' ({small['_file']}) covered by '{big['name']}' ({big['_file']})")
                existing.pop(small["id"], None)
                break
    for c in existing.values():
        c.pop("_file", None)
    lib["collections"] = list(existing.values())
    print(f"curated: {matched} entries matched titles you have/track, {added} new titles added")
    prune(lib)
    LIB.write_text(json.dumps(lib, indent=1))
    print(f"{len(lib['collections'])} collections, {len(lib['items'])} titles")


if __name__ == "__main__":
    main()
