import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDownloadUrl,
  buildSearchUrl,
  inferSystem,
  isSupportedFileName,
  parseArchiveUrl,
  playableFiles,
  systemSupportsFile,
} from "../src/archive.mjs";

test("parses an Archive item URL", () => {
  assert.deepEqual(parseArchiveUrl("https://archive.org/details/my-item/"), {
    kind: "item",
    identifier: "my-item",
    url: "https://archive.org/details/my-item/",
  });
});

test("parses an Archive file URL without losing nested file names", () => {
  const parsed = parseArchiveUrl("https://archive.org/download/my-item/My%20Game%2Fgame.nes?download=1");
  assert.equal(parsed.kind, "file");
  assert.equal(parsed.identifier, "my-item");
  assert.equal(parsed.filename, "My Game/game.nes");
  assert.match(parsed.url, /download\/my-item\/My%20Game%2Fgame\.nes\?download=1$/);
});

test("rejects non-Archive origins and path traversal", () => {
  assert.throws(() => parseArchiveUrl("http://archive.org/details/game"), /https/);
  assert.throws(() => parseArchiveUrl("https://evilarchive.org/details/game"), /https/);
  assert.throws(() => parseArchiveUrl("https://archive.org/download/game/..%2Fsecret.nes"), /invalid/i);
});

test("builds a safely encoded Archive download URL", () => {
  assert.equal(
    buildDownloadUrl("my item", "folder/My Game.nes"),
    "https://archive.org/download/my%20item/folder/My%20Game.nes",
  );
});

test("infers the supported console from common file names", () => {
  assert.equal(inferSystem("Super Mario Bros.nes"), "NES");
  assert.equal(inferSystem("Chrono Trigger.sfc"), "SNES");
  assert.equal(inferSystem("Sonic the Hedgehog.gen"), "GENESIS");
  assert.equal(inferSystem("unknown.zip"), null);
});

test("infers the expanded console set and leaves ambiguous containers manual", () => {
  assert.equal(inferSystem("Super Mario 64.z64"), "N64");
  assert.equal(inferSystem("Pokemon.nds"), "NDS");
  assert.equal(inferSystem("Final Fantasy.pbp"), "PS1");
  assert.equal(inferSystem("arcade-set.zip"), "ARCADE");
  assert.equal(inferSystem("game.zip"), null);
  assert.equal(inferSystem("game.cue"), null);
});

test("recognizes supported files and rejects obvious system mismatches", () => {
  assert.equal(isSupportedFileName("game.nes"), true);
  assert.equal(isSupportedFileName("readme.txt"), false);
  assert.equal(systemSupportsFile("NES", "game.nes"), true);
  assert.equal(systemSupportsFile("PS1", "game.nes"), false);
  assert.equal(systemSupportsFile("PS1", "game.cue"), true);
});

test("filters private and non-ROM metadata files", () => {
  const files = playableFiles({ files: [
    { name: "game.nes", size: "128" },
    { name: "secret.gba", private: "true" },
    { name: "cover.jpg", size: "100" },
    { name: "folder/game.sfc", source: "original", size: "256" },
  ] });
  assert.deepEqual(files.map((file) => file.name), ["folder/game.sfc", "game.nes"]);
  assert.equal(files[0].hint, "Likely supported ROM format");
});

test("builds a constrained Archive search URL", () => {
  const url = new URL(buildSearchUrl("nes homebrew"));
  assert.equal(url.hostname, "archive.org");
  assert.match(url.searchParams.get("q"), /mediatype:data/);
  assert.equal(url.searchParams.get("output"), "json");
  assert.equal(url.searchParams.get("rows"), "20");
});
