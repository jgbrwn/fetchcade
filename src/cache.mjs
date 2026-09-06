export const KOIN_ROM_CACHE_NAME = "koin-rom-cache-v1";
export const KOIN_ROM_CACHE_PREFIX = "koin-rom-cache-";
export const RESUME_STATE_CACHE_NAME = "fetchcade-resume-state-v1";
export const RECENT_GAMES_KEY = "fetchcade.recent-games.v1";
export const MAX_RECENT_GAMES = 20;
export const CACHE_PREFERENCE_KEY = "fetchcade.cache-roms";

export function cacheStorageAvailable() {
  return typeof caches !== "undefined" && typeof caches.keys === "function";
}

export function getCachePreference() {
  try {
    return localStorage.getItem(CACHE_PREFERENCE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setCachePreference(enabled) {
  try {
    localStorage.setItem(CACHE_PREFERENCE_KEY, String(Boolean(enabled)));
  } catch {
    // The preference is optional; a private browsing context may reject it.
  }
}

export async function getRomCacheInfo() {
  if (!cacheStorageAvailable()) return { available: false, count: 0, names: [] };
  const names = (await caches.keys()).filter((name) => name.startsWith(KOIN_ROM_CACHE_PREFIX));
  let count = 0;
  for (const name of names) {
    const cache = await caches.open(name);
    count += (await cache.keys()).length;
  }
  return { available: true, count, names };
}

export async function clearRomCache() {
  if (!cacheStorageAvailable()) return 0;
  const names = (await caches.keys()).filter((name) => name.startsWith(KOIN_ROM_CACHE_PREFIX) || name === RESUME_STATE_CACHE_NAME);
  let removed = 0;
  for (const name of names) {
    if (await caches.delete(name)) removed += 1;
  }
  persistRecentGames([]);
  return removed;
}

function fallbackHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function makeRomCacheId({ url, filename, version = "" }) {
  const input = `fetchcade-rom-v1\n${url}\n${filename}\n${version}`;
  let digest;
  if (globalThis.crypto?.subtle) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    digest = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } else {
    digest = fallbackHash(input);
  }
  const origin = globalThis.location?.origin || "https://fetchcade.invalid";
  return `${origin}/__fetchcade-rom-cache__/v1/${digest}`;
}

export function getRecentGames() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_GAMES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((game) => game?.cacheId && game?.sourceUrl && game?.filename) : [];
  } catch {
    return [];
  }
}

export function persistRecentGames(games) {
  try {
    localStorage.setItem(RECENT_GAMES_KEY, JSON.stringify(games.slice(0, MAX_RECENT_GAMES)));
  } catch {
    // Recent history is optional and should never block playback.
  }
}

export function upsertRecentGame(game) {
  const previous = getRecentGames().filter((item) => item.cacheId !== game.cacheId);
  const next = [{ ...game, playedAt: Date.now() }, ...previous].slice(0, MAX_RECENT_GAMES);
  persistRecentGames(next);
  return next;
}

export function updateRecentGame(cacheId, updates) {
  const next = getRecentGames().map((game) => game.cacheId === cacheId ? { ...game, ...updates } : game);
  persistRecentGames(next);
  return next;
}

export function removeRecentGame(cacheId) {
  const next = getRecentGames().filter((game) => game.cacheId !== cacheId);
  persistRecentGames(next);
  return next;
}

function resumeStateKey(cacheId) {
  const key = new URL(cacheId);
  key.pathname = `${key.pathname.replace(/\/$/, "")}/resume-state`;
  key.search = "";
  return key.toString();
}

export async function saveResumeState(cacheId, blob) {
  if (!cacheStorageAvailable() || !cacheId || !blob) return false;
  const cache = await caches.open(RESUME_STATE_CACHE_NAME);
  await cache.put(resumeStateKey(cacheId), new Response(blob, { headers: { "Content-Type": "application/octet-stream" } }));
  return true;
}

export async function loadResumeState(cacheId) {
  if (!cacheStorageAvailable() || !cacheId) return null;
  const cache = await caches.open(RESUME_STATE_CACHE_NAME);
  const response = await cache.match(resumeStateKey(cacheId));
  return response ? response.blob() : null;
}

export async function clearResumeState(cacheId) {
  if (!cacheStorageAvailable() || !cacheId) return false;
  const cache = await caches.open(RESUME_STATE_CACHE_NAME);
  return cache.delete(resumeStateKey(cacheId));
}

export async function hasResumeState(cacheId) {
  if (!cacheStorageAvailable() || !cacheId) return false;
  const cache = await caches.open(RESUME_STATE_CACHE_NAME);
  return Boolean(await cache.match(resumeStateKey(cacheId)));
}

export async function isRomCached(cacheId) {
  if (!cacheStorageAvailable() || !cacheId) return false;
  const names = (await caches.keys()).filter((name) => name.startsWith(KOIN_ROM_CACHE_PREFIX));
  for (const name of names) {
    if (await (await caches.open(name)).match(cacheId)) return true;
  }
  return false;
}

export async function pruneRecentGames() {
  const recent = getRecentGames();
  const valid = [];
  for (const game of recent) {
    if (await isRomCached(game.cacheId)) {
      valid.push({ ...game, hasResume: await hasResumeState(game.cacheId) });
    }
  }
  persistRecentGames(valid);
  return valid;
}
