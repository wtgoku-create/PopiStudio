# Bundled Popiart CLI

This directory holds the **popiart** Go CLI binaries per OS and CPU (for example `win-amd64/popiart.exe`, `darwin-arm64/popiart`). They are **not committed** to git.

- **Local dev:** run `npm run popiart:cli:ensure` (also runs as part of `npm run electron:dev`).
- **Packaging:** `electron-builder` `beforePack` runs `scripts/ensure-popiart-cli.cjs`, which downloads the correct slice(s) for the build target.
- **Version:** override with env `POPIART_CLI_VERSION` (default pinned in `scripts/ensure-popiart-cli.cjs`).

At runtime the main process sets `POPIART_CLI` and prepends the binary directory to `PATH`.

## Auth sync with PopiStudio

When the user signs in to PopiStudio, the app fetches the account gateway product key and runs:

`popiart --endpoint https://server.popi.art/v1 auth login --key <apikey>`

Session state is stored in `~/.popiart/config.json` (see [popiartcli README](https://github.com/wtgoku-create/popiartcli/blob/main/README.md)). Cowork / OpenClaw subprocesses use that file; the app does **not** inject `POPIART_KEY` into the gateway environment.

On sign-out, the app runs `popiart auth logout` (best-effort).
