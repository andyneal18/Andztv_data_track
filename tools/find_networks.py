"""Look up the network/streamer and studio of every title so search can find them
("disney channel", "netflix", "hbo", "pixar", "a24"…).

    python3 tools/find_networks.py

Sets `networks` (original broadcaster / streaming service) and `studios`
(production company / distributor) on each item, from Wikidata, with TVmaze
filling in networks for shows Wikidata doesn't know. Lookups are cached in
data/.cache/networks.json so re-runs are fast. Only those two fields are written.
"""
import json
import os
import shutil
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from enrich import get_json  # throttled, Wikimedia-friendly fetch
from find_collections import chunks, qid, sparql

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "data" / "library.json"
CACHE = ROOT / "data" / ".cache" / "networks.json"


def load_cache():
    try:
        return json.loads(CACHE.read_text())
    except (OSError, ValueError):
        return {}


def save_cache(cache):
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache))


def wiki_qids(titles, cache):
    """Wikipedia article title -> Wikidata QID (for titles enrich.py didn't store one for)."""
    known = cache.setdefault("wikiQid", {})
    todo = [t for t in titles if t not in known]
    for batch in chunks(todo, 50):
        params = urllib.parse.urlencode({
            "action": "query", "format": "json", "prop": "pageprops", "ppprop": "wikibase_item",
            "redirects": 1, "titles": "|".join(batch)})
        data = get_json(f"https://en.wikipedia.org/w/api.php?{params}")["query"]
        alias = {}
        for k in ("normalized", "redirects"):
            for r in data.get(k, []):
                alias[r["from"]] = r["to"]
        found = {p["title"]: p.get("pageprops", {}).get("wikibase_item") for p in data.get("pages", {}).values()}
        for t in batch:
            end = t
            while end in alias:
                end = alias[end]
            known[t] = found.get(end)
    return {t: known[t] for t in titles if known.get(t)}


def tvmaze_networks(show_id, cache):
    known = cache.setdefault("tvmaze", {})
    key = str(show_id)
    if key not in known:
        try:
            s = get_json(f"https://api.tvmaze.com/shows/{show_id}")
            known[key] = [x["name"] for x in (s.get("network"), s.get("webChannel")) if x]
        except Exception as e:
            print("  tvmaze error", show_id, e)
            return []
    return known[key]


def main():
    cache = load_cache()
    items = json.loads(LIB.read_text())["items"]

    qids = {i["id"]: i["wikidata"] for i in items if i.get("wikidata")}
    need = [i for i in items if i["id"] not in qids and i.get("wiki")]
    by_title = wiki_qids(sorted({i["wiki"] for i in need}), cache)
    for i in need:
        if i["wiki"] in by_title:
            qids[i["id"]] = by_title[i["wiki"]]
    save_cache(cache)
    print(f"{len(qids)} titles on Wikidata")

    # Distributors limited to one country (P3005) are foreign/home-video licensees.
    # Streamers also turn up as "distributor" of anything they've carried (Netflix
    # for Citizen Kane), so a network only counts as a broadcaster or producer.
    nets, studios, dists = {}, {}, {}
    for batch in chunks(sorted(set(qids.values())), 150):
        vals = " ".join(f"wd:{q}" for q in batch)
        rows = sparql(f"""
            SELECT ?item ?prop ?co ?coLabel WHERE {{
              VALUES ?item {{ {vals} }}
              {{ ?item wdt:P449 ?co BIND("net" AS ?prop) }}
              UNION {{ ?item wdt:P272 ?co BIND("studio" AS ?prop) }}
              UNION {{ ?item p:P750 ?st . ?st ps:P750 ?co . FILTER NOT EXISTS {{ ?st pq:P3005 [] }} BIND("dist" AS ?prop) }}
              SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
            }}""")
        for r in rows:
            label = r["coLabel"]["value"]
            if label == qid(r["co"]["value"]):
                continue  # no English label
            target = {"net": nets, "studio": studios, "dist": dists}[r["prop"]["value"]]
            target.setdefault(qid(r["item"]["value"]), []).append(label)
    networks = {n for ns in nets.values() for n in ns}
    for q, ds in dists.items():
        studios.setdefault(q, []).extend(d for d in ds if d not in networks)

    found = {}
    for i in items:
        q = qids.get(i["id"])
        n, s = nets.get(q, []), studios.get(q, [])
        if i["type"] == "tv" and not n and i.get("tvmaze"):
            n = tvmaze_networks(i["tvmaze"], cache)
        found[i["id"]] = (list(dict.fromkeys(n)), [x for x in dict.fromkeys(s) if x not in n])
    save_cache(cache)

    # Re-read just before writing so edits made in the app meanwhile aren't lost.
    shutil.copyfile(LIB, ROOT / "data" / "backups" / "library-before-networks.json")
    lib = json.loads(LIB.read_text())
    changed = 0
    for i in lib["items"]:
        if i["id"] not in found:
            continue
        before = (i.get("networks"), i.get("studios"))
        for key, val in zip(("networks", "studios"), found[i["id"]]):
            if val:
                i[key] = val
            else:
                i.pop(key, None)
        changed += before != (i.get("networks"), i.get("studios"))
    tmp = LIB.with_suffix(".tmp")
    tmp.write_text(json.dumps(lib, indent=1))
    os.replace(tmp, LIB)
    n_net = sum(1 for v in found.values() if v[0])
    n_std = sum(1 for v in found.values() if v[1])
    print(f"networks for {n_net} titles, studios for {n_std}; {changed} titles updated")


if __name__ == "__main__":
    main()
