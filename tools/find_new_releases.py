"""Find new releases for curated collections (Laika's next film, a new Snoopy special…).

    python3 tools/find_new_releases.py          # then apply_curated.py + enrich.py
    python3 tools/find_new_releases.py --dry    # just print what it would add

Curated lists in data/curated/*.json are fixed, so new films never show up in them
by themselves. A curated collection can say where to watch for new entries:

    "watch": {
      "wikidata":   [["P272", "Q1314323"]],          # production company = Laika
      "categories": ["Category:Peanuts specials"],    # new Wikipedia articles
      "lists": [{"page": "List of Apple TV original programming",
                 "match": "^Snoopy Presents", "format": "TV special"}]  # rows in list tables
    }

Director collections ("cur-dir-Q…") are watched automatically (director = that person).

Only titles that are already out (release date on or before today), and no older
than the newest title already in the collection, are taken, so the lists don't fill
up with old shorts or announced-but-unreleased films. Finds are saved to
data/discovered.json; apply_curated.py merges them into the collections.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "data" / "library.json"
CURATED = ROOT / "data" / "curated"
OUT = ROOT / "data" / "discovered.json"
UA = "andztv-library/1.0 (personal media catalog)"
try:  # Wikimedia asks tools to include contact info; it raises their rate limit a lot.
    _contact = json.loads((ROOT / "data" / "config.json").read_text()).get("contact")
except (OSError, ValueError):
    _contact = None
WIKI_UA = f"andztv-library/1.0 (personal media catalog; {_contact})" if _contact else UA

# Feature films, TV films/specials and series. No shorts or single episodes.
FILM_CLASSES = ["Q11424", "Q29168811", "Q202866", "Q506240", "Q93204", "Q24869", "Q229390", "Q1261214"]
TV_CLASSES = ["Q5398426", "Q581714", "Q1259759", "Q526877", "Q15416"]
TODAY = date.today().isoformat()
MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], 1)}


def ua_for(url):
    return WIKI_UA if re.search(r"\.(wikipedia|wikimedia|wikidata)\.org", url) else UA


_last = [0.0]


def get_json(url, data=None, tries=4):
    for i in range(tries):
        wait = _last[0] + 1.0 - time.time()  # one request a second; Wikimedia rate-limits bursts
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            headers = {"User-Agent": ua_for(url)}
            if data:
                headers["Content-Type"] = "application/x-www-form-urlencoded"
            req = urllib.request.Request(url, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if i == tries - 1 or e.code not in (429, 500, 502, 503, 504):
                raise
            time.sleep(float(e.headers.get("Retry-After") or 0) or 5 * (i + 1))
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


def sparql(query):
    data = urllib.parse.urlencode({"query": query, "format": "json"}).encode()
    return get_json("https://query.wikidata.org/sparql", data)["results"]["bindings"]


def wiki_api(**params):
    params.update(format="json", formatversion=2)
    return get_json("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(params))


def norm(s):
    s = s.lower().replace("&", "and")
    s = re.sub(r"[’'`]", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return re.sub(r"^(the|a|an) ", "", s)


def bare(title):
    """Article title without its disambiguation: 'Wildwood (film)' -> 'Wildwood'."""
    return re.sub(r" \((\d{4} )?([A-Z][a-z]+ )?(film|TV series|television series|miniseries|TV special|special)\)$", "", title)


# ---------------------------------------------------------------- sources

def from_wikidata(prop, value, since, films_only=False):
    classes = " ".join(f"wd:{c}" for c in FILM_CLASSES + ([] if films_only else TV_CLASSES))
    rows = sparql(f"""
        SELECT ?m (SAMPLE(?lbl) AS ?label) (MIN(?d) AS ?date) (SAMPLE(?art) AS ?article) (SAMPLE(?cls) AS ?c) WHERE {{
          ?m wdt:{prop} wd:{value} .
          ?m wdt:P31 ?cls . VALUES ?cls {{ {classes} }}
          ?m rdfs:label ?lbl FILTER(lang(?lbl) = "en")
          ?m wdt:P577 ?d .
          ?art schema:about ?m ; schema:isPartOf <https://en.wikipedia.org/> .
        }} GROUP BY ?m
        HAVING(MIN(?d) >= "{since}-01-01T00:00:00Z"^^xsd:dateTime && MIN(?d) <= "{TODAY}T23:59:59Z"^^xsd:dateTime)""")
    out = []
    for r in rows:
        wiki = urllib.parse.unquote(r["article"]["value"].rsplit("/", 1)[-1]).replace("_", " ")
        d = r["date"]["value"][:10]
        out.append({"title": bare(wiki) if norm(bare(wiki)) == norm(r["label"]["value"]) else r["label"]["value"],
                    "year": int(d[:4]), "date": d, "wiki": wiki, "qid": r["m"]["value"].rsplit("/", 1)[-1],
                    "type": "tv" if r["c"]["value"].rsplit("/", 1)[-1] in TV_CLASSES else "movie"})
    return out


def infobox_date(text):
    """First release date in an article's infobox: {{Start date|2026|11|13}} / {{Film date|…}}."""
    box = text[:6000]
    m = re.search(r"\|\s*(released|release_date|first_aired|air_date|premiere)\s*=([^\n]*(?:\n\s*\*[^\n]*)*)", box)
    if not m:
        return None
    return find_date(m.group(2))


