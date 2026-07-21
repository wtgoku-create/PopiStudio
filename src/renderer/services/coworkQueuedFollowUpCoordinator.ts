import {
  type CoworkPendingSteer,
  CoworkSteerRejectReason,
  CoworkSteerStatus,
} from '../../shared/cowork/steer';
import type { AppDispatch, RootState } from '../store';
import {
  removePendingSteer,
  updateSteerStatus,
} from '../store/slices/coworkSlice';
import type { CoworkContinueOptions, CoworkSessionStatus } from '../types/cowork';
import { CoworkSessionStatusValue } from '../types/cowork';
import { i18nService } from './i18n';
import { selectQueuedFollowUp } from './queuedFollowUpSelection';

export const CoworkQueuedFollowUpTrigger = {
  Completed: 'completed',
  Interrupted: 'interrupted',
  IdleClick: 'idle_click',
} as const;
export type CoworkQueuedFollowUpTrigger =
  typeof CoworkQueuedFollowUpTrigger[keyof typeof CoworkQueuedFollowUpTrigger];

interface CoworkQueuedFollowUpCoordinatorDependencies {
  getState: () => RootState;
  dispatch: AppDispatch;
  continueSession: (options: CoworkContinueOptions) => Promise<boolean>;
  stopSession: (sessionId: string) => Promise<boolean>;
  log: (level: 'debug' | 'warn' | 'error', message: string, error?: unknown) => void;
}

interface QueuedFollowUpOperation {
  steerId: string;
  cancelled: boolean;
}

export class CoworkQueuedFollowUpCoordinator {
  private readonly inFlightBySessionId = new Map<string, QueuedFollowUpOperation>();
  private readonly startingQueuedTurnSessionIds = new Set<string>();
  private readonly interruptingBySessionId = new Map<string, QueuedFollowUpOperation>();

  constructor(private readonly dependencies: CoworkQueuedFollowUpCoordinatorDependencies) {}

  handleSessionRunning(sessionId: string): void {
    this.startingQueuedTurnSessionIds.delete(sessionId);
  }

  handleSessionCompleted(sessionId: string): void {
    if (this.interruptingBySessionId.has(sessionId)) return;
    if (this.startingQueuedTurnSessionIds.has(sessionId)) return;
    void this.submit(sessionId, undefined, CoworkQueuedFollowUpTrigger.Completed);
  }

  handleSessionError(sessionId: string): void {
    this.startingQueuedTurnSessionIds.delete(sessionId);
  }

  handleSessionIdle(sessionId: string): void {
    this.startingQueuedTurnSessionIds.delete(sessionId);
  }

  clearSession(sessionId: string): void {
    const inFlight = this.inFlightBySessionId.get(sessionId);
    if (inFlight) inFlight.cancelled = true;
    const interrupting = this.interruptingBySessionId.get(sessionId);
    if (interrupting) interrupting.cancelled = true;
    this.inFlightBySessionId.delete(sessionId);
    this.startingQueuedTurnSessionIds.delete(sessionId);
    this.interruptingBySessionId.delete(sessionId);
  }

  submitSelected(sessionId: string, steerId: string): Promise<boolean> {
    if (this.getSessionStatus(sessionId) === CoworkSessionStatusValue.Running) {
      return this.interruptAndSubmit(sessionId, steerId);
    }
    return this.submit(sessionId, steerId, CoworkQueuedFollowUpTrigger.IdleClick);
  }

  async interruptAndSubmit(sessionId: string, steerId: string): Promise<boolean> {
    const sessionStatus = this.getSessionStatus(sessionId);
    if (sessionStatus && sessionStatus !== CoworkSessionStatusValue.Running) {
      return this.submit(sessionId, steerId, CoworkQueuedFollowUpTrigger.IdleClick);
    }
    if (this.interruptingBySessionId.has(sessionId) || this.inFlightBySessionId.has(sessionId)) {
      return false;
    }

    const queuedSteer = selectQueuedFollowUp(
      this.dependencies.getState().cowork.pendingSteers[sessionId] ?? [],
      steerId,
    );
    if (!queuedSteer) {
      this.dependencies.log(
        'warn',
        `ignored queued follow-up interrupt because the item is missing; session=${sessionId}; id=${steerId}.`,
      );
      return false;
    }

    const operation: QueuedFollowUpOperation = { steerId, cancelled: false };
    this.interruptingBySessionId.set(sessionId, operation);
    try {
      const stopped = await this.dependencies.stopSession(sessionId);
      if (!stopped || operation.cancelled) return false;
      return await this.submit(sessionId, steerId, CoworkQueuedFollowUpTrigger.Interrupted);
    } catch (error) {
      this.dependencies.log(
        'error',
        `failed to interrupt the active turn for a queued follow-up; session=${sessionId}; id=${steerId}.`,
        error,
      );
      return false;
    } finally {
      if (this.interruptingBySessionId.get(sessionId) === operation) {
        this.interruptingBySessionId.delete(sessionId);
      }
    }
  }

