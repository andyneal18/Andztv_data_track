"""Discover collections (film series / franchises) from Wikidata.

For every matched title, looks up the series (P179) and media franchise (P8345)
it belongs to, then lists every film / TV series in that group. Members you
don't own are added to the library as "missing" (Don't Have) so gaps show up.

    python3 tools/find_collections.py
    python3 tools/enrich.py          # afterwards, to fetch posters for new titles

Existing collections are kept: auto-collections are refreshed, anything you
deleted stays deleted (tracked in "dismissedCollections"), and collections you
made or edited by hand are never touched.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "data" / "library.json"
UA = "andztv-library/1.0 (personal media catalog)"
try:  # Wikimedia asks tools to include contact info; it raises their rate limit a lot.
    _contact = json.loads((ROOT / "data" / "config.json").read_text()).get("contact")
except (OSError, ValueError):
    _contact = None
WIKI_UA = f"andztv-library/1.0 (personal media catalog; {_contact})" if _contact else UA


def ua_for(url):
    return WIKI_UA if re.search(r"\.(wikipedia|wikimedia|wikidata)\.org", url) else UA
MAX_MEMBERS = 60  # skip mega-franchises; add those by hand if you want them

FILM_CLASSES = [
    "Q11424", "Q29168811", "Q202866", "Q506240", "Q17517379", "Q93204", "Q24869",
    "Q229390", "Q25110269", "Q20650540", "Q1033891", "Q20667187", "Q112158242",
]
TV_CLASSES = [
    "Q5398426", "Q581714", "Q117467246", "Q1259759", "Q63952888", "Q526877",
    "Q15416", "Q21191270", "Q7724161", "Q2484376",
]


def sparql(query, tries=4):
    for i in range(tries):
        try:
            data = urllib.parse.urlencode({"query": query, "format": "json"}).encode()
            req = urllib.request.Request(
                "https://query.wikidata.org/sparql", data=data,
                headers={"User-Agent": WIKI_UA, "Content-Type": "application/x-www-form-urlencoded"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())["results"]["bindings"]
        except Exception as e:
            print("  sparql retry", e)
            time.sleep(5 * (i + 1))
    raise RuntimeError("SPARQL failed")


def qid(uri):
    return uri.rsplit("/", 1)[-1]


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def clean_label(label):
    label = re.sub(r"^list of ", "", label, flags=re.I)
    label = re.sub(r" (film series|franchise|media franchise)$", "", label, flags=re.I)
    label = re.sub(r" in film$", " films", label, flags=re.I)
    return label[:1].upper() + label[1:]


def name_key(label):
    k = re.sub(r"\b(films?|series|the)\b", "", label.lower())
    return re.sub(r"[^a-z0-9]+", "", k)


def chunks(xs, n):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def main():
    lib = json.loads(LIB.read_text())
    items = lib["items"]
    by_qid = {i["wikidata"]: i for i in items if i.get("wikidata")}
    dismissed = set(lib.setdefault("dismissedCollections", []))
    dismissed_items = set(lib.setdefault("dismissedItems", []))  # titles you deleted in the app

    # 1. Which groups do owned titles belong to?
    groups = {}  # gid -> {"label", "kind"}
    for batch in chunks(list(by_qid), 150):
        vals = " ".join(f"wd:{q}" for q in batch)
        rows = sparql(f"""
            SELECT ?item ?grp ?grpLabel ?kind WHERE {{
              VALUES ?item {{ {vals} }}
              {{ ?item wdt:P179 ?grp BIND("series" AS ?kind) }}
              UNION {{ ?item wdt:P8345 ?grp BIND("franchise" AS ?kind) }}
              SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
            }}""")
        for r in rows:
            g = qid(r["grp"]["value"])
            groups.setdefault(g, {"label": r["grpLabel"]["value"], "kind": r["kind"]["value"]})
    print(f"{len(groups)} candidate groups")

    # 2. Members of each group that are films or TV series.
    classes = " ".join(f"wd:{c}" for c in FILM_CLASSES + TV_CLASSES)
    tv_set = set(TV_CLASSES)
    members = {g: {} for g in groups}
    # Series and franchise links are queried separately in small batches;
    # one combined query times out on the public endpoint.
    link = {
        "P179": "?m p:P179 ?st . ?st ps:P179 ?grp . OPTIONAL { ?st pq:P1545 ?ord }",
        "P8345": "?m wdt:P8345 ?grp .",
    }
    rows = []
    for n, batch in enumerate(chunks(list(groups), 8)):
        vals = " ".join(f"wd:{g}" for g in batch)
        for pattern in link.values():
            rows += sparql(f"""
            SELECT ?grp ?m ?cls (SAMPLE(?lbl) AS ?mLabel) (MIN(?d) AS ?date) (SAMPLE(?art) AS ?article) (SAMPLE(?ord) AS ?ordinal) WHERE {{
              VALUES ?grp {{ {vals} }}
              {pattern}
              ?m wdt:P31 ?cls . VALUES ?cls {{ {classes} }}
              ?m rdfs:label ?lbl FILTER(lang(?lbl) = "en")
              OPTIONAL {{ ?m wdt:P577 ?d }}
              OPTIONAL {{ ?art schema:about ?m ; schema:isPartOf <https://en.wikipedia.org/> }}
            }} GROUP BY ?grp ?m ?cls""")
        if n % 10 == 9:
            print(f"  {min((n + 1) * 8, len(groups))}/{len(groups)} groups")
    for r in rows:
        g, m = qid(r["grp"]["value"]), qid(r["m"]["value"])
        label = r["mLabel"]["value"]
        if re.fullmatch(r"Q\d+", label):
            continue  # no English label: probably obscure
        d = r.get("date", {}).get("value", "")[:10]
        entry = members[g].setdefault(m, {
            "qid": m, "title": label, "date": d,
            "type": "movie", "ordinal": r.get("ordinal", {}).get("value"),
            "wiki": urllib.parse.unquote(r["article"]["value"].rsplit("/", 1)[-1]).replace("_", " ")
            if r.get("article") else None,
        })
        if qid(r["cls"]["value"]) in tv_set:
            entry["type"] = "tv"
        if d and (not entry["date"] or d < entry["date"]):
            entry["date"] = d

    # 3. Build collections.
    today = date.today().isoformat()
    existing = {c["id"]: c for c in lib["collections"]}
    new_items = 0
    seen_sets = []
    ordered = sorted(groups, key=lambda g: groups[g]["kind"] != "series")  # series before franchises
    # A series and a franchise with the same name ("Dune" / "Dune") become one collection.
    primary, keep = {}, []
    for g in ordered:
        label = clean_label(groups[g]["label"])
        if re.fullmatch(r"Q\d+", label):
            continue  # no English name on Wikidata
        groups[g]["label"] = label
        k = name_key(label)
        if k in primary:
            for q, m in members[g].items():
                members[primary[k]].setdefault(q, m)
        else:
            primary[k] = g
            keep.append(g)
    used_ids = {i["id"] for i in items}
    for g in keep:
        mem = [m for m in members[g].values()
               if m["date"] and m["date"] <= today and m["wiki"] and m["qid"] not in dismissed_items]
        owned = [m for m in mem if m["qid"] in by_qid]
        if len(mem) < 2 or not owned or len(mem) > MAX_MEMBERS:
            continue
        cid = f"wd-{g}"
        if cid in dismissed or existing.get(cid, {}).get("manual"):
            continue
        qset = frozenset(m["qid"] for m in mem)
        if any(qset <= s for s in seen_sets):
            continue  # franchise adds nothing beyond a series we already have
        seen_sets.append(qset)

        def sort_key(m):
            o = m["ordinal"]
            return (m["date"], float(o) if o and re.fullmatch(r"\d+(\.\d+)?", o) else 999)

        ids = []
        for m in sorted(mem, key=sort_key):
            item = by_qid.get(m["qid"])
            if not item:
                year = int(m["date"][:4])
                prefix = "tv" if m["type"] == "tv" else "m"
                iid = base = f"{prefix}-{slug(m['title'])}-{year}"
                n = 2
                while iid in used_ids:
                    iid, n = f"{base}-{n}", n + 1
                used_ids.add(iid)
                item = {
                    "id": iid,
                    "title": m["title"], "year": year, "type": m["type"],
                    "status": "missing", "addedBy": "collection",
                    "wiki": m["wiki"], "wikidata": m["qid"],
                }
                items.append(item)
                by_qid[m["qid"]] = item
                new_items += 1
            ids.append(item["id"])
        prev = existing.get(cid) or {}
        existing[cid] = {
            "id": cid, "name": groups[g]["label"], "source": "wikidata",
            "kind": groups[g]["kind"], "items": ids,
        }
        existing[cid].update({k: prev[k] for k in ("pinned", "pinnedAt") if k in prev})  # keep your pins

    lib["collections"] = list(existing.values())
    from apply_curated import prune  # fold anything a broader (curated) collection covers
    prune(lib)
    LIB.write_text(json.dumps(lib, indent=1))
    print(f"{len(lib['collections'])} collections, {new_items} missing titles added")


if __name__ == "__main__":
    main()
