export const APP_NAME = "Fetchcade";
export const DEMO_URL = "https://raw.githubusercontent.com/TeneoPython01/nes-game-01/main/game.nes";

export const SYSTEM_OPTIONS = [
  { value: "auto", label: "Auto when unambiguous" },
  { value: "NES", label: "NES / Famicom" },
  { value: "SNES", label: "SNES / Super Famicom" },
  { value: "N64", label: "Nintendo 64" },
  { value: "GB", label: "Game Boy" },
  { value: "GBC", label: "Game Boy Color" },
  { value: "GBA", label: "Game Boy Advance" },
  { value: "NDS", label: "Nintendo DS" },
  { value: "VIRTUAL_BOY", label: "Virtual Boy" },
  { value: "SATURN", label: "Sega Saturn" },
  { value: "GENESIS", label: "Sega Genesis / Mega Drive" },
  { value: "MASTER_SYSTEM", label: "Sega Master System" },
  { value: "GAME_GEAR", label: "Sega Game Gear" },
  { value: "PS1", label: "PlayStation" },
  { value: "PC_ENGINE", label: "PC Engine / TurboGrafx-16" },
  { value: "NEOGEO", label: "Neo Geo" },
  { value: "NEOGEO_POCKET", label: "Neo Geo Pocket" },
  { value: "NEOGEO_POCKET_COLOR", label: "Neo Geo Pocket Color" },
  { value: "LYNX", label: "Atari Lynx" },
  { value: "ATARI_5200", label: "Atari 5200" },
  { value: "ATARI_2600", label: "Atari 2600" },
  { value: "ATARI_7800", label: "Atari 7800" },
  { value: "WONDERSWAN", label: "WonderSwan" },
  { value: "WONDERSWAN_COLOR", label: "WonderSwan Color" },
  { value: "ARCADE", label: "Arcade / FBNeo" },
  { value: "C64", label: "Commodore 64" },
];

const ARCHIVE_HOSTS = new Set(["archive.org", "www.archive.org"]);
const ROM_EXTENSIONS = /\.(nes|fds|snes|smc|sfc|fig|swc|n64|z64|v64|gb|gbc|gba|nds|vb|cue|chd|iso|7z|gen|md|smd|sms|gg|pbp|pce|neo|ngp|ngc|lnx|lyx|a52|a26|a78|ws|wsc|zip|d64|t64|tap|prg|crt|bin|rom)$/i;

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
    if (identifier.includes("/")) throw new Error("The Archive file path is invalid.");
    const filename = filenameParts.join("/");
    if (filename.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error("The Archive file path is invalid.");
    }
    return { kind: "file", identifier, filename, url: url.toString() };
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

function normalizedName(name) {
  return String(name || "").split(/[?#]/)[0].toLowerCase();
}

export function inferSystem(name) {
  const value = normalizedName(name);
  if (value.endsWith(".nes") || value.endsWith(".fds")) return "NES";
  if (value.endsWith(".snes") || value.endsWith(".smc") || value.endsWith(".sfc") || value.endsWith(".fig") || value.endsWith(".swc")) return "SNES";
  if (value.endsWith(".n64") || value.endsWith(".z64") || value.endsWith(".v64")) return "N64";
  if (value.endsWith(".gbc")) return "GBC";
  if (value.endsWith(".gba")) return "GBA";
  if (value.endsWith(".gb")) return "GB";
  if (value.endsWith(".nds")) return "NDS";
  if (value.endsWith(".vb")) return "VIRTUAL_BOY";
  if (value.endsWith(".gen") || value.endsWith(".md") || value.endsWith(".smd")) return "GENESIS";
  if (value.endsWith(".sms")) return "MASTER_SYSTEM";
  if (value.endsWith(".gg")) return "GAME_GEAR";
  if (value.endsWith(".pbp")) return "PS1";
  if (value.endsWith(".pce")) return "PC_ENGINE";
  if (value.endsWith(".neo")) return "NEOGEO";
  if (value.endsWith(".ngp")) return "NEOGEO_POCKET";
  if (value.endsWith(".ngc")) return "NEOGEO_POCKET_COLOR";
  if (value.endsWith(".lnx") || value.endsWith(".lyx")) return "LYNX";
  if (value.endsWith(".a52")) return "ATARI_5200";
  if (value.endsWith(".a26")) return "ATARI_2600";
  if (value.endsWith(".a78")) return "ATARI_7800";
  if (value.endsWith(".ws")) return "WONDERSWAN";
  if (value.endsWith(".wsc")) return "WONDERSWAN_COLOR";
  if (value.endsWith(".d64") || value.endsWith(".t64") || value.endsWith(".tap") || value.endsWith(".prg") || value.endsWith(".crt")) return "C64";

  // Containers, raw .bin files, and disc images are intentionally ambiguous.
  const stem = value.replace(/\.[a-z0-9]+$/, "");
  if (/arcade|fbneo|mame/.test(stem)) return "ARCADE";
  if (/game[-_ ]?boy[-_ ]?color/.test(stem)) return "GBC";
  if (/game[-_ ]?boy[-_ ]?advance/.test(stem)) return "GBA";
  if (/game[-_ ]?boy/.test(stem)) return "GB";
  if (/super[-_ ]?nintendo|snes/.test(stem)) return "SNES";
  if (/nintendo[-_ ]?64|\bn64\b/.test(stem)) return "N64";
  if (/genesis|mega[-_ ]?drive/.test(stem)) return "GENESIS";
  if (/master[-_ ]?system/.test(stem)) return "MASTER_SYSTEM";
  if (/game[-_ ]?gear/.test(stem)) return "GAME_GEAR";
  if (/playstation|ps1|psx/.test(stem)) return "PS1";
  if (/nintendo[-_ ]?entertainment|famicom|\bnes\b/.test(stem)) return "NES";
  return null;
}

export function formatHint(name) {
  const value = normalizedName(name);
  if (value.endsWith(".zip")) return "ZIP container · choose system";
  if (value.endsWith(".7z")) return "7z container · choose system";
  if (value.endsWith(".cue")) return "CUE sheet · companion tracks may be needed";
  if (value.endsWith(".iso") || value.endsWith(".chd") || value.endsWith(".pbp")) return "Disc image · BIOS may be needed";
  if (value.endsWith(".bin") || value.endsWith(".rom")) return "Raw image · choose system if needed";
  return "Likely supported ROM format";
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
      hint: formatHint(file.name),
      cacheVersion: file.md5 || file.sha1 || [file.mtime, file.size].filter(Boolean).join(":"),
    }))
    .sort((a, b) => {
      const sourceOrder = (a.source === "original" ? 0 : 1) - (b.source === "original" ? 0 : 1);
      return sourceOrder || a.name.localeCompare(b.name);
    });
}

export function systemLabels(files) {
  const labels = new Map(SYSTEM_OPTIONS.slice(1).map((item) => [item.value, item.label]));
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
