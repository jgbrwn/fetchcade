import React, { useEffect, useRef, useState } from "react";
import { GamePlayer } from "koin.js";
import { SYSTEMS as KOIN_SYSTEMS, SUPPORTED_EXTENSIONS as KOIN_SUPPORTED_EXTENSIONS } from "koin.js/systems";
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
  isSupportedFileName,
  itemUrl,
  parseArchiveUrl,
  playableFiles,
  systemLabels,
  systemSupportsFile,
} from "./archive.mjs";
import {
  CACHE_HEADROOM_BYTES,
  MAX_CACHEABLE_GAME_BYTES,
  cacheStorageAvailable,
  clearResumeState,
  clearRomCache,
  getCachePreference,
  getRecentGames,
  getRemoveConfirmationPreference,
  getRomCacheInfo,
  getStorageEstimate,
  hasResumeState,
  isCacheableGameSize,
  isRomCached,
  loadResumeState,
  makeRomCacheId,
  normalizeGameSize,
  pruneRecentGames,
  removeCachedGame,
  removeRecentGame,
  saveResumeState,
  setCachePreference,
  setRemoveConfirmationPreference,
  updateRecentGame,
  upsertRecentGame,
} from "./cache.mjs";

const SEARCH_ROWS = 20;
const INSPECT_LIMIT = 12;
const FILE_DISPLAY_LIMIT = 60;
const RELAY_ENABLED = import.meta.env.PROD;
const KOIN_PROJECT_URL = "https://github.com/muditjuneja/koin";
const NOSTALGIST_PROJECT_URL = "https://github.com/arianrhodsandlot/nostalgist";

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

function responseSize(response) {
  const range = response.headers.get("Content-Range");
  const rangeMatch = range?.match(/\/(\d+)$/);
  if (rangeMatch) return normalizeGameSize(rangeMatch[1]);
  if (response.status === 206) return null;
  return normalizeGameSize(response.headers.get("Content-Length"));
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
  return { url, size: responseSize(response) };
}

