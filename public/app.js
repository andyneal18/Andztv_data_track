// andztv library — front end. All data lives in data/library.json via the local server.
const STATUS = {
  downloaded: { label: "Downloaded", short: "Have", hint: "On Jellyfin and checked", icon: "check" },
  in_progress: { label: "In Progress", short: "Ripping", hint: "Ripping / needs review", icon: "clock" },
  missing: { label: "Don't Have", short: "Need", hint: "Still need to get it", icon: "x" },
};
const STATUS_ORDER = ["downloaded", "in_progress", "missing"];

const ICONS = {
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  x: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"/>',
  puzzle: '<path d="M10 4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v4h-4v-2a2 2 0 1 0-4 0v2H6v-4H4a2 2 0 1 1 0-4h2V6h4V4z"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  close: '<path d="M7 7l10 10M17 7 7 17"/>',
  pin: '<path d="M9 4h6l-1 6 4 4H6l4-4-1-6z"/><path d="M12 14v6"/>',
};
const icon = (n) => `<svg class="i" viewBox="0 0 24 24">${ICONS[n]}</svg>`;

let lib = { items: [], collections: [] };
let byId = new Map();
let collsByItem = new Map();
const ui = {
  tab: localGet("tab") || "collections",
  search: "",
  type: "all",
  statuses: new Set(STATUS_ORDER),
  sort: localGet("sort") || "title",
  missingKind: "all",
  collapsedSections: new Set(JSON.parse(localGet("collapsed") || "[]")),
  collapsedCards: new Set(JSON.parse(localGet("collapsedCards") || "[]")),
  expandedCards: new Set(),
  collShow: localGet("collShow") || "incomplete",
  collCat: "all",
  collSort: localGet("collSort") || "name",
  reorder: null,
  reqShowDone: false,
  pinnedCollapsed: !!localGet("pinnedCollapsed"),
  titlesMore: false,
  nextMore: false,
};

function localGet(k) { try { return localStorage.getItem("andztv." + k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem("andztv." + k, v); } catch {} }

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sortTitle = (t) => t.toLowerCase().replace(/^[^a-z0-9]+/, "").replace(/^(the|a|an) /, "");
const posterUrl = (i) => (i.poster ? `/posters/${encodeURIComponent(i.poster)}` : "");

// ---------------------------------------------------------------- data

let libVersion = null;
async function load() {
  const r = await fetch("/api/library");
  libVersion = r.headers.get("X-Lib-Version");
  lib = await r.json();
  lib.collections ||= [];
  lib.dismissedItems ||= [];
  lib.dismissedCollections ||= [];
  reindex();
  render(true);
}

function reindex() {
  byId = new Map(lib.items.map((i) => [i.id, i]));
  collsByItem = new Map();
  lib.collections.forEach((c) => {
    c.items = c.items.filter((id) => byId.has(id));
    c.items.forEach((id) => (collsByItem.get(id) || collsByItem.set(id, []).get(id)).push(c));
  });
}

let saveTimer;
function save() {
  reindex();
  $("#save-state").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const r = await fetch("/api/library", { method: "PUT", headers: { "Content-Type": "application/json", "X-Lib-Version": libVersion || "" }, body: JSON.stringify(lib) });
      const j = await r.json();
      if (j.stale) {
        $("#save-state").textContent = "";
        toast("Your library was updated on another device. Reloaded — please redo your last change.");
        return load();
      }
      if (!r.ok) throw new Error(j.error);
      libVersion = j.version;
      $("#save-state").textContent = "Saved";
    } catch (e) {
      $("#save-state").textContent = "Not saved!";
      toast("Couldn't save: " + e.message);
    }
  }, 400);
}

// Snapshot-based undo for destructive actions.
function withUndo(label, fn) {
  const snap = JSON.stringify(lib);
  fn();
  save();
  render();
  toast(label, "Undo", () => { lib = JSON.parse(snap); save(); render(); });
}

const collectionsOf = (id) => collsByItem.get(id) || [];

function newId(title, year, type) {
  const base = `${type === "tv" ? "tv" : "m"}-${slug(title)}${year ? "-" + year : ""}`;
  let id = base, n = 2;
  while (byId.has(id)) id = `${base}-${n++}`;
  return id;
}

// Insert in release order so a series reads top-to-bottom without manual sorting.
function addToCollection(c, id) {
  if (c.items.includes(id)) return;
  const y = byId.get(id)?.year || 9999;
  const at = c.items.findIndex((x) => (byId.get(x)?.year || 9999) > y);
  at === -1 ? c.items.push(id) : c.items.splice(at, 0, id);
  c.manual = true;
}

function setStatus(item, status) {
  if (item.status === status) return;
  const prev = item.status;
  item.status = status;
  if (status === "in_progress") item.startedAt = today();
  if (status === "downloaded") {
    item.dateAdded ||= today();
    if (item.request && !item.request.fulfilled) item.request.fulfilled = today();
  }
  if (status !== "missing") delete item.failed; // retrying or done: no longer on the Failed list
  save();
}

// A failed rip goes back to Don't Have and onto the Failed list.
function markFailed(item, note = "") {
  const count = (item.failed?.count || 0) + 1;
  setStatus(item, "missing");
  item.failed = { date: today(), count, note };
  item.lastFailed = today();
  save();
}
// Anything flagged as failed (a title you have can still have a failed season/re-rip).
const failedItems = () => lib.items.filter((i) => i.failed);

function deleteItem(item) {
  lib.items = lib.items.filter((i) => i !== item);
  // Remember deletions so re-running the collection tools doesn't bring them back.
  for (const key of [item.wikidata, "id:" + item.id]) if (key && !lib.dismissedItems.includes(key)) lib.dismissedItems.push(key);
  lib.collections.forEach((c) => {
    if (c.items.includes(item.id)) { c.items = c.items.filter((x) => x !== item.id); c.manual = true; }
  });
  reindex();
}

function removeFromCollection(c, item) {
  c.items = c.items.filter((x) => x !== item.id);
  // Curated lists remember the removal (so updates to the list still apply);
  // other collections just become "yours".
  if (c.source === "curated") {
    lib.excludedMembers ||= [];
    const key = `${c.id}|${item.id}`;
    if (!lib.excludedMembers.includes(key)) lib.excludedMembers.push(key);
  } else c.manual = true;
  reindex();
  // A gap that only existed because of this collection goes away with it.
  if (item.addedBy === "collection" && item.status === "missing" && !item.request && !collectionsOf(item.id).length) deleteItem(item);
}

function matchesSearch(item) {
  if (!ui.search) return true;
  const q = ui.search.toLowerCase();
  return item.title.toLowerCase().includes(q) || String(item.year).includes(q) ||
    (item.request?.by || "").toLowerCase().includes(q) ||
    collectionsOf(item.id).some((c) => c.name.toLowerCase().includes(q)) || !!companyMatch(item);
}

// Networks, streamers and studios (from tools/find_networks.py, plus the spreadsheet's Network column).
function companiesOf(item) {
  return [...new Set([...(item.networks || []), ...(item.network || "").split(";").map((s) => s.trim()), ...(item.studios || [])])].filter(Boolean);
}
const normCo = (s) => ` ${s.toLowerCase().replace(/\+/g, " plus").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()} `;
// Other names people search by. Each query also matches the names listed for it.
const CO_ALIASES = {
  hbo: ["max", "hbo max"], max: ["hbo max"], amazon: ["prime video"], prime: ["amazon"],
  apple: ["apple tv"], "apple tv plus": ["apple tv"], nick: ["nickelodeon", "nick jr"], cn: ["cartoon network"], abc: ["american broadcasting company"],
  fox: ["fox broadcasting company", "20th century"], "20th century fox": ["20th century studios"],
  "disney junior": ["disney jr"], "disney jr": ["disney junior"], "disney plus": ["disney plus"],
  warner: ["warner bros"], wb: ["the wb", "warner bros"], paramount: ["paramount plus"], cw: ["the cw"],
  syndication: ["broadcast syndication"], dcom: ["disney channel"], ghibli: ["studio ghibli"],
};
// The network/studio name that makes this title match the search, if any. Matches whole
// words from the start ("disney channel" finds Disney Channel, not Disney Junior).
let coCache = { q: null };
function companyMatch(item) {
  const q = normCo(ui.search).trim();
  if (q.length < 2) return null;
  if (coCache.q !== q) coCache = { q, terms: [` ${q}`, ...(CO_ALIASES[q] || []).map((t) => ` ${t} `)] }; // aliases match whole words only
  return companiesOf(item).find((c) => { const n = normCo(c); return coCache.terms.some((t) => n.includes(t)); }) || null;
}

function missingKind(item) {
  if (item.request && !item.request.fulfilled) return "request";
  if (item.addedBy === "collection") return "gap";
  return "wishlist";
}

