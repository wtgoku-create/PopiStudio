import { useCallback, useEffect, useState } from 'react';

import type { SubagentSessionSummary } from '../../types/cowork';
import { CoworkSessionStatusValue } from '../../types/cowork';

const SUBAGENT_REFRESH_INTERVAL_MS = 1500;

/**
 * Fetches and subscribes to subagent sessions for the currently selected session.
 * Returns a map of parentSessionId → subagent summaries.
 */
export const useSubagentSessions = (
  currentSessionId: string | null,
  currentSessionStatus?: string,
) => {
  const [subagentsBySessionId, setSubagentsBySessionId] = useState<
    Record<string, SubagentSessionSummary[]>
  >({});
  const fetchSubagents = useCallback(async (sessionId: string) => {
    try {
      const result = await window.electron?.cowork?.listSubagentSessions(sessionId);
      if (!result?.success || !result.runs) return;

      const summaries: SubagentSessionSummary[] = result.runs.map((run) => ({
        id: run.id,
        agentId: run.agentId,
        task: run.task,
        label: run.label,
        sessionKey: run.sessionKey,
        parentSessionId: sessionId,
        status: run.status,
        createdAt: run.createdAt,
      }));

      setSubagentsBySessionId((prev) => {
        const existing = prev[sessionId];
        if (existing && JSON.stringify(existing) === JSON.stringify(summaries)) {
          return prev;
        }
        return { ...prev, [sessionId]: summaries };
      });
    } catch {
      // Silently ignore fetch errors
    }
  }, []);

  useEffect(() => {
    if (!currentSessionId) return;

    void fetchSubagents(currentSessionId);
  }, [currentSessionId, fetchSubagents]);

  useEffect(() => {
    if (!currentSessionId || currentSessionStatus !== CoworkSessionStatusValue.Running) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void fetchSubagents(currentSessionId);
    }, SUBAGENT_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [currentSessionId, currentSessionStatus, fetchSubagents]);

  useEffect(() => {
    const unsubscribe = window.electron?.cowork?.onSubagentRunsChanged?.(({ parentSessionId, runs }) => {
      setSubagentsBySessionId((prev) => ({
        ...prev,
        [parentSessionId]: runs,
      }));
    });
    return () => unsubscribe?.();
  }, []);

  return { subagentsBySessionId, refetchSubagents: fetchSubagents };
};