def find_date(s):
    m = re.search(r"\{\{\s*(?:start date|film date|release date)[^|}]*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})", s, re.I)
    if m:
        return f"{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}"
    m = re.search(r"\b(" + "|".join(MONTHS) + r")\.? (\d{1,2}),? (\d{4})", s, re.I)
    if m:
        return f"{m[3]}-{MONTHS[m[1].lower()]:02d}-{int(m[2]):02d}"
    m = re.search(r"\b(\d{1,2}) (" + "|".join(MONTHS) + r") (\d{4})", s, re.I)
    if m:
        return f"{m[3]}-{MONTHS[m[2].lower()]:02d}-{int(m[1]):02d}"
    m = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", s)
    return m and f"{m[1]}-{m[2]}-{m[3]}"


def from_categories(cats, known_wiki, since, fmt=None):
    pages = []
    for cat in cats:
        cont = {}
        while True:
            d = wiki_api(action="query", list="categorymembers", cmtitle=cat, cmnamespace=0, cmlimit=500, **cont)
            pages += [m["title"] for m in d["query"]["categorymembers"]]
            if "continue" not in d:
                break
            cont = {"cmcontinue": d["continue"]["cmcontinue"]}
    todo = [p for p in dict.fromkeys(pages) if p.lower() not in known_wiki and not p.lower().startswith(("list of", "peanuts filmography"))]
    out = []
    for i in range(0, len(todo), 20):
        d = wiki_api(action="query", titles="|".join(todo[i:i + 20]), prop="revisions|pageprops|description",
                     rvprop="content", rvslots="main", ppprop="wikibase_item")
        for p in d["query"]["pages"]:
            desc = p.get("description", "")
            text = p.get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("content", "")
            if not re.search(r"film|movie|special|series|show|documentary", desc, re.I) or "disambiguation" in desc.lower():
                continue  # characters, songs, list pages…
            d8 = infobox_date(text)
            if not d8 or d8 > TODAY or int(d8[:4]) < since:
                continue
            tv = re.search(r"series|show", desc, re.I) and not re.search(r"special|film", desc, re.I)
            e = {"title": bare(p["title"]), "year": int(d8[:4]), "date": d8, "wiki": p["title"],
                 "type": "tv" if tv else "movie", "qid": p.get("pageprops", {}).get("wikibase_item")}
            if not tv and (fmt or re.search(r"special", desc, re.I)):
                e["format"] = fmt or "TV special"
            out.append(e)
    return out


