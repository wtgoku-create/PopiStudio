import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const BUNDLE_DIR = 'popiart-cli';

/** Default PopiArt creator API (see popiartcli README). */
export const POPIART_SERVER_ENDPOINT = 'https://server.popi.art/v1';

const LOGIN_TIMEOUT_MS = 120_000;

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

function ensurePopiartHomeEnv(env: Record<string, string | undefined>): void {
  if (!env.HOME) {
    env.HOME = app.getPath('home');
  }
  if (process.platform === 'win32' && !env.USERPROFILE) {
    env.USERPROFILE = env.HOME;
  }
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
  ensurePopiartHomeEnv(env);
  return env;
}

type PopiartCliJson = { ok?: boolean; error?: { message?: string; code?: string } };

function parsePopiartJson(stdout: string): PopiartCliJson | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as PopiartCliJson;
  } catch {
    const lastLine = trimmed.split(/\r?\n/).filter(Boolean).pop();
    if (!lastLine) {
      return null;
    }
    try {
      return JSON.parse(lastLine) as PopiartCliJson;
    } catch {
      return null;
    }
  }
}

function runPopiartCli(
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const cli = getPopiartCliPath();
  if (!cli) {
    return Promise.resolve({ exitCode: null, stdout: '', stderr: 'Bundled popiart CLI not found' });
  }

  const env = appendPopiartCliToEnv({ ...process.env });
  delete env.POPIART_KEY;
  delete env.POPIART_TOKEN;

  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;

  return new Promise((resolve) => {
    const child = spawn(cli, args, {
      env: env as NodeJS.ProcessEnv,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      stderr = `${stderr}\n[PopiartCli] command timed out after ${timeoutMs}ms`.trim();
      finish(null);
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      stderr = `${stderr}\n${error.message}`.trim();
      finish(null);
    });

    child.on('close', (code) => {
      finish(code);
    });
  });
}

/**
 * Run `popiart auth login` with the PopiStudio gateway product key so ~/.popiart/config.json
 * holds a sess_* bearer for server.popi.art (per popiartcli README).
 */
export async function loginPopiartCli(productKey: string): Promise<{ ok: boolean; error?: string }> {
  const key = productKey.trim();
  if (!key) {
    return { ok: false, error: 'Empty product key' };
  }

  const args = [
    '--endpoint',
    POPIART_SERVER_ENDPOINT,
    'auth',
    'login',
    '--key',
    key,
    '--output',
    'json',
    '--quiet',
    '--non-interactive',
  ];

  const { exitCode, stdout, stderr } = await runPopiartCli(args);
  const parsed = parsePopiartJson(stdout);

  if (exitCode === 0 && parsed?.ok !== false) {
    console.log('[PopiartCli] auth login succeeded');
    return { ok: true };
  }

  const message = parsed?.error?.message
    || stderr.trim()
    || stdout.trim()
    || `popiart auth login failed (exit ${exitCode ?? 'unknown'})`;
  console.warn('[PopiartCli] auth login failed:', message);
  return { ok: false, error: message };
}

export async function logoutPopiartCli(): Promise<void> {
  const cli = getPopiartCliPath();
  if (!cli) {
    return;
  }

  const args = [
    '--endpoint',
    POPIART_SERVER_ENDPOINT,
    'auth',
    'logout',
    '--output',
    'json',
    '--quiet',
    '--non-interactive',
  ];

  const { exitCode, stderr } = await runPopiartCli(args, { timeoutMs: 30_000 });
  if (exitCode !== 0) {
    console.warn(`[PopiartCli] auth logout exited with code ${exitCode ?? 'null'}`, stderr || undefined);
  } else {
    console.log('[PopiartCli] auth logout succeeded');
  }
}
