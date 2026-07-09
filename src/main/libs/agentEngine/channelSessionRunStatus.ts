import type { CoworkSessionStatus } from '../../coworkStore';

/**
 * Decides the next local status for a channel-synced session from a gateway
 * `sessions.list` row.
 *
 * `hasActiveRun` is authoritative when present. The row `status` can linger as
 * "running" on conversation entries after cron deliveries mirror into them, so
 * stale running only counts when the live flag is unavailable.
 */
export function resolveChannelSessionNextStatus(input: {
  hasActiveRun: boolean | null;
  rawStatus: string;
  currentStatus: CoworkSessionStatus;
}): CoworkSessionStatus | null {
  const { hasActiveRun, rawStatus, currentStatus } = input;

  if (hasActiveRun === true) return 'running';
  if (
    rawStatus === 'failed' ||
    rawStatus === 'killed' ||
    rawStatus === 'timeout' ||
    rawStatus === 'error'
  ) {
    return 'error';
  }
  if (rawStatus === 'done' || rawStatus === 'completed') return 'completed';
  if (hasActiveRun === false) {
    return currentStatus === 'running' ? 'completed' : null;
  }
  return rawStatus === 'running' ? 'running' : null;
}
