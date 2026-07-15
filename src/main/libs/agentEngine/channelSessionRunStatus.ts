import type { CoworkSessionStatus } from '../../coworkStore';

/**
 * Decides the next local status for a channel-synced session from a gateway
 * `sessions.list` row.
 *
 * The row `status` is the strongest live signal for IM sessions. Some gateway
 * rows report `status="running"` while `hasActiveRun` is still false, so a raw
 * running status must still move the local session into running.
 */
export function resolveChannelSessionNextStatus(input: {
  hasActiveRun: boolean | null;
  rawStatus: string;
  currentStatus: CoworkSessionStatus;
}): CoworkSessionStatus | null {
  const { hasActiveRun, rawStatus, currentStatus } = input;

  if (hasActiveRun === true) return 'running';
  if (rawStatus === 'running' || rawStatus === 'processing') return 'running';
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
  return null;
}
