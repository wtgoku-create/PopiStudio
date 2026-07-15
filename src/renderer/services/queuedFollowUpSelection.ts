import type { CoworkPendingSteer } from '../../shared/cowork/steer';

export const selectQueuedFollowUp = (
  pendingSteers: readonly CoworkPendingSteer[],
  requestedSteerId?: string,
): CoworkPendingSteer | undefined => {
  if (requestedSteerId) {
    return pendingSteers.find(steer => steer.id === requestedSteerId);
  }
  return pendingSteers[0];
};
