"""Match library titles to Wikipedia/Wikidata and download poster artwork.

    python3 tools/enrich.py            # match + posters for anything missing them
    python3 tools/enrich.py --retry    # also retry titles that failed to match

Lookups are cached in data/.cache so re-runs are fast. Safe to run while the
app is stopped; it edits data/library.json in place.
"""
import difflib
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "data" / "library.json"
POSTERS = ROOT / "posters"
UA = "andztv-library/1.0 (personal media catalog)"
try:  # Wikimedia asks tools to include contact info; it raises their rate limit a lot.
    _contact = json.loads((ROOT / "data" / "config.json").read_text()).get("contact")
except (OSError, ValueError):
    _contact = None
WIKI_UA = f"andztv-library/1.0 (personal media catalog; {_contact})" if _contact else UA


def ua_for(url):
    return WIKI_UA if re.search(r"\.(wikipedia|wikimedia|wikidata)\.org", url) else UA


_lock = threading.Lock()
_last = [0.0]


def throttle(gap=0.5):
    # Wikimedia rate-limits bursts; keep requests politely spaced across threads.
    with _lock:
        wait = _last[0] + gap - time.time()
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()


def get_json(url, tries=6):
    for i in range(tries):
        throttle()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua_for(url)})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if i == tries - 1 or e.code not in (429, 500, 502, 503, 504):
                raise
            time.sleep(float(e.headers.get("Retry-After") or 0) or 5 * (i + 1))
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


_img_lock = threading.Lock()
_img_last = [0.0]


def download(url, dest, tries=6):
    # upload.wikimedia.org is stricter than the API; pace images separately.
    for i in range(tries):
        with _img_lock:
            wait = _img_last[0] + 0.9 - time.time()
            if wait > 0:
                time.sleep(wait)
            _img_last[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua_for(url)})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            break
        except urllib.error.HTTPError as e:
            if i == tries - 1 or e.code not in (429, 500, 502, 503, 504):
                raise
            with _img_lock:  # back off everyone, not just this thread
                time.sleep(float(e.headers.get("Retry-After") or 0) or 10 * (i + 1))
    if len(data) < 500:
        raise ValueError("image too small")
    dest.write_bytes(data)


