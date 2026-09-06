# CartRelay POC

**Pick. Fetch. Play.**

A browser-first retro-emulation proof of concept aimed at mobile/touch play without maintaining a ROM library.

## What it does

- Uses **Koin.js** as the emulator/player layer.
- Accepts:
  - `https://archive.org/details/<identifier>`
  - `https://archive.org/download/<identifier>/<filename>`
- For an Archive item page, reads `https://archive.org/metadata/<identifier>` and lists ROM-like files.
- Fetches/launches a game only when the user asks to play it.
- Has no upload flow and no ROM database.
- Includes an optional **Archive-only streaming relay** for CORS failures. It follows redirects, adds CORS/CORP response headers, uses `Cache-Control: no-store`, and does not persist content.
- Includes a lawful test control using **NES Diamond-Chase**, an MIT-licensed homebrew ROM on GitHub, so Koin/mobile controls can be tested independently of Archive.org.

## Why the relay exists

Internet Archive's canonical file pattern is:

`https://archive.org/download/<identifier>/<filename>`

However, `/download/` can redirect to storage nodes. Some storage responses do not include the browser CORS headers required by a cross-origin web emulator.

The Worker is intentionally **not** an open proxy:
- it accepts only `archive.org` / `*.archive.org`;
- it validates every redirect;
- it uses GET/HEAD only;
- it does not cache or store the game.

## Run locally

Koin.js documents COOP/COEP headers for SharedArrayBuffer, so opening `index.html` as a `file://` URL is not the right test.

```bash
cd cartrelay-poc
python3 server.py
```

Open:

`http://localhost:8080`

The browser still needs internet access for Koin.js and remote ROM URLs.

## Deploy the static POC

`_headers` is included in a format understood by hosts such as Cloudflare Pages/Netlify-style static deployments. Verify your host actually emits:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

## Deploy the optional Cloudflare Worker

Create a Worker and use the contents of `archive-relay-worker.js`.

Once deployed, paste the Worker origin into CartRelay's **Optional Archive CORS relay** field, e.g.:

`https://cartrelay-archive-relay.example.workers.dev`

The POC will then use:

`https://...workers.dev/fetch?url=<encoded archive URL>`

## Privacy / storage semantics

CartRelay itself stores no ROMs and has no library. Bytes necessarily exist in browser memory while a game is running. Direct remote responses may also be subject to ordinary browser/HTTP caching rules set by the source. The included relay explicitly sends `Cache-Control: no-store`.

## Systems wired into the UI

- NES / Famicom
- SNES / Super Famicom
- Sega Genesis / Mega Drive
- Sega Master System
- Game Gear
- Game Boy / Color / Advance

Koin.js supports additional systems that can be added later.

## Name

**CartRelay** is a working name: the cartridge is relayed to the browser for the session rather than accumulated into a library.

A preliminary web search on September 6, 2026 did not surface a retro-emulation product using the exact name. That is not a trademark/domain clearance.
