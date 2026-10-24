// andztv library — tiny local server, no dependencies.
//   node server.js        then open http://localhost:4545
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const PORT = process.env.PORT || 4545;
// Optional password (set ANDZTV_PASSWORD). The browser asks once and remembers it.
const PASSWORD = process.env.ANDZTV_PASSWORD || "";
const ROOT = __dirname;
const LIB = path.join(ROOT, "data", "library.json");
const BACKUPS = path.join(ROOT, "data", "backups");
const POSTERS = path.join(ROOT, "posters");
const PUBLIC = path.join(ROOT, "public");
const UA = "andztv-library/1.0 (personal media catalog)";
// Wikimedia asks tools to include contact info (see data/config.json); other hosts get the plain UA.
let contact = null;
try { contact = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "config.json"))).contact; } catch {}
const WIKI_UA = contact ? `andztv-library/1.0 (personal media catalog; ${contact})` : UA;
const uaFor = (url) => (/\.(wikipedia|wikimedia|wikidata)\.org/.test(url) ? WIKI_UA : UA);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
};

fs.mkdirSync(BACKUPS, { recursive: true });
fs.mkdirSync(POSTERS, { recursive: true });

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 20e6) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) reject(new Error("too large"));
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Keep a rolling backup at most every 10 minutes, newest 40 kept.
let lastBackup = 0;
function backup() {
  if (Date.now() - lastBackup < 10 * 60e3 || !fs.existsSync(LIB)) return;
  lastBackup = Date.now();
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  fs.copyFileSync(LIB, path.join(BACKUPS, `library-${stamp}.json`));
  const old = fs.readdirSync(BACKUPS).sort().slice(0, -40);
  old.forEach((f) => fs.unlinkSync(path.join(BACKUPS, f)));
}

function libVersion() {
  return String(fs.statSync(LIB).mtimeMs);
}

function safeId(id) {
  return String(id || "").replace(/[^a-z0-9-]/gi, "").slice(0, 120);
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": uaFor(url) } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function savePosterFromUrl(id, url) {
  const r = await fetch(url, { headers: { "User-Agent": uaFor(url) } });
  if (!r.ok) throw new Error(`image fetch failed (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 500) throw new Error("image too small");
  const file = `${id}-${Date.now().toString(36)}.jpg`;
  fs.writeFileSync(path.join(POSTERS, file), buf);
  return file;
}

// IMDb's public search-suggestion feed (what the imdb.com search box uses).
// Searching a person ("shane gillis") also returns their specials/films.
const IMDB_KIND = {
  movie: ["movie", null], tvMovie: ["movie", "TV movie"], tvSpecial: ["movie", "TV special"],
  video: ["movie", "Direct-to-video"], short: ["movie", "Short"], tvShort: ["movie", "Short"],
  tvSeries: ["tv", null], tvMiniSeries: ["tv", "Miniseries"],
};
function imdbPoster(i) {
  // Ask Amazon's image CDN for a 600px-wide version instead of the original.
  return i?.imageUrl ? i.imageUrl.replace(/\._V1_.*\.jpg$/, "._V1_UX600_.jpg") : null;
}
function fromImdb(x) {
  const [type, format] = IMDB_KIND[x.qid] || [];
  if (!type) return null; // people, video games, podcasts…
  return {
    source: "imdb", imdb: x.id, title: x.l, year: x.y || null, type, format,
    description: [x.q, x.s].filter(Boolean).join(" · "), poster: imdbPoster(x.i),
  };
}
async function imdbSearch(q) {
  const key = q.trim().toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!key) return [];
  const data = await fetchJson(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(key)}.json?includeVideos=0`);
  return (data.d || []).map(fromImdb).filter(Boolean);
}
async function imdbTitle(id) {
  const data = await fetchJson(`https://v3.sg.media-imdb.com/suggestion/t/${id}.json`);
  const hit = (data.d || []).find((x) => x.id === id);
  if (!hit) throw new Error("IMDb has no title with that ID");
  return fromImdb(hit) || { source: "imdb", imdb: hit.id, title: hit.l, year: hit.y || null, poster: imdbPoster(hit.i) };
}

