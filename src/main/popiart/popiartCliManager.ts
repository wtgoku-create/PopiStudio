/**
 * popiartCliManager.ts
 *
 * 管理 PopiArt CLI 路径解析、环境构造和命令执行。
 *
 * CLI 路径解析顺序：
 * 1. POPIART_CLI_PATH 环境变量（用于开发调试）
 * 2. 打包应用内的内置二进制（app.isPackaged）
 * 3. 系统 PATH 中的 popiart / popiart.exe
 *
 * 关键设计决策：
 * - API endpoint (POPIART_ENDPOINT) 与 MCP server transport 是分离的。
 *   MCP server 以 stdio 模式运行；endpoint 只传给 CLI 的参数和环境变量。
 * - 配置目录 (POPIART_CONFIG_DIR) 隔离在 Electron userData 下，
 *   避免污染用户本地的 ~/.popiart，并支持干净的卸载和迁移。
 * - 登录后 CLI 自己将 auth token 写入 POPIART_CONFIG_DIR/config.json；
 *   LobsterAI 不存储也不处理原始 API key。
 */

import { spawn } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { PopiArtMcp } from '../../shared/popiart/constants';

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

/**
 * 返回 popiartcli 存储配置（auth token 等）的目录。
 * 放在 Electron userData 下，与用户本地的 ~/.popiart 隔离。
 */
export function resolvePopiArtConfigDir(): string {
  return path.join(app.getPath('userData'), 'popiart');
}

/**
 * 清理 PopiArt CLI 在本地 userData 下的登录配置。
 *
 * 用户退出 LobsterAI 登录后，PopiArt 也必须同步退出，
 * 因此需要删除 popiartcli 写入的本地 token 配置文件。
 */
export function clearPopiArtConfig(): void {
  const configDir = resolvePopiArtConfigDir();
  const configFile = path.join(configDir, 'config.json');

  try {
    if (fs.existsSync(configFile)) {
      fs.rmSync(configFile, { force: true });
    }
  } catch {
    // 配置清理失败时不抛错，避免影响主登出流程。
  }
}

/**
 * 解析 popiart CLI 二进制文件的路径。
 *
 * 解析顺序：
 * 1. POPIART_CLI_PATH 环境变量 — 允许开发/调试时覆盖，无需重新打包
 * 2. process.resourcesPath 下的打包二进制 — 随 LobsterAI 发行版打包
 * 3. 'popiart' / 'popiart.exe' — 最后回退到 PATH
 */
export function resolvePopiArtCliPath(): string {
  // 开发/调试覆盖
  if (process.env.POPIART_CLI_PATH?.trim()) {
    return process.env.POPIART_CLI_PATH.trim();
  }

  // 打包应用：从 LobsterAI 资源目录中获取
  if (app.isPackaged) {
    const exe = process.platform === 'win32' ? 'popiart.exe' : 'popiart';
    return path.join(process.resourcesPath, 'bin', 'popiart', process.platform, process.arch, exe);
  }

  // 最后手段：依赖 PATH
  return process.platform === 'win32' ? 'popiart.exe' : 'popiart';
}

/**
 * 返回可加入 PATH 的 PopiArt CLI 目录。
 * 当 CLI 解析结果只是裸命令名时，返回 null，表示仍依赖系统 PATH。
 */
export function resolvePopiArtCliDir(): string | null {
  const cliPath = resolvePopiArtCliPath();
  if (!cliPath || cliPath === 'popiart' || cliPath === 'popiart.exe') {
    return null;
  }
  return path.dirname(cliPath);
}

/**
 * 构建传递给 popiart 子进程的环境变量对象。
 * 确保 POPIART_CONFIG_DIR 存在，并设置配置目录和 endpoint。
 *
 * @param extra - 可选的额外环境变量（例如 POPIART_ENDPOINT 覆盖）
 */
export function buildPopiArtEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const configDir = resolvePopiArtConfigDir();
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  return {
    ...process.env,
    POPIART_CONFIG_DIR: configDir,
    POPIART_ENDPOINT: PopiArtMcp.Endpoint,
    ...(extra || {}),
  };
}

/**
 * 检查 popiart CLI 二进制文件是否存在于解析后的路径。
 * 如果路径只是二进制名称（无目录分隔符），则假定它在 PATH 中并返回 true。
 */
export function popiArtCliExists(cliPath = resolvePopiArtCliPath()): boolean {
  // 仅有二进制名称（无路径分隔符），假定在 PATH 上
  if (!cliPath || cliPath === 'popiart' || cliPath === 'popiart.exe') return true;
  return fs.existsSync(cliPath);
}

/**
 * 解析 CLI 输出的结构化结果类型。
 *
 * PopiArt CLI 命令发出两种 JSON 格式：
 * - 成功：{ "data": { ... } }
 * - 失败：{ "error": { "code": "...", "message": "..." } }
 *
 * 此类型同时捕获两者，以及用于调试的原始 stdout/stderr。
 */
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
 * 执行 popiart CLI 命令，带结构化错误处理。
 *
 * @param args - CLI 子命令参数（例如 ['auth', 'login', '--key', key]）
 * @param options.endpoint - 覆盖 API endpoint（默认为 PopiArtMcp.Endpoint）
 * @param options.env - 传递给子进程的额外环境变量
 * @param options.timeoutMs - 命令超时毫秒数（默认 60s）
 *
 * @note endpoint 通过 --endpoint 参数传递给 CLI，而不是环境变量，
 *       因为 popiartcli 从 CLI 参数读取 endpoint，而非 POPIART_ENDPOINT 环境变量。
 *       此处 buildPopiArtEnv 中设置的 POPIART_ENDPOINT 是为 CLI 读取环境变量的场景准备的。
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
  const endpoint = options.endpoint?.trim() || PopiArtMcp.Endpoint;
  // 所有 args 前面加 --endpoint 以满足 CLI 的 endpoint 要求
  const finalArgs = ['--endpoint', endpoint, ...args];

  const env = buildPopiArtEnv({
    POPIART_ENDPOINT: endpoint,
    ...options.env,
  });

  return new Promise((resolve) => {
    const child = spawn(cliPath, finalArgs, {
      env,
      windowsHide: true,
      // stdin: ignore（无需交互式输入）
      // stdout/stderr: 捕获为 pipe 用于解析 JSON
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

    // 超时保护：超时后 kill 进程并返回错误
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

    // Spawn 失败（例如二进制未找到、权限拒绝）
    child.on('error', (error) => {
      finish({
        ok: false,
        error: { code: 'CLI_ERROR', message: error.message },
        rawStdout: stdout,
        rawStderr: stderr,
      });
    });

    // 进程退出：从 stdout 解析 JSON 得到结构化结果
    child.on('close', (code) => {
      const trimmed = stdout.trim();
      let parsed: unknown = undefined;
      if (trimmed) {
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          // 不是 JSON — 降级到原始输出处理
          parsed = undefined;
        }
      }

      // 非零退出码：尝试从 JSON 响应体中提取 error
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

      // 成功：从 "data" 字段提取数据；否则将解析后的对象作为 data
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
