'use strict';

/**
 * Ensure preinstalled OpenClaw plugins are downloaded and placed into the
 * runtime extensions directory.
 *
 * Uses the OpenClaw CLI (`openclaw plugins install`) to handle downloading,
 * dependency resolution, and proper module setup for each plugin declared in
 * package.json ("openclaw.plugins").
 *
 * Flow per plugin:
 *   1. Checks a local cache in vendor/openclaw-plugins/{id}/
 *   2. Installs via `openclaw plugins install` if not cached at the right version
 *   3. Copies the plugin into vendor/openclaw-runtime/current/extensions/{id}/
 *
 * Environment variables:
 *   OPENCLAW_SKIP_PLUGINS          – Set to "1" to skip this script entirely
 *   OPENCLAW_FORCE_PLUGIN_INSTALL  – Set to "1" to force re-download all plugins
 *   OPENCLAW_PLUGIN_INSTALL_RETRIES – Override retry attempts for transient
 *                                     plugin-install failures (default: 3)
 *   OPENCLAW_PLUGIN_RETRY_BASE_MS   – Override initial retry delay in ms
 *                                     for transient plugin-install failures
 *                                     (default: 3000)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyOpenClawPluginPatches } = require('./openclaw-plugin-patches/index.cjs');
const {
  BEE_PACKAGE_NAME,
  prepareOpenClawNeteaseBeePackage,
} = require('./openclaw-plugin-preparers/netease-bee.cjs');
const {
  NIM_PLUGIN_PACKAGE_ID,
  prepareOpenClawNimPackage,
} = require('./openclaw-plugin-preparers/nim-channel.cjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rootDir = path.resolve(__dirname, '..');

function log(msg) {
  console.log(`[openclaw-plugins] ${msg}`);
}

function die(msg) {
  console.error(`[openclaw-plugins] ERROR: ${msg}`);
  process.exit(1);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function buildPluginInstallEnv(plugin) {
  const env = { npm_config_legacy_peer_deps: 'true' };
  if (plugin.id === BEE_PACKAGE_NAME || plugin.npm === BEE_PACKAGE_NAME) {
    env.npm_config_allow_git = 'all';
  }
  return env;
}

function copyDirRecursive(src, dest) {
  const linkedOpenClawPeer = path.join(src, 'node_modules', 'openclaw');
  const shouldExcludeLinkedPeer =
    fs.existsSync(linkedOpenClawPeer) && fs.lstatSync(linkedOpenClawPeer).isSymbolicLink();

  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    filter: sourcePath =>
      !shouldExcludeLinkedPeer || path.resolve(sourcePath) !== path.resolve(linkedOpenClawPeer),
  });
}

function mergeDirectoryContents(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    fs.cpSync(path.join(src, entry.name), path.join(dest, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

function mergeDirectoryContentsExcluding(src, dest, excludedPaths = []) {
  if (!fs.existsSync(src)) return;
  const excluded = excludedPaths.map(excludedPath => path.resolve(excludedPath));
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sourcePath = path.join(src, entry.name);
    fs.cpSync(sourcePath, path.join(dest, entry.name), {
      recursive: true,
      force: true,
      filter: candidatePath => !excluded.some(excludedPath => path.resolve(candidatePath) === excludedPath),
    });
  }
}

/**
 * Fix broken symlinks in node_modules/.bin/ directories.
 *
 * npm creates absolute symlinks during `openclaw plugins install` that point
 * into the temporary staging directory.  After copying out of staging those
 * symlinks are broken.  This rewrites each one to a correct relative path
 * based on the symlink target structure (../pkgName/relative/to/bin).
 */
function fixBinSymlinks(baseDir) {
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isSymbolicLink()) {
        const binDir = path.dirname(full);
        if (path.basename(binDir) !== '.bin') continue;
        const target = fs.readlinkSync(full);
        if (!path.isAbsolute(target)) continue;
        // Extract the path relative to node_modules/ from the absolute target.
        // e.g. "/tmp/.../extensions/moltbot-popo/node_modules/qrcode/bin/qrcode"
        //   -> "qrcode/bin/qrcode"
        const nmSegment = '/node_modules/';
        const nmIdx = target.lastIndexOf(nmSegment);
        if (nmIdx === -1) continue;
        const relToNm = target.slice(nmIdx + nmSegment.length); // "qrcode/bin/qrcode"
        const newTarget = path.join('..', relToNm);              // "../qrcode/bin/qrcode"
        try {
          fs.unlinkSync(full);
          fs.symlinkSync(newTarget, full);
        } catch {
          // best-effort; signing can still proceed if the symlink is removed
        }
      }
    }
  };
  walk(baseDir);
}

