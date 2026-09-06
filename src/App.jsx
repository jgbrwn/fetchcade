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

function PlayerBoundary({ children, onError }) {
  return <PlayerErrorBoundary onError={onError}>{children}</PlayerErrorBoundary>;
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
        <label htmlFor="file-select">Playable files found</label>
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
              {displayFileName(file.name)}{file.system ? ` · ${file.system}` : ""} · {formatBytes(file.size)}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => onPlay(result, selected)} disabled={disabled || !selected}>
          Play
        </button>
      </div>
      {result.totalFiles > result.files.length && (
        <p className="field-note">Showing the first {result.files.length} playable files in this item.</p>
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
  const searchToken = useRef(0);
  const playerRef = useRef(null);

  useEffect(() => {
    document.title = `${APP_NAME} — Fetch. Play. No shelf.`;
  }, []);

  useEffect(() => {
    if (player) playerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [player]);

  async function playFile(url, filename, label, systemOverride = null, external = false) {
    setBusy(true);
    setDirectStatus({ message: "Checking the Archive file…", kind: "" });
    try {
      const parsed = external ? null : parseArchiveUrl(url);
      const playableUrl = await findPlayableUrl(url, parsed);
      const chosenSystem = systemOverride || (system === "auto" ? inferSystem(filename || url) : system);
      if (!chosenSystem) {
        throw new Error("This file type does not identify a console. Choose a System manually, then play it.");
      }
      const gameTitle = label?.trim() || title.trim() || displayFileName(filename || url).replace(/\.[^.]+$/, "") || "Archive game";
      setPlayer({
        key: `${playableUrl}-${Date.now()}`,
        url: playableUrl,
        filename: filename || displayFileName(url),
        title: gameTitle,
        system: chosenSystem,
      });
      setDirectStatus({ message: "Launching the player. On a phone, use Koin's fullscreen control for the best layout.", kind: "success" });
    } catch (error) {
      setDirectStatus({ message: errorMessage(error), kind: "error" });
    } finally {
      setBusy(false);
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
      setTitle((current) => current.trim() || metadata.metadata?.title || "");
      if (files.length === 1) {
        await playFile(buildDownloadUrl(parsed.identifier, files[0].name), files[0].name, metadata.metadata?.title || title, files[0].system);
      } else {
        setDirectStatus({ message: `${files.length} playable files found. Pick one below.`, kind: "success" });
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
      await playFile(buildDownloadUrl(parsed.identifier, selectedItemFile), selectedItemFile, title);
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
    await playFile(url, file.name, result.title, file.system || null);
  }

  function playDemo() {
    setSystem("NES");
    setTitle("NES Diamond-Chase (MIT demo)");
    setDirectStatus({ message: "Loading the MIT-licensed homebrew demo…", kind: "" });
    playFile(DEMO_URL, "game.nes", "NES Diamond-Chase (MIT demo)", "NES", true).catch(() => {});
  }

  function closePlayer() {
    setPlayer(null);
    setDirectStatus({ message: "Player closed.", kind: "" });
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
          <Status message={directStatus.message} kind={directStatus.kind} />
          <p className="legal-note">Use only software you have the right to access. The relay is a transport workaround, not a storage service.</p>
        </section>

        {player && (
          <section className="player-card card-glow" ref={playerRef} aria-labelledby="player-heading">
            <div className="player-heading">
              <div>
                <p className="eyebrow">03 / NOW PLAYING</p>
                <h2 id="player-heading">{player.title}</h2>
                <p className="player-meta"><span className="player-system">{player.system}</span> {displayFileName(player.filename)}</p>
              </div>
              <button className="button-secondary close-button" type="button" onClick={closePlayer}>Close</button>
            </div>
            <div className="player-mount">
              <PlayerBoundary onError={(error) => setDirectStatus({ message: `Koin could not start this game: ${errorMessage(error)}`, kind: "error" })}>
                <GamePlayer
                  key={player.key}
                  romId=""
                  romUrl={player.url}
                  romFileName={player.filename}
                  system={player.system}
                  title={player.title}
                  onReady={() => setDirectStatus({ message: "Ready. Tap fullscreen in Koin for the best phone layout.", kind: "success" })}
                  onError={(error) => setDirectStatus({ message: `Koin could not load this file: ${errorMessage(error)}`, kind: "error" })}
                  onExit={closePlayer}
                />
              </PlayerBoundary>
            </div>
            <p className="player-tip">Tip: Koin's virtual controls appear inside its player; fullscreen gives them more room on small screens.</p>
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
          <p className="privacy-line"><span className="shield-mark">◇</span> Fetchcade has no account, upload flow, or ROM library.</p>
        </section>

        <footer className="site-footer">
          <span>Fetchcade / prototype</span>
          <span>Fetch. Play. No shelf.</span>
        </footer>
      </main>
    </div>
  );
}
