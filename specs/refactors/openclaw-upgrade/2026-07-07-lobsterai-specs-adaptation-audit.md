# LobsterAI OpenClaw Specs Adaptation Audit

## 1. Overview

This document records the PopiStudio-side review of OpenClaw-related design documents under:

```text
/Users/a111/project/LobsterAI/specs
```

The goal is not to copy LobsterAI specs wholesale. PopiStudio has product-specific OpenClaw integration points, including PopiArt, knowledge source prompts, Popiai server providers, and OpenAI Codex routing. The useful output of this audit is a scoped list of LobsterAI design decisions that should be applied, deferred, or rejected for the current PopiStudio codebase.

## 2. Current PopiStudio Baseline

As of this audit:

| Area | PopiStudio state |
|------|------------------|
| OpenClaw pinned version | `package.json` pins `v2026.6.1` |
| Runtime patch directory | `scripts/patches/v2026.6.1/` is the active version-specific patch set |
| OpenClaw manager | Contains bundle fast path, compile cache, Bonjour disable, gateway health polling, bundled worker shim self-heal, and Popiai-specific shim env names |
| Config sync | Contains PopiArt CLI env injection, knowledge source prompt injection, Popiai provider IDs, OpenAI Codex headers, and PopiStudio-specific media path policy |
| Specs coverage | PopiStudio specs lag behind LobsterAI for several 2026-05 to 2026-07 OpenClaw reliability and runtime upgrade decisions |

## 3. LobsterAI Specs Reviewed

Primary documents reviewed:

| LobsterAI spec | PopiStudio conclusion |
|----------------|----------------------|
| `refactors/startup-gateway-optimization/2026-05-28-startup-gateway-optimization.md` | Partially applicable now. The dev-mode npm shim path fix applies directly to PopiStudio. Media-generation entitlement and LobsterAI server model warmup are product-specific and need PopiStudio equivalents before porting. |
| `bugfixes/node-runtime-resolution/2026-07-01-node-runtime-resolution.md` | Applicable in principle. PopiStudio still has Windows node/npm/npx resolution paths that should be unified, but this is larger than a direct docs copy and should be implemented as a focused refactor. |
| `refactors/openclaw-upgrade/2026-06-16-openclaw-2026-6-1-upgrade.md` | Applied as the migration checklist for version, plugin, build, local-extension, and patch-set changes. |
| `refactors/openclaw-upgrade/2026-06-17-openclaw-2026-6-1-final-patch-decisions.md` | Applied through `src/main/libs/openclawPatches` decision tests and `scripts/patches/v2026.6.1/`. |
| `refactors/openclaw-upgrade/2026-06-18-openclaw-bundle-worker-shim.md` | Applied. PopiStudio now generates root worker shims during bundling and startup fast path self-heal. |
| `bugfixes/mcp-stdio-process-leak/2026-05-28-mcp-shared-runtime-design.md` | Relevant to future runtime patching if PopiStudio sees stdio MCP process multiplication. Current active patch set is still 4.14, so direct 6.1 patch assumptions do not apply. |
| `bugfixes/openclaw-task-cwd-system-prompt/2026-07-03-openclaw-task-cwd-system-prompt-design.md` | Potentially applicable to scheduled task cwd behavior, but must be checked against PopiStudio scheduled task implementation and current OpenClaw patch level. |
| `features/cowork-plan-mode/2026-06-21-cowork-plan-mode-design.md` and `features/cowork-goal-mode/*` | Not a safe direct port. PopiStudio's current renderer and runtime types do not expose all LobsterAI plan/goal mode contracts. |

## 4. Applied Findings

### 4.1 Gateway status and diagnostics

Imported from LobsterAI's OpenClaw manager evolution:

- `OpenClawEngineStatus` now includes `gatewayPort` and `gatewayHttpUrl` while gateway is starting or running.
- Gateway startup uses a 4096 MB V8 old-space limit unless `NODE_OPTIONS` already provides one.
- Gateway compile cache env includes `OPENCLAW_PACKAGED_COMPILE_CACHE_RESPAWNED=1`.
- Recent gateway stdout/stderr is retained in memory for crash classification.
- Invalid `openclaw.json` startup failures suppress automatic restart loops.

These changes are version-neutral and fit PopiStudio's current manager.

### 4.2 Dev-mode npm shim path

Applied from `refactors/startup-gateway-optimization/2026-05-28-startup-gateway-optimization.md`.

PopiStudio previously passed `undefined` as `npmBinDir` in development mode:

```typescript
const npmBinDir = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'npm', 'bin')
  : undefined;
```

This leaves gateway npm/npx `.cmd` shims with an empty `POPIAI_NPM_BIN_DIR`, which can break plugins that execute `npm` from inside the OpenClaw gateway process. PopiStudio now uses the app-local npm bin directory in dev mode:

```typescript
const npmBinDir = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'npm', 'bin')
  : path.join(app.getAppPath(), 'node_modules', 'npm', 'bin');
```

## 5. Deferred Findings

### 5.1 OpenClaw 2026.6.1 upgrade docs

LobsterAI's `v2026.6.1` upgrade specs contain a detailed patch migration matrix. PopiStudio now uses that matrix for the active `v2026.6.1` patch directory, with product-specific details preserved.

The active adaptation rules are:

| Patch decision category | PopiStudio action |
|-------------------------|-------------------|
| Still required in LobsterAI 6.1 and also used by PopiStudio config/runtime | Ported into `scripts/patches/v2026.6.1/` |
| No longer required in LobsterAI 6.1 due to upstream OpenClaw support | Left out and locked by patch decision tests |
| LobsterAI-specific providers or media generation | Not copied directly; Popiai providers and PopiArt workflows remain separate |

### 5.2 Unified Node runtime resolution

The LobsterAI node runtime spec identifies a real Windows class of failures: shell shims can be mistaken for native spawnable `node.exe`. PopiStudio still has split logic in `resolveStdioCommand.ts`, `coworkUtil.ts`, and gateway shim setup.

Recommended future refactor:

1. Add a `src/main/libs/nodeRuntime.ts` module.
2. Separate shell command shims from native spawnable runtime resolution.
3. On Windows, never treat the no-extension `node` bash shim or `node.cmd` as a native Node runtime for `child_process.spawn`.
4. Use Electron-as-node with `ELECTRON_RUN_AS_NODE=1` when no real `node.exe` is available.
5. Update MCP, skill script, plugin, and OpenClaw gateway helper paths to use the shared resolver.

This should be implemented with tests; it is larger than a safe opportunistic patch.

## 6. Non-Applicable LobsterAI Details

The following LobsterAI spec details should not be ported directly:

| LobsterAI detail | Reason |
|------------------|--------|
| `lobster-media-generation` plugin contracts and entitlement toggles | PopiStudio uses PopiArt-specific integration paths. |
| `LOBSTERAI_*` env names | PopiStudio uses `POPIAI_*`; gateway shims and config must keep PopiStudio names. |
| `lobsterai-server` provider IDs | PopiStudio uses Popiai provider IDs and token proxy behavior. |
| LobsterAI media-generation patch decisions | PopiStudio uses PopiArt-specific integration paths. |
| LobsterAI plan/goal mode renderer contracts | PopiStudio types and UI currently diverge. |

## 7. Verification

For changes applied in this audit:

```bash
node_modules/.bin/vitest run src/main/libs/openclawEngineManager.test.ts
node_modules/.bin/tsc -p electron-tsconfig.json --noEmit
```

Full `npm test` and `npm run compile:electron` may trigger native dependency rebuilds and Electron header downloads through pre scripts; run those in an environment that can write npm/electron-gyp caches.
