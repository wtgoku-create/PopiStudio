# Bundled Popiart CLI

This directory holds the **popiart** Go CLI binaries per OS and CPU (for example `win-amd64/popiart.exe`, `darwin-arm64/popiart`). They are **not committed** to git.

- **Local dev:** run `npm run popiart:cli:ensure` (also runs as part of `npm run electron:dev`).
- **Packaging:** `electron-builder` `beforePack` runs `scripts/ensure-popiart-cli.cjs`, which downloads the correct slice(s) for the build target.
- **Version:** override with env `POPIART_CLI_VERSION` (default pinned in `scripts/ensure-popiart-cli.cjs`).

At runtime the main process sets `POPIART_CLI` to the absolute path of the binary for the current `process.platform` / `process.arch`.
