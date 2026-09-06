# Koin.js / Nostalgist.js compatibility plan

**Status:** deferred compatibility work. Production should remain on the currently tested dependency combination until a candidate passes the full emulator and mobile lifecycle checks.

## Current snapshot

This snapshot was reviewed on **September 6, 2026**:

- Fetchcade uses `koin.js` `1.3.5`; the lockfile resolves its bundled Nostalgist dependency to `0.21.1`.
- Koin declares Nostalgist as `^0.21.0`, which does not include `0.22.x`.
- Koin's published `dist` bundles Nostalgist. Adding a newer Nostalgist directly to Fetchcade would not replace the copy inside Koin.
- Nostalgist `0.22.0` adds basic multidisc support. Fetchcade currently uses one ROM URL at a time, so that feature is not an immediate requirement.
- Koin carries a version-specific `nostalgist+0.21.0.patch` for keyboard mapping and gamepad initialization. That patch does not apply unchanged to Nostalgist `0.22.0`.

Upstream references and license details are maintained in [`NOTICE`](../NOTICE).

## Item 1: build Koin against newer Nostalgist

### Recommended approach

Do not solve this with a root-level npm override or by hand-editing Koin's minified bundle. Instead:

1. Build Koin from its source repository in a temporary compatibility workspace.
2. Pin both a Koin commit/ref and an exact Nostalgist version.
3. Update Koin's Nostalgist dependency to the candidate version.
4. Regenerate/rebase Koin's `patch-package` patch for that exact Nostalgist version.
5. Build Koin's distribution and install the resulting local package into Fetchcade.
6. Run Fetchcade's tests and browser/emulator smoke tests against the candidate.
7. Promote only through a reviewed pull request.

A local experiment successfully built the current Koin source against Nostalgist `0.22.0`. The existing `nostalgist+0.21.0.patch` failed to apply, which confirms that the main work is a controlled patch rebase—not an obvious API incompatibility.

### Compatibility concerns to check

- Preserve Koin's keyboard-mapping cache and custom gamepad behavior from its existing patch.
- Confirm `prepare`, `start`, `pause`, `resume`, `exit`, `resize`, `saveState`, `saveStateWithBlob`, `loadState`, and `screenshot` behavior.
- Test single-file ROMs, cached ROMs, save/load, auto-save/resume, touch controls, keyboard/gamepad input, fullscreen, exit cleanup, and startup failures.
- Treat Nostalgist's new multidisc API as additive but out of Fetchcade scope until Fetchcade has a real multi-file flow.
- Keep the Koin patch and Fetchcade's own install-time Koin patch version-aware and fail closed when upstream bundle shape changes.

## Item 2: GitHub Actions automation

### Baseline CI

Add a normal CI workflow for pull requests and `main` pushes that runs:

- `npm ci` and the install-time Koin patch;
- `npm test`;
- production build;
- representative browser smoke tests;
- mobile/fullscreen/exit cleanup checks.

### Nostalgist compatibility workflow

Add a separate workflow with these triggers:

- weekly `schedule` check;
- manual `workflow_dispatch` with an explicit candidate version;
- optional `repository_dispatch` event if the Nostalgist project ever cooperates with an upstream notification.

The workflow should:

1. Query the latest Nostalgist release/package version.
2. Compare it with a small pinned compatibility manifest.
3. Build Koin from a pinned source ref against the candidate Nostalgist version.
4. Generate/apply the version-specific Koin patch.
5. Build and test Fetchcade using the locally built Koin artifact.
6. Upload logs and the candidate artifact.
7. Open a pull request with the version, lockfile, patch, and compatibility-test changes when successful.

The production deployment should not consume an unreviewed `latest` build. A human-reviewed PR should be the promotion gate.

### Why not only use a release trigger or Dependabot?

A GitHub `release` trigger in Fetchcade will not automatically observe releases in the separate Nostalgist repository. A scheduled watcher is the reliable default; `repository_dispatch` is an optional faster path that requires upstream cooperation.

Dependabot may help track a deliberately declared compatibility version, but it cannot by itself rebuild Koin's bundled distribution or regenerate Koin's version-specific Nostalgist patch.

## Suggested compatibility manifest

When this work resumes, add a tracked file such as `compatibility/koin-nostalgist.json`:

```json
{
  "koinRef": "<reviewed Koin commit or tag>",
  "nostalgistVersion": "0.22.0",
  "status": "candidate"
}
```

The manifest should record the tested pair, not a floating `latest` range.

## Promotion criteria

Do not promote a candidate until it passes:

- Koin source build and patch application;
- Fetchcade unit tests and production build;
- MIT demo playback;
- at least one representative game per core family;
- opt-in cache and resume flow;
- save/load and auto-save;
- keyboard, gamepad, and touch controls;
- Android Chrome fullscreen entry/exit;
- Koin Exit Game cleanup with no stale canvas/frame or frozen menu;
- invalid URL, unsupported file, failed fetch, and failed emulator startup paths.