function collStats(c) {
  const items = c.items.map((id) => byId.get(id)).filter(Boolean);
  const n = { downloaded: 0, in_progress: 0, missing: 0 };
  items.forEach((i) => n[i.status]++);
  return { c, items, n, total: items.length, pct: items.length ? Math.round((100 * n.downloaded) / items.length) : 0 };
}

function collKind(c, items) {
  if (c.source === "manual") return "Custom";
  if (c.source === "curated" && c.kind) return c.kind;
  const tv = items.some((i) => i.type === "tv"), mv = items.some((i) => i.type === "movie");
  if (tv && mv) return "Universe";
  if (tv) return "TV Universe";
  return c.kind === "series" ? "Film Series" : "Franchise";
}

// ---------------------------------------------------------------- shared pieces

function thumbHtml(i) {
  return `<div class="th" data-open="${esc(i.id)}">${i.poster ? `<img loading="lazy" src="${posterUrl(i)}" alt="">` : ""}</div>`;
}

function statusPill(i, cid) {
  return `<button class="spill ${i.status}" data-act="status-menu" data-iid="${esc(i.id)}"${cid ? ` data-cid="${esc(cid)}"` : ""}>${icon(STATUS[i.status].icon)}<span class="full">${STATUS[i.status].label}</span><span class="short">${STATUS[i.status].short}</span></button>`;
}

function rowTitle(i, sub, showReq = true) {
  const req = showReq && i.request && !i.request.fulfilled ? `<span class="badge req">${icon("star")}${esc(i.request.by || "Request")}</span>` : "";
  return `<div class="tt" data-open="${esc(i.id)}">
    <div class="n" title="${esc(i.title)}${i.year ? ` (${i.year})` : ""}">${esc(i.title)}</div>
    <div class="s">${sub ?? `${i.format || (i.type === "tv" ? "TV Series" : "Movie")}${i.year ? ` · ${i.year}` : ""}`} ${req}</div></div>`;
}

function posterHtml(item) {
  return `<div class="poster">${item.poster ? `<img loading="lazy" src="${posterUrl(item)}" alt="">` : `<div class="ph">${esc(item.title)}</div>`}<div class="sbar"></div></div>`;
}

function cardHtml(item) {
  const tags = [];
  if (item.request && !item.request.fulfilled) tags.push(`<span class="tag req">★ ${esc(item.request.by || "Request")}</span>`);
  if (item.type === "tv") tags.push(`<span class="tag">TV</span>`);
  return `<div class="card s-${item.status}" data-open="${esc(item.id)}">
    ${posterHtml(item)}<div class="tags">${tags.join("")}</div>
    <div class="t" title="${esc(item.title)}">${esc(item.title)}</div>
    <div class="y">${item.year || ""}</div></div>`;
}

// ---------------------------------------------------------------- top-level render

function renderStats() {
  const n = { downloaded: 0, in_progress: 0, missing: 0 };
  lib.items.forEach((i) => n[i.status]++);
  const total = lib.items.length;
  const pct = total ? Math.round((100 * n.downloaded) / total) : 0;
  const incomplete = lib.collections.filter((c) => collStats(c).n.downloaded < c.items.length).length;
  $("#stats").innerHTML = `
    <div class="stat"><div class="n">${total.toLocaleString()}</div><div class="l">Tracked</div></div>
    <div class="stat g"><div class="n">${n.downloaded.toLocaleString()}</div><div class="l">Downloaded</div></div>
    <div class="stat o"><div class="n">${n.in_progress.toLocaleString()}</div><div class="l">In progress</div></div>
    <div class="stat r"><div class="n">${n.missing.toLocaleString()}</div><div class="l">Don't have</div></div>
    <div class="stat a"><div class="n">${pct}%</div><div class="l">Complete</div><div class="meter"><span style="width:${pct}%"></span></div></div>
    <div class="stat"><div class="n">${lib.collections.length}</div><div class="l">Collections · ${incomplete} open</div></div>`;
  const counts = {
    req: lib.items.filter((i) => i.request && !i.request.fulfilled).length,
    next: n.in_progress,
    failed: failedItems().length,
  };
  document.querySelectorAll("[data-count]").forEach((el) => (el.textContent = counts[el.dataset.count] || ""));
}

