/**
 * Manages PopiArt CLI path resolution, environment construction, and command execution.
 *
 * CLI path resolution order:
 * 1. `POPIART_CLI_PATH` environment variable for local development overrides
 * 2. Bundled binary inside the packaged app resources
 * 3. Pre-fetched repo-local binary under `vendor/popiart-cli/` in development
 * 4. System `PATH` fallback (`popiart` / `popiart.exe`)
 */

import { spawn } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { getServerApiBaseUrl } from '../libs/endpoints';

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

function resolveBundledPopiArtCliPath(baseDir: string): string {
  const exe = process.platform === 'win32' ? 'popiart.exe' : 'popiart';
  return path.join(baseDir, 'bin', 'popiart', process.platform, process.arch, exe);
}

function resolveVendorPopiArtCliPath(): string {
  const targetPlatform = process.platform === 'darwin'
    ? 'mac'
    : process.platform === 'win32'
      ? 'win'
      : process.platform;
  const targetId = `${targetPlatform}-${process.arch}`;
  const exe = process.platform === 'win32' ? 'popiart.exe' : 'popiart';
  return path.join(process.cwd(), 'vendor', 'popiart-cli', targetId, process.platform, process.arch, exe);
}

/**
 * Returns the PopiArt CLI config directory used to store auth tokens and local state.
 * It lives under Electron `userData` so app state stays isolated from `~/.popiart`.
 */
export function resolvePopiArtConfigDir(): string {
  return path.join(app.getPath('userData'), 'popiart');
}

/**
 * Clears persisted PopiArt CLI auth state from local app storage.
 */
export function clearPopiArtConfig(): void {
  const configDir = resolvePopiArtConfigDir();
  const configFile = path.join(configDir, 'config.json');

  try {
    if (fs.existsSync(configFile)) {
      fs.rmSync(configFile, { force: true });
    }
  } catch {
    // Ignore cleanup failures so logout flow stays resilient.
  }
}

/**
 * Resolves the PopiArt CLI executable path.
 */
export function resolvePopiArtCliPath(): string {
  if (process.env.POPIART_CLI_PATH?.trim()) {
    return process.env.POPIART_CLI_PATH.trim();
  }

  if (app.isPackaged) {
    return resolveBundledPopiArtCliPath(process.resourcesPath);
  }

  const vendorCliPath = resolveVendorPopiArtCliPath();
  if (fs.existsSync(vendorCliPath)) {
    return vendorCliPath;
  }

  return process.platform === 'win32' ? 'popiart.exe' : 'popiart';
}

/**
 * Returns the directory containing the resolved CLI binary when available.
 * Returns `null` when resolution falls back to PATH.
 */
export function resolvePopiArtCliDir(): string | null {
  const cliPath = resolvePopiArtCliPath();
  if (!cliPath || cliPath === 'popiart' || cliPath === 'popiart.exe') {
    return null;
  }
  return path.dirname(cliPath);
}

/**
 * Builds the environment object used for PopiArt CLI subprocesses.
 */
export function buildPopiArtEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const configDir = resolvePopiArtConfigDir();
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  return {
    ...process.env,
    POPIART_CONFIG_DIR: configDir,
    POPIART_ENDPOINT: getServerApiBaseUrl(),
    ...(extra || {}),
  };
}

/**
 * Checks whether the resolved PopiArt CLI exists.
 * When resolution falls back to a bare executable name, this assumes PATH lookup.
 */
export function popiArtCliExists(cliPath = resolvePopiArtCliPath()): boolean {
  if (!cliPath || cliPath === 'popiart' || cliPath === 'popiart.exe') {
    return true;
  }
  return fs.existsSync(cliPath);
}

export interface PopiArtCommandResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  rawStdout?: string;
  rawStderr?: string;
}

/**
 * Executes a PopiArt CLI command with structured error handling.
 */
export async function runPopiArtCli<T = unknown>(
  args: string[],
  options: {
    endpoint?: string;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
  } = {},
): Promise<PopiArtCommandResult<T>> {
  const cliPath = resolvePopiArtCliPath();
  const endpoint = options.endpoint?.trim() || getServerApiBaseUrl();
  const finalArgs = ['--endpoint', endpoint, ...args];

  const env = buildPopiArtEnv({
    POPIART_ENDPOINT: endpoint,
    ...options.env,
  });

  return new Promise((resolve) => {
    const child = spawn(cliPath, finalArgs, {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: PopiArtCommandResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        error: {
          code: 'TIMEOUT',
          message: `PopiArt command timed out after ${options.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS}ms.`,
        },
        rawStdout: stdout,
        rawStderr: stderr,
      });
    }, options.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      finish({
        ok: false,
        error: { code: 'CLI_ERROR', message: error.message },
        rawStdout: stdout,
        rawStderr: stderr,
      });
    });

    child.on('close', (code) => {
      const trimmed = stdout.trim();
      let parsed: unknown = undefined;

      if (trimmed) {
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          parsed = undefined;
        }
      }

      if (code !== 0) {
        const parsedError = parsed && typeof parsed === 'object' && 'error' in parsed
          ? (parsed as { error?: PopiArtCommandResult['error'] }).error
          : undefined;
        finish({
          ok: false,
          error: parsedError || {
            code: 'CLI_ERROR',
            message: stderr.trim() || stdout.trim() || `PopiArt exited with code ${code ?? 'unknown'}.`,
          },
          rawStdout: stdout,
          rawStderr: stderr,
        });
        return;
      }

      const data = parsed && typeof parsed === 'object' && 'data' in parsed
        ? (parsed as { data?: T }).data
        : parsed as T | undefined;

      finish({
        ok: true,
        data,
        rawStdout: stdout,
        rawStderr: stderr,
      });
    });
  });
}