function listDirectories(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

function findFilesByName(root, fileName, maxDepth = 8) {
  const results = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === fileName) {
        results.push(full);
      } else if (entry.isDirectory()) {
        if (entry.name === 'node_modules' && depth > 1) continue;
        walk(full, depth + 1);
      }
    }
  };

  walk(root, 0);
  return results;
}

function listDirectPackageDirs(nodeModulesDir) {
  if (!fs.existsSync(nodeModulesDir)) {
    return [];
  }

  const packageDirs = [];
  for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const entryPath = path.join(nodeModulesDir, entry.name);
    if (!entry.name.startsWith('@')) {
      packageDirs.push(entryPath);
      continue;
    }

    for (const scopedEntry of fs.readdirSync(entryPath, { withFileTypes: true })) {
      if (scopedEntry.isDirectory()) {
        packageDirs.push(path.join(entryPath, scopedEntry.name));
      }
    }
  }

  return packageDirs;
}

function pluginDirectoryMatches(dir, plugin) {
  const manifest = readJsonFile(path.join(dir, 'openclaw.plugin.json'));
  if (manifest?.id === plugin.id) return true;
  if (Array.isArray(manifest?.channels) && manifest.channels.includes(plugin.id)) return true;

  const pkg = readJsonFile(path.join(dir, 'package.json'));
  if (pkg?.name === plugin.npm) return true;
  if (pkg?.openclaw?.channel?.id === plugin.id) return true;
  if (Array.isArray(pkg?.openclaw?.channels) && pkg.openclaw.channels.includes(plugin.id)) return true;
  return false;
}

function hasPluginShape(dir) {
  return fs.existsSync(path.join(dir, 'openclaw.plugin.json')) ||
    fs.existsSync(path.join(dir, 'package.json'));
}

function packageNameToNodeModulesPath(packageName) {
  const parts = String(packageName || '').split('/').filter(Boolean);
  return parts.length > 0 ? path.join('node_modules', ...parts) : null;
}

function findInstallProjectDirForNestedPlugin(stagingDir, plugin, nestedPluginDir) {
  const dependencyPath = packageNameToNodeModulesPath(plugin.npm);
  if (!dependencyPath) return null;
  const suffix = `${path.sep}${dependencyPath}`;
  if (!nestedPluginDir.endsWith(suffix)) return null;
  const projectDir = nestedPluginDir.slice(0, -suffix.length);
  return projectDir && fs.existsSync(path.join(projectDir, 'package.json')) ? projectDir : null;
}