function renderFilters() {
  const search = `<div class="search">${icon("search")}<input class="input" id="search" type="search" placeholder="Search titles, collections, networks, studios…" autocomplete="off" value="${esc(ui.search)}"></div>`;
  let extra = "";
  if (ui.tab === "collections") {
    extra = `<select data-act="collcat">${[["all", "All categories"], ["curated", "Hand-picked"], ["movie", "Movies only"], ["tv", "Has TV"], ["custom", "My custom"]].map(([v, l]) => `<option value="${v}" ${ui.collCat === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select data-act="collshow">${[["incomplete", "Incomplete"], ["complete", "Completed"], ["all", "All status"]].map(([v, l]) => `<option value="${v}" ${ui.collShow === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select data-act="collsort" aria-label="Sort collections">${[["name", "A–Z"], ["closest", "Nearly done"], ["pct", "Most complete %"], ["leastpct", "Least complete %"], ["missing", "Most missing"], ["size", "Biggest"], ["type", "By type"]].map(([v, l]) => `<option value="${v}" ${ui.collSort === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  }
  $("#filters").innerHTML = search + extra;
}

function render(full = false) {
  document.querySelectorAll("#tabs button, #bottomnav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === ui.tab));
  $("#page-title").textContent = { collections: "Collections", next: "Up next", failed: "Failed rips", requests: "Requests", library: "Masterlist" }[ui.tab];
  if (full) renderFilters();
  renderStats();
  const y = window.scrollY;
  const view = $("#view");
  if (ui.tab === "library") view.innerHTML = renderLibrary();
  else if (ui.tab === "collections") view.innerHTML = renderCollections();
  else if (ui.tab === "next") view.innerHTML = renderNext();
  else if (ui.tab === "failed") view.innerHTML = renderFailed();
  else view.innerHTML = renderRequests();
  window.scrollTo(0, y);
}

// ---------------------------------------------------------------- collections

function renderCollections() {
  const q = ui.search.toLowerCase();
  const all = lib.collections.map(collStats).filter(({ c, items }) =>
    !q || c.name.toLowerCase().includes(q) || items.some((i) => i.title.toLowerCase().includes(q)));
  // Pinned collections always show first, whatever the filters (search still applies).
  const pinned = all.filter((x) => x.c.pinned).sort((a, b) => (a.c.pinnedAt || 0) - (b.c.pinnedAt || 0));
  let list = all.filter((x) => !x.c.pinned);
  if (ui.collCat === "movie") list = list.filter((x) => x.items.every((i) => i.type === "movie"));
  if (ui.collCat === "tv") list = list.filter((x) => x.items.some((i) => i.type === "tv"));
  if (ui.collCat === "custom") list = list.filter((x) => x.c.source === "manual");
  if (ui.collCat === "curated") list = list.filter((x) => x.c.source === "curated");
  const complete = (x) => x.total > 0 && x.n.downloaded === x.total;
  if (ui.collShow === "incomplete") list = list.filter((x) => !complete(x));
  if (ui.collShow === "complete") list = list.filter(complete);
  const left = (x) => x.total - x.n.downloaded;
  const byName = (a, b) => sortTitle(a.c.name).localeCompare(sortTitle(b.c.name));
  const sorts = {
    name: byName,
    closest: (a, b) => left(a) - left(b) || b.pct - a.pct || byName(a, b),
    pct: (a, b) => b.pct - a.pct || byName(a, b),
    leastpct: (a, b) => a.pct - b.pct || byName(a, b),
    missing: (a, b) => left(b) - left(a) || byName(a, b),
    size: (a, b) => b.total - a.total || byName(a, b),
    type: (a, b) => kindRank(a) - kindRank(b) || collKind(a.c, a.items).localeCompare(collKind(b.c, b.items)) || byName(a, b),
  };
  list.sort(sorts[ui.collSort] || byName);

  // Keep cards where they are while you edit: the order (and which cards show) is
  // fixed when you change the sort, filter or search, not every time a title changes.
  const key = [q, ui.collCat, ui.collShow, ui.collSort].join("|");
  let stale = false;
  if (ui.frozen?.key === key) {
    const byId = new Map(all.map((x) => [x.c.id, x]));
    const kept = ui.frozen.ids.map((id) => byId.get(id)).filter((x) => x && !x.c.pinned);
    const extra = list.filter((x) => !ui.frozen.ids.includes(x.c.id)); // new or just unpinned
    stale = kept.length !== list.length || kept.some((x, i) => x !== list[i]);
    list = kept.concat(extra);
  }
  ui.frozen = { key, ids: list.map((x) => x.c.id) };

  const head = `<div class="row" style="margin-bottom:16px">
      <span class="muted">${list.length + pinned.length} collection${list.length + pinned.length === 1 ? "" : "s"}${ui.collShow === "incomplete" ? " still missing something" : ""}</span>
      ${stale ? `<button class="linkbtn" data-act="resort" title="Your edits changed the order; cards stay put until you re-sort">↻ Re-sort</button>` : ""}
      <span style="flex:1"></span>
      <button class="btn small" data-act="refresh-colls" title="Look up series & franchises for your titles on Wikidata">↻ Find collections</button>
      <button class="btn small soft" data-act="new-coll">${icon("plus")} New collection</button></div>`;
  const pinnedHtml = pinned.length ? `<button class="coll-sec toggle ${ui.pinnedCollapsed ? "collapsed" : ""}" data-act="pinned-toggle" aria-expanded="${!ui.pinnedCollapsed}">
      <span class="chev">${icon("chev")}</span>${icon("pin")} Pinned <span class="dim">${pinned.length}</span></button>
    ${ui.pinnedCollapsed ? "" : `<div class="cgrid">${pinned.map(collCard).join("")}</div>`}
    <h2 class="coll-sec">All collections</h2>` : "";
  const titles = ui.search ? titleResults() : "";
  if (!list.length) return titles + head + pinnedHtml + `<div class="empty">No collections match${ui.search ? " that search" : ""}.</div>`;
  if (ui.collSort === "type") {
    // Grouped under a heading per kind (Studio, Franchise, Director…)
    const groups = [];
    for (const x of list) {
      const k = collKind(x.c, x.items);
      if (!groups.length || groups.at(-1).k !== k) groups.push({ k, xs: [] });
      groups.at(-1).xs.push(x);
    }
    return titles + head + pinnedHtml + groups.map((g) =>
      `<h2 class="coll-sec">${esc(g.k)} <span class="dim">${g.xs.length}</span></h2><div class="cgrid">${g.xs.map(collCard).join("")}</div>`).join("");
  }
  return titles + head + pinnedHtml + `<div class="cgrid">${list.map(collCard).join("")}</div>`;
}

const KIND_ORDER = ["Studio", "Universe", "Franchise", "Film Series", "TV Universe", "Director", "Custom"];
function kindRank(x) {
  const i = KIND_ORDER.indexOf(collKind(x.c, x.items));
  return i === -1 ? KIND_ORDER.length : i;
}

// While searching: matching films/shows themselves, above the collections they're in.
function titleResults() {
  const q = ui.search.toLowerCase();
  const hits = lib.items.filter((i) => i.title.toLowerCase().includes(q) || String(i.year) === q || companyMatch(i))
    .sort((a, b) => (a.status === "missing") - (b.status === "missing") || sortTitle(a.title).localeCompare(sortTitle(b.title)));
  if (!hits.length) return "";
  const LIMIT = 12;
  const shown = ui.titlesMore ? hits : hits.slice(0, LIMIT);
  const rows = shown.map((i) => {
    const colls = collectionsOf(i.id).map((c) => c.name);
    const co = i.title.toLowerCase().includes(q) ? null : companyMatch(i);
    const sub = `${i.format || (i.type === "tv" ? "TV Series" : "Movie")}${i.year ? ` · ${i.year}` : ""}${co ? ` · ${esc(co)}` : ""}${colls.length ? ` · <span class="dim">in ${esc(colls.slice(0, 2).join(", "))}${colls.length > 2 ? ` +${colls.length - 2}` : ""}</span>` : ""}`;
    return `<div class="trow s-${i.status}">${thumbHtml(i)}${rowTitle(i, sub)}${statusPill(i)}</div>`;
  });
  if (hits.length > LIMIT) rows.push(`<div class="more-row"><button class="linkbtn" data-act="titles-more">${ui.titlesMore ? "Show fewer" : `Show all ${hits.length} titles`}</button></div>`);
  return `<section class="qsec title-hits"><div class="qsec-head"><div class="ic a">${icon("film")}</div><div><h3>Titles <span class="muted" style="font-weight:500">${hits.length}</span></h3><p>Films and shows matching “${esc(ui.search)}”</p></div></div>
    <div class="rows">${rows.join("")}</div></section>`;
}

const PREVIEW = 3;

// A small fanned stack of posters, like a Letterboxd list cover.
function fanHtml(items) {
  const withArt = items.filter((i) => i.poster).slice(0, 5);
  if (!withArt.length) return "";
  return `<div class="fan" aria-hidden="true">${withArt.map((i) => `<div class="fp ${i.status === "missing" ? "missing" : ""}"><img loading="lazy" src="${posterUrl(i)}" alt=""></div>`).join("")}</div>`;
}

function collCard({ c, items, n, total, pct }) {
  const isComplete = total > 0 && n.downloaded === total;
  const collapsed = ui.collapsedCards.has(c.id);
  const reorder = ui.reorder === c.id;
  const expanded = ui.expandedCards.has(c.id) || reorder;
  const shown = expanded ? items : items.slice(0, PREVIEW);
  const hiddenMissing = items.slice(PREVIEW).filter((i) => i.status === "missing").length;
  const status = isComplete ? `<span class="badge done">✓ Complete</span>`
    : `${n.missing ? `<span class="badge missing">${n.missing} missing</span>` : ""}${n.in_progress ? `<span class="badge prog">${n.in_progress} ripping</span>` : ""}`;
  const rows = shown.map((i, idx) => `<div class="trow s-${i.status}">
      ${thumbHtml(i)}${rowTitle(i)}
      <div class="pill-x">${statusPill(i, c.id)}
        <button class="icon-btn x" data-act="coll-x" data-cid="${esc(c.id)}" data-iid="${esc(i.id)}" title="Remove from ${esc(c.name)}" aria-label="Remove ${esc(i.title)} from ${esc(c.name)}">${icon("close")}</button></div>
      ${reorder ? `<div class="acts"><div class="moves">
          <button data-act="coll-move" data-cid="${esc(c.id)}" data-idx="${idx}" data-d="-1" title="Move up">▲</button>
          <button data-act="coll-move" data-cid="${esc(c.id)}" data-idx="${idx}" data-d="1" title="Move down">▼</button></div>
</div>` : ""}
      </div>`);
  // Pad short collections so every card in the grid is the same height.
  for (let k = shown.length; k < PREVIEW; k++) rows.push(`<div class="trow pad">${k === 0 && !items.length ? `<span class="muted">Empty. Add some titles.</span>` : ""}</div>`);

  let left;
  if (reorder) left = `<button class="linkbtn" data-act="coll-reorder" data-cid="">Done reordering</button>`;
  else if (items.length > PREVIEW) left = expanded
    ? `<button class="linkbtn" data-act="coll-less" data-cid="${esc(c.id)}">Show less ${icon("up")}</button>`
    : `<button class="linkbtn" data-act="coll-more" data-cid="${esc(c.id)}">Show all ${items.length} ${icon("chev")}</button>${hiddenMissing ? `<span class="foot-note">${hiddenMissing} more missing</span>` : ""}`;
  else left = `<span>${total} entr${total === 1 ? "y" : "ies"}</span>`;

  return `<article class="ccard ${isComplete ? "complete" : ""} ${collapsed ? "collapsed" : ""} ${reorder ? "reordering" : ""}" data-cid="${esc(c.id)}">
    <div class="ccard-head">
      <div class="ccard-top">
        <span class="chip-k">${collKind(c, items)}</span>${status}<span class="sp"></span>
        <button class="icon-btn pin ${c.pinned ? "on" : ""}" data-act="coll-pin" data-cid="${esc(c.id)}" title="${c.pinned ? "Unpin" : "Pin to top"}">${icon("pin")}</button>
        <button class="icon-btn" data-act="coll-menu" data-cid="${esc(c.id)}" title="Collection options">${icon("dots")}</button>
        <button class="icon-btn chev" data-act="coll-collapse" data-cid="${esc(c.id)}" title="Collapse">${icon("chev")}</button>
      </div>
      <div>
        <h3 title="${esc(c.name)}">${esc(c.name)}</h3>
        <div class="prog-line"><span>${n.downloaded} of ${total} downloaded</span><b>${pct}%</b></div>
        <div class="bar"><span class="g" style="width:${pct}%"></span><span class="o" style="width:${total ? (100 * n.in_progress) / total : 0}%"></span></div>
      </div>
      ${fanHtml(items)}
    </div>
    <div class="rows">${rows.join("")}</div>
    <div class="ccard-foot"><div class="foot-left">${left}</div>
      <button class="linkbtn" data-act="coll-add" data-cid="${esc(c.id)}">${icon("plus")} Add</button></div>
  </article>`;
}

// ---------------------------------------------------------------- up next

function renderNext() {
  const q = (i) => matchesSearch(i);
  const openReq = (i) => i.request && !i.request.fulfilled;
  const ripping = lib.items.filter((i) => i.status === "in_progress" && q(i))
    .sort((a, b) => (a.startedAt || "").localeCompare(b.startedAt || ""));
  const priority = lib.items.filter((i) => i.status === "missing" && openReq(i) && i.request.priority === "high" && q(i))
    .sort((a, b) => (a.request.date || "").localeCompare(b.request.date || ""));
  const otherReq = lib.items.filter((i) => i.status === "missing" && openReq(i) && i.request.priority !== "high" && q(i));

  // Collection gaps, ranked by how close the collection is to being complete.
  const best = new Map();
  for (const st of lib.collections.map(collStats)) {
    const left = st.total - st.n.downloaded;
    if (!left || st.n.downloaded === 0) continue; // only collections you've started
    for (const i of st.items) {
      if (i.status !== "missing" || openReq(i) || !q(i)) continue;
      const score = left * 100 - st.pct;
      const cur = best.get(i.id);
      if (!cur || score < cur.score) best.set(i.id, { i, st, left, score });
    }
  }
  const gaps = [...best.values()].sort((a, b) => a.score - b.score || (a.i.year || 0) - (b.i.year || 0));
  const wish = lib.items.filter((i) => i.status === "missing" && missingKind(i) === "wishlist" && q(i));

  const startBtn = (i) => `<button class="btn small" data-act="quick-status" data-s="in_progress" data-iid="${esc(i.id)}">Start ripping</button>`;
  const sec = (ic, cls, title, sub, rows, empty) => `<section class="qsec">
    <div class="qsec-head"><div class="ic ${cls}">${icon(ic)}</div><div><h3>${title} <span class="muted" style="font-weight:500">${rows.length}</span></h3><p>${sub}</p></div></div>
    <div class="rows">${rows.length ? rows.join("") : `<div class="more-row muted">${empty}</div>`}</div></section>`;

  const ripRows = ripping.map((i) => `<div class="trow s-${i.status}">${thumbHtml(i)}
    ${rowTitle(i, `Started ${esc(i.startedAt || "?")}${i.lastFailed ? ` · last failed ${esc(i.lastFailed)}` : ""}`)}
    <div class="acts"><button class="btn small" style="color:var(--green)" data-act="quick-status" data-s="downloaded" data-iid="${esc(i.id)}">✓ On Jellyfin</button>
      <button class="btn small ghost" data-act="rip-failed" data-iid="${esc(i.id)}">Rip failed</button></div></div>`);
  const reqRows = (list) => list.map((i) => `<div class="trow s-${i.status}">${thumbHtml(i)}
    ${rowTitle(i, `<b>${esc(i.request.by || "Someone")}</b> asked ${esc(i.request.date || "")}${i.request.note ? ` · “${esc(i.request.note)}”` : ""}`, false)}
    <div class="acts">${startBtn(i)}</div></div>`);
  const GAP_LIMIT = 25;
  const gapRows = (ui.nextMore ? gaps : gaps.slice(0, GAP_LIMIT)).map(({ i, st, left }) => `<div class="trow s-${i.status}">${thumbHtml(i)}
    ${rowTitle(i, `<span class="why">${left === 1 ? "Completes" : `${left} left in`} <b>${esc(st.c.name)}</b> (${st.n.downloaded}/${st.total})</span>`)}
    <div class="acts">${startBtn(i)}</div></div>`);
  if (gaps.length > GAP_LIMIT) gapRows.push(`<div class="more-row"><button class="linkbtn" data-act="next-more">${ui.nextMore ? "Show fewer" : `Show all ${gaps.length}`}</button></div>`);
  const wishRows = wish.map((i) => `<div class="trow s-${i.status}">${thumbHtml(i)}${rowTitle(i)}<div class="acts">${startBtn(i)}</div></div>`);

  return `<div class="qgrid">
    <div style="display:grid;gap:22px">
      ${sec("clock", "o", "Ripping now", "Check each rip, then mark it on Jellyfin, or send it back if it failed.", ripRows, "Nothing mid-rip. Hit “Start ripping” on something below.")}
      ${sec("star", "p", "Priority requests", "Friends & family are waiting on these.", reqRows(priority), "No priority requests.")}
      ${otherReq.length ? sec("heart", "p", "Other requests", "Requested, no rush.", reqRows(otherReq), "") : ""}
    </div>
    <div style="display:grid;gap:22px">
      ${sec("puzzle", "a", "Finish a collection", "Missing pieces of collections you've started, closest to complete first.", gapRows, "No gaps in collections you've started.")}
      ${wish.length ? sec("heart", "r", "Wishlist", "Things you added for yourself.", wishRows, "") : ""}
    </div></div>`;
}

// ---------------------------------------------------------------- failed rips

function renderFailed() {
  const list = failedItems().filter(matchesSearch).sort((a, b) => b.failed.date.localeCompare(a.failed.date));
  const rows = list.map((i) => `<div class="trow s-${i.status}">${thumbHtml(i)}
    ${rowTitle(i, `${i.type === "tv" ? "TV · " : ""}Failed ${esc(i.failed.date)}${i.failed.count > 1 ? ` · ${i.failed.count} tries` : ""}${i.failed.note ? ` · “${esc(i.failed.note)}”` : ""}${i.status === "downloaded" ? ` · <span style="color:var(--green)">rest is on Jellyfin</span>` : ""}`)}
    <div class="acts">
      <button class="btn small" data-act="fail-retry" data-iid="${esc(i.id)}">Try again</button>
      <button class="btn small ghost" data-act="fail-note" data-iid="${esc(i.id)}">${i.failed.note ? "Edit note" : "Add note"}</button>
      <button class="icon-btn x" data-act="fail-clear" data-iid="${esc(i.id)}" title="Clear from Failed">${icon("close")}</button>
    </div></div>`);
  return `<section class="qsec">
    <div class="qsec-head"><div class="ic r">${icon("x")}</div><div><h3>Failed rips <span class="muted" style="font-weight:500">${list.length}</span></h3>
      <p>Rips that didn't work out. “Try again” moves one back to In Progress; ✕ clears it from this list (it stays in Don't Have).</p></div></div>
    <div class="rows">${rows.length ? rows.join("") : `<div class="more-row muted">No failed rips. When a rip goes wrong, hit “Rip failed” on it in Up Next.</div>`}</div></section>`;
}

// ---------------------------------------------------------------- requests

function renderRequests() {
  const all = lib.items.filter((i) => i.request && matchesSearch(i));
  const open = all.filter((i) => !i.request.fulfilled)
    .sort((a, b) => (a.request.priority === "high" ? 0 : 1) - (b.request.priority === "high" ? 0 : 1) || (a.request.date || "").localeCompare(b.request.date || ""));
  const done = all.filter((i) => i.request.fulfilled).sort((a, b) => b.request.fulfilled.localeCompare(a.request.fulfilled));
  const people = [...new Set(lib.items.map((i) => i.request?.by).filter(Boolean))];

  const row = (i) => `<div class="trow s-${i.status}">${thumbHtml(i)}
    ${rowTitle(i, `<b>${esc(i.request.by || "Someone")}</b> · ${esc(i.request.date || "")}${i.request.priority === "high" && !i.request.fulfilled ? ` <span class="badge req">Priority</span>` : ""}${i.request.fulfilled ? ` · fulfilled ${esc(i.request.fulfilled)}` : ""}${i.request.note ? ` · “${esc(i.request.note)}”` : ""}`, false)}
    ${statusPill(i)}
    <div class="acts">${i.request.fulfilled ? `<button class="btn small ghost" data-act="req-reopen" data-iid="${esc(i.id)}">Reopen</button>`
      : i.status === "downloaded" ? `<button class="btn small" data-act="req-done" data-iid="${esc(i.id)}">Mark fulfilled</button>` : ""}
      <button class="icon-btn" data-open="${esc(i.id)}" title="Edit">${icon("edit")}</button></div></div>`;

  return `<form class="req-form" id="req-form">
      <div><label>What did they ask for?</label><input class="input" name="title" required placeholder="Movie or show title" autocomplete="off"></div>
      <div><label>Requested by</label><input class="input" name="by" required placeholder="Mom, Dad, Sam…" list="people" autocomplete="off">
        <datalist id="people">${people.map((p) => `<option value="${esc(p)}">`).join("")}</datalist></div>
      <div><label>Priority</label><select name="priority"><option value="high">Priority</option><option value="normal">Whenever</option></select></div>
      <div><button class="btn primary" type="submit">Find & add</button></div>
      <div style="grid-column:1/-1"><input class="input" name="note" placeholder="Note (optional), e.g. 'the 1995 version', 'for Thanksgiving'" style="width:100%"></div>
    </form>
    <section class="qsec"><div class="qsec-head"><div class="ic p">${icon("star")}</div><div><h3>Open requests <span class="muted" style="font-weight:500">${open.length}</span></h3><p>These also show under Don't Have on the masterlist.</p></div></div>
      <div class="rows">${open.length ? open.map(row).join("") : `<div class="more-row muted">No open requests. Nice.</div>`}</div></section>
    <section class="qsec" style="margin-top:22px"><div class="qsec-head" style="cursor:pointer" data-act="req-toggle-done"><div class="ic a">${icon("check")}</div><div><h3>Fulfilled <span class="muted" style="font-weight:500">${done.length}</span></h3><p>${ui.reqShowDone ? "Click to hide" : "Click to show"}</p></div></div>
      ${ui.reqShowDone ? `<div class="rows">${done.map(row).join("") || `<div class="more-row muted">None yet.</div>`}</div>` : ""}</section>`;
}

// ---------------------------------------------------------------- masterlist

function renderLibrary() {
  const items = lib.items.filter((i) => (ui.type === "all" || i.type === ui.type) && matchesSearch(i));
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, items.filter((i) => i.status === s).length]));
  const mk = { request: 0, gap: 0, wishlist: 0 };
  items.filter((i) => i.status === "missing").forEach((i) => mk[missingKind(i)]++);
  const sorters = {
    title: (a, b) => sortTitle(a.title).localeCompare(sortTitle(b.title)),
    year: (a, b) => (a.year || 0) - (b.year || 0) || sortTitle(a.title).localeCompare(sortTitle(b.title)),
    added: (a, b) => (b.dateAdded || b.startedAt || "").localeCompare(a.dateAdded || a.startedAt || ""),
  };

  let html = `<div class="mfilter">
    ${STATUS_ORDER.map((s) => `<button class="mchip ${ui.statuses.has(s) && ui.statuses.size < 3 ? "on" : ""}" data-act="toggle-status" data-s="${s}"><span class="dot ${s}"></span>${STATUS[s].label} <b>${counts[s].toLocaleString()}</b></button>`).join("")}
    <span style="flex:1"></span>
    <div class="seg">${["all", "movie", "tv"].map((t) => `<button data-act="type" data-v="${t}" class="${ui.type === t ? "on" : ""}">${{ all: "All", movie: "Movies", tv: "TV" }[t]}</button>`).join("")}</div>
    <select data-act="sort">${[["title", "Sort: Title"], ["year", "Sort: Year"], ["added", "Sort: Recently added"]].map(([v, l]) => `<option value="${v}" ${ui.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select>
    <a class="btn" href="/api/export.csv">Export CSV</a>
  </div>`;

  for (const s of STATUS_ORDER) {
    if (!ui.statuses.has(s)) continue;
    let list = items.filter((i) => i.status === s);
    let filterBar = "";
    if (s === "missing") {
      filterBar = `<div class="seg" data-stop>${[["all", "All"], ["request", `Requests ${mk.request}`], ["wishlist", `Wishlist ${mk.wishlist}`], ["gap", `Collection gaps ${mk.gap}`]]
        .map(([v, l]) => `<button data-act="mkind" data-v="${v}" class="${ui.missingKind === v ? "on" : ""}">${l}</button>`).join("")}</div>`;
      if (ui.missingKind !== "all") list = list.filter((i) => missingKind(i) === ui.missingKind);
    }
    list.sort(sorters[ui.sort]);
    if (s === "missing") list.sort((a, b) => (missingKind(a) === "request" ? 0 : 1) - (missingKind(b) === "request" ? 0 : 1));
    html += `<section class="section ${ui.collapsedSections.has(s) ? "collapsed" : ""}">
      <div class="section-head" data-act="collapse" data-s="${s}">
        <span class="chev">${icon("chev")}</span><span class="dot ${s}"></span><h2>${STATUS[s].label}</h2>
        <span class="chip-k">${list.length}</span>${filterBar}
      </div>
      <div class="grid">${list.length ? list.map(cardHtml).join("") : `<div class="empty" style="grid-column:1/-1">Nothing here${ui.search ? " matching your search" : ""}.</div>`}</div>
    </section>`;
  }
  return html;
}

// ---------------------------------------------------------------- popover menu

function openMenu(anchor, html, onPick) {
  const m = $("#menu");
  m.innerHTML = html;
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  let left = r.right - w + window.scrollX;
  left = Math.max(8 + window.scrollX, Math.min(left, window.scrollX + innerWidth - w - 8));
  let top = r.bottom + 6 + window.scrollY;
  if (r.bottom + h + 12 > innerHeight) top = r.top - h - 6 + window.scrollY;
  m.style.left = left + "px";
  m.style.top = top + "px";
  m.onclick = (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    closeMenu();
    onPick(b.dataset.v);
  };
}
function closeMenu() { $("#menu").hidden = true; }

function statusMenu(anchor, item, cid) {
  const c = cid && lib.collections.find((x) => x.id === cid);
  openMenu(anchor, STATUS_ORDER.map((s) => `<button data-v="${s}" class="${item.status === s ? "on" : ""}"><span class="dot ${s}"></span><span>${STATUS[s].label}<span class="hint">${STATUS[s].hint}</span></span></button>`).join("")
    + (item.status === "in_progress" ? `<button data-v="failed"><span class="dot failed"></span><span>Rip failed<span class="hint">Back to Don't Have, listed under Failed</span></span></button>` : "")
    + `<hr><button data-v="open">${icon("edit")} Edit details…</button>`
    + (c ? `<button data-v="remove" style="color:var(--red)">${icon("trash")} Remove from ${esc(c.name)}</button>` : ""), (v) => {
    if (v === "open") return openItem(item.id);
    if (v === "remove") return withUndo(`Removed ${item.title} from ${c.name}`, () => removeFromCollection(c, item));
    if (v === "failed") { markFailed(item); render(); return toast(`${item.title} moved to Failed`); }
    setStatus(item, v);
    render();
    if (v === "downloaded") toast(`${item.title} is on Jellyfin`);
  });
}

function togglePin(c) {
  if (c.pinned) { delete c.pinned; delete c.pinnedAt; }
  else { c.pinned = true; c.pinnedAt = Date.now(); }
  save();
  render();
  toast(c.pinned ? `Pinned ${c.name}` : `Unpinned ${c.name}`);
}

function collMenu(anchor, c) {
  openMenu(anchor, `<button data-v="pin">${icon("pin")} ${c.pinned ? "Unpin" : "Pin to top"}</button>
    <button data-v="rename">${icon("edit")} Rename</button>
    <button data-v="reorder">↕ Reorder titles</button>
    <button data-v="add">${icon("plus")} Add a title</button><hr>
    <button data-v="delete" style="color:var(--red)">${icon("trash")} Delete collection</button>`, (v) => {
    if (v === "pin") togglePin(c);
    if (v === "rename") askText("Rename collection", c.name, (name) => { if (name) { c.name = name; c.manual = true; save(); } closeModal(); });
    if (v === "reorder") { ui.reorder = c.id; render(); }
    if (v === "add") openAdd({ forCollection: c.id });
    if (v === "delete") withUndo(`Deleted “${c.name}” (titles kept)`, () => {
      lib.collections = lib.collections.filter((x) => x !== c);
      if (c.source !== "manual") lib.dismissedCollections.push(c.id);
    });
  });
}

// ---------------------------------------------------------------- modal: item detail

function openModal(html) {
  closeMenu();
  $("#modal-body").innerHTML = html;
  $("#modal").hidden = false;
}
function closeModal() {
  $("#modal").hidden = true;
  $("#modal-body").innerHTML = "";
  render();
}

function openItem(id) {
  const item = byId.get(id);
  if (!item) return;
  const colls = collectionsOf(id);
  const others = lib.collections.filter((c) => !c.items.includes(id)).sort((a, b) => a.name.localeCompare(b.name));
  const r = item.request || {};
  const info = [
    ["Genres", (item.genres || []).join(", ")], ["Runtime", item.runtime], ["Rating", item.rating],
    ["Resolution", item.resolution], ["Network", [...new Set([...(item.networks || []), ...(item.network || "").split(";").map((x) => x.trim())])].filter(Boolean).join(", ")],
    ["Studio", (item.studios || []).slice(0, 4).join(", ")], ["Added", item.dateAdded],
    ["Started rip", item.status === "in_progress" ? item.startedAt : null], ["Last failed rip", item.lastFailed],
    ["File", item.path],
  ].filter(([, v]) => v);
  const wikiLink = item.wiki ? `<dt>Wikipedia</dt><dd><a href="https://en.wikipedia.org/wiki/${encodeURIComponent(item.wiki)}" target="_blank" style="color:var(--accent)">${esc(item.wiki)}</a></dd>` : "";

  openModal(`${item.poster ? `<div class="hero" style="background-image:url('${posterUrl(item)}')"></div>` : ""}<div class="detail" data-item="${esc(id)}">
    <div>
      <div class="card s-${item.status}" style="cursor:default">${posterHtml(item)}</div>
      <div class="row" style="margin-top:10px">
        <button class="btn small" data-act="art-search">Change artwork</button>
        <label class="btn small ghost">Upload<input type="file" accept="image/*" data-act="art-upload" hidden></label>
      </div>
    </div>
    <div>
      <h2>${esc(item.title)}</h2>
      <div class="sub">${item.year || "—"} · ${item.type === "tv" ? "TV show" : "Movie"}${item.description ? " · " + esc(item.description) : ""}</div>

      <div class="statusbtns">${STATUS_ORDER.map((s) => `<button class="${s} ${item.status === s ? "on" : ""}" data-act="set-status" data-s="${s}">${STATUS[s].label}</button>`).join("")}</div>
      <div class="flow">${item.status === "missing" ? "Started ripping it? Mark it <b>In Progress</b>. It stays orange until you've checked the rip and it's on Jellyfin."
        : item.status === "in_progress" ? `Once the rip checks out and it's on Jellyfin, mark it <b>Downloaded</b>. <button class="btn small" data-act="modal-failed">Rip failed</button>`
        : "On Jellyfin and watchable."}</div>

      <div class="box"><h4>Request</h4>
        ${item.request ? `<div class="fields">
          <div class="field"><label>Requested by</label><input class="input" data-f="request.by" value="${esc(r.by || "")}"></div>
          <div class="field"><label>Priority</label><select data-f="request.priority"><option value="high" ${r.priority === "high" ? "selected" : ""}>Priority</option><option value="normal" ${r.priority !== "high" ? "selected" : ""}>Whenever</option></select></div>
          <div class="field"><label>Date</label><input class="input" type="date" data-f="request.date" value="${esc(r.date || "")}"></div>
        </div>
        <div class="field" style="margin-top:8px"><label>Note</label><input class="input" data-f="request.note" value="${esc(r.note || "")}"></div>
        <div class="row" style="margin-top:8px">${r.fulfilled ? `<span class="badge done">Fulfilled ${esc(r.fulfilled)}</span>` : ""}<button class="btn small ghost" data-act="remove-request">Remove request</button></div>`
        : `<div class="row"><span class="muted">Not a request.</span><button class="btn small" data-act="make-request">Mark as a request from someone…</button></div>`}
      </div>

      <div class="box"><h4>Collections</h4>
        <div class="chips">${colls.map((c) => `<span class="chip">${esc(c.name)}<button data-act="leave-coll" data-cid="${esc(c.id)}" title="Remove from this collection">×</button></span>`).join("") || `<span class="muted">Not in any collection.</span>`}</div>
        <div class="row" style="margin-top:10px">
          <select data-act="join-coll"><option value="">Add to collection…</option><option value="__new">+ New collection…</option>
            ${others.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select>
        </div>
      </div>

      <div class="box"><h4>Details</h4>
        <div class="fields">
          <div class="field"><label>Title</label><input class="input" data-f="title" value="${esc(item.title)}"></div>
          <div class="field"><label>Year</label><input class="input" type="number" data-f="year" value="${esc(item.year || "")}"></div>
          <div class="field"><label>Type</label><select data-f="type"><option value="movie" ${item.type === "movie" ? "selected" : ""}>Movie</option><option value="tv" ${item.type === "tv" ? "selected" : ""}>TV show</option></select></div>
        </div>
        <div class="field" style="margin-top:8px"><label>IMDb ID or link ${item.imdb ? `· <a href="https://www.imdb.com/title/${esc(item.imdb)}/" target="_blank" rel="noopener">open on IMDb ↗</a>` : ""}</label>
          <div class="row" style="flex-wrap:nowrap"><input class="input" id="imdb-id" style="flex:1;min-width:0" placeholder="tt1234567 or paste the IMDb link" value="${esc(item.imdb || "")}" autocomplete="off">
          <button class="btn small" data-act="imdb-set">Use poster</button></div>
          <div class="dim" style="font-size:12px;margin-top:4px">Wrong or missing artwork? Paste the right IMDb page and it'll pull that poster.</div></div>
        <div class="field" style="margin-top:8px"><label>Notes</label><textarea data-f="notes" rows="2" placeholder="Disc info, missing seasons, rip quality…">${esc(item.notes || "")}</textarea></div>
        ${info.length || wikiLink ? `<dl class="kv" style="margin-top:10px">${info.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}${wikiLink}</dl>` : ""}
      </div>

      <div class="row" style="justify-content:flex-end" data-confirm-slot>
        <button class="btn danger" data-act="delete-item">Delete title</button>
      </div>
    </div>
  </div>`);
}

function setField(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  keys.slice(0, -1).forEach((k) => (o = o[k] ||= {}));
  o[keys.at(-1)] = value;
}

// ---------------------------------------------------------------- modal: add / lookup

function openAdd({ preset = {}, forCollection = null, forArtwork = null } = {}) {
  const coll = forCollection && lib.collections.find((c) => c.id === forCollection);
  const title = forArtwork ? "Pick new artwork" : coll ? `Add to “${esc(coll.name)}”` : preset.request ? `Request from ${esc(preset.request.by)}` : "Add a title";
  openModal(`<h2 style="margin-top:0">${title}</h2>
    <form id="lookup-form" class="row">
      <input class="input" name="q" style="flex:1;min-width:200px" placeholder="Search a movie or show…" value="${esc(preset.q || "")}" autocomplete="off" required>
      <select name="type"><option value="">Movie or TV</option><option value="movie" ${preset.type === "movie" ? "selected" : ""}>Movie</option><option value="tv" ${preset.type === "tv" ? "selected" : ""}>TV show</option></select>
      <button class="btn primary">Search</button>
    </form>
    ${forArtwork ? "" : `<div class="muted" style="margin-top:10px">Titles already in your library show up first.</div>`}
    <div id="lookup-results"></div>
    <div id="add-form"></div>
    ${forArtwork ? "" : `<div class="row" style="margin-top:14px"><button class="btn ghost small" data-act="add-manual">Add without looking it up</button></div>`}`);
  const modal = $("#modal-body");
  modal.dataset.forCollection = forCollection || "";
  modal.dataset.forArtwork = forArtwork || "";
  modal.dataset.preset = JSON.stringify(preset);
  $("input[name=q]", modal).focus();
  if (preset.q) runLookup();
}

let lookupResults = [];
async function runLookup() {
  const modal = $("#modal-body");
  const f = $("#lookup-form", modal);
  const q = f.q.value.trim();
  if (!q) return;
  const forArtwork = modal.dataset.forArtwork;
  const local = forArtwork ? [] : lib.items.filter((i) => i.title.toLowerCase().includes(q.toLowerCase())).slice(0, 12).map((i) => ({ local: i }));
  lookupResults = local;
  $("#lookup-results").innerHTML = `<div class="results">${local.map(resultHtml).join("")}</div><div class="muted" style="margin-top:12px">Searching Wikipedia & TVmaze…</div>`;
  let remote = [];
  try { remote = await (await fetch(`/api/lookup?q=${encodeURIComponent(q)}&type=${f.type.value}`)).json(); } catch {}
  const localQ = new Set(local.map((l) => l.local.wikidata).filter(Boolean));
  const key = (t, y) => sortTitle(t).replace(/[^a-z0-9]+/g, "") + "|" + (y || "");
  const localKeys = new Set(local.map((l) => key(l.local.title, l.local.year)));
  remote = remote.filter((r) => (forArtwork ? r.poster
    : !(r.wikidata && localQ.has(r.wikidata)) && !(r.imdb && local.some((l) => l.local.imdb === r.imdb)) && !localKeys.has(key(r.title, r.year))));
  lookupResults = [...local, ...remote];
  $("#lookup-results").innerHTML = lookupResults.length
    ? `<div class="results">${lookupResults.map(resultHtml).join("")}</div>`
    : `<div class="empty" style="margin-top:14px">No matches. Try a different spelling, or add it without looking it up.</div>`;
}

function resultHtml(r, idx) {
  if (r.local) {
    const i = r.local;
    return `<div class="result" data-r="${idx}"><div class="card s-${i.status}">${posterHtml(i)}</div>
      <div class="t">${esc(i.title)}${i.year ? ` (${i.year})` : ""}</div><div class="own">In library · ${STATUS[i.status].label}</div></div>`;
  }
  return `<div class="result" data-r="${idx}"><div class="poster">${r.poster ? `<img src="${esc(r.poster)}" alt="">` : `<div class="ph">${esc(r.title)}</div>`}</div>
    <div class="t">${esc(r.title)}${r.year ? ` (${r.year})` : ""}</div><div class="d">${r.source === "imdb" ? `<b class="src">IMDb</b> ` : ""}${esc(r.description || r.source)}</div></div>`;
}

async function pickResult(idx) {
  const modal = $("#modal-body");
  const r = idx === "manual" ? { title: $("#lookup-form input[name=q]").value.trim(), manual: true } : lookupResults[idx];
  if (!r) return;
  document.querySelectorAll(".result").forEach((el) => el.classList.toggle("sel", el.dataset.r == idx));
  const forCollection = modal.dataset.forCollection;
  const forArtwork = modal.dataset.forArtwork;
  const preset = JSON.parse(modal.dataset.preset || "{}");

  if (forArtwork) {
    const item = byId.get(forArtwork);
    try {
      item.poster = (await postPoster(item.id, { url: r.poster })).poster;
      save(); openItem(item.id); toast("Artwork updated");
    } catch (e) { toast("Couldn't fetch that image: " + e.message); }
    return;
  }
  if (r.local) {
    if (forCollection) {
      const c = lib.collections.find((x) => x.id === forCollection);
      addToCollection(c, r.local.id); save(); closeModal(); toast(`Added to ${c.name}`);
    } else {
      if (preset.request?.by && !r.local.request) {
        r.local.request = { ...preset.request, date: today() };
        if (r.local.status === "downloaded") r.local.request.fulfilled = today();
        save();
        toast(r.local.status === "downloaded" ? `You already have ${r.local.title}! Logged as fulfilled.` : `Request added to ${r.local.title}`);
      }
      openItem(r.local.id);
    }
    return;
  }

  const defStatus = preset.request || forCollection ? "missing" : "in_progress";
  $("#add-form").innerHTML = `<div class="box" style="margin-top:16px"><h4>Add “${esc(r.title)}”</h4>
    <div class="fields">
      <div class="field"><label>Title</label><input class="input" id="nf-title" value="${esc(r.title || "")}"></div>
      <div class="field"><label>Year</label><input class="input" id="nf-year" type="number" value="${esc(r.year || "")}"></div>
      <div class="field"><label>Type</label><select id="nf-type"><option value="movie" ${r.type !== "tv" ? "selected" : ""}>Movie</option><option value="tv" ${r.type === "tv" ? "selected" : ""}>TV show</option></select></div>
      <div class="field"><label>Status</label><select id="nf-status">${STATUS_ORDER.map((s) => `<option value="${s}" ${s === defStatus ? "selected" : ""}>${STATUS[s].label}</option>`).join("")}</select></div>
    </div>
    <div class="fields" style="margin-top:8px">
      <div class="field"><label>Requested by (optional)</label><input class="input" id="nf-by" value="${esc(preset.request?.by || "")}" placeholder="Leave blank if it's for you"></div>
      <div class="field"><label>Priority</label><select id="nf-pri"><option value="high" ${preset.request?.priority !== "normal" ? "selected" : ""}>Priority</option><option value="normal" ${preset.request?.priority === "normal" ? "selected" : ""}>Whenever</option></select></div>
      <div class="field"><label>Collection</label><select id="nf-coll"><option value="">None</option>${lib.collections.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => `<option value="${esc(c.id)}" ${c.id === forCollection ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
    </div>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn primary" id="nf-save">Add to library</button></div></div>`;
  $("#nf-save").onclick = async () => {
    const title = $("#nf-title").value.trim();
    if (!title) return;
    $("#nf-save").disabled = true;
    const year = parseInt($("#nf-year").value) || null;
    const type = $("#nf-type").value;
    const item = { id: newId(title, year, type), title, year, type, status: $("#nf-status").value, addedBy: "manual" };
    for (const k of ["wiki", "wikidata", "tvmaze", "imdb", "format", "description"]) if (r[k]) item[k] = r[k];
    if (item.status === "in_progress") item.startedAt = today();
    if (item.status === "downloaded") item.dateAdded = today();
    const by = $("#nf-by").value.trim();
    if (by) item.request = { by, priority: $("#nf-pri").value, date: today(), note: preset.request?.note || "" };
    lib.items.push(item);
    byId.set(item.id, item);
    const cid = $("#nf-coll").value;
    if (cid) addToCollection(lib.collections.find((x) => x.id === cid), item.id);
    if (r.poster) {
      try { item.poster = (await postPoster(item.id, { url: r.poster })).poster; } catch {}
    }
    save();
    closeModal();
    toast(`Added ${title}`, "Open", () => openItem(item.id));
  };
}

// Pull the poster (and fill any blank year) from an IMDb title id/link.
async function setFromImdb(item) {
  const raw = $("#imdb-id").value.trim();
  const id = raw.match(/tt\d{5,10}/)?.[0];
  if (!id) return toast("Paste an IMDb ID like tt1234567, or the IMDb page link");
  const btn = $('[data-act="imdb-set"]');
  btn.disabled = true; btn.textContent = "Fetching…";
  try {
    const r = await fetch(`/api/imdb?id=${id}`);
    const t = await r.json();
    if (!r.ok) throw new Error(t.error);
    item.imdb = id;
    if (!item.year && t.year) item.year = t.year;
    if (t.poster) item.poster = (await postPoster(item.id, { url: t.poster })).poster;
    save();
    openItem(item.id);
    toast(t.poster ? `Poster updated from IMDb: ${t.title}${t.year ? ` (${t.year})` : ""}` : `Saved IMDb ID. IMDb has no poster for ${t.title}`);
  } catch (e) {
    btn.disabled = false; btn.textContent = "Use poster";
    toast("IMDb lookup failed: " + e.message);
  }
}

async function postPoster(id, body) {
  const isFile = body instanceof File;
  const res = await fetch(`/api/poster?id=${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": isFile ? body.type || "image/jpeg" : "application/json" },
    body: isFile ? body : JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error);
  return j;
}

// ---------------------------------------------------------------- small UI helpers

let toastTimer;
function toast(msg, actionLabel, action) {
  const t = $("#toast");
  t.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button class="btn small">${esc(actionLabel)}</button>` : ""}`;
  if (actionLabel) t.querySelector("button").onclick = () => { t.hidden = true; action(); };
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 6000);
}

// Inline "are you sure?": swaps the button for Yes/Cancel in place.
function confirmInline(btn, text, onYes) {
  const slot = btn.closest("[data-confirm-slot]") || btn.parentElement;
  const prev = slot.innerHTML;
  slot.innerHTML = `<span class="confirm">${esc(text)} <button class="btn small danger solid" data-yes>Yes</button><button class="btn small" data-no>Cancel</button></span>`;
  slot.querySelector("[data-yes]").onclick = (e) => { e.stopPropagation(); onYes(); };
  slot.querySelector("[data-no]").onclick = (e) => { e.stopPropagation(); slot.innerHTML = prev; };
}

// In-page text prompt (avoids the browser's prompt()).
function askText(title, value, onOk) {
  openModal(`<h2 style="margin-top:0">${esc(title)}</h2>
    <form id="ask-form" class="row"><input class="input" name="v" style="flex:1" value="${esc(value || "")}" required autocomplete="off">
    <button class="btn primary">Save</button></form>`);
  const f = $("#ask-form");
  f.v.focus(); f.v.select();
  f.onsubmit = (e) => { e.preventDefault(); onOk(f.v.value.trim()); };
}

function saveSet(key, set) { localSet(key, JSON.stringify([...set])); }

// Tapping empty space on a collection card toggles Show all / Show less.
function cardTap(e) {
  const card = e.target.closest(".ccard");
  if (!card || card.matches(".collapsed, .reordering") || e.target.closest("button, a, input, select, textarea, #menu")) return;
  const id = card.dataset.cid;
  if (ui.expandedCards.has(id)) return collapseCard(id);
  if (!card.querySelector('[data-act="coll-more"]')) return;
  ui.expandedCards.add(id);
  render();
}

// Shrinking a long list would leave you stranded below it, so bring the card's top back into view.
function collapseCard(id) {
  ui.expandedCards.delete(id);
  render();
  const card = document.querySelector(`.ccard[data-cid="${CSS.escape(id)}"]`);
  if (!card) return;
  const top = card.getBoundingClientRect().top - ($(".topbar")?.offsetHeight || 0) - 12;
  if (top < 0) window.scrollBy({ top, behavior: "smooth" });
}

// ---------------------------------------------------------------- events

document.addEventListener("click", (e) => {
  if (!e.target.closest("#menu") && !e.target.closest("[data-act$='-menu']")) closeMenu();
  const t = e.target.closest("[data-act], [data-open], .result[data-r]");
  if (!t) return cardTap(e);
  if (t.closest("#menu")) return;
  const act = t.dataset.act;
  const itemId = $("#modal-body [data-item]")?.dataset.item;
  const item = itemId && byId.get(itemId);
  const coll = () => lib.collections.find((x) => x.id === t.dataset.cid);

  if (!act && t.matches(".result[data-r]")) return pickResult(+t.dataset.r);
  if (!act && t.dataset.open) return openItem(t.dataset.open);

  switch (act) {
    case "status-menu": return statusMenu(t, byId.get(t.dataset.iid), t.dataset.cid);
    case "coll-menu": return collMenu(t, coll());
    case "coll-pin": return togglePin(coll());
    case "coll-x": {
      const c = coll(), i = byId.get(t.dataset.iid);
      const gone = i.addedBy === "collection" && i.status === "missing" && !i.request && collectionsOf(i.id).length === 1;
      return withUndo(gone ? `Removed ${i.title} for good` : `Removed ${i.title} from ${c.name}`, () => removeFromCollection(c, i));
    }
    case "rip-failed": {
      const i = byId.get(t.dataset.iid);
      markFailed(i);
      render();
      return toast(`${i.title} moved to Failed`, "View", () => goTab("failed"));
    }
    case "fail-retry": {
      const i = byId.get(t.dataset.iid);
      setStatus(i, "in_progress");
      render();
      return toast(`Ripping ${i.title} again`);
    }
    case "fail-clear": {
      const i = byId.get(t.dataset.iid);
      return withUndo(`Cleared ${i.title} from Failed`, () => { delete i.failed; });
    }
    case "fail-note": {
      const i = byId.get(t.dataset.iid);
      return askText(`What went wrong with ${i.title}?`, i.failed?.note || "", (v) => { i.failed.note = v; save(); closeModal(); });
    }
    case "quick-status": {
      const i = byId.get(t.dataset.iid);
      setStatus(i, t.dataset.s);
      render();
      return toast({ in_progress: `Ripping ${i.title}`, downloaded: `${i.title} is on Jellyfin`, missing: `${i.title} is back in Don't Have` }[t.dataset.s]);
    }
    case "toggle-status": {
      const s = t.dataset.s;
      if (ui.statuses.size === 3) ui.statuses = new Set([s]);
      else if (ui.statuses.has(s) && ui.statuses.size === 1) ui.statuses = new Set(STATUS_ORDER);
      else ui.statuses.has(s) ? ui.statuses.delete(s) : ui.statuses.add(s);
      return render();
    }
    case "type": ui.type = t.dataset.v; return render();
    case "mkind": e.stopPropagation(); ui.missingKind = t.dataset.v; return render();
    case "collapse":
      if (e.target.closest("[data-stop]")) return;
      ui.collapsedSections.has(t.dataset.s) ? ui.collapsedSections.delete(t.dataset.s) : ui.collapsedSections.add(t.dataset.s);
      saveSet("collapsed", ui.collapsedSections);
      return render();
    case "coll-collapse": {
      const id = t.dataset.cid;
      ui.collapsedCards.has(id) ? ui.collapsedCards.delete(id) : ui.collapsedCards.add(id);
      saveSet("collapsedCards", ui.collapsedCards);
      return render();
    }
    case "coll-more": ui.expandedCards.add(t.dataset.cid); return render();
    case "coll-less": return collapseCard(t.dataset.cid);
    case "coll-reorder": ui.reorder = t.dataset.cid || null; return render();
    case "coll-add": return openAdd({ forCollection: t.dataset.cid });
    case "coll-move": {
      const c = coll();
      const i = +t.dataset.idx, j = i + +t.dataset.d;
      if (j < 0 || j >= c.items.length) return;
      [c.items[i], c.items[j]] = [c.items[j], c.items[i]];
      c.manual = true; save(); return render();
    }
    case "coll-remove": {
      const c = coll(), i = byId.get(t.dataset.iid);
      return withUndo(`Removed ${i.title} from ${c.name}`, () => removeFromCollection(c, i));
    }
    case "new-coll":
      return askText("New collection name", "", (v) => {
        if (!v) return closeModal();
        lib.collections.push({ id: "c-" + slug(v) + "-" + Date.now().toString(36), name: v, source: "manual", manual: true, items: [] });
        ui.collShow = "all"; localSet("collShow", "all");
        save(); renderFilters();
        openAdd({ forCollection: lib.collections.at(-1).id });
      });
    case "refresh-colls": {
      t.disabled = true; t.textContent = "Looking up… (a few minutes)";
      clearTimeout(saveTimer);
      fetch("/api/library", { method: "PUT", headers: { "Content-Type": "application/json", "X-Lib-Version": libVersion || "" }, body: JSON.stringify(lib) })
        .then(() => fetch("/api/refresh-collections", { method: "POST" }))
        .then((r) => r.json())
        .then((j) => { if (j.error) throw new Error(j.error); toast(j.log.split("\n").filter((l) => /collections|matched/.test(l)).join(" · ") || "Done"); return load(); })
        .catch((err) => { toast("Refresh failed: " + err.message); render(); });
      return;
    }
    case "next-more": ui.nextMore = !ui.nextMore; return render();
    case "resort": ui.frozen = null; return render();
    case "titles-more": ui.titlesMore = !ui.titlesMore; return render();
    case "pinned-toggle": ui.pinnedCollapsed = !ui.pinnedCollapsed; localSet("pinnedCollapsed", ui.pinnedCollapsed ? "1" : ""); return render();
    case "imdb-set": return setFromImdb(item);
    case "req-toggle-done": ui.reqShowDone = !ui.reqShowDone; return render();
    case "req-done": byId.get(t.dataset.iid).request.fulfilled = today(); save(); return render();
    case "req-reopen": delete byId.get(t.dataset.iid).request.fulfilled; save(); return render();

    // ---- item modal
    case "set-status": setStatus(item, t.dataset.s); return openItem(item.id);
    case "modal-failed": markFailed(item); toast(`${item.title} moved to Failed`); return openItem(item.id);
    case "make-request": item.request = { by: "", priority: "high", date: today(), note: "" }; save(); openItem(item.id); return $("[data-f='request.by']")?.focus();
    case "remove-request": delete item.request; save(); return openItem(item.id);
    case "leave-coll": {
      const c = coll();
      c.items = c.items.filter((x) => x !== item.id); c.manual = true; save(); return openItem(item.id);
    }
    case "delete-item":
      return confirmInline(t, "Delete this title from your library?", () => {
        $("#modal").hidden = true;
        withUndo(`Deleted ${item.title}`, () => deleteItem(item));
      });
    case "art-search": return openAdd({ preset: { q: item.title, type: item.type }, forArtwork: item.id });
    case "add-manual": return pickResult("manual");
  }
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  const itemId = $("#modal-body [data-item]")?.dataset.item;
  const item = itemId && byId.get(itemId);
  const act = t.dataset.act;
  if (act === "sort") { ui.sort = t.value; localSet("sort", ui.sort); return render(); }
  if (act === "collsort") { ui.collSort = t.value; localSet("collSort", ui.collSort); return render(); }
  if (act === "collshow") { ui.collShow = t.value; localSet("collShow", ui.collShow); return render(); }
  if (act === "collcat") { ui.collCat = t.value; return render(); }
  if (act === "art-upload" && t.files[0]) {
    try { item.poster = (await postPoster(item.id, t.files[0])).poster; save(); openItem(item.id); } catch (err) { toast("Upload failed: " + err.message); }
    return;
  }
  if (act === "join-coll" && item) {
    if (t.value === "__new") {
      return askText("New collection name", "", (v) => {
        if (v) lib.collections.push({ id: "c-" + slug(v) + "-" + Date.now().toString(36), name: v, source: "manual", manual: true, items: [item.id] });
        save(); openItem(item.id);
      });
    }
    const c = lib.collections.find((x) => x.id === t.value);
    if (c) { addToCollection(c, item.id); save(); openItem(item.id); }
    return;
  }
  if (t.dataset.f && item) {
    let v = t.value;
    if (t.dataset.f === "year") v = parseInt(v) || null;
    setField(item, t.dataset.f, v);
    save();
    if (["title", "year", "type"].includes(t.dataset.f)) openItem(item.id);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "imdb-id") { e.preventDefault(); $('[data-act="imdb-set"]').click(); }
});

document.addEventListener("submit", (e) => {
  if (e.target.id === "lookup-form") { e.preventDefault(); return runLookup(); }
  if (e.target.id === "req-form") {
    e.preventDefault();
    const f = e.target;
    openAdd({ preset: { q: f.title.value.trim(), request: { by: f.by.value.trim(), priority: f.priority.value, note: f.note.value.trim() } } });
  }
});

let searchTimer;
document.addEventListener("input", (e) => {
  if (e.target.id !== "search") return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { ui.search = e.target.value.trim(); ui.titlesMore = false; render(); }, 150);
});

