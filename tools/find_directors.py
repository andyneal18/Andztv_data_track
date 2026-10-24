"""Build director collections for directors you clearly collect.

    python3 tools/find_directors.py            # show who you collect (no changes)
    python3 tools/find_directors.py --write    # write data/curated/directors.json
    python3 tools/apply_curated.py && python3 tools/enrich.py

The dry run lists every director you own 3+ films by. Only names in PICK get a
collection: directors whose work you seem to collect for its own sake (not just
because they made franchise entries you own). Edit PICK to add or remove.
"""
import json
import sys
import urllib.parse
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from find_collections import FILM_CLASSES, chunks, qid, sparql  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "data" / "library.json"
OUT = ROOT / "data" / "curated" / "directors.json"

PICK = {
    "Christopher Nolan", "Wes Anderson", "Steven Spielberg", "Tim Burton", "Robert Zemeckis",
    "Hayao Miyazaki", "Peter Jackson", "Quentin Tarantino", "David Fincher", "Rian Johnson",
    "Taika Waititi", "Phil Lord", "Christopher Miller", "James Gunn", "Brad Bird", "Josh Safdie",
    "Matt Johnson", "Chloé Zhao", "Ryan Coogler", "Bo Burnham", "Edgar Wright",
}
# Works Wikidata doesn't class as films (stand-up specials etc.), added by hand.
ADD = {
    "Bo Burnham": [{"title": "Bo Burnham: what.", "year": 2013, "wiki": "What. (Bo Burnham album)"},
                   {"title": "Bo Burnham: Inside", "year": 2021, "wiki": "Bo Burnham: Inside"}],
}
# Directing duos get one shared collection.
DUOS = {"Christopher Miller": "Phil Lord"}
DUO_NAMES = {"Phil Lord": "Phil Lord & Christopher Miller"}


def main():
    lib = json.loads(LIB.read_text())
    owned = {i["wikidata"]: i for i in lib["items"] if i.get("wikidata") and i["status"] != "missing"}

    directed = {}  # director qid -> {"name", "owned": set()}
    for batch in chunks(list(owned), 150):
        vals = " ".join(f"wd:{q}" for q in batch)
        for r in sparql(f"""
            SELECT ?m ?d ?dLabel WHERE {{
              VALUES ?m {{ {vals} }}
              ?m wdt:P57 ?d .
              SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
            }}"""):
            d = directed.setdefault(qid(r["d"]["value"]), {"name": r["dLabel"]["value"], "owned": set()})
            d["owned"].add(qid(r["m"]["value"]))

    cands = {k: v for k, v in directed.items() if len(v["owned"]) >= 3 or v["name"] in PICK}
    classes = " ".join(f"wd:{c}" for c in FILM_CLASSES)
    films = {k: {} for k in cands}
    for batch in chunks(list(cands), 10):
        vals = " ".join(f"wd:{d}" for d in batch)
        for r in sparql(f"""
            SELECT ?d ?m (SAMPLE(?lbl) AS ?title) (MIN(?dt) AS ?date) (SAMPLE(?art) AS ?article) WHERE {{
              VALUES ?d {{ {vals} }}
              ?m wdt:P57 ?d ; wdt:P31 ?cls . VALUES ?cls {{ {classes} }}
              FILTER NOT EXISTS {{ ?m wdt:P31 wd:Q24862 }}   # short films
              FILTER NOT EXISTS {{ ?m wdt:P31 wd:Q21191270 }} # TV episodes
              ?m rdfs:label ?lbl FILTER(lang(?lbl) = "en")
              ?m wdt:P577 ?dt .
              ?art schema:about ?m ; schema:isPartOf <https://en.wikipedia.org/> .
            }} GROUP BY ?d ?m"""):
            m = qid(r["m"]["value"])
            films[qid(r["d"]["value"])][m] = {
                "title": r["title"]["value"], "date": r["date"]["value"][:10],
                "wiki": urllib.parse.unquote(r["article"]["value"].rsplit("/", 1)[-1]).replace("_", " "),
            }

    today = date.today().isoformat()
    chosen = []
    for d, info in sorted(cands.items(), key=lambda kv: -len(kv[1]["owned"])):
        fl = {m: f for m, f in films[d].items() if f["date"] <= today}
        n_own = len(info["owned"] & set(fl)) or len(info["owned"])
        share = n_own / max(len(fl), 1)
        ok = info["name"] in PICK and info["name"] not in DUOS and len(fl) >= 3
        print(f"{'✓' if ok else ' '} {info['name']:30} own {n_own:2} of {len(fl):3} ({share:.0%})")
        if ok:
            chosen.append((d, info, fl))

    if "--write" not in sys.argv:
        print("\n(dry run; pass --write to save)")
        return
    # Fold duo partners' films into the lead's collection.
    by_name = {info["name"]: (d, info, fl) for d, info, fl in chosen}
    for d, info in cands.items():
        lead = DUOS.get(info["name"])
        if lead in by_name:
            by_name[lead][2].update({m: f for m, f in films[d].items() if f["date"] <= today})
    cols = []
    for d, info, fl in chosen:
        items = []
        for m, f in sorted(fl.items(), key=lambda kv: kv[1]["date"]):
            o = owned.get(m)
            e = {"title": o["title"] if o else f["title"], "year": o.get("year") if o else int(f["date"][:4]),
                 "type": "movie", "wiki": f["wiki"]}
            if o and o["title"] != f["title"]:
                e["aka"] = [f["title"]]
            items.append(e)
        for e in ADD.get(info["name"], []):
            o = next((x for x in owned.values() if x["title"].lower() == e["title"].lower()), None)
            items.append({**e, "type": "movie", **({"title": o["title"], "year": o["year"]} if o else {})})
        items.sort(key=lambda e: e["year"] or 0)
        cols.append({"id": f"cur-dir-{d.lower()}", "name": DUO_NAMES.get(info["name"], info["name"]),
                     "kind": "Director", "items": items})
    OUT.write_text(json.dumps({"collections": cols}, indent=1, ensure_ascii=False))
    print(f"\nwrote {len(cols)} director collections to {OUT}")


if __name__ == "__main__":
    main()