  private async submit(
    sessionId: string,
    requestedSteerId: string | undefined,
    trigger: CoworkQueuedFollowUpTrigger,
  ): Promise<boolean> {
    if (this.inFlightBySessionId.has(sessionId)) return false;

    const queuedSteer = selectQueuedFollowUp(
      this.dependencies.getState().cowork.pendingSteers[sessionId] ?? [],
      requestedSteerId,
    );
    if (!queuedSteer) return false;

    const operation: QueuedFollowUpOperation = {
      steerId: queuedSteer.id,
      cancelled: false,
    };
    this.inFlightBySessionId.set(sessionId, operation);

    try {
      const stillQueued = selectQueuedFollowUp(
        this.dependencies.getState().cowork.pendingSteers[sessionId] ?? [],
        queuedSteer.id,
      );
      if (!stillQueued) return false;

      this.startingQueuedTurnSessionIds.add(sessionId);
      const sent = await this.dependencies.continueSession({
        sessionId,
        prompt: this.buildPrompt(queuedSteer),
        browserAnnotations: queuedSteer.browserAnnotations,
      });
      if (operation.cancelled) {
        this.startingQueuedTurnSessionIds.delete(sessionId);
        return false;
      }
      if (!sent) {
        this.startingQueuedTurnSessionIds.delete(sessionId);
        this.dependencies.dispatch(updateSteerStatus({
          sessionId,
          steerId: queuedSteer.id,
          status: CoworkSteerStatus.Rejected,
          error: i18nService.t('coworkSteerRejected'),
          reason: CoworkSteerRejectReason.RuntimeRejected,
        }));
        return false;
      }

      this.dependencies.dispatch(removePendingSteer({ sessionId, steerId: queuedSteer.id }));
      this.dependencies.log(
        'debug',
        `submitted queued follow-up; session=${sessionId}; id=${queuedSteer.id}; trigger=${trigger}.`,
      );
      return true;
    } catch (error) {
      this.startingQueuedTurnSessionIds.delete(sessionId);
      this.dependencies.log(
        'error',
        `failed to submit queued follow-up; session=${sessionId}; id=${queuedSteer.id}; trigger=${trigger}.`,
        error,
      );
      this.dependencies.dispatch(updateSteerStatus({
        sessionId,
        steerId: queuedSteer.id,
        status: CoworkSteerStatus.Rejected,
        error: error instanceof Error ? error.message : i18nService.t('coworkSteerRejected'),
        reason: CoworkSteerRejectReason.Unknown,
      }));
      return false;
    } finally {
      if (this.inFlightBySessionId.get(sessionId) === operation) {
        this.inFlightBySessionId.delete(sessionId);
      }
    }
  }

  private getSessionStatus(sessionId: string): CoworkSessionStatus | undefined {
    const state = this.dependencies.getState().cowork;
    if (state.currentSession?.id === sessionId) {
      return state.currentSession.status;
    }
    return state.sessions.find(session => session.id === sessionId)?.status;
  }

  private buildPrompt(queuedSteer: CoworkPendingSteer): string {
    const attachmentLines = (queuedSteer.attachments ?? [])
      .filter(attachment => !attachment.path.startsWith('inline:'))
      .map(attachment => `${i18nService.t('inputFileLabel')}: ${attachment.path}`)
      .join('\n');
    const text = queuedSteer.text.trim();
    if (!text) return attachmentLines;
    return attachmentLines ? `${text}\n\n${attachmentLines}` : text;
  }
}
