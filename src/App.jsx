import React, { useEffect, useRef, useState } from "react";
import { GamePlayer } from "koin.js";
import "koin.js/styles.css";
import {
  APP_NAME,
  DEMO_URL,
  SYSTEM_OPTIONS,
  buildCorsUrl,
  buildDownloadUrl,
  buildMetadataUrl,
  buildSearchUrl,
  displayFileName,
  formatBytes,
  inferSystem,
  itemUrl,
  parseArchiveUrl,
  playableFiles,
  systemLabels,
} from "./archive.mjs";
import {
  cacheStorageAvailable,
  clearRomCache,
  getCachePreference,
  getRomCacheInfo,
  makeRomCacheId,
  setCachePreference,
} from "./cache.mjs";

const SEARCH_ROWS = 20;
const INSPECT_LIMIT = 12;
const FILE_DISPLAY_LIMIT = 60;
const RELAY_ENABLED = import.meta.env.PROD;

function relayUrl(target) {
  return RELAY_ENABLED ? `/fetch?url=${encodeURIComponent(target)}` : null;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The request timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url) {
  const candidates = [url, relayUrl(url)].filter(Boolean);
  let lastError;
  for (const candidate of [...new Set(candidates)]) {
    try {
      const response = await fetchWithTimeout(candidate, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Archive metadata could not be loaded.");
}

async function checkPlayableUrl(url) {
  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      cache: "no-store",
    },
    25_000,
  );
  try {
    if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);
  } finally {
    // Do not buffer a ROM just to test CORS. Koin will fetch it once when mounted.
    try {
      await response.body?.cancel();
    } catch {
      // The browser may already have closed the response body.
    }
  }
  return url;
}