def norm(s):
    s = s.lower().replace("&", "and")
    s = re.sub(r"\(.*?\)", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def wiki_search(query):
    params = {
        "action": "query", "format": "json", "generator": "search",
        "gsrsearch": query, "gsrlimit": 6,
        "prop": "pageprops|pageimages|description",
        "ppprop": "wikibase_item", "piprop": "thumbnail",
        "pithumbsize": 500, "pilicense": "any",
    }
    data = get_json("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(params))
    pages = list((data.get("query") or {}).get("pages", {}).values())
    return sorted(pages, key=lambda p: p.get("index", 99))


def wiki_poster(title):
    params = {
        "action": "query", "format": "json", "titles": title, "redirects": 1,
        "prop": "pageimages", "piprop": "thumbnail", "pithumbsize": 500, "pilicense": "any",
    }
    data = get_json("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(params))
    for p in data.get("query", {}).get("pages", {}).values():
        return (p.get("thumbnail") or {}).get("source")


KIND_WORDS = {
    "movie": ("film", "movie", "documentary", "concert", "special", "musical"),
    "tv": ("series", "television", "tv", "sitcom", "show", "anime", "miniseries", "serial", "programme", "soap"),
}


def words(s):
    s = re.sub(r"\(.*?\)", "", s.lower().replace("&", "and"))
    return set(re.findall(r"[a-z0-9]+", s)) - {"the", "a", "an"}


def similar(a, b):
    ta, tb = words(a), words(b)
    a, b = norm(a), norm(b)
    if a == b or (min(len(a), len(b)) >= 4 and (a in b or b in a)):
        return True
    if ta and tb and len(ta & tb) / len(ta | tb) >= 0.75:  # same words, different order
        return True
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.75


def score(page, item):
    desc = (page.get("description") or "").lower()
    title = norm(page["title"])
    want = norm(item["title"])
    # A same-year film with a different name is not a match (e.g. a documentary
    # matching whatever big film came out that year).
    if not similar(page["title"], item["title"]):
        return -99
    s = 0
    if title == want:
        s += 4
    elif want in title or title in want:
        s += 2
    if any(w in desc for w in KIND_WORDS[item["type"]]):
        s += 3
    elif any(w in desc for w in KIND_WORDS["tv" if item["type"] == "movie" else "movie"]):
        s -= 3
    y = item.get("year")
    if y:
        years = [int(m) for m in re.findall(r"(?<!\d)(1[89]\d\d|20\d\d)(?!\d)", desc + " " + page["title"])]
        if y in years:
            s += 4
        elif any(abs(y - x) <= 1 for x in years):
            s += 2
        elif years:
            s -= 2
    if "disambiguation" in desc or "list of" in page["title"].lower():
        s -= 10
    return s


def match(item):
    kind = "film" if item["type"] == "movie" else "TV series"
    queries = [f'{item["title"]} {item.get("year") or ""} {kind}', item["title"]]
    best, best_s = None, 0
    for q in queries:
        for p in wiki_search(q):
            sc = score(p, item)
            if sc > best_s:
                best, best_s = p, sc
        if best_s >= 9:
            break
    if not best or best_s < 5:
        return None
    return {
        "wiki": best["title"],
        "wikidata": (best.get("pageprops") or {}).get("wikibase_item"),
        "description": best.get("description"),
        "posterUrl": (best.get("thumbnail") or {}).get("source"),
        "matchScore": best_s,
    }


def tvmaze_poster(item):
    q = urllib.parse.urlencode({"q": item["title"]})
    results = get_json(f"https://api.tvmaze.com/search/shows?{q}")
    y = item.get("year")
    for r in results:
        show = r["show"]
        prem = int((show.get("premiered") or "0")[:4] or 0)
        if norm(show["name"]) == norm(item["title"]) and (not y or not prem or abs(prem - y) <= 1):
            img = show.get("image") or {}
            return show["id"], img.get("original") or img.get("medium")
    return None, None


def enrich(item, retry):
    changed = False
    if "wiki" not in item or (retry and item.get("wiki") is None):
        try:
            m = match(item)
        except Exception as e:
            print("  match error", item["title"], e)
            return False
        if m:
            item.update({k: v for k, v in m.items() if k != "posterUrl"})
            item["_posterUrl"] = m["posterUrl"]
        else:
            item["wiki"] = None
        changed = True

    if item["type"] == "tv" and "tvmaze" not in item:
        try:
            tid, img = tvmaze_poster(item)
            item["tvmaze"] = tid
            if img:
                item["_posterUrl"] = img  # TVmaze art is higher resolution
        except Exception as e:
            print("  tvmaze error", item["title"], e)
        changed = True

    dest = POSTERS / f'{item["id"]}.jpg'
    url = item.pop("_posterUrl", None)
    if not url and item.get("wiki") and not item.get("poster") and not dest.exists():
        try:
            url = wiki_poster(item["wiki"])
        except Exception as e:
            print("  poster lookup error", item["title"], e)
    if not item.get("poster") and url and not dest.exists():
        try:
            download(url, dest)
        except Exception as e:
            print("  poster error", item["title"], e)
    if dest.exists() and item.get("poster") != dest.name:
        item["poster"] = dest.name
        changed = True
    return changed


def main():
    retry = "--retry" in sys.argv
    POSTERS.mkdir(exist_ok=True)
    lib = json.loads(LIB.read_text())
    todo = [i for i in lib["items"] if "wiki" not in i or not i.get("poster") or (retry and i.get("wiki") is None)]
    print(f"{len(todo)} titles to process")
    done = 0
    with ThreadPoolExecutor(max_workers=2) as ex:
        for _ in ex.map(lambda it: enrich(it, retry), todo):
            done += 1
            if done % 50 == 0:
                print(f"  {done}/{len(todo)}")
                try:  # checkpoint; workers may be mid-update, so skip on a race
                    LIB.write_text(json.dumps(lib, indent=1))
                except RuntimeError:
                    pass
    LIB.write_text(json.dumps(lib, indent=1))
    items = lib["items"]
    print(f"matched {sum(1 for i in items if i.get('wiki'))}/{len(items)}, "
          f"posters {sum(1 for i in items if i.get('poster'))}/{len(items)}")


if __name__ == "__main__":
    main()