def from_list(page, match, since, typ="movie", fmt=None):
    """Rows of the tables on a list page: italic title + release date in the same row."""
    text = wiki_api(action="parse", page=page, prop="wikitext", redirects=1)["parse"]["wikitext"]
    text = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", "", text, flags=re.S)  # refs hold their own dates/titles
    out = []
    for row in re.split(r"\n\|-", text):
        t = re.search(r"''\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*''|''([^'\[\]\n{}|][^'\n{}|]*?)''", row)
        if not t:
            continue
        wiki = t[1].strip() if t[1] else None
        title = (t[2] or (bare(t[1]) if t[1] else t[3])).strip()
        if match and not re.search(match, title, re.I):
            continue
        d8 = find_date(row[t.end():])
        if not d8 or d8 > TODAY or int(d8[:4]) < since:
            continue
        e = {"title": title, "year": int(d8[:4]), "date": d8, "type": typ}
        if wiki:
            e["wiki"] = wiki
        if fmt:
            e["format"] = fmt
        out.append(e)
    return out


def imdb_poster(e):
    """IMDb id + poster for a title with the exact same name and year (for posters
    of titles too new to have a Wikipedia article)."""
    key = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", e["title"].lower())).strip()
    try:
        d = get_json(f"https://v3.sg.media-imdb.com/suggestion/x/{urllib.parse.quote(key)}.json?includeVideos=0")
    except Exception:
        return
    for x in d.get("d", []):
        if norm(x.get("l", "")) == norm(e["title"]) and x.get("y") == e["year"]:
            e["imdb"] = x["id"]
            img = (x.get("i") or {}).get("imageUrl")
            if img:
                e["posterUrl"] = re.sub(r"\._V1_.*\.jpg$", "._V1_UX600_.jpg", img)
            return


# ---------------------------------------------------------------- main

def main():
    dry = "--dry" in sys.argv
    lib = json.loads(LIB.read_text())
    by_id = {i["id"]: i for i in lib["items"]}
    dismissed = set(lib.get("dismissedItems", [])) | set(lib.get("dismissedCollections", []))
    found = json.loads(OUT.read_text()) if OUT.exists() else {}
    lib_cols = {c["id"]: c for c in lib["collections"]}

    added = 0
    for f in sorted(CURATED.glob("*.json")):
        for col in json.loads(f.read_text())["collections"]:
            cid = col["id"]
            if cid in dismissed:
                continue
            watch = dict(col.get("watch") or {})
            m = re.fullmatch(r"cur-dir-(q\d+)", cid)
            if m:
                watch.setdefault("wikidata", [["P57", m[1].upper(), "films"]])  # director; films only, like find_directors.py
            if not watch:
                continue
            # What the collection already has: the curated list, earlier finds, and its live items.
            have = list(col["items"]) + found.get(cid, [])
            have += [by_id[x] for x in lib_cols.get(cid, {}).get("items", []) if x in by_id]
            known_wiki = {(e.get("wiki") or "").lower() for e in have} - {""}
            known_qid = {e.get("qid") or e.get("wikidata") for e in have} - {None}
            known_title = {(norm(t), e.get("year")) for e in have for t in [e["title"], *e.get("aka", [])]}
            since = max((e.get("year") or 0) for e in have) if have else date.today().year

            hits = []
            try:
                for prop, value, *opt in watch.get("wikidata", []):
                    hits += from_wikidata(prop, value, since, "films" in opt)
                if watch.get("categories"):
                    hits += from_categories(watch["categories"], known_wiki, since, watch.get("format"))
                for L in watch.get("lists", []):
                    hits += from_list(L["page"], L.get("match"), since, L.get("type", "movie"), L.get("format"))
            except Exception as ex:
                print(f"  {col['name']}: lookup failed ({ex})")
                continue

            for e in hits:
                y = e["year"]
                if (e.get("wiki") or "").lower() in known_wiki or e.get("qid") in known_qid or e.get("qid") in dismissed \
                        or any((norm(e["title"]), yy) in known_title for yy in (y - 1, y, y + 1)):
                    continue
                known_title.add((norm(e["title"]), y))
                known_wiki.add((e.get("wiki") or "").lower())
                if not e.get("wiki"):
                    imdb_poster(e)
                e["found"] = TODAY
                found.setdefault(cid, []).append(e)
                added += 1
                print(f"  new in {col['name']}: {e['title']} ({e['date']})")

    if not dry:
        OUT.write_text(json.dumps(found, indent=1, ensure_ascii=False))
    print(f"new releases: {added} found")


if __name__ == "__main__":
    main()
