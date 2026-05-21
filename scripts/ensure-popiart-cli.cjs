'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const tar = require('tar');
const extractZip = require('extract-zip');

const PROJECT_ROOT = path.join(__dirname, '..');
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, 'package.json');
const VENDOR_ROOT = path.join(PROJECT_ROOT, 'vendor', 'popiart-cli');
const DEFAULT_REPO = 'wtgoku-create/popiartcli';
const DEFAULT_VERSION = 'latest';

const TARGET_CONFIG = {
  'mac-x64': {
    platformDir: 'darwin',
    archDir: 'x64',
    executableName: 'popiart',
    assetPlatformTokens: ['darwin', 'macos', 'mac'],
    assetArchTokens: ['x64', 'amd64', 'x86_64'],
  },
  'mac-arm64': {
    platformDir: 'darwin',
    archDir: 'arm64',
    executableName: 'popiart',
    assetPlatformTokens: ['darwin', 'macos', 'mac'],
    assetArchTokens: ['arm64', 'aarch64'],
  },
  'win-x64': {
    platformDir: 'win32',
    archDir: 'x64',
    executableName: 'popiart.exe',
    assetPlatformTokens: ['windows', 'win32', 'win'],
    assetArchTokens: ['x64', 'amd64', 'x86_64'],
  },
  'win-arm64': {
    platformDir: 'win32',
    archDir: 'arm64',
    executableName: 'popiart.exe',
    assetPlatformTokens: ['windows', 'win32', 'win'],
    assetArchTokens: ['arm64', 'aarch64'],
  },
  'linux-x64': {
    platformDir: 'linux',
    archDir: 'x64',
    executableName: 'popiart',
    assetPlatformTokens: ['linux'],
    assetArchTokens: ['x64', 'amd64', 'x86_64'],
  },
  'linux-arm64': {
    platformDir: 'linux',
    archDir: 'arm64',
    executableName: 'popiart',
    assetPlatformTokens: ['linux'],
    assetArchTokens: ['arm64', 'aarch64'],
  },
};

const PLATFORM_TOKEN_GROUPS = {
  win32: ['windows', 'win32', 'win'],
  darwin: ['darwin', 'macos', 'mac'],
  linux: ['linux'],
};

function readPackageConfig() {
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  } catch {
    pkg = {};
  }
  const config = pkg.popiartcli && typeof pkg.popiartcli === 'object' ? pkg.popiartcli : {};
  return {
    repo: typeof config.repo === 'string' && config.repo.trim() ? config.repo.trim() : DEFAULT_REPO,
    version: typeof config.version === 'string' && config.version.trim() ? config.version.trim() : DEFAULT_VERSION,
  };
}

function resolveTargetIdFromHost() {
  if (process.platform === 'darwin') {
    return process.arch === 'x64' ? 'mac-x64' : 'mac-arm64';
  }
  if (process.platform === 'win32') {
    return process.arch === 'arm64' ? 'win-arm64' : 'win-x64';
  }
  if (process.platform === 'linux') {
    return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  }
  throw new Error(`Unsupported host platform: ${process.platform}/${process.arch}`);
}

function resolveTargetConfig(targetId) {
  const config = TARGET_CONFIG[targetId];
  if (!config) {
    throw new Error(`Unsupported PopiArt CLI target: ${targetId}`);
  }
  return config;
}

function resolvePreparedTargetRoot(targetId) {
  return path.join(VENDOR_ROOT, targetId);
}

function resolvePreparedExecutablePath(targetId) {
  const config = resolveTargetConfig(targetId);
  return path.join(resolvePreparedTargetRoot(targetId), config.platformDir, config.archDir, config.executableName);
}