function findInstalledPluginDir(stagingDir, plugin) {
  const expectedDir = path.join(stagingDir, 'extensions', plugin.id);
  if (fs.existsSync(expectedDir)) {
    return { pluginDir: expectedDir, installProjectDir: null };
  }

  const extensionDirs = listDirectories(path.join(stagingDir, 'extensions'));
  const matchingExtensionDir = extensionDirs.find((dir) => pluginDirectoryMatches(dir, plugin));
  if (matchingExtensionDir) {
    return { pluginDir: matchingExtensionDir, installProjectDir: null };
  }
  if (extensionDirs.length === 1 && hasPluginShape(extensionDirs[0])) {
    return { pluginDir: extensionDirs[0], installProjectDir: null };
  }

  const manifestDirs = findFilesByName(stagingDir, 'openclaw.plugin.json')
    .map((file) => path.dirname(file));
  const matchingManifestDir = manifestDirs.find((dir) => pluginDirectoryMatches(dir, plugin));
  if (matchingManifestDir) {
    return {
      pluginDir: matchingManifestDir,
      installProjectDir: findInstallProjectDirForNestedPlugin(stagingDir, plugin, matchingManifestDir),
    };
  }

  const packageDirs = findFilesByName(stagingDir, 'package.json')
    .map((file) => path.dirname(file));
  const dependencyPath = packageNameToNodeModulesPath(plugin.npm);
  if (dependencyPath) {
    for (const dir of packageDirs) {
      const pkg = readJsonFile(path.join(dir, 'package.json'));
      const deps = {
        ...(pkg?.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {}),
        ...(pkg?.devDependencies && typeof pkg.devDependencies === 'object' ? pkg.devDependencies : {}),
        ...(pkg?.optionalDependencies && typeof pkg.optionalDependencies === 'object' ? pkg.optionalDependencies : {}),
      };
      if (!Object.prototype.hasOwnProperty.call(deps, plugin.npm)) continue;
      const nestedPluginDir = path.join(dir, dependencyPath);
      if (
        fs.existsSync(nestedPluginDir) &&
        pluginDirectoryMatches(nestedPluginDir, plugin)
      ) {
        return { pluginDir: nestedPluginDir, installProjectDir: dir };
      }
    }
  }

  const matchingPackageDir = packageDirs.find((dir) => pluginDirectoryMatches(dir, plugin));
  if (matchingPackageDir) {
    return {
      pluginDir: matchingPackageDir,
      installProjectDir: findInstallProjectDirForNestedPlugin(stagingDir, plugin, matchingPackageDir),
    };
  }

  const npmProjectsDir = path.join(stagingDir, 'npm', 'projects');
  if (fs.existsSync(npmProjectsDir)) {
    const npmPackageDirs = fs
      .readdirSync(npmProjectsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .flatMap(entry => listDirectPackageDirs(path.join(npmProjectsDir, entry.name, 'node_modules')));
    const matchingNpmPackageDir = npmPackageDirs.find((dir) => pluginDirectoryMatches(dir, plugin));
    if (matchingNpmPackageDir) {
      return {
        pluginDir: matchingNpmPackageDir,
        installProjectDir: findInstallProjectDirForNestedPlugin(stagingDir, plugin, matchingNpmPackageDir),
      };
    }
  }

  const shapedDirs = [...manifestDirs, ...packageDirs]
    .filter((dir, index, dirs) => dirs.indexOf(dir) === index)
    .filter((dir) => !dir.includes(`${path.sep}node_modules${path.sep}`));
  return shapedDirs.length === 1
    ? { pluginDir: shapedDirs[0], installProjectDir: null }
    : null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isLocalPathSpec(spec) {
  if (!spec || typeof spec !== 'string') return false;
  if (spec.startsWith('file:')) return true;
  if (path.isAbsolute(spec)) return true;
  if (spec.startsWith('./') || spec.startsWith('../')) return true;
  if (spec === '.' || spec === '..') return true;
  // Windows drive letter path, e.g. C:\foo\bar
  if (/^[a-zA-Z]:[\\/]/.test(spec)) return true;
  return false;
}

function isGitSpec(spec) {
  if (!spec || typeof spec !== 'string') return false;
  if (spec.startsWith('git+')) return true;
  if (spec.startsWith('github:')) return true;
  if (/^git@github\.com:/i.test(spec)) return true;
  if (/^https?:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?(?:#.+)?$/i.test(spec)) return true;
  return false;
}

function resolveGitPackSpec(spec, version) {
  if (!isGitSpec(spec)) {
    return spec;
  }
  if (!version || spec.includes('#')) {
    return spec;
  }
  return `${spec}#${version}`;
}

function parseGitSpec(spec, version) {
  if (!isGitSpec(spec)) {
    return null;
  }

  const resolved = resolveGitPackSpec(spec, version);
  const hashIndex = resolved.lastIndexOf('#');
  const ref = hashIndex >= 0 ? resolved.slice(hashIndex + 1) : null;
  const rawSource = hashIndex >= 0 ? resolved.slice(0, hashIndex) : resolved;

  if (rawSource.startsWith('github:')) {
    return {
      cloneUrl: `https://github.com/${rawSource.slice('github:'.length)}.git`,
      ref,
    };
  }

  if (rawSource.startsWith('git+')) {
    return {
      cloneUrl: rawSource.slice(4),
      ref,
    };
  }

  return {
    cloneUrl: rawSource,
    ref,
  };
}

function isCommitHashRef(ref) {
  return typeof ref === 'string' && /^[0-9a-f]{7,40}$/i.test(ref);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function patchWeixinGatewayMethods(channelPath, label) {
  if (!fs.existsSync(channelPath)) {
    return;
  }

  let src = fs.readFileSync(channelPath, 'utf8');
  if (!src.includes('gatewayMethods')) {
    const marker = 'configSchema: {';
    const idx = src.indexOf(marker);
    if (idx !== -1) {
      src = src.slice(0, idx) + 'gatewayMethods: ["web.login.start", "web.login.wait"],\n  ' + src.slice(idx);
      fs.writeFileSync(channelPath, src);
      log(`Patched ${label}: added gatewayMethods declaration`);
    }
  } else {
    log(`${label} already has gatewayMethods, skipping patch`);
  }
}

function patchWeixinStartupActivation(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return;
  }

  const manifest = readJsonFile(manifestPath);
  if (!manifest) {
    log('openclaw-weixin/openclaw.plugin.json could not be parsed, skipping startup activation patch');
    return;
  }

  if (manifest?.activation?.onStartup !== true) {
    manifest.activation = {
      ...(manifest.activation && typeof manifest.activation === 'object' ? manifest.activation : {}),
      onStartup: true,
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
    log('Patched openclaw-weixin/openclaw.plugin.json: enabled startup activation for QR login discovery');
  } else {
    log('openclaw-weixin/openclaw.plugin.json already has startup activation, skipping patch');
  }
}

function patchWeixinDmPolicy(processMsgPath, label) {
  if (!fs.existsSync(processMsgPath)) {
    return;
  }

  let pmSrc = fs.readFileSync(processMsgPath, 'utf8');
  const dmPolicyPatchMarker = 'chanCfg_dmPolicy_patch';
  if (!pmSrc.includes(dmPolicyPatchMarker)) {
    const oldAllowFrom = 'configuredAllowFrom: [],';
    const oldDmPolicy = 'dmPolicy: "pairing",';
    const patchedDmPolicy = `dmPolicy: (() => { /* ${dmPolicyPatchMarker} */ const _cc = (deps.config.channels)?.['openclaw-weixin'] ?? {}; return _cc.dmPolicy || 'pairing'; })(),`;
    if (pmSrc.includes(oldDmPolicy) && pmSrc.includes(oldAllowFrom)) {
      pmSrc = pmSrc.replaceAll(oldDmPolicy, patchedDmPolicy);
      pmSrc = pmSrc.replace(
        oldAllowFrom,
        `configuredAllowFrom: (() => { const _cc = (deps.config.channels)?.['openclaw-weixin'] ?? {}; return Array.isArray(_cc.allowFrom) ? _cc.allowFrom.map(String) : []; })(),`
      );
      fs.writeFileSync(processMsgPath, pmSrc);
      log(`Patched ${label}: dmPolicy/allowFrom now read from config`);
    }
  } else {
    log(`${label} dmPolicy patch already applied, skipping`);
  }
}

function patchWeixinAllowFromWildcard(processMsgPath, label) {
  if (!fs.existsSync(processMsgPath)) {
    return;
  }

  let pmSrc = fs.readFileSync(processMsgPath, 'utf8');
  const wildcardNeedle = "list.includes('*')";
  if (pmSrc.includes(wildcardNeedle)) {
    log(`${label} allowFrom wildcard patch already applied, skipping`);
    return;
  }

  const replacements = [
    {
      from: 'isSenderAllowed: (id: string, list: string[]) => list.length === 0 || list.includes(id),',
      to: "isSenderAllowed: (id: string, list: string[]) => list.length === 0 || list.includes('*') || list.includes(id),",
    },
    {
      from: 'isSenderAllowed: (id, list) => list.length === 0 || list.includes(id),',
      to: "isSenderAllowed: (id, list) => list.length === 0 || list.includes('*') || list.includes(id),",
    },
  ];

  let patched = false;
  for (const { from, to } of replacements) {
    if (pmSrc.includes(from)) {
      pmSrc = pmSrc.replaceAll(from, to);
      patched = true;
    }
  }

  if (patched) {
    fs.writeFileSync(processMsgPath, pmSrc);
    log(`Patched ${label}: allowFrom now honors wildcard entries`);
  }
}

function buildNpmPackEnv() {
  return {
    ...process.env,
    npm_config_prefer_offline: '',
    npm_config_prefer_online: '',
    NPM_CONFIG_PREFER_OFFLINE: '',
    NPM_CONFIG_PREFER_ONLINE: '',
  };
}

function buildGitEnv() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  };
}

function formatCliFailureOutput(result) {
  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  return [stdout, stderr].filter(Boolean).join('\n');
}

/**
 * Run the OpenClaw CLI with the given arguments.
 *
 * Uses the bundled runtime's openclaw.mjs entry point and sets
 * OPENCLAW_STATE_DIR to control where plugins are installed.
 */
function runOpenClawCli(args, opts = {}) {
  const openclawMjs = path.join(
    rootDir, 'vendor', 'openclaw-runtime', 'current', 'openclaw.mjs'
  );

  if (!fs.existsSync(openclawMjs)) {
    throw new Error(`OpenClaw CLI not found at ${openclawMjs}`);
  }

  const result = spawnSync(process.execPath, [openclawMjs, ...args], {
    encoding: 'utf-8',
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: opts.cwd || rootDir,
    env: { ...process.env, ...opts.env },
    timeout: opts.timeout || 5 * 60 * 1000,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    throw new Error(`openclaw ${args.join(' ')} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const output = formatCliFailureOutput(result);
    throw new Error(
      `openclaw ${args.join(' ')} exited with code ${result.status}` +
      (output ? `\n${output}` : '')
    );
  }

  return (result.stdout || '').trim();
}

/**
 * Run npm to pack a plugin into a .tgz file.
 * Returns the path to the packed .tgz.
 */
function npmPack(packSpec, registry, outputDir) {
  const isWin = process.platform === 'win32';
  const npmBin = isWin ? 'npm.cmd' : 'npm';
  const args = ['pack', packSpec, '--pack-destination', outputDir];
  if (registry) {
    args.push(`--registry=${registry}`);
  }

  const result = spawnSync(npmBin, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: outputDir,
    env: buildNpmPackEnv(),
    shell: isWin,
    timeout: 3 * 60 * 1000,
    windowsVerbatimArguments: isWin,
  });

  if (result.error) {
    throw new Error(`npm pack ${packSpec} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(
      `npm pack ${packSpec} exited with code ${result.status}` +
      (stderr ? `\n${stderr}` : '')
    );
  }

  // npm pack outputs the filename of the tarball
  const tgzName = (result.stdout || '').trim().split('\n').pop();
  return path.join(outputDir, tgzName);
}

function gitCloneAndPack(spec, version, outputDir) {
  const parsed = parseGitSpec(spec, version);
  if (!parsed) {
    throw new Error(`Unsupported git spec: ${spec}`);
  }

  const sourceDir = path.join(outputDir, 'git-source');
  const gitEnv = buildGitEnv();

  if (parsed.ref && isCommitHashRef(parsed.ref)) {
    fs.mkdirSync(sourceDir, { recursive: true });

    const initResult = spawnSync('git', ['init'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: sourceDir,
      env: gitEnv,
      timeout: 5 * 60 * 1000,
    });
    if (initResult.error) {
      throw new Error(`git init ${sourceDir} failed: ${initResult.error.message}`);
    }
    if (initResult.status !== 0) {
      const stderr = (initResult.stderr || '').trim();
      throw new Error(
        `git init ${sourceDir} exited with code ${initResult.status}` +
        (stderr ? `\n${stderr}` : '')
      );
    }

    const remoteResult = spawnSync('git', ['remote', 'add', 'origin', parsed.cloneUrl], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: sourceDir,
      env: gitEnv,
      timeout: 5 * 60 * 1000,
    });
    if (remoteResult.error) {
      throw new Error(`git remote add origin ${parsed.cloneUrl} failed: ${remoteResult.error.message}`);
    }
    if (remoteResult.status !== 0) {
      const stderr = (remoteResult.stderr || '').trim();
      throw new Error(
        `git remote add origin ${parsed.cloneUrl} exited with code ${remoteResult.status}` +
        (stderr ? `\n${stderr}` : '')
      );
    }

    const fetchResult = spawnSync('git', ['fetch', '--depth', '1', 'origin', parsed.ref], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: sourceDir,
      env: gitEnv,
      timeout: 5 * 60 * 1000,
    });
    if (fetchResult.error) {
      throw new Error(`git fetch ${parsed.cloneUrl} ${parsed.ref} failed: ${fetchResult.error.message}`);
    }
    if (fetchResult.status !== 0) {
      const stderr = (fetchResult.stderr || '').trim();
      throw new Error(
        `git fetch ${parsed.cloneUrl} ${parsed.ref} exited with code ${fetchResult.status}` +
        (stderr ? `\n${stderr}` : '')
      );
    }

    const checkoutResult = spawnSync('git', ['checkout', '--detach', 'FETCH_HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: sourceDir,
      env: gitEnv,
      timeout: 5 * 60 * 1000,
    });
    if (checkoutResult.error) {
      throw new Error(`git checkout FETCH_HEAD failed: ${checkoutResult.error.message}`);
    }
    if (checkoutResult.status !== 0) {
      const stderr = (checkoutResult.stderr || '').trim();
      throw new Error(
        `git checkout FETCH_HEAD exited with code ${checkoutResult.status}` +
        (stderr ? `\n${stderr}` : '')
      );
    }
  } else {
    const cloneArgs = ['clone', '--depth', '1'];
    if (parsed.ref) {
      cloneArgs.push('--branch', parsed.ref);
    }
    cloneArgs.push(parsed.cloneUrl, sourceDir);

    const cloneResult = spawnSync('git', cloneArgs, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: outputDir,
      env: gitEnv,
      timeout: 5 * 60 * 1000,
    });

    if (cloneResult.error) {
      throw new Error(`git clone ${parsed.cloneUrl} failed: ${cloneResult.error.message}`);
    }
    if (cloneResult.status !== 0) {
      const stderr = (cloneResult.stderr || '').trim();
      throw new Error(
        `git clone ${parsed.cloneUrl} exited with code ${cloneResult.status}` +
        (stderr ? `\n${stderr}` : '')
      );
    }
  }

  return npmPack(sourceDir, null, outputDir);
}

function resolvePluginInstallSource(plugin) {
  const { npm: npmSpec, version, registry } = plugin;

  if (registry) {
    return {
      kind: 'packed',
      packSpec: `${npmSpec}@${version}`,
      pinnedDisplaySpec: `${npmSpec}@${version}`,
      registry,
    };
  }

  if (isGitSpec(npmSpec)) {
    return {
      kind: 'git',
      gitSpec: resolveGitPackSpec(npmSpec, version),
      pinnedDisplaySpec: resolveGitPackSpec(npmSpec, version),
    };
  }

  if (isLocalPathSpec(npmSpec)) {
    return {
      kind: 'direct',
      installSpec: npmSpec,
      pinnedDisplaySpec: npmSpec,
    };
  }

  // Pack registry packages before OpenClaw installation so npm metadata and
  // plugin manifests are resolved from the pinned tarball consistently.
  return {
    kind: 'packed',
    packSpec: `${npmSpec}@${version}`,
    pinnedDisplaySpec: `${npmSpec}@${version}`,
  };
}

function isRetryablePluginInstallError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /(?:\b503\b|\b429\b|rate limit|temporarily unavailable|service unavailable|econnreset|etimedout|enotfound|eai_again|socket hang up|network error|fetch failed)/i
    .test(message);
}

function installPluginWithRetries(installSpec, stagingDir, plugin) {
  const retryCount = parsePositiveInt(process.env.OPENCLAW_PLUGIN_INSTALL_RETRIES, 3);
  const baseDelayMs = parsePositiveInt(process.env.OPENCLAW_PLUGIN_RETRY_BASE_MS, 3000);
  const maxAttempts = Math.max(1, retryCount);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      runOpenClawCli(
        ['plugins', 'install', installSpec, '--force', '--dangerously-force-unsafe-install'],
        {
          env: {
            OPENCLAW_STATE_DIR: stagingDir,
            // Prevent npm from auto-installing peerDependencies (npm v7+).
            // Channel plugins declare openclaw as a peerDep, but the host
            // gateway already provides the SDK at runtime.  Without this,
            // npm installs the full openclaw SDK + transitive deps (~738 MB)
            // into each plugin's node_modules.
            ...buildPluginInstallEnv(plugin),
          },
          stdio: 'inherit',
        }
      );
      return;
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryablePluginInstallError(error)) {
        throw error;
      }
      const delayMs = baseDelayMs * (2 ** (attempt - 1));
      log(
        `Install attempt ${attempt}/${maxAttempts} for ${plugin.id} failed with a transient error. ` +
        `Retrying in ${delayMs}ms...`
      );
      sleep(delayMs);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (process.env.OPENCLAW_SKIP_PLUGINS === '1') {
    log('Skipped (OPENCLAW_SKIP_PLUGINS=1).');
    process.exit(0);
  }

  // Read plugin declarations from package.json
  const pkg = require(path.join(rootDir, 'package.json'));
  const plugins = (pkg.openclaw && pkg.openclaw.plugins) || [];

  if (!Array.isArray(plugins) || plugins.length === 0) {
    log('No plugins declared in package.json, nothing to do.');
    process.exit(0);
  }

  // Validate plugin declarations
  for (const plugin of plugins) {
    if (!plugin.id || !plugin.npm || !plugin.version) {
      die(
        `Invalid plugin declaration: ${JSON.stringify(plugin)}. ` +
        'Each plugin must have "id", "npm", and "version" fields.'
      );
    }
  }

  const forceInstall = process.env.OPENCLAW_FORCE_PLUGIN_INSTALL === '1';
  const pluginCacheBase = path.join(rootDir, 'vendor', 'openclaw-plugins');
  const runtimeCurrentDir = path.join(rootDir, 'vendor', 'openclaw-runtime', 'current');
  // Third-party plugins go into `third-party-extensions/` — a directory the gateway's
  // bundled-channel metadata scan never touches.  When the gateway runs from
  // `gateway-bundle.mjs` (root, not dist/), `RUNNING_FROM_BUILT_ARTIFACT` is false
  // and `resolveBundledPluginScanDir` falls back to `extensions/`.  Placing our
  // plugins there caused them to fail the `bundled-channel-entry` contract check
  // and wasted ~30s on serial load failures.  `third-party-extensions/` is discovered
  // solely via `plugins.load.paths` (origin="config"), bypassing the bundled contract.
  // See openclaw/openclaw#60196.
  const runtimeExtensionsDir = path.join(runtimeCurrentDir, 'third-party-extensions');

  ensureDir(runtimeExtensionsDir);
  ensureDir(pluginCacheBase);

  log(`Processing ${plugins.length} plugin(s)...`);

  for (const plugin of plugins) {
    const { id, npm: npmSpec, version, optional } = plugin;
    const cacheDir = path.join(pluginCacheBase, id);
    const installInfoPath = path.join(cacheDir, 'plugin-install-info.json');
    const targetDir = path.join(runtimeExtensionsDir, id);

    log(`--- Plugin: ${id} (${npmSpec}@${version}) ---`);

    // Check cache
    let needsDownload = true;
    if (!forceInstall && fs.existsSync(installInfoPath)) {
      const info = readJsonFile(installInfoPath);
      if (info && info.version === version && info.npmSpec === npmSpec) {
        log(`Cache hit (version=${version}), skipping download.`);
        needsDownload = false;
      } else {
        log(`Cache version mismatch (cached=${info?.version || 'none'}, wanted=${version}).`);
      }
    }

    if (needsDownload) {
      const source = resolvePluginInstallSource(plugin);
      log(`Installing ${source.pinnedDisplaySpec} via OpenClaw CLI...`);

      // Use a temporary OPENCLAW_STATE_DIR so the CLI installs plugins
      // into a staging directory rather than the user's global config.
      const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `openclaw-plugin-staging-`));
      let installFailure = null;

      try {
        let installSpec;

        if (source.kind === 'git') {
          log('  Cloning plugin from Git source before install.');
          installSpec = gitCloneAndPack(npmSpec, version, stagingDir);
        } else if (source.kind === 'packed') {
          if (source.registry) {
            log(`  Packing from custom registry: ${source.registry}`);
          }
          installSpec = npmPack(source.packSpec, source.registry, stagingDir);
        } else {
          installSpec = source.installSpec;
        }

        if (id === BEE_PACKAGE_NAME || npmSpec === BEE_PACKAGE_NAME) {
          log('  Preparing NetEase Bee package for OpenClaw 2026.6 runtime install.');
          if (!fs.existsSync(installSpec) || fs.statSync(installSpec).isDirectory()) {
            installSpec = npmPack(`${BEE_PACKAGE_NAME}@${version}`, plugin.registry, stagingDir);
          }
          installSpec = prepareOpenClawNeteaseBeePackage(installSpec, stagingDir, { log });
        }

        if (id === NIM_PLUGIN_PACKAGE_ID) {
          log('  Preparing NIM package for OpenClaw 2026.6 runtime install.');
          installSpec = prepareOpenClawNimPackage(installSpec, stagingDir, { log });
        }

        installPluginWithRetries(installSpec, stagingDir, plugin);

        // Older OpenClaw installs to {OPENCLAW_STATE_DIR}/extensions/{pluginId}/.
        // Newer CLI builds may place npm installs under
        // {OPENCLAW_STATE_DIR}/npm/projects/<pkg>/ and link them from config.
        // Resolve both layouts by scanning for the installed plugin manifest.
        const installedDir = findInstalledPluginDir(stagingDir, plugin);
        if (!installedDir?.pluginDir) {
          throw new Error(`No plugin found in staging directory after install`);
        }
        if (!hasPluginShape(installedDir.pluginDir)) {
          throw new Error(`Installed plugin directory ${path.basename(installedDir.pluginDir)} has no plugin manifest`);
        }

        // Replace cache dir with new content
        if (fs.existsSync(cacheDir)) {
          fs.rmSync(cacheDir, { recursive: true, force: true });
        }
        ensureDir(path.dirname(cacheDir));
        copyDirRecursive(installedDir.pluginDir, cacheDir);
        if (installedDir.installProjectDir) {
          const installProjectNodeModulesDir = path.join(installedDir.installProjectDir, 'node_modules');
          mergeDirectoryContentsExcluding(
            installProjectNodeModulesDir,
            path.join(cacheDir, 'node_modules'),
            [path.join(installProjectNodeModulesDir, 'openclaw')]
          );
          const dependencyPath = packageNameToNodeModulesPath(npmSpec);
          if (dependencyPath) {
            fs.rmSync(path.join(cacheDir, dependencyPath), { recursive: true, force: true });
          }
        }
        fixBinSymlinks(cacheDir);

        // Write install info for cache validation
        fs.writeFileSync(
          installInfoPath,
          JSON.stringify(
            {
              pluginId: id,
              npmSpec,
              version,
              installedAt: new Date().toISOString(),
            },
            null,
            2
          ) + '\n',
          'utf-8'
        );

        log(`Downloaded and cached ${id}@${version}.`);
      } catch (err) {
        if (optional) {
          log(`WARNING: Failed to install optional plugin ${id}: ${getErrorMessage(err)}`);
          log(`Skipping ${id} — it may not be available from this network.`);
          continue;
        }
        installFailure = err;
      } finally {
        // Clean up staging directory
        try {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }

      if (installFailure !== null) {
        die(`Failed to install plugin ${id}: ${getErrorMessage(installFailure)}`);
      }
    }

    // Copy from cache to runtime extensions directory
    if (!fs.existsSync(cacheDir)) {
      if (optional) {
        log(`Skipping ${id} — cache not available (optional plugin).`);
        continue;
      }
      die(`Plugin cache directory missing after install: ${cacheDir}`);
    }

    // Remove existing target and copy fresh
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    copyDirRecursive(cacheDir, targetDir);

    // Remove the plugin-install-info.json from the target (it's cache metadata only)
    const targetInfoPath = path.join(targetDir, 'plugin-install-info.json');
    if (fs.existsSync(targetInfoPath)) {
      fs.unlinkSync(targetInfoPath);
    }

    log(`Installed ${id} -> ${path.relative(rootDir, targetDir)}`);
  }

  log(`All ${plugins.length} plugin(s) installed successfully.`);

  applyOpenClawPluginPatches({ runtimeExtensionsDir, log });
}

if (require.main === module) {
  main();
}

module.exports = {
  buildPluginInstallEnv,
  buildNpmPackEnv,
  buildGitEnv,
  copyDirRecursive,
  findInstalledPluginDir,
  gitCloneAndPack,
  isGitSpec,
  isLocalPathSpec,
  main,
  mergeDirectoryContentsExcluding,
  mergeDirectoryContents,
  npmPack,
  packageNameToNodeModulesPath,
  parseGitSpec,
  resolveGitPackSpec,
  resolvePluginInstallSource,
};
