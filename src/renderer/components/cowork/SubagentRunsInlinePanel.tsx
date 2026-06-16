import { ChevronRightIcon } from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import type { CoworkMessage, SubagentSessionStatus, SubagentSessionSummary } from '../../types/cowork';
import { SubagentSessionStatusValue } from '../../types/cowork';
import { getAgentDisplayName } from '../../utils/agentDisplay';
import AgentAvatarIcon from '../agent/AgentAvatarIcon';
import ConversationTurnsView from './ConversationTurnsView';
import {
  COWORK_DETAIL_CONTENT_CLASS,
  COWORK_DETAIL_GUTTER_CLASS,
} from './messageDisplayUtils';

interface SubagentRunsInlinePanelProps {
  parentSessionId: string;
  runs?: SubagentSessionSummary[];
  compact?: boolean;
}

const getRunTitle = (run: SubagentSessionSummary): string => (
  run.agentId
    || run.label
    || i18nService.t('subagentUnnamed')
);

const getStatusLabel = (status: SubagentSessionStatus): string => {
  if (status === SubagentSessionStatusValue.Done) return i18nService.t('subagentCompleted');
  if (status === SubagentSessionStatusValue.Error) return i18nService.t('subagentError');
  return i18nService.t('subagentWorking');
};

const getStatusClassName = (status: SubagentSessionStatus): string => {
  if (status === SubagentSessionStatusValue.Done) {
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
  }
  if (status === SubagentSessionStatusValue.Error) {
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  }
  return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
};