function goTab(tab) {
  ui.tab = tab; localSet("tab", ui.tab);
  ui.reorder = null;
  window.scrollTo(0, 0);
  render(true);
}
for (const nav of ["#tabs", "#bottomnav"]) {
  $(nav).addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) goTab(b.dataset.tab);
  });
}
$(".brand").addEventListener("click", (e) => { e.preventDefault(); goTab("collections"); });
$("#add-btn").onclick = () => openAdd();
$("#modal-close").onclick = closeModal;
$("#modal").addEventListener("mousedown", (e) => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if (!$("#menu").hidden) return closeMenu(); if (!$("#modal").hidden) closeModal(); }
  if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) { e.preventDefault(); $("#search")?.focus(); }
});

// Theme: dark by default (it's a movie app); the header button switches to light.
(function theme() {
  const saved = localGet("theme");
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme-btn").onclick = () => {
    const light = document.documentElement.dataset.theme === "light";
    document.documentElement.dataset.theme = light ? "dark" : "light";
    localSet("theme", document.documentElement.dataset.theme);
  };
})();

load();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !$("#modal").hidden) return;
  fetch("/api/library", { method: "HEAD" }).then((r) => {
    const v = r.headers.get("X-Lib-Version");
    if (v && libVersion && v !== libVersion) load();
  }).catch(() => {});
});