function archiveFetchFailure(lastError, deployed) {
  const message = errorMessage(lastError || "unknown error");
  if (/HTTP 404/.test(message)) return "Archive could not find that file (HTTP 404). Check the item and filename.";
  if (/HTTP 401|HTTP 403/.test(message)) return "Archive denied access to that file. The item may be private, restricted, or unavailable.";
  if (/timed out/i.test(message)) return "Archive took too long to answer. Try again or choose another file.";
  return deployed
    ? `The browser could not fetch this Archive file through its direct URL or relay (${message}).`
    : "The browser could not fetch this Archive file. Try again from the deployed app so its CORS relay can help.";
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

  throw new Error(archiveFetchFailure(lastError, RELAY_ENABLED));
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

function formatPlayedAt(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "Recently";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function RecentGameCard({ game, onPlay, onRemove, disabled }) {
  return (
    <article className="recent-game">
      <div className="recent-game-copy">
        <p className="eyebrow">{game.system} · {formatPlayedAt(game.playedAt)}</p>
        <h3>{game.title}</h3>
        <p className="recent-file">{displayFileName(game.filename)}{game.size ? ` · ${formatBytes(game.size)}` : ""}</p>
      </div>
      <div className="recent-actions">
        {game.hasResume && (
          <button type="button" onClick={() => onPlay(game, true)} disabled={disabled}>
            Resume
          </button>
        )}
        <button type="button" className={game.hasResume ? "button-secondary" : ""} onClick={() => onPlay(game, false)} disabled={disabled}>
          {game.hasResume ? "Play fresh" : "Play"}
        </button>
        <button type="button" className="remove-button" onClick={() => onRemove(game)} disabled={disabled} title={`Remove ${game.title} from this browser's recent games and cache`}>
          Remove
        </button>
      </div>
    </article>
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

function AboutModal({ open, onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;
  const extensions = [...new Set(KOIN_SUPPORTED_EXTENSIONS)].sort();

  return (
    <div className="about-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="about-modal" role="dialog" aria-modal="true" aria-labelledby="about-heading" aria-describedby="about-description" onMouseDown={(event) => event.stopPropagation()}>
        <div className="about-modal-header">
          <div>
            <p className="eyebrow">HELP / ABOUT</p>
            <h2 id="about-heading">How Fetchcade works</h2>
          </div>
          <button ref={closeRef} type="button" className="button-secondary about-close" onClick={onClose} aria-label="Close About dialog">×</button>
        </div>
        <p className="about-intro" id="about-description">
          Fetchcade finds a likely playable Internet Archive file and hands it to Koin.js for a browser emulator session. Koin supplies the controls and player UI; Nostalgist.js powers the browser emulation layer.
        </p>

        <div className="about-help-grid">
          <section className="about-panel">
            <h3>Start playing</h3>
            <ol>
              <li>Search the Archive or paste an Archive item/file URL.</li>
              <li>Choose a file and system when the format is ambiguous.</li>
              <li>Press Koin's Play button, then open its controls/fullscreen affordance on mobile.</li>
              <li>Use Stop session or Koin's Exit game control to return to Fetchcade.</li>
            </ol>
          </section>
          <section className="about-panel">
            <h3>Cache &amp; resume</h3>
            <p>Local caching is off until you opt in. New cached games must be no larger than {formatBytes(MAX_CACHEABLE_GAME_BYTES)}; larger games still play but are not stored locally.</p>
            <p>Cached games can appear in Recent games and receive browser-local resume saves. Clear local cache removes those copies and resume states from this browser.</p>
          </section>
        </div>

        <section className="about-panel about-format-panel">
          <div className="about-section-heading">
            <div>
              <h3>Koin.js systems and file formats</h3>
              <p className="field-note">Generated from the installed Koin system configuration used by this build.</p>
            </div>
            <span className="about-count">{KOIN_SYSTEMS.length} systems</span>
          </div>
          <div className="about-systems">
            {KOIN_SYSTEMS.map((item) => (
              <article className="about-system" key={item.key}>
                <div className="about-system-title">
                  <strong>{item.label}</strong>
                  <code>{item.key}</code>
                </div>
                <p>{item.extensions.join(", ")}</p>
                {item.biosNeeded && <span className="about-badge">BIOS may be needed</span>}
              </article>
            ))}
          </div>
          <p className="about-extension-list"><strong>Declared extensions:</strong> {extensions.join(", ")}</p>
          <p className="field-note about-caveat">A recognized extension does not guarantee that every file will boot. ZIP and 7z files are containers, disc formats may need companion tracks, and some systems require BIOS files. Fetchcade also accepts a few ambiguous raw/disc formats for manual selection. Dreamcast and PSP are not included in this Koin configuration because compatible web cores are unavailable.</p>
        </section>

        <div className="about-footer">
          <span>Use only software you are legally authorized to access.</span>
          <span className="about-links">
            <a href={KOIN_PROJECT_URL} target="_blank" rel="noreferrer">Koin.js ↗</a>
            <a href={NOSTALGIST_PROJECT_URL} target="_blank" rel="noreferrer">Nostalgist.js ↗</a>
          </span>
        </div>
      </section>
    </div>
  );
}

function RemoveGameModal({ game, skipConfirmation, onSkipChange, onCancel, onConfirm }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!game) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [game, onCancel]);

  if (!game) return null;
  return (
    <div className="about-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="remove-game-heading" onMouseDown={(event) => event.stopPropagation()}>
        <p className="eyebrow">REMOVE LOCAL GAME</p>
        <h2 id="remove-game-heading">Remove “{game.title}”?</h2>
        <p>This removes the cached game copy, browser-local resume state, and its Recent games entry from this device. It does not delete anything from Internet Archive or Fetchcade.</p>
        <label className="confirm-toggle">
          <input type="checkbox" checked={skipConfirmation} onChange={(event) => onSkipChange(event.target.checked)} />
          <span>Don’t ask again on this device</span>
        </label>
        <div className="confirm-actions">
          <button ref={closeRef} type="button" className="button-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="remove-confirm-button" onClick={onConfirm}>Remove game</button>
        </div>
      </section>
    </div>
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
  const [recentGames, setRecentGames] = useState(() => getRecentGames());
  const [cacheGames, setCacheGames] = useState(() => getCachePreference() && cacheStorageAvailable());
  const [cacheInfo, setCacheInfo] = useState({ available: cacheStorageAvailable(), count: 0, names: [] });
  const [cacheMessage, setCacheMessage] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [removeGameTarget, setRemoveGameTarget] = useState(null);
  const [skipRemoveConfirmation, setSkipRemoveConfirmation] = useState(false);
  const searchToken = useRef(0);
  const sessionToken = useRef(0);
  const playerRef = useRef(null);

  useEffect(() => {
    document.title = `${APP_NAME} -- Fetch. Play. No server`;
    Promise.all([loadCacheInfo(), pruneRecentGames()]).then(([info, recent]) => {
      setCacheInfo(info);
      setRecentGames(recent);
    });
  }, []);

  useEffect(() => {
    if (player) playerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [player]);

  async function refreshCacheInfo() {
    const [info, recent] = await Promise.all([loadCacheInfo(), pruneRecentGames()]);
    setCacheInfo(info);
    setRecentGames(recent);
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

  async function removeGameNow(game) {
    if (!game || busy || player) return;
    setRemoveGameTarget(null);
    setBusy(true);
    setCacheMessage(`Removing ${game.title} from this browser…`);
    try {
      await removeCachedGame(game.cacheId);
      await refreshCacheInfo();
      setCacheMessage(`Removed ${game.title} from Recent games and the local cache.`);
    } catch (error) {
      setCacheMessage(`Could not remove ${game.title}: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function requestRemoveGame(game) {
    if (busy || player) return;
    if (getRemoveConfirmationPreference()) {
      void removeGameNow(game);
      return;
    }
    setSkipRemoveConfirmation(false);
    setRemoveGameTarget(game);
  }

  function confirmRemoveGame() {
    if (!removeGameTarget) return;
    if (skipRemoveConfirmation) setRemoveConfirmationPreference(true);
    void removeGameNow(removeGameTarget);
  }

  function cancelRemoveGame() {
    setRemoveGameTarget(null);
  }

  async function playFile(url, filename, label, systemOverride = null, external = false, cacheVersion = "", initialSaveState = null, cacheIdOverride = "", knownSize = null) {
    const token = ++sessionToken.current;
    setBusy(true);
    setDirectStatus({ message: external ? "Checking the demo…" : "Checking the Archive file…", kind: "" });
    try {
      const parsed = external ? null : parseArchiveUrl(url);
      const fileName = filename || displayFileName(url);
      if (!external && !isSupportedFileName(fileName)) {
        throw new Error(`This Archive file (${displayFileName(fileName)}) is not a recognized Koin game format.`);
      }
      const chosenSystem = systemOverride || (system === "auto" ? inferSystem(fileName) : system);
      if (!chosenSystem || chosenSystem === "auto") {
        throw new Error(`Fetchcade could not identify a console for ${displayFileName(fileName)}. Choose a supported System manually.`);
      }
      if (!external && !systemSupportsFile(chosenSystem, fileName)) {
        throw new Error(`${displayFileName(fileName)} is a ${inferSystem(fileName) || "different"} format, not a ${chosenSystem} game. Choose the matching System.`);
      }
      const cachedReplay = Boolean(cacheIdOverride && await isRomCached(cacheIdOverride));
      const playable = cachedReplay ? { url, size: normalizeGameSize(knownSize) } : await findPlayableUrl(url, parsed);
      const playableSize = normalizeGameSize(knownSize) || playable.size;
      let romId = cachedReplay ? cacheIdOverride : "";
      if (!romId && !external && cacheGames && cacheStorageAvailable()) {
        const size = playableSize;
        let skipReason = null;
        if (!isCacheableGameSize(size)) {
          skipReason = size
            ? `This game is ${formatBytes(size)}; the optional local cache is limited to ${formatBytes(MAX_CACHEABLE_GAME_BYTES)} per game.`
            : "The file size could not be verified, so this session will play without local caching.";
        } else {
          const estimate = await getStorageEstimate();
          const remaining = estimate ? estimate.quota - estimate.usage : null;
          if (remaining !== null && remaining < size + CACHE_HEADROOM_BYTES) {
            skipReason = "The browser does not have enough estimated storage headroom for a local copy, so this session will play without caching.";
          }
        }
        if (skipReason) {
          setCacheMessage(`${skipReason} You can still play it normally.`);
        } else {
          try {
            romId = await makeRomCacheId({ url, filename: fileName, version: cacheVersion });
          } catch {
            setCacheMessage("The local cache key could not be created; this session will still play without caching.");
          }
        }
      }
      if (token !== sessionToken.current) return;
      const gameTitle = label?.trim() || title.trim() || displayFileName(filename || url).replace(/\.[^.]+$/, "") || "Archive game";
      setGameStarted(false);
      setPlayer({
        key: `${playable.url}-${Date.now()}`,
        url: playable.url,
        sourceUrl: url,
        filename: fileName,
        title: gameTitle,
        system: chosenSystem,
        cacheId: romId,
        cacheVersion,
        size: playableSize,
        initialSaveState,
      });
      setDirectStatus({ message: cachedReplay ? "Starting from the local game copy…" : "Launching the player. Use Koin's controls/fullscreen affordance for the best phone layout.", kind: "success" });
    } catch (error) {
      if (token === sessionToken.current) setDirectStatus({ message: errorMessage(error), kind: "error" });
    } finally {
      if (token === sessionToken.current) setBusy(false);
    }
  }

  async function recordRecentGame(currentPlayer) {
    if (!currentPlayer?.cacheId || !await isRomCached(currentPlayer.cacheId)) return;
    const next = upsertRecentGame({
      cacheId: currentPlayer.cacheId,
      sourceUrl: currentPlayer.sourceUrl,
      filename: currentPlayer.filename,
      title: currentPlayer.title,
      system: currentPlayer.system,
      cacheVersion: currentPlayer.cacheVersion || "",
      size: currentPlayer.size || null,
      hasResume: await hasResumeState(currentPlayer.cacheId),
    });
    setRecentGames(next);
  }

  async function persistPlayerState(blob) {
    if (!player?.cacheId) return;
    try {
      if (await saveResumeState(player.cacheId, blob)) {
        setRecentGames(updateRecentGame(player.cacheId, { hasResume: true, resumeUpdatedAt: Date.now() }));
      }
    } catch (error) {
      setCacheMessage(`Could not save the local resume state: ${errorMessage(error)}`);
    }
  }

  async function playRecentGame(game, resume) {
    setSource(game.sourceUrl);
    setTitle(game.title);
    setSystem(game.system);
    let initialSaveState = null;
    if (resume) {
      setDirectStatus({ message: "Loading the latest local resume state…", kind: "" });
      try {
        initialSaveState = await loadResumeState(game.cacheId);
      } catch (error) {
        setDirectStatus({ message: `Resume state could not be read; starting fresh (${errorMessage(error)}).`, kind: "" });
      }
      if (!initialSaveState) {
        setDirectStatus({ message: "No resume state was found; starting the cached game fresh.", kind: "" });
      }
    }
    await playFile(
      game.sourceUrl,
      game.filename,
      game.title,
      game.system,
      false,
      game.cacheVersion || "",
      initialSaveState,
      game.cacheId,
      game.size,
    );
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
        await playFile(buildDownloadUrl(parsed.identifier, files[0].name), files[0].name, itemTitle, files[0].system, false, files[0].cacheVersion, null, "", files[0].size);
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
        null,
        "",
        file?.size,
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
    await playFile(url, file.name, result.title, file.system || null, false, file.cacheVersion, null, "", file.size);
  }

  function playDemo() {
    setSystem("NES");
    setTitle("NES Diamond-Chase (MIT demo)");
    setDirectStatus({ message: "Loading the MIT-licensed homebrew demo…", kind: "" });
    playFile(DEMO_URL, "game.nes", "NES Diamond-Chase (MIT demo)", "NES", true).catch(() => {});
  }

  function unmountPlayerAndReturnHome() {
    sessionToken.current += 1;
    const fullscreenElement = document.fullscreenElement
      || document.webkitFullscreenElement
      || document.mozFullScreenElement
      || document.msFullscreenElement;
    const exitFullscreen = document.exitFullscreen
      || document.webkitExitFullscreen
      || document.mozCancelFullScreen
      || document.msExitFullscreen;
    let finished = false;
    let fallbackTimer;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      setPlayer(null);
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
    };

    if (!fullscreenElement || !exitFullscreen) {
      finish();
      return;
    }

    // Let Android Chrome leave fullscreen before React removes the fullscreen element.
    // The timeout prevents a browser-specific fullscreen promise from trapping the page.
    fallbackTimer = window.setTimeout(finish, 350);
    try {
      Promise.resolve(exitFullscreen.call(document)).then(finish, finish);
    } catch {
      finish();
    }
  }

  async function handlePlayerError(error) {
    const failedPlayer = player;
    unmountPlayerAndReturnHome();
    if (failedPlayer?.cacheId) {
      try {
        await clearResumeState(failedPlayer.cacheId);
      } catch {
        // Resume cleanup is best-effort; the explicit cache clear control remains available.
      }
      setRecentGames(removeRecentGame(failedPlayer.cacheId));
    }
    await refreshCacheInfo();
    setDirectStatus({
      message: `Could not play ${failedPlayer?.title ? `“${failedPlayer.title}”` : "that file"}: ${errorMessage(error)}. The player was closed and you are back at the menu.`,
      kind: "error",
    });
  }

  function closePlayer() {
    unmountPlayerAndReturnHome();
    setDirectStatus({ message: gameStarted
      ? "Session stopped. Koin is unmounted so its emulator resources can be released."
      : "Loading canceled. Koin is unmounted and nothing was cached.",
      kind: "" });
    setGameStarted(false);
    refreshCacheInfo();
  }

  return (
    <div className="app-shell">
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <RemoveGameModal
        game={removeGameTarget}
        skipConfirmation={skipRemoveConfirmation}
        onSkipChange={setSkipRemoveConfirmation}
        onCancel={cancelRemoveGame}
        onConfirm={confirmRemoveGame}
      />
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <main className="content">
        <header className="site-header">
          <a className="brand" href="/" aria-label="Fetchcade home">
            Fetch<span>cade</span>
          </a>
          <div className="header-actions">
            <div className="header-note">
              <span className="live-dot" />
              <span>Live Archive search</span>
            </div>
            <button type="button" className="about-button" onClick={() => setAboutOpen(true)} aria-haspopup="dialog" aria-expanded={aboutOpen}>? / About</button>
          </div>
        </header>

        <section className="hero">
          <div className="hero-kicker">A temporary arcade for the open web</div>
          <h1>Fetch a game.<br /><em>Play it now.</em></h1>
          <p className="hero-copy">
            Search Internet Archive or bring a known link. Fetchcade sends the game to your browser—no server-side ROM library; optional replay caching stays under your control. <a href={KOIN_PROJECT_URL} target="_blank" rel="noreferrer">Koin.js</a> provides the player and touch controls, while <a href={NOSTALGIST_PROJECT_URL} target="_blank" rel="noreferrer">Nostalgist.js</a> powers the browser emulation layer.
          </p>
          <div className="hero-chips" aria-label="Product features">
            <span>Archive powered</span><span>Touch ready</span><span>No server library</span>
          </div>
        </section>

        <section className="recent-card card" aria-labelledby="recent-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ON THIS DEVICE</p>
              <h2 id="recent-heading">Recent games</h2>
            </div>
            <span className="step-mark">↻</span>
          </div>
          {recentGames.length ? (
            <>
              <p className="helper-text">Cached games stay in this browser only. Resume loads the latest local save state when one exists; Play fresh starts from the beginning.</p>
              <div className="recent-list">
                {recentGames.map((game) => (
                  <RecentGameCard key={game.cacheId} game={game} onPlay={playRecentGame} onRemove={requestRemoveGame} disabled={busy || Boolean(player)} />
                ))}
              </div>
            </>
          ) : (
            <p className="helper-text recent-empty">No cached games yet. Turn on the optional local replay cache below, then play a game to see up to 20 recent entries here.</p>
          )}
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
              <p className="field-note">Keep a browser-local copy of games you play so the next replay can skip the Archive download. Nothing is uploaded to Fetchcade. New local copies are limited to {formatBytes(MAX_CACHEABLE_GAME_BYTES)} per game; larger games still play without caching.</p>
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
              <button className="button-secondary close-button" type="button" onClick={closePlayer}>{gameStarted ? "Stop session" : "Cancel loading"}</button>
            </div>
            <div className="player-mount">
              <PlayerErrorBoundary onError={handlePlayerError}>
                <GamePlayer
                  key={player.key}
                  romId={player.cacheId || ""}
                  romUrl={player.url}
                  romFileName={player.filename}
                  initialSaveState={player.initialSaveState || undefined}
                  onSaveState={player.cacheId ? (_slot, blob) => persistPlayerState(blob) : undefined}
                  onLoadState={player.cacheId ? () => loadResumeState(player.cacheId) : undefined}
                  onAutoSave={player.cacheId ? (blob) => persistPlayerState(blob) : undefined}
                  autoSaveInterval={player.cacheId ? 30_000 : undefined}
                  system={player.system}
                  title={player.title}
                  onReady={() => {
                    setGameStarted(true);
                    setDirectStatus({ message: "Ready. On a phone, open Koin's controls/fullscreen affordance and rotate landscape if helpful.", kind: "success" });
                    recordRecentGame(player);
                  }}
                  onError={handlePlayerError}
                  onExit={closePlayer}
                />
              </PlayerErrorBoundary>
            </div>
            <p className="player-tip">Koin supplies the virtual controls, keyboard/gamepad input, rewind, and player UI. Touch controls are most comfortable after opening its controls/fullscreen affordance; browser/device fullscreen behavior varies.</p>
            <p className="player-tip settings-persistence"><strong>Settings persist in this browser:</strong> Koin stores volume, mute, shader, haptics, keyboard mappings by system, and gamepad mappings locally for this origin. They do not sync across devices. Cached games auto-save a local resume state about every 30 seconds; use Koin's Save control before Stop session when you want an immediate checkpoint.</p>
          </section>
        )}

        <section className="how-card card" aria-labelledby="how-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE IDEA</p>
              <h2 id="how-heading">No server. Your browser, your choice.</h2>
            </div>
          </div>
          <div className="how-grid">
            <div><span>01</span><strong>Find</strong><p>Search live Archive metadata or paste a link.</p></div>
            <div><span>02</span><strong>Fetch</strong><p>The browser requests the file only when you play.</p></div>
            <div><span>03</span><strong>Play</strong><p>Koin handles the controls and emulator session.</p></div>
          </div>
          <p className="privacy-line"><span className="shield-mark">◇</span> Fetchcade has no account, upload flow, or server-side ROM library; local caching is opt-in.</p>
        </section>

        <footer className="site-footer">
          <div className="footer-left">
            <span>Fetch. Play. No server.</span>
            <span>Use only software you are legally authorized to access.</span>
          </div>
          <div className="footer-right">
            <span>Gameplay powered by</span>
            <a href={KOIN_PROJECT_URL} target="_blank" rel="noreferrer">Koin.js ↗</a>
            <span>and</span>
            <a href={NOSTALGIST_PROJECT_URL} target="_blank" rel="noreferrer">Nostalgist.js ↗</a>
            <a href="https://github.com/jgbrwn/fetchcade" target="_blank" rel="noreferrer">GitHub project ↗</a>
            <span>Fetchcade does not verify rights or encourage illegal ROM use.</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
