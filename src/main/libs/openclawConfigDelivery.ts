import { OpenClawEnginePhase } from '../../shared/openclawEngine/constants';

export const OpenClawConfigDeliveryMode = {
  Rpc: 'rpc',
  Skipped: 'skipped',
  Fallback: 'fallback',
} as const;
export type OpenClawConfigDeliveryMode =
  typeof OpenClawConfigDeliveryMode[keyof typeof OpenClawConfigDeliveryMode];

const OpenClawConfigRpcMethod = {
  Get: 'config.get',
  Set: 'config.set',
} as const;

export type OpenClawConfigRpcClient = {
  request: <T = Record<string, unknown>>(
    method: string,
    params?: unknown,
    opts?: { expectFinal?: boolean; timeoutMs?: number | null },
  ) => Promise<T>;
};

export type OpenClawConfigDeliveryInput = {
  reason: string;
  gatewayPhase: OpenClawEnginePhase;
  readConfigFile: () => string;
  ensureRpcClient: () => Promise<OpenClawConfigRpcClient | null>;
  scheduleDeferredRestart: (reason: string) => void;
  nowMs?: () => number;
};

export type OpenClawConfigDeliveryResult = {
  mode: OpenClawConfigDeliveryMode;
  detail: string;
  restartScheduled: boolean;
  elapsedMs: number;
};

const CONFIG_GET_TIMEOUT_MS = 10_000;
const CONFIG_SET_TIMEOUT_MS = 15_000;
const FALLBACK_RESTART_MIN_INTERVAL_MS = 10 * 60 * 1000;

let lastFallbackRestartAtMs = 0;

export function __resetOpenClawConfigDeliveryStateForTests(): void {
  lastFallbackRestartAtMs = 0;
}

const isBaseHashConflict = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /base hash|changed since last load/i.test(message);
};

const describeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 200);
};

async function requestConfigSet(
  client: OpenClawConfigRpcClient,
  raw: string,
): Promise<void> {
  const snapshot = await client.request<{ hash?: unknown }>(
    OpenClawConfigRpcMethod.Get,
    {},
    { timeoutMs: CONFIG_GET_TIMEOUT_MS },
  );
  const baseHash = typeof snapshot?.hash === 'string' && snapshot.hash.trim()
    ? snapshot.hash.trim()
    : undefined;
  await client.request(
    OpenClawConfigRpcMethod.Set,
    { raw, ...(baseHash ? { baseHash } : {}) },
    { timeoutMs: CONFIG_SET_TIMEOUT_MS },
  );
}

export async function deliverOpenClawConfigToGateway(
  input: OpenClawConfigDeliveryInput,
): Promise<OpenClawConfigDeliveryResult> {
  const now = input.nowMs ?? Date.now;
  const startedAtMs = now();
  const finish = (
    mode: OpenClawConfigDeliveryMode,
    detail: string,
    restartScheduled = false,
  ): OpenClawConfigDeliveryResult => {
    const result: OpenClawConfigDeliveryResult = {
      mode,
      detail,
      restartScheduled,
      elapsedMs: now() - startedAtMs,
    };
    const log = mode === OpenClawConfigDeliveryMode.Fallback ? console.warn : console.log;
    log(
      `[ConfigDelivery] delivery finished with mode ${result.mode} for ${input.reason}: ${result.detail};`
      + ` restart scheduled=${result.restartScheduled}; elapsed=${result.elapsedMs}ms`,
    );
    return result;
  };

  const fallback = (detail: string): OpenClawConfigDeliveryResult => {
    const sinceLast = now() - lastFallbackRestartAtMs;
    if (sinceLast < FALLBACK_RESTART_MIN_INTERVAL_MS) {
      return finish(
        OpenClawConfigDeliveryMode.Fallback,
        `${detail}; restart rate-limited (${Math.round(sinceLast / 1000)}s since last)`,
      );
    }
    lastFallbackRestartAtMs = now();
    input.scheduleDeferredRestart(`config-delivery-fallback:${input.reason}`);
    return finish(OpenClawConfigDeliveryMode.Fallback, detail, true);
  };

  if (
    input.gatewayPhase !== OpenClawEnginePhase.Running
    && input.gatewayPhase !== OpenClawEnginePhase.Starting
  ) {
    return finish(
      OpenClawConfigDeliveryMode.Skipped,
      `gateway not running (phase=${input.gatewayPhase}); config loads at next start`,
    );
  }

  let raw: string;
  try {
    raw = input.readConfigFile();
  } catch (error) {
    return fallback(`config file read failed: ${describeError(error)}`);
  }
  if (!raw.trim()) {
    return fallback('config file is empty');
  }

  let client: OpenClawConfigRpcClient | null = null;
  try {
    client = await input.ensureRpcClient();
  } catch (error) {
    return fallback(`gateway client unavailable: ${describeError(error)}`);
  }
  if (!client) {
    return fallback('gateway client unavailable');
  }

  try {
    await requestConfigSet(client, raw);
    return finish(OpenClawConfigDeliveryMode.Rpc, 'config.set acked');
  } catch (error) {
    if (!isBaseHashConflict(error)) {
      return fallback(`config.set failed: ${describeError(error)}`);
    }
    try {
      await requestConfigSet(client, raw);
      return finish(OpenClawConfigDeliveryMode.Rpc, 'config.set acked after hash retry');
    } catch (retryError) {
      return fallback(`config.set retry failed: ${describeError(retryError)}`);
    }
  }
}