async function findPlayableUrl(directUrl, parsed) {
  const candidates = [];
  if (parsed?.kind === "file") candidates.push(buildCorsUrl(parsed.identifier, parsed.filename));
  candidates.push(directUrl);
  const relayed = relayUrl(directUrl);
  if (relayed) candidates.push(relayed);

  let lastError;
  for (const candidate of [...new Set(candidates)]) {
    try {
      return await checkPlayableUrl(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  if (RELAY_ENABLED) {
    throw new Error(`Archive file fetch failed after trying the direct URL and relay (${errorMessage(lastError)}).`);
  }
  throw new Error("Archive file fetch failed. Try again from the deployed app so its CORS relay can help.");
}

async function inspectSearchDocuments(documents, isCurrent) {
  const inspected = [];
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < documents.length) {
      const index = nextIndex++;
      const doc = documents[index];
      try {
        const metadata = await fetchJson(buildMetadataUrl(doc.identifier));
        const allFiles = playableFiles(metadata);
        if (allFiles.length) {
          inspected[index] = {
            identifier: doc.identifier,
            title: metadata.metadata?.title || doc.title || doc.identifier,
            description: metadata.metadata?.description || doc.description || "",
            creator: metadata.metadata?.creator || doc.creator || "",
            year: metadata.metadata?.year || doc.year || "",
            files: allFiles.slice(0, FILE_DISPLAY_LIMIT),
            totalFiles: allFiles.length,
            systems: systemLabels(allFiles),
          };
        }
      } catch {
        // Search should remain useful when one old/private item has bad metadata.
      }
      if (!isCurrent()) return;
    }
  };

  const concurrency = Math.min(3, documents.length);
  await Promise.all(Array.from({ length: concurrency }, worker));
  return inspected.filter(Boolean);
}

async function loadCacheInfo() {
  try {
    return await getRomCacheInfo();
  } catch {
    return { available: cacheStorageAvailable(), count: 0, names: [] };
  }
}

class PlayerErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="player-error" role="alert">
          <strong>Koin could not start this game.</strong>
          <span>{errorMessage(this.state.error)}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

function Status({ message, kind = "" }) {
  if (!message) return null;
  return (
    <p className={`status ${kind}`} role={kind === "error" ? "alert" : "status"} aria-live="polite">
      <span className="status-dot" aria-hidden="true" />
      {message}
    </p>
  );
}

function FilePicker({ files, value, onChange, onPlay, disabled }) {
  if (!files.length) return null;
  return (
    <div className="file-picker">
      <div className="field-label-row">
        <label htmlFor="file-select">Playable-looking files found</label>
        <span className="field-note">{files.length} option{files.length === 1 ? "" : "s"}</span>
      </div>
      <div className="file-picker-row">
        <select id="file-select" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
          {files.map((file) => (
            <option value={file.name} key={file.name}>
              {file.name} · {formatBytes(file.size)}{file.system ? ` · ${file.system}` : ""}
            </option>
          ))}
        </select>
        <button type="button" onClick={onPlay} disabled={disabled || !value}>
          Play selected
        </button>
      </div>
      <p className="field-note format-note">{files.find((file) => file.name === value)?.hint}</p>
    </div>
  );
}

function SearchResult({ result, onPlay, disabled }) {
  const [selectedFile, setSelectedFile] = useState(result.files[0]?.name || "");
  const selected = result.files.find((file) => file.name === selectedFile) || result.files[0];
  const description = String(result.description || "").replace(/\s+/g, " ").trim();

  return (
    <article className="result-card">
      <div className="result-card-top">
        <div>
          <p className="eyebrow">ARCHIVE ITEM</p>
          <h3>{result.title}</h3>
          <p className="result-meta">
            {result.year || "Year unknown"}
            {result.creator ? ` · ${result.creator}` : ""}
          </p>
        </div>
        <a href={itemUrl(result.identifier)} target="_blank" rel="noreferrer" className="text-link">
          Archive ↗
        </a>
      </div>
      {description && <p className="result-description">{description.slice(0, 220)}{description.length > 220 ? "…" : ""}</p>}
      <div className="chip-row">
        {(result.systems.length ? result.systems : ["Choose system manually"]).map((system) => (
          <span className="chip" key={system}>{system}</span>
        ))}
        <span className="chip muted-chip">
          {result.totalFiles}{result.totalFiles === 1 ? " file" : " files"}
        </span>
      </div>
      <div className="result-play-row">
        <select aria-label={`Playable file for ${result.title}`} value={selected?.name || ""} onChange={(event) => setSelectedFile(event.target.value)}>
          {result.files.map((file) => (
            <option value={file.name} key={file.name}>
              {displayFileName(file.name)}{file.system ? ` · ${file.system}` : ""} · {file.hint}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => onPlay(result, selected)} disabled={disabled || !selected}>
          Play
        </button>
      </div>
      {result.totalFiles > result.files.length && (
        <p className="field-note">Showing the first {result.files.length} playable-looking files in this item.</p>
      )}
    </article>
  );
}

export default function App() {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [system, setSystem] = useState("auto");
  const [title, setTitle] = useState("");
  const [itemFiles, setItemFiles] = useState([]);
  const [selectedItemFile, setSelectedItemFile] = useState("");
  const [directStatus, setDirectStatus] = useState({ message: "", kind: "" });
  const [busy, setBusy] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchStatus, setSearchStatus] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchTotal, setSearchTotal] = useState(null);
  const [player, setPlayer] = useState(null);
  const [cacheGames, setCacheGames] = useState(() => getCachePreference() && cacheStorageAvailable());
  const [cacheInfo, setCacheInfo] = useState({ available: cacheStorageAvailable(), count: 0, names: [] });
  const [cacheMessage, setCacheMessage] = useState("");
  const searchToken = useRef(0);
  const sessionToken = useRef(0);
  const playerRef = useRef(null);

  useEffect(() => {
    document.title = `${APP_NAME} — Fetch. Play. No shelf.`;
    loadCacheInfo().then(setCacheInfo);
  }, []);

  useEffect(() => {
    if (player) playerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [player]);

  async function refreshCacheInfo() {
    setCacheInfo(await loadCacheInfo());
  }

  function toggleCache(event) {
    const enabled = event.target.checked;
    setCacheGames(enabled);
    setCachePreference(enabled);
    setCacheMessage(enabled
      ? "New Archive games may be kept in this browser for faster replay."
      : "Caching is off for the next games you play; existing copies remain until cleared.");
  }

  async function handleClearCache() {
    if (busy || player || !cacheInfo.available) return;
    if (!window.confirm("Clear locally cached game copies? This affects this browser only and cannot remove the current game from memory if one is running.")) return;
    setCacheMessage("Clearing local game copies…");
    try {
      const removed = await clearRomCache();
      await refreshCacheInfo();
      setCacheMessage(removed ? "Local game cache cleared." : "There were no local game copies to clear.");
    } catch (error) {
      setCacheMessage(`Could not clear the local game cache: ${errorMessage(error)}`);
    }
  }

  async function playFile(url, filename, label, systemOverride = null, external = false, cacheVersion = "") {
    const token = ++sessionToken.current;
    setBusy(true);
    setDirectStatus({ message: external ? "Checking the demo…" : "Checking the Archive file…", kind: "" });
    try {
      const parsed = external ? null : parseArchiveUrl(url);
      const playableUrl = await findPlayableUrl(url, parsed);
      const chosenSystem = systemOverride || (system === "auto" ? inferSystem(filename || url) : system);
      if (!chosenSystem) {
        throw new Error("This file type does not identify a console. Choose a System manually, then play it.");
      }
      let romId = "";
      if (!external && cacheGames && cacheStorageAvailable()) {
        try {
          romId = await makeRomCacheId({ url, filename: filename || displayFileName(url), version: cacheVersion });
        } catch {
          setCacheMessage("The local cache key could not be created; this session will still play without caching.");
        }
      }
      if (token !== sessionToken.current) return;
      const gameTitle = label?.trim() || title.trim() || displayFileName(filename || url).replace(/\.[^.]+$/, "") || "Archive game";
      setPlayer({
        key: `${playableUrl}-${Date.now()}`,
        url: playableUrl,
        filename: filename || displayFileName(url),
        title: gameTitle,
        system: chosenSystem,
        cacheId: romId,
      });
      setDirectStatus({ message: "Launching the player. Use Koin's controls/fullscreen affordance for the best phone layout.", kind: "success" });
    } catch (error) {
      if (token === sessionToken.current) setDirectStatus({ message: errorMessage(error), kind: "error" });
    } finally {
      if (token === sessionToken.current) setBusy(false);
    }
  }

  async function resolveDirect(event) {
    event.preventDefault();
    setItemFiles([]);
    setSelectedItemFile("");
    const raw = source.trim();
    if (!raw) {
      setDirectStatus({ message: "Paste an Internet Archive item or file URL first.", kind: "error" });
      return;
    }

    let parsed;
    try {
      parsed = parseArchiveUrl(raw);
    } catch (error) {
      setDirectStatus({ message: errorMessage(error), kind: "error" });
      return;
    }

    if (parsed.kind === "file") {
      await playFile(parsed.url, parsed.filename, title);
      return;
    }

    setBusy(true);
    setDirectStatus({ message: "Reading live Archive item metadata…", kind: "" });
    try {
      const metadata = await fetchJson(buildMetadataUrl(parsed.identifier));
      const files = playableFiles(metadata);
      if (!files.length) throw new Error("No likely playable ROM/archive files were found in this item.");
      setItemFiles(files);
      setSelectedItemFile(files[0].name);
      const itemTitle = metadata.metadata?.title || title;
      setTitle((current) => current.trim() || metadata.metadata?.title || "");
      if (files.length === 1) {
        await playFile(buildDownloadUrl(parsed.identifier, files[0].name), files[0].name, itemTitle, files[0].system, false, files[0].cacheVersion);
      } else {
        setDirectStatus({ message: `${files.length} playable-looking files found. Pick one below.`, kind: "success" });
      }
    } catch (error) {
      setDirectStatus({ message: errorMessage(error), kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function playSelectedItemFile() {
    if (!selectedItemFile) return;
    try {
      const parsed = parseArchiveUrl(source.trim());
      const file = itemFiles.find((candidate) => candidate.name === selectedItemFile);
      await playFile(
        buildDownloadUrl(parsed.identifier, selectedItemFile),
        selectedItemFile,
        title,
        file?.system || null,
        false,
        file?.cacheVersion || "",
      );
    } catch (error) {
      setDirectStatus({ message: errorMessage(error), kind: "error" });
    }
  }

  async function runSearch(event) {
    event.preventDefault();
    const token = ++searchToken.current;
    setSearchBusy(true);
    setSearchResults([]);
    setSearchTotal(null);
    setSearchStatus("Searching Archive and checking the first compatible items…");
    try {
      const response = await fetchJson(buildSearchUrl(query, 1, SEARCH_ROWS));
      const docs = response?.response?.docs || [];
      const total = Number(response?.response?.numFound || 0);
      setSearchTotal(total);
      if (!docs.length) {
        setSearchStatus("No Archive items matched that search.");
        return;
      }
      const results = await inspectSearchDocuments(docs.slice(0, INSPECT_LIMIT), () => token === searchToken.current);
      if (token !== searchToken.current) return;
      setSearchResults(results);
      setSearchStatus(
        results.length
          ? `Found ${results.length} item${results.length === 1 ? "" : "s"} with likely playable files.`
          : "The first matches did not contain obvious playable files. Try a system name, game title, or homebrew keyword.",
      );
    } catch (error) {
      if (token === searchToken.current) setSearchStatus(errorMessage(error));
    } finally {
      if (token === searchToken.current) setSearchBusy(false);
    }
  }

  async function playSearchResult(result, file) {
    const url = buildDownloadUrl(result.identifier, file.name);
    setSource(itemUrl(result.identifier));
    setTitle(result.title);
    if (file.system) setSystem(file.system);
    await playFile(url, file.name, result.title, file.system || null, false, file.cacheVersion);
  }

  function playDemo() {
    setSystem("NES");
    setTitle("NES Diamond-Chase (MIT demo)");
    setDirectStatus({ message: "Loading the MIT-licensed homebrew demo…", kind: "" });
    playFile(DEMO_URL, "game.nes", "NES Diamond-Chase (MIT demo)", "NES", true).catch(() => {});
  }

  function closePlayer() {
    sessionToken.current += 1;
    setPlayer(null);
    setDirectStatus({ message: "Session stopped. Koin is unmounted so its emulator resources can be released.", kind: "" });
    refreshCacheInfo();
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <main className="content">
        <header className="site-header">
          <a className="brand" href="/" aria-label="Fetchcade home">
            Fetch<span>cade</span>
          </a>
          <div className="header-note">
            <span className="live-dot" />
            <span>Live Archive search</span>
          </div>
        </header>

        <section className="hero">
          <div className="hero-kicker">A temporary arcade for the open web</div>
          <h1>Fetch a game.<br /><em>Play it now.</em></h1>
          <p className="hero-copy">
            Search Internet Archive or bring a known link. Fetchcade sends the game to your browser for this session—no uploads, no ROM shelf.
          </p>
          <div className="hero-chips" aria-label="Product features">
            <span>Archive powered</span><span>Touch ready</span><span>Nothing stored here</span>
          </div>
        </section>

        <section className="search-card card-glow" aria-labelledby="search-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">01 / FIND A GAME</p>
              <h2 id="search-heading">Search the Archive</h2>
            </div>
            <span className="step-mark">⌕</span>
          </div>
          <form className="search-form" onSubmit={runSearch}>
            <label className="sr-only" htmlFor="query">Search Internet Archive</label>
            <input
              id="query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try: NES homebrew, Sonic, Mega Drive…"
              autoComplete="off"
            />
            <button type="submit" disabled={searchBusy || !query.trim()}>
              {searchBusy ? "Searching…" : "Search"}
            </button>
          </form>
          <p className="helper-text">Fetchcade checks live item metadata and keeps results that contain likely playable files.</p>
          {(searchStatus || searchBusy) && (
            <div className={`search-status ${searchStatus && !searchBusy && !searchResults.length && searchTotal !== null ? "search-status-error" : ""}`}>
              {searchBusy && <span className="spinner" aria-hidden="true" />}
              <span>{searchStatus}</span>
              {searchTotal !== null && !searchBusy && <span className="result-count">{searchTotal.toLocaleString()} Archive matches</span>}
            </div>
          )}
          {searchResults.length > 0 && (
            <div className="results-list">
              {searchResults.map((result) => (
                <SearchResult key={result.identifier} result={result} onPlay={playSearchResult} disabled={busy} />
              ))}
            </div>
          )}
        </section>

        <div className="divider-label"><span>or use a known link</span></div>

        <section className="direct-card card" aria-labelledby="direct-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">02 / BRING YOUR OWN LINK</p>
              <h2 id="direct-heading">Play from an Archive URL</h2>
            </div>
            <span className="step-mark">↗</span>
          </div>
          <form onSubmit={resolveDirect}>
            <label htmlFor="source">Archive item or file URL</label>
            <input
              id="source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="archive.org/details/item-id or /download/item-id/game.nes"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck="false"
            />
            <div className="form-grid">
              <div>
                <label htmlFor="system">System</label>
                <select id="system" value={system} onChange={(event) => setSystem(event.target.value)}>
                  {SYSTEM_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="title">Display title <span className="optional">optional</span></label>
                <input id="title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Uses Archive title when available" />
              </div>
            </div>
            <div className="action-row">
              <button type="submit" disabled={busy}>{busy ? "Working…" : "Resolve & play"}</button>
              <button type="button" className="button-secondary" onClick={playDemo} disabled={busy}>Try MIT demo</button>
            </div>
          </form>
          <FilePicker
            files={itemFiles}
            value={selectedItemFile}
            onChange={setSelectedItemFile}
            onPlay={playSelectedItemFile}
            disabled={busy}
          />
          <div className="storage-panel" aria-labelledby="cache-heading">
            <div className="storage-copy">
              <p className="storage-title" id="cache-heading">Optional local replay cache</p>
              <p className="field-note">Keep a browser-local copy of games you play so the next replay can skip the Archive download. Nothing is uploaded to Fetchcade.</p>
              <label className="cache-toggle">
                <input type="checkbox" checked={cacheGames} onChange={toggleCache} disabled={!cacheInfo.available} />
                <span>Keep game copies on this device</span>
              </label>
            </div>
            <div className="storage-actions">
              <button
                type="button"
                className="button-secondary clear-cache-button"
                onClick={handleClearCache}
                disabled={busy || Boolean(player) || !cacheInfo.available}
                title="Removes ROM copies stored by Koin in this browser. It does not delete anything from Internet Archive or Fetchcade servers. Stop the current game first."
              >
                Clear local cache
              </button>
              <span className="field-note">{cacheInfo.count ? `${cacheInfo.count} local game${cacheInfo.count === 1 ? "" : "s"} cached` : "No local games cached"}</span>
            </div>
          </div>
          {cacheMessage && <p className="cache-message" role="status">{cacheMessage}</p>}
          <Status message={directStatus.message} kind={directStatus.kind} />
          <p className="format-note legal-note"><strong>Format note:</strong> Koin handles many single-file console formats. ZIP/7z are containers, not universal ROM support; disc formats may need companion tracks and BIOS. Choose the system manually when auto-detection is ambiguous.</p>
          <p className="legal-note">Use only software you have the right to access. The relay is a transport workaround, not a storage service.</p>
        </section>

        {player && (
          <section className="player-card card-glow" ref={playerRef} aria-labelledby="player-heading">
            <div className="player-heading">
              <div>
                <p className="eyebrow">03 / NOW PLAYING</p>
                <h2 id="player-heading">{player.title}</h2>
                <p className="player-meta"><span className="player-system">{player.system}</span> {displayFileName(player.filename)} {player.cacheId && <span className="cache-badge">· local cache on</span>}</p>
              </div>
              <button className="button-secondary close-button" type="button" onClick={closePlayer}>Stop session</button>
            </div>
            <div className="player-mount">
              <PlayerErrorBoundary onError={(error) => setDirectStatus({ message: `Koin could not start this game: ${errorMessage(error)}`, kind: "error" })}>
                <GamePlayer
                  key={player.key}
                  romId={player.cacheId || ""}
                  romUrl={player.url}
                  romFileName={player.filename}
                  system={player.system}
                  title={player.title}
                  onReady={() => setDirectStatus({ message: "Ready. On a phone, open Koin's controls/fullscreen affordance and rotate landscape if helpful.", kind: "success" })}
                  onError={(error) => setDirectStatus({ message: `Koin could not load this file: ${errorMessage(error)}`, kind: "error" })}
                  onExit={closePlayer}
                />
              </PlayerErrorBoundary>
            </div>
            <p className="player-tip">Koin supplies the virtual controls, keyboard/gamepad input, rewind, and player UI. Touch controls are most comfortable after opening its controls/fullscreen affordance; browser/device fullscreen behavior varies.</p>
            <p className="player-tip settings-persistence"><strong>Settings persist in this browser:</strong> Koin stores volume, mute, shader, haptics, keyboard mappings by system, and gamepad mappings locally for this origin. They do not sync across devices. Save-state buttons download `.state` files unless a save backend is configured.</p>
          </section>
        )}

        <section className="how-card card" aria-labelledby="how-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE IDEA</p>
              <h2 id="how-heading">No shelf. Just a session.</h2>
            </div>
          </div>
          <div className="how-grid">
            <div><span>01</span><strong>Find</strong><p>Search live Archive metadata or paste a link.</p></div>
            <div><span>02</span><strong>Fetch</strong><p>The browser requests the file only when you play.</p></div>
            <div><span>03</span><strong>Play</strong><p>Koin handles the controls and emulator session.</p></div>
          </div>
          <p className="privacy-line"><span className="shield-mark">◇</span> Fetchcade has no account, upload flow, or server-side ROM library.</p>
        </section>

        <footer className="site-footer">
          <div className="footer-left">
            <span>Fetchcade / prototype</span>
            <span>Use only software you are legally authorized to access.</span>
          </div>
          <div className="footer-right">
            <a href="https://github.com/jgbrwn/fetchcade" target="_blank" rel="noreferrer">GitHub project ↗</a>
            <span>Fetchcade does not verify rights or encourage illegal ROM use.</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
