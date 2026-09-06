export const APP_NAME = "Fetchcade";
export const DEMO_URL = "https://raw.githubusercontent.com/TeneoPython01/nes-game-01/main/game.nes";

export const SYSTEM_OPTIONS = [
  { value: "auto", label: "Auto from file name" },
  { value: "NES", label: "NES / Famicom" },
  { value: "SNES", label: "SNES / Super Famicom" },
  { value: "GENESIS", label: "Sega Genesis / Mega Drive" },
  { value: "MASTER_SYSTEM", label: "Master System" },
  { value: "GAME_GEAR", label: "Game Gear" },
  { value: "GB", label: "Game Boy" },
  { value: "GBC", label: "Game Boy Color" },
  { value: "GBA", label: "Game Boy Advance" },
];

const ARCHIVE_HOSTS = new Set(["archive.org", "www.archive.org"]);
const ROM_EXTENSIONS = /\.(nes|fds|sfc|smc|fig|swc|md|gen|smd|sms|gg|gb|gbc|gba|zip|7z|bin|rom)$/i;

function decodePathPart(part, label) {
  let decoded;
  try {
    decoded = decodeURIComponent(part);
  } catch {
    throw new Error(`The Archive ${label} contains an invalid escaped character.`);
  }
  if (!decoded || decoded === "." || decoded === ".." || decoded.includes("\0")) {
    throw new Error(`The Archive ${label} contains an invalid path segment.`);
  }
  return decoded;
}

function validateArchiveOrigin(url) {
  if (url.protocol !== "https:" || !ARCHIVE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Use an https://archive.org item or file URL.");
  }
  if (url.username || url.password || url.port) {
    throw new Error("Archive URLs cannot contain credentials or a custom port.");
  }
}

/** Parse the two Archive URL shapes Fetchcade intentionally supports. */
export function parseArchiveUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That is not a valid URL.");
  }
  validateArchiveOrigin(url);

  const pathParts = url.pathname.split("/");
  if (pathParts[0] === "") pathParts.shift();
  while (pathParts.at(-1) === "") pathParts.pop();
  const route = pathParts.shift();

  if (route === "details" || route === "metadata") {
    if (pathParts.length !== 1 || !pathParts[0]) {
      throw new Error("Use an Archive item URL like /details/item-id.");
    }
    const identifier = decodePathPart(pathParts[0], "identifier");
    if (identifier.includes("/")) throw new Error("The Archive identifier is invalid.");
    return { kind: "item", identifier, url: url.toString() };
  }

  if (route === "download") {
    if (pathParts.length < 2 || pathParts.some((part) => !part)) {
      throw new Error("Use an Archive file URL like /download/item-id/game.nes.");
    }
    const identifier = decodePathPart(pathParts.shift(), "identifier");
    const filenameParts = pathParts.map((part) => decodePathPart(part, "file name"));
    if (identifier.includes("/")) {
      throw new Error("The Archive file path is invalid.");
    }
    const filename = filenameParts.join("/");
    if (filename.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error("The Archive file path is invalid.");
    }
    return {
      kind: "file",
      identifier,
      filename,
      url: url.toString(),
    };
  }

  throw new Error("Use an archive.org/details/... item page or archive.org/download/... file URL.");
}

export function buildDownloadUrl(identifier, filename) {
  if (!identifier || identifier.includes("/")) throw new Error("Invalid Archive identifier.");
  const parts = String(filename).split("/");
  if (!parts.length || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid Archive file name.");
  }
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${parts
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

export function buildCorsUrl(identifier, filename) {
  const parts = String(filename).split("/");
  return `https://cors.archive.org/cors/${encodeURIComponent(identifier)}/${parts
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

export function buildMetadataUrl(identifier) {
  return `https://archive.org/metadata/${encodeURIComponent(identifier)}`;
}

function extensionOf(name) {
  return String(name || "").split("?")[0].toLowerCase();
}

export function inferSystem(name) {
  const value = extensionOf(name);
  if (value.endsWith(".nes") || value.endsWith(".fds") || /(^|[^a-z])nes([^a-z]|$)/i.test(value)) return "NES";
  if (/\.(sfc|smc|fig|swc)$/.test(value) || /super[-_ ]?nintendo|snes/i.test(value)) return "SNES";
  if (/\.(md|gen|smd)$/.test(value) || /genesis|mega[-_ ]?drive/i.test(value)) return "GENESIS";
  if (value.endsWith(".sms") || /master[-_ ]?system/i.test(value)) return "MASTER_SYSTEM";
  if (value.endsWith(".gg") || /game[-_ ]?gear/i.test(value)) return "GAME_GEAR";
  if (value.endsWith(".gbc") || /game[-_ ]?boy[-_ ]?color/i.test(value)) return "GBC";
  if (value.endsWith(".gba") || /game[-_ ]?boy[-_ ]?advance/i.test(value)) return "GBA";
  if (value.endsWith(".gb") || /game[-_ ]?boy/i.test(value)) return "GB";
  return null;
}

export function isLikelyPlayableFile(file) {
  return Boolean(
    file &&
      typeof file.name === "string" &&
      ROM_EXTENSIONS.test(file.name) &&
      file.private !== "true" &&
      file.private !== true &&
      file.source !== "metadata" &&
      file.name !== "" &&
      !file.name.endsWith("/")
  );
}

export function playableFiles(metadata) {
  return (metadata?.files || [])
    .filter(isLikelyPlayableFile)
    .map((file) => ({
      name: file.name,
      size: file.size ? Number(file.size) : null,
      source: file.source || "",
      system: inferSystem(file.name),
    }))
    .sort((a, b) => {
      const sourceOrder = (a.source === "original" ? 0 : 1) - (b.source === "original" ? 0 : 1);
      return sourceOrder || a.name.localeCompare(b.name);
    });
}

export function systemLabels(files) {
  const labels = new Map(SYSTEM_OPTIONS.slice(1).map((item) => [item.value, item.label.split(" /")[0]]));
  return [...new Set(files.map((file) => file.system).filter(Boolean))].map((system) => labels.get(system) || system);
}

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "size unknown";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let amount = bytes;
  let unit = -1;
  do {
    amount /= 1024;
    unit += 1;
  } while (amount >= 1024 && unit < units.length - 1);
  return `${amount.toFixed(amount >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function buildSearchUrl(query, page = 1, rows = 20) {
  const cleaned = String(query || "").trim().replace(/[\r\n]+/g, " ");
  if (!cleaned) throw new Error("Enter a game, system, or homebrew search.");
  const url = new URL("https://archive.org/advancedsearch.php");
  url.searchParams.set("q", `(${cleaned}) AND mediatype:data`);
  for (const field of ["identifier", "title", "description", "creator", "year"]) {
    url.searchParams.append("fl[]", field);
  }
  url.searchParams.set("rows", String(rows));
  url.searchParams.set("page", String(page));
  url.searchParams.set("output", "json");
  return url.toString();
}

export function itemUrl(identifier) {
  return `https://archive.org/details/${encodeURIComponent(identifier)}`;
}

export function displayFileName(filename) {
  const value = String(filename || "");
  return value.split("/").at(-1) || value;
}
