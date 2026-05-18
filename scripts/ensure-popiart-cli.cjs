'use strict';

/**
 * Download the bundled popiart CLI (Go release) for the current packaging target.
 * Artifacts: https://github.com/wtgoku-create/popiartcli/releases
 *
 * Output layout under resources/popiart-cli/:
 *   win-amd64/popiart.exe
 *   win-arm64/popiart.exe
 *   darwin-amd64/popiart
 *   darwin-arm64/popiart
 *   linux-amd64/popiart
 *   linux-arm64/popiart
 *
 * Dev (no electron-builder context): downloads a single folder for process.platform/arch.
 *
 * Usage:
 *   node scripts/ensure-popiart-cli.cjs
 *   node scripts/ensure-popiart-cli.cjs --from-builder   (reads stdin JSON with electronPlatformName + arch)
 */

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const extractZip = require('extract-zip');
const tar = require('tar');

const POPIART_CLI_VERSION = process.env.POPIART_CLI_VERSION || '0.3.20';
const REPO = 'wtgoku-create/popiartcli';
const TAG = `v${POPIART_CLI_VERSION}`;

const ASSETS = {
  'win-amd64': `popiart_${POPIART_CLI_VERSION}_windows_amd64.zip`,
  'win-arm64': `popiart_${POPIART_CLI_VERSION}_windows_arm64.zip`,
  'darwin-amd64': `popiart_${POPIART_CLI_VERSION}_darwin_amd64.tar.gz`,
  'darwin-arm64': `popiart_${POPIART_CLI_VERSION}_darwin_arm64.tar.gz`,
  'linux-amd64': `popiart_${POPIART_CLI_VERSION}_linux_amd64.tar.gz`,
  'linux-arm64': `popiart_${POPIART_CLI_VERSION}_linux_arm64.tar.gz`,
};

function releaseUrl(filename) {
  return `https://github.com/${REPO}/releases/download/${TAG}/${filename}`;
}

function resolveArchFromContext(context) {
  const n = context?.arch;
  if (n === 3) return 'arm64';
  if (n === 0) return 'ia32';
  return 'x64';
}

/** @returns {string[]} keys into ASSETS */
function resolveTargetsForPack(context) {
  const platform = context?.electronPlatformName;
  const arch = resolveArchFromContext(context);

  if (platform === 'win32') {
    return arch === 'arm64' ? ['win-arm64'] : ['win-amd64'];
  }
  if (platform === 'darwin') {
    // Include both slices so arm64 / x64 / universal app bundles can resolve at runtime via process.arch.
    return ['darwin-arm64', 'darwin-amd64'];
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? ['linux-arm64'] : ['linux-amd64'];
  }
  return [];
}

function resolveTargetsForDev() {
  const p = process.platform;
  const a = process.arch;
  if (p === 'win32') {
    return a === 'arm64' ? ['win-arm64'] : ['win-amd64'];
  }
  if (p === 'darwin') {
    return a === 'arm64' ? ['darwin-arm64'] : ['darwin-amd64'];
  }
  if (p === 'linux') {
    return a === 'arm64' ? ['linux-arm64'] : ['linux-amd64'];
  }
  console.warn('[ensure-popiart-cli] Unsupported dev platform, skipping');
  return [];
}

async function downloadToFile(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed ${res.status} ${res.statusText}: ${url}`);
  }
  const tmp = `${dest}.part`;
  const out = fs.createWriteStream(tmp);
  await pipeline(Readable.fromWeb(res.body), out);
  fs.renameSync(tmp, dest);
}

function findPopiartBinary(rootDir, isWindows) {
  const wantName = isWindows ? 'popiart.exe' : 'popiart';

  const stack = [rootDir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && e.name === wantName) {
        return full;
      }
    }
  }
  return null;
}

async function extractArchive(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (archivePath.endsWith('.zip')) {
    await extractZip(archivePath, { dir: destDir });
  } else {
    await tar.x({ file: archivePath, cwd: destDir });
  }
}

async function ensureOneTarget(projectRoot, targetKey, cacheDir) {
  const outDir = path.join(projectRoot, 'resources', 'popiart-cli', targetKey);
  const assetName = ASSETS[targetKey];
  if (!assetName) {
    throw new Error(`Unknown popiart target: ${targetKey}`);
  }

  const exeName = targetKey.startsWith('win-') ? 'popiart.exe' : 'popiart';
  const finalExe = path.join(outDir, exeName);
  if (fs.existsSync(finalExe)) {
    console.log(`[ensure-popiart-cli] ${targetKey}: already present (${finalExe})`);
    return;
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  const archivePath = path.join(cacheDir, assetName);
  if (!fs.existsSync(archivePath)) {
    const url = releaseUrl(assetName);
    console.log(`[ensure-popiart-cli] ${targetKey}: downloading ${url}`);
    await downloadToFile(url, archivePath);
  }

  const extractRoot = path.join(cacheDir, `extract-${targetKey}`);
  fs.rmSync(extractRoot, { recursive: true, force: true });
  fs.mkdirSync(extractRoot, { recursive: true });
  await extractArchive(archivePath, extractRoot);

  const found = findPopiartBinary(extractRoot, targetKey.startsWith('win-'));
  if (!found) {
    throw new Error(`[ensure-popiart-cli] ${targetKey}: popiart binary not found after extract`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(found, finalExe);
  if (!targetKey.startsWith('win-')) {
    try {
      fs.chmodSync(finalExe, 0o755);
    } catch {
      // ignore
    }
  }

  fs.rmSync(extractRoot, { recursive: true, force: true });
  console.log(`[ensure-popiart-cli] ${targetKey}: installed -> ${finalExe}`);
}

/**
 * @param {object | null} context electron-builder beforePack context (optional)
 */
async function ensurePopiartCli(context) {
  const projectRoot = path.join(__dirname, '..');
  const cacheDir = path.join(projectRoot, 'build-cache', 'popiart-cli');

  const targets = context
    ? resolveTargetsForPack(context)
    : resolveTargetsForDev();

  if (targets.length === 0) {
    console.warn('[ensure-popiart-cli] No targets resolved; skipping');
    return;
  }

  for (const key of targets) {
    await ensureOneTarget(projectRoot, key, cacheDir);
  }

  const marker = path.join(projectRoot, 'resources', 'popiart-cli', '.bundled-version');
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, `${TAG}\n`, 'utf8');
}

async function main() {
  await ensurePopiartCli(null);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[ensure-popiart-cli]', err);
    process.exit(1);
  });
}

module.exports = { ensurePopiartCli, resolveTargetsForPack };
