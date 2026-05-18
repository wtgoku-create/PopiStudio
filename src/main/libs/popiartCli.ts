import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const BUNDLE_DIR = 'popiart-cli';

function runtimeSubdir(): string {
  if (process.platform === 'win32') {
    return process.arch === 'arm64' ? 'win-arm64' : 'win-amd64';
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-amd64';
  }
  if (process.platform === 'linux') {
    return process.arch === 'arm64' ? 'linux-arm64' : 'linux-amd64';
  }
  return '';
}

/**
 * Root directory containing per-platform subdirs (e.g. win-amd64/popiart.exe).
 */
export function getBundledPopiartRoot(): string | null {
  if (app.isPackaged) {
    const resourcesRoot = path.join(process.resourcesPath, BUNDLE_DIR);
    if (fs.existsSync(resourcesRoot) && fs.statSync(resourcesRoot).isDirectory()) {
      return resourcesRoot;
    }
    return null;
  }

  const candidates = [
    path.join(__dirname, '..', '..', 'resources', BUNDLE_DIR),
    path.resolve(process.cwd(), 'resources', BUNDLE_DIR),
    path.join(app.getAppPath(), 'resources', BUNDLE_DIR),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // continue
    }
  }
  return null;
}

/**
 * Absolute path to the bundled `popiart` executable for this OS/arch, or null if missing.
 */
export function getPopiartCliPath(): string | null {
  const root = getBundledPopiartRoot();
  const sub = runtimeSubdir();
  if (!root || !sub) {
    return null;
  }
  const exeName = process.platform === 'win32' ? 'popiart.exe' : 'popiart';
  const candidate = path.join(root, sub, exeName);
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return null;
}

/**
 * Prepends the directory containing the bundled `popiart` binary to PATH so
 * shells and tools can run `popiart` / `popiart.exe` without referencing POPIART_CLI.
 * On Windows, sets both PATH and Path so spawn inherits the correct lookup.
 */
function prependPopiartBinDirToPath(env: Record<string, string | undefined>, cliPath: string): void {
  const binDir = path.resolve(path.dirname(cliPath));
  const cur = (env.PATH ?? env.Path ?? process.env.PATH ?? process.env.Path ?? '') as string;
  const sep = path.delimiter;
  const segments = cur.split(sep).map((s) => s.trim()).filter(Boolean);
  const norm = (p: string) => path.resolve(p).toLowerCase();
  const want = norm(binDir);
  const rest = segments.filter((s) => norm(s) !== want);
  const next = [binDir, ...rest].join(sep);
  env.PATH = next;
  if (process.platform === 'win32') {
    env.Path = next;
  }
}

/**
 * Injects `POPIART_CLI` and prepends its directory to PATH when the bundled binary exists.
 */
export function appendPopiartCliToEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const cli = getPopiartCliPath();
  if (cli) {
    env.POPIART_CLI = cli;
    prependPopiartBinDirToPath(env, cli);
  }
  return env;
}

export async function logoutPopiartCli(): Promise<void> {
  const cli = getPopiartCliPath();
  if (!cli) {
    return;
  }

  const env = appendPopiartCliToEnv({ ...process.env });
  await new Promise<void>((resolve) => {
    const child = spawn(
      cli,
      ['auth', 'logout', '--output', 'json', '--quiet', '--non-interactive'],
      {
        env: env as NodeJS.ProcessEnv,
        stdio: 'ignore',
        windowsHide: true,
      },
    );

    child.on('error', (error) => {
      console.warn('[PopiartCli] logout command failed to start:', error);
      resolve();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.warn(`[PopiartCli] logout command exited with code ${code ?? 'null'}`);
      }
      resolve();
    });
  });
}
