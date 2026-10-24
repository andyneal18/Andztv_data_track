You're picking up a personal project called **andztv library**. It was built on my Mac and I'm moving it onto this machine (my HP EliteDesk, always on, also runs Jellyfin). Please read this, then read `README.md` in this folder, then help me with the steps at the bottom.

## What it is
A small web app for tracking my ripped Blu-ray collection on Jellyfin: what I have, what I'm ripping, what failed, what I still need, and what friends and family have asked for. I use it on a computer and on my phone, so it has to stay readable on both.

- **Stack:** Node `server.js` with zero npm dependencies, serving `public/` (`index.html`, `app.js`, `styles.css`). Data is one JSON file, `data/library.json`. Posters are in `posters/`. Python 3 helper scripts are in `tools/` and use only the standard library.
- **Saving:** the server keeps rolling backups in `data/backups/`. It rejects stale saves via an `X-Lib-Version` header, so two open devices can't overwrite each other. A tab whose save is rejected reloads.
- **Password:** optional, set with the `ANDZTV_PASSWORD` environment variable (HTTP Basic auth).
- **Default port:** 4545.

## How I think about my library (please keep to this)
- **Three statuses:**
  - Downloaded (green): on Jellyfin.
  - In Progress (orange): ripping or waiting for me to check the rip.
  - Don't Have (red).
  - A title must never jump straight from Don't Have to Downloaded. I always check the rip first.
- **Failed** is its own tab, not a status. A failed rip carries a `failed` flag `{date, count, note}`. A title I have can still be flagged, e.g. "Season 2 failed".
- **Requests** are things friends and family asked for (`request: {by, priority, date, note, fulfilled}`). They show on the Requests tab and also in Don't Have.
- **Collections are the main view,** along with "Up Next" (what to rip next). The full masterlist matters less.
  - Every collection card shows its first 3 titles at the same height, with "Show all N" in the footer.
  - I can pin collections to the top.
  - The ✕ next to a title's status removes it from that collection, with Undo. A missing title removed that way is gone for good.
- **Collection rules:**
  - Go broad, not small: Toy Story lives inside **Pixar**, Frozen inside **Walt Disney Animation Studios**.
  - Superhero lists may overlap on purpose: all Spider-Man plus the MCU; Fox X-Men; and DCU, DCEU and DCAU kept separate.
  - Go deep within a franchise: TV specials, spin-off series, direct-to-video. For example, the Muppets list includes Studio DC: Almost Live and The Muppets at Walt Disney World.
  - Official releases only, no fan films. The one exception is Spider-Man: Lotus, which got a Blu-ray release.
  - Many films are standalone and belong in no collection. Never force a film into a list.
  - Director collections are only for directors I clearly collect (Nolan, Wes Anderson and others). They're listed in `PICK` in `tools/find_directors.py`.
- **Where collections come from:**
  - Hand-curated lists in `data/curated/*.json`.
  - Director lists, generated into `data/curated/directors.json`.
  - Wikidata, for whatever's left.
  - `tools/apply_curated.py` merges them in. It respects deletions (`dismissedItems`, `dismissedCollections`, `excludedMembers`) and won't rebuild collections I've edited (`manual: true`).
- **Matching titles to Wikipedia** (`tools/enrich.py`) requires the titles to look alike and a movie never matches a series. A loose match once gave a documentary the Project Hail Mary poster. `tools/audit_matches.py` finds bad matches.
- **Wikimedia rate limits:** requests must include the contact address in `data/config.json` and stay throttled. Don't raise the concurrency.

## How I like to work
- I write in shorthand. If something's ambiguous, ask me. Don't guess silently.
- Make a backup of `data/library.json` before any bulk change.
- Never edit `data/library.json` while I might be editing in the app without telling me. The app reloads on version conflicts, but say when you've changed data.
- Keep the code dependency-free and match the existing style.

## What I need now (on this EliteDesk)
1. **Install the app as a service:** run `./deploy/install.sh` from this folder. It sets up a systemd service called `andztv` that starts on boot and restarts if it crashes, and it offers to set a password. Fix it if it fails on this distro.
2. **Set up remote access with Tailscale:**
   - Install Tailscale here: `curl -fsSL https://tailscale.com/install.sh | sh`, then `sudo tailscale up`.
   - Optionally run `sudo tailscale serve --bg 4545` for an HTTPS address.
   - Help me check that I can open it from my phone on cellular, and add it to my home screen.
   - Do **not** expose the app to the public internet (no port forwarding), because it can edit and delete my library.
3. **Check it works:**
   - `systemctl status andztv` shows it running.
   - It still runs after a reboot.
   - The ↻ Find collections button works here (it needs `python3`).
4. **Logs and restarts:** `journalctl -u andztv -f` shows the logs; `sudo systemctl restart andztv` restarts it.

From now on this machine has the real copy of the library. The old Mac copy should no longer be used.
