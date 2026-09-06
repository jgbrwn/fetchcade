export const KOIN_ROM_CACHE_NAME = "koin-rom-cache-v1";
export const KOIN_ROM_CACHE_PREFIX = "koin-rom-cache-";
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
  const names = (await caches.keys()).filter((name) => name.startsWith(KOIN_ROM_CACHE_PREFIX));
  let removed = 0;
  for (const name of names) {
    if (await caches.delete(name)) removed += 1;
  }
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