function readPreparedMetadata(targetId) {
  const metadataPath = path.join(resolvePreparedTargetRoot(targetId), 'metadata.json');
  if (!fs.existsSync(metadataPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writePreparedMetadata(targetId, metadata) {
  const metadataPath = path.join(resolvePreparedTargetRoot(targetId), 'metadata.json');
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}

function normalizeName(name) {
  return name.trim().toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasNameToken(name, token) {
  const lower = normalizeName(name);
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(token.toLowerCase())}([^a-z0-9]|$)`).test(lower);
}

function isRejectedAssetName(name) {
  const lower = normalizeName(name);
  return lower.includes('checksums')
    || lower.includes('checksum')
    || lower.includes('.sha')
    || lower.endsWith('.sig')
    || lower.endsWith('.pem')
    || lower.endsWith('.sbom')
    || lower.startsWith('source code')
    || lower.includes('source code')
    || lower.includes('src')
    || lower.includes('source')
    || lower.includes('sources');
}

function scoreAsset(name, targetConfig) {
  const lower = normalizeName(name);
  if (!lower.includes('popiart')) return Number.NEGATIVE_INFINITY;
  if (isRejectedAssetName(lower)) return Number.NEGATIVE_INFINITY;

  let score = 0;

  const hasTargetPlatformToken = targetConfig.assetPlatformTokens.some((token) => hasNameToken(lower, token));
  const hasTargetArchToken = targetConfig.assetArchTokens.some((token) => hasNameToken(lower, token));

  if (hasTargetPlatformToken) {
    score += 40;
  }
  if (hasTargetArchToken) {
    score += 40;
  }
  if (!hasTargetPlatformToken) {
    score -= 30;
  }
  if (!hasTargetArchToken) {
    score -= 30;
  }

  const otherPlatformTokens = Object.values(PLATFORM_TOKEN_GROUPS)
    .flat()
    .filter((token) => !targetConfig.assetPlatformTokens.includes(token));
  if (otherPlatformTokens.some((token) => hasNameToken(lower, token))) {
    score -= 160;
  }
  if (lower.endsWith('.zip') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    score += 15;
  }
  if (lower.endsWith('.msi') || lower.endsWith('.pkg') || lower.endsWith('.deb') || lower.endsWith('.rpm')) {
    score -= 120;
  }
  if (lower.endsWith(`/${targetConfig.executableName}`) || lower.endsWith(targetConfig.executableName)) {
    score += 20;
  }
  if (lower.includes('portable') || lower.includes('standalone')) {
    score += 20;
  }
  if (lower.includes('universal')) {
    score -= 10;
  }

  return score;
}

async function fetchRelease(repo, version) {
  const endpoint = version === 'latest'
    ? `https://api.github.com/repos/${repo}/releases/latest`
    : `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(version)}`;

  const response = await fetch(endpoint, {
    headers: {
      ...createGitHubHeaders('application/vnd.github+json'),
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch PopiArt CLI release metadata: HTTP ${response.status}`);
  }

  return response.json();
}

function pickBestAsset(release, targetId) {
  const targetConfig = resolveTargetConfig(targetId);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const scoredAssets = assets
    .filter((asset) => asset && typeof asset === 'object' && typeof asset.name === 'string')
    .map((asset) => ({
      asset,
      score: scoreAsset(asset.name, targetConfig),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scoredAssets[0];

  if (!best || best.score < 40) {
    const names = assets
      .map((asset) => typeof asset?.name === 'string' ? asset.name : null)
      .filter(Boolean)
      .join(', ');
    throw new Error(`Could not find a matching PopiArt CLI asset for ${targetId}. Available assets: ${names || 'none'}`);
  }

  console.log(
    `[ensure-popiart-cli] Selected asset for ${targetId}: ${best.asset.name} `
    + `(score=${best.score})`,
  );

  return best.asset;
}

async function downloadFile(url, outPath) {
  const response = await fetch(url, {
    headers: createGitHubHeaders('application/octet-stream'),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download PopiArt CLI asset: HTTP ${response.status}`);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(outPath));
}

function walkFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function isExecutableCandidate(candidate, targetConfig) {
  const base = path.basename(candidate).toLowerCase();
  if (targetConfig.executableName.toLowerCase().endsWith('.exe')) {
    return base.endsWith('.exe');
  }
  return !base.endsWith('.dll')
    && !base.endsWith('.so')
    && !base.endsWith('.dylib')
    && !base.endsWith('.txt')
    && !base.endsWith('.md');
}

function scoreExtractedBinaryCandidate(candidate, extractDir, targetConfig) {
  const relative = path.relative(extractDir, candidate).replace(/\\/g, '/');
  const lowerRelative = relative.toLowerCase();
  const lowerBase = path.basename(candidate).toLowerCase();
  const expected = targetConfig.executableName.toLowerCase();

  let score = 0;

  if (lowerBase === expected) {
    score += 1000;
  }
  if (lowerRelative.endsWith(`/${expected}`) || lowerRelative === expected) {
    score += 200;
  }
  if (lowerBase.includes('popiart')) {
    score += 160;
  }
  if (lowerRelative.includes('/bin/')) {
    score += 80;
  }
  if (lowerRelative.includes('/dist/')) {
    score += 40;
  }
  if (targetConfig.assetPlatformTokens.some((token) => lowerRelative.includes(token))) {
    score += 30;
  }
  if (targetConfig.assetArchTokens.some((token) => lowerRelative.includes(token))) {
    score += 30;
  }
  if (lowerBase.includes('cli')) {
    score += 20;
  }
  if (lowerBase.includes('setup') || lowerBase.includes('install') || lowerBase.includes('uninstall')) {
    score -= 200;
  }

  score -= relative.length;
  return score;
}

async function extractAsset(assetPath, extractDir) {
  const lower = assetPath.toLowerCase();
  fs.mkdirSync(extractDir, { recursive: true });

  if (lower.endsWith('.zip')) {
    await extractZip(assetPath, { dir: extractDir });
    return;
  }
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    await tar.x({
      file: assetPath,
      cwd: extractDir,
    });
    return;
  }

  throw new Error(`Unsupported PopiArt CLI asset format: ${path.basename(assetPath)}`);
}

function pickExtractedBinary(extractDir, targetId) {
  const targetConfig = resolveTargetConfig(targetId);
  const candidates = walkFiles(extractDir)
    .filter((candidate) => isExecutableCandidate(candidate, targetConfig))
    .map((candidate) => ({
      path: candidate,
      score: scoreExtractedBinaryCandidate(candidate, extractDir, targetConfig),
    }))
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length);

  const best = candidates[0];
  if (!best || best.score < 100) {
    const candidateSummary = candidates.length > 0
      ? candidates
        .slice(0, 8)
        .map((candidate) => `${path.relative(extractDir, candidate.path)} (score=${candidate.score})`)
        .join(', ')
      : 'none';
    throw new Error(
      `Could not find ${targetConfig.executableName} inside extracted PopiArt CLI asset for ${targetId}. `
      + `Executable candidates: ${candidateSummary}`,
    );
  }

  return best.path;
}

function summarizeExtractedTopLevelEntries(extractDir) {
  if (!fs.existsSync(extractDir)) {
    return 'none';
  }
  const entries = fs.readdirSync(extractDir, { withFileTypes: true })
    .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
    .slice(0, 20);
  return entries.length > 0 ? entries.join(', ') : 'none';
}

async function ensurePopiArtCliTarget(targetId) {
  const { repo, version } = readPackageConfig();
  const targetConfig = resolveTargetConfig(targetId);
  const preparedExecutable = resolvePreparedExecutablePath(targetId);
  const preparedMetadata = readPreparedMetadata(targetId);

  let release;
  let asset;
  try {
    release = await fetchRelease(repo, version);
    asset = pickBestAsset(release, targetId);
  } catch (error) {
    if (preparedMetadata && fs.existsSync(preparedExecutable)) {
      console.warn(
        `[ensure-popiart-cli] Failed to refresh ${targetId} from GitHub, using cached CLI instead: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        targetId,
        releaseTag: preparedMetadata.releaseTag || 'cached',
        assetName: preparedMetadata.assetName || path.basename(preparedExecutable),
        executablePath: preparedExecutable,
        cached: true,
      };
    }
    throw error;
  }

  const releaseTag = typeof release.tag_name === 'string' ? release.tag_name : version;
  if (
    preparedMetadata
    && preparedMetadata.repo === repo
    && preparedMetadata.releaseTag === releaseTag
    && preparedMetadata.assetName === asset.name
    && fs.existsSync(preparedExecutable)
  ) {
    return {
      targetId,
      releaseTag,
      assetName: asset.name,
      executablePath: preparedExecutable,
      cached: true,
    };
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lobster-popiart-cli-'));
  try {
    const assetPath = path.join(tempRoot, asset.name);
    await downloadFile(asset.browser_download_url, assetPath);

    let resolvedBinary = assetPath;
    const lower = asset.name.toLowerCase();
    if (lower.endsWith('.zip') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      const extractDir = path.join(tempRoot, 'extract');
      await extractAsset(assetPath, extractDir);
      console.log(
        `[ensure-popiart-cli] Extracted ${asset.name} top-level entries: `
        + summarizeExtractedTopLevelEntries(extractDir),
      );
      resolvedBinary = pickExtractedBinary(extractDir, targetId);
    }

    const preparedRoot = resolvePreparedTargetRoot(targetId);
    const destinationDir = path.dirname(preparedExecutable);
    fs.rmSync(preparedRoot, { recursive: true, force: true });
    fs.mkdirSync(destinationDir, { recursive: true });
    fs.copyFileSync(resolvedBinary, preparedExecutable);
    if (targetConfig.executableName === 'popiart') {
      fs.chmodSync(preparedExecutable, 0o755);
    }
    writePreparedMetadata(targetId, {
      repo,
      requestedVersion: version,
      releaseTag,
      assetName: asset.name,
      downloadedAt: new Date().toISOString(),
    });

    console.log(`[ensure-popiart-cli] Prepared ${targetId} from ${asset.name} (${releaseTag})`);
    return {
      targetId,
      releaseTag,
      assetName: asset.name,
      executablePath: preparedExecutable,
      cached: false,
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  const targetArg = process.argv[2] || 'host';
  const targetId = targetArg === 'host' ? resolveTargetIdFromHost() : targetArg;
  await ensurePopiArtCliTarget(targetId);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[ensure-popiart-cli] Failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  ensurePopiArtCliTarget,
  readPackageConfig,
  resolvePreparedExecutablePath,
  resolvePreparedTargetRoot,
  resolveTargetConfig,
  resolveTargetIdFromHost,
};