const SubagentRunsInlinePanel: React.FC<SubagentRunsInlinePanelProps> = ({
  parentSessionId,
  runs: providedRuns,
  compact = false,
}) => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const [runs, setRuns] = useState<SubagentSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(() => new Set());
  const [messagesByRunId, setMessagesByRunId] = useState<Record<string, CoworkMessage[]>>({});
  const [loadingRunIds, setLoadingRunIds] = useState<Set<string>>(() => new Set());

  const usesProvidedRuns = providedRuns !== undefined;
  const activeRuns = providedRuns ?? runs;
  const activeRunIdsKey = useMemo(() => activeRuns.map((run) => run.id).sort().join('|'), [activeRuns]);

  const fetchRuns = useCallback(async () => {
    try {
      const result = await window.electron?.cowork?.listSubagentSessions(parentSessionId);
      if (result?.success && Array.isArray(result.runs)) {
        setRuns(result.runs.map((run) => ({
          ...run,
          parentSessionId,
        })));
      }
    } catch {
      // Subagent runs are optional context for the parent session.
    } finally {
      setLoading(false);
    }
  }, [parentSessionId]);

  const fetchHistory = useCallback(async (run: SubagentSessionSummary) => {
    setLoadingRunIds((current) => {
      const next = new Set(current);
      next.add(run.id);
      return next;
    });

    try {
      const result = await window.electron?.cowork?.getSubTaskHistory({
        parentSessionId: run.parentSessionId,
        agentId: run.id,
        sessionKey: run.sessionKey ?? undefined,
      });
      if (result?.success && Array.isArray(result.messages)) {
        setMessagesByRunId((current) => ({
          ...current,
          [run.id]: result.messages as CoworkMessage[],
        }));
      }
    } catch {
      // Keep the last loaded history visible if a refresh fails.
    } finally {
      setLoadingRunIds((current) => {
        const next = new Set(current);
        next.delete(run.id);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    setRuns([]);
    setLoading(true);
    setExpandedRunIds(new Set());
    setMessagesByRunId({});
    setLoadingRunIds(new Set());
    if (usesProvidedRuns) {
      setLoading(false);
      return;
    }
    void fetchRuns();
  }, [fetchRuns, parentSessionId, usesProvidedRuns]);

  useEffect(() => {
    setExpandedRunIds((current) => {
      const activeRunIds = new Set(activeRunIdsKey ? activeRunIdsKey.split('|') : []);
      let changed = false;
      const next = new Set<string>();
      current.forEach((runId) => {
        if (activeRunIds.has(runId)) {
          next.add(runId);
        } else {
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [activeRunIdsKey]);

  useEffect(() => {
    const unsubscribe = window.electron?.cowork?.onSubagentRunsChanged?.(({ parentSessionId: changedParentSessionId, runs: nextRuns }) => {
      if (usesProvidedRuns) return;
      if (changedParentSessionId !== parentSessionId) return;
      setRuns(nextRuns.map((run) => ({
        ...run,
        parentSessionId,
      })));
      setLoading(false);
    });
    return () => unsubscribe?.();
  }, [parentSessionId, usesProvidedRuns]);

  useEffect(() => {
    const unsubscribe = window.electron?.cowork?.onSubagentMessagesChanged?.((data) => {
      if (data.parentSessionId !== parentSessionId) return;
      setMessagesByRunId((current) => ({
        ...current,
        [data.runId]: data.messages,
      }));
      setLoadingRunIds((current) => {
        if (!current.has(data.runId)) return current;
        const next = new Set(current);
        next.delete(data.runId);
        return next;
      });
    });
    return () => unsubscribe?.();
  }, [parentSessionId]);

  useEffect(() => {
    if (expandedRunIds.size === 0) return;
    const expandedRuns = activeRuns.filter((run) => expandedRunIds.has(run.id));
    expandedRuns.forEach((run) => {
      if (!messagesByRunId[run.id]) {
        void fetchHistory(run);
      }
    });
  }, [activeRuns, expandedRunIds, fetchHistory, messagesByRunId]);

  const visibleRuns = useMemo(() => (
    activeRuns.slice().sort((a, b) => a.createdAt - b.createdAt)
  ), [activeRuns]);

  if (!loading && visibleRuns.length === 0) {
    return null;
  }

  return (
    <div className={compact ? 'mt-2 animate-message-in' : `${COWORK_DETAIL_GUTTER_CLASS} animate-message-in`}>
      <div className={compact ? '' : COWORK_DETAIL_CONTENT_CLASS}>
        <section className={`${compact ? 'mb-2' : 'my-4'} overflow-hidden rounded-lg border border-border bg-surface/50`}>
          <div className="divide-y divide-border">
            {loading && visibleRuns.length === 0 && (
              <div className="flex items-center justify-center px-3 py-3">
                <div className="h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              </div>
            )}
            {visibleRuns.map((run) => {
              const agent = run.agentId
                ? agents.find((item) => item.id === run.agentId)
                : undefined;
              const title = agent ? getAgentDisplayName(agent) : getRunTitle(run);
              const isExpanded = expandedRunIds.has(run.id);
              const messages = messagesByRunId[run.id] ?? [];
              const effectiveMessages = messages.length > 0 || !run.task
                ? messages
                : [{
                    id: `${run.id}-synthetic-task`,
                    type: 'user' as const,
                    content: run.task,
                    timestamp: run.createdAt,
                  }];
              const isLoadingRun = loadingRunIds.has(run.id);

              return (
                <div key={run.id} className="bg-background/60">
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedRunIds((current) => {
                        const next = new Set(current);
                        if (next.has(run.id)) {
                          next.delete(run.id);
                        } else {
                          next.add(run.id);
                        }
                        return next;
                      });
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-raised/70"
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? i18nService.t('subagentInlineCollapse') : i18nService.t('subagentInlineExpand')}
                  >
                    <ChevronRightIcon
                      className={`h-4 w-4 shrink-0 text-secondary transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    />
                    <AgentAvatarIcon
                      value={agent?.icon}
                      className="h-7 w-7 border border-border/70 bg-background"
                      iconClassName="h-4 w-4"
                      legacyClassName="text-sm"
                      fallbackText={title.trim().slice(0, 1).toUpperCase() || 'A'}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {title}
                    </span>
                    {messages.length > 0 && (
                      <span className="shrink-0 text-xs text-secondary">
                        {messages.length} {i18nService.t('subTaskMessages')}
                      </span>
                    )}
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${getStatusClassName(run.status)}`}>
                      {getStatusLabel(run.status)}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="max-h-[520px] overflow-y-auto overscroll-contain border-t border-border bg-background">
                      {isLoadingRun && !messagesByRunId[run.id] ? (
                        <div className="flex items-center justify-center py-6 text-sm text-secondary">
                          <div className="mr-3 h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                          {i18nService.t('loading')}
                        </div>
                      ) : effectiveMessages.length > 0 ? (
                        <ConversationTurnsView
                          messages={effectiveMessages}
                          isStreaming={run.status === SubagentSessionStatusValue.Running}
                          readOnly
                          className="py-2"
                        />
                      ) : (
                        <div className="px-4 py-5 text-sm text-secondary">
                          {i18nService.t('subTaskNoHistory')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};

export default SubagentRunsInlinePanel;