// Search IMDb, Wikipedia (and TVmaze for shows) so new titles get artwork.
async function lookup(q, type) {
  const kind = type === "tv" ? "TV series" : type === "movie" ? "film" : "";
  const params = new URLSearchParams({
    action: "query", format: "json", generator: "search", gsrsearch: `${q} ${kind}`.trim(),
    gsrlimit: "8", prop: "pageprops|pageimages|description", ppprop: "wikibase_item",
    piprop: "thumbnail", pithumbsize: "500", pilicense: "any",
  });
  const out = [];
  let imdb = [];
  const tasks = [imdbSearch(q).then((r) => (imdb = type ? r.filter((x) => x.type === type) : r)),
    fetchJson(`https://en.wikipedia.org/w/api.php?${params}`).then((data) => {
    const pages = Object.values(data.query?.pages || {}).sort((a, b) => a.index - b.index);
    for (const p of pages) {
      const desc = p.description || "";
      if (/disambiguation/i.test(desc)) continue;
      // Only actual works, not people, lists or places.
      if (!/film|movie|series|special|documentary|sitcom|anime|miniseries|show|cartoon/i.test(desc) || /^list of/i.test(p.title)) continue;
      const y = (desc + " " + p.title).match(/\b(1[89]\d\d|20\d\d)\b/);
      const isTv = /series|television|sitcom|show|anime/i.test(desc);
      out.push({
        source: "wikipedia", title: p.title.replace(/ \((\d{4} )?(American |British )?(film|TV series|miniseries|television series)\)$/, ""),
        wiki: p.title, wikidata: p.pageprops?.wikibase_item, description: desc,
        year: y ? +y[1] : null, type: isTv ? "tv" : "movie", poster: p.thumbnail?.source || null,
      });
    }
  })];
  if (type !== "movie") {
    tasks.push(fetchJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`).then((rs) => {
      for (const { show } of rs.slice(0, 4)) {
        out.push({
          source: "tvmaze", title: show.name, tvmaze: show.id, type: "tv",
          year: show.premiered ? +show.premiered.slice(0, 4) : null,
          description: `TV series${show.network ? " · " + show.network.name : ""}`,
          poster: show.image?.original || show.image?.medium || null,
        });
      }
    }));
  }
  await Promise.allSettled(tasks);
  // IMDb first; drop Wikipedia/TVmaze hits that are the same title & year.
  const norm = (t) => String(t).toLowerCase().replace(/^(the|a|an) /, "").replace(/[^a-z0-9]+/g, "");
  const seen = new Set(imdb.map((x) => norm(x.title) + "|" + x.year));
  return [...imdb, ...out.filter((x) => !seen.has(norm(x.title) + "|" + x.year))];
}

let toolRunning = false;
function runTools() {
  return new Promise((resolve, reject) => {
    const py = process.env.PYTHON || "python3";
    execFile(py, [path.join(ROOT, "tools", "find_collections.py")], { cwd: ROOT, timeout: 15 * 60e3 }, (err, out1, e1) => {
      if (err) return reject(new Error(e1 || err.message));
      execFile(py, [path.join(ROOT, "tools", "apply_curated.py")], { cwd: ROOT, timeout: 5 * 60e3 }, (errC, outC, eC) => {
        if (errC) return reject(new Error(eC || errC.message));
        execFile(py, [path.join(ROOT, "tools", "enrich.py")], { cwd: ROOT, timeout: 30 * 60e3 }, (err2, out2, e2) => {
          if (err2) return reject(new Error(e2 || err2.message));
          // Networks & studios, so search finds "disney channel", "netflix"…
          execFile(py, [path.join(ROOT, "tools", "find_networks.py")], { cwd: ROOT, timeout: 15 * 60e3 }, (err3, out3, e3) => {
            if (err3) return reject(new Error(e3 || err3.message));
            resolve((out1 + outC + out2 + out3).trim());
          });
        });
      });
    });
  });
}

function authorized(req) {
  if (!PASSWORD) return true;
  const [scheme, token] = (req.headers.authorization || "").split(" ");
  if (scheme !== "Basic" || !token) return false;
  const pass = Buffer.from(token, "base64").toString().split(":").slice(1).join(":");
  return pass.length === PASSWORD.length && require("crypto").timingSafeEqual(Buffer.from(pass), Buffer.from(PASSWORD));
}

const server = http.createServer(async (req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="andztv"', "Content-Type": "text/plain" });
    return res.end("Password required");
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (p === "/api/library" && (req.method === "GET" || req.method === "HEAD")) {
      res.setHeader("X-Lib-Version", libVersion());
      return send(res, 200, fs.readFileSync(LIB));
    }
    if (p === "/api/library" && req.method === "PUT") {
      const body = await readBody(req);
      const lib = JSON.parse(body.toString());
      if (!Array.isArray(lib.items) || !Array.isArray(lib.collections)) throw new Error("bad library");
      if (toolRunning) return send(res, 409, { error: "Collections refresh is running; try again in a moment." });
      // Another device/tab (or a tool) changed the library since this page loaded it.
      // (Pages from before this check existed send no version: make them reload too.)
      const base = req.headers["x-lib-version"];
      if (base === undefined || (base && base !== libVersion())) {
        return send(res, 409, { error: "Library changed elsewhere. Reload the page.", stale: true });
      }
      backup();
      const tmp = LIB + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(lib, null, 1));
      fs.renameSync(tmp, LIB);
      return send(res, 200, { ok: true, version: libVersion() });
    }
    if (p === "/api/imdb") {
      const id = (url.searchParams.get("id") || "").match(/tt\d{5,10}/)?.[0];
      if (!id) return send(res, 400, { error: "That doesn't look like an IMDb ID (tt1234567)" });
      return send(res, 200, await imdbTitle(id));
    }
    if (p === "/api/lookup") {
      return send(res, 200, await lookup(url.searchParams.get("q") || "", url.searchParams.get("type")));
    }
    if (p === "/api/poster" && req.method === "POST") {
      const id = safeId(url.searchParams.get("id"));
      if (!id) throw new Error("missing id");
      let file;
      if ((req.headers["content-type"] || "").startsWith("image/")) {
        file = `${id}-${Date.now().toString(36)}.jpg`;
        fs.writeFileSync(path.join(POSTERS, file), await readBody(req));
      } else {
        const { url: imgUrl } = JSON.parse((await readBody(req)).toString());
        file = await savePosterFromUrl(id, imgUrl);
      }
      return send(res, 200, { poster: file });
    }
    if (p === "/api/refresh-collections" && req.method === "POST") {
      if (toolRunning) return send(res, 409, { error: "already running" });
      toolRunning = true;
      backup();
      try {
        return send(res, 200, { ok: true, log: await runTools() });
      } finally {
        toolRunning = false;
      }
    }
    if (p === "/api/export.csv") {
      const lib = JSON.parse(fs.readFileSync(LIB));
      const colOf = {};
      lib.collections.forEach((c) => c.items.forEach((id) => (colOf[id] ||= []).push(c.name)));
      const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const rows = [["Title", "Year", "Type", "Status", "Requested By", "Priority", "Collections", "Notes"]];
      for (const i of lib.items) {
        rows.push([i.title, i.year, i.type, i.status, i.request?.by, i.request?.priority, (colOf[i.id] || []).join("; "), i.notes]);
      }
      res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="andztv-library.csv"' });
      return res.end(rows.map((r) => r.map(esc).join(",")).join("\n"));
    }

    // Static files
    let file;
    if (p.startsWith("/posters/")) file = path.join(POSTERS, path.basename(p));
    else file = path.join(PUBLIC, p === "/" ? "index.html" : path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(PUBLIC) && !file.startsWith(POSTERS)) return send(res, 403, "forbidden", "text/plain");
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, "not found", "text/plain");
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": file.startsWith(POSTERS) ? "max-age=86400" : "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`andztv library running at http://localhost:${PORT}`));
