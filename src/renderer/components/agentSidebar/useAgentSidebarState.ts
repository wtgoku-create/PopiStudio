import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { CoworkSessionSourceKind } from '../../../shared/cowork/constants';
import { coworkService } from '../../services/cowork';
import { localStore } from '../../services/store';
import { RootState } from '../../store';
import {
  selectCoworkSessions,
  selectCurrentSessionId,
  selectUnreadSessionIds,
} from '../../store/selectors/coworkSelectors';
import type { CoworkSessionSummary } from '../../types/cowork';
import { CoworkSessionStatusValue } from '../../types/cowork';
import { type CoworkSessionSummaryChangedEventDetail, CoworkUiEvent } from '../cowork/constants';
import {
  AgentSidebarIndicator,
  AgentSidebarPageSize,
  AgentSidebarPreferenceKey,
} from './constants';
import type {
  AgentSidebarAgentNode,
  AgentSidebarAgentSummary,
  AgentSidebarPreferenceState,
  AgentSidebarTaskNode,
} from './types';

const normalizeAgentId = (agentId?: string) => agentId?.trim() || 'main';
const isPrimarySession = (session: CoworkSessionSummary): boolean => (
  !session.source || session.source.kind === CoworkSessionSourceKind.AgentHome
);

const limitAgentSessions = (sessions: CoworkSessionSummary[]): CoworkSessionSummary[] => {
  const sortedSessions = sortAgentSidebarTasks(sessions);
  const primarySession = sortedSessions.find(isPrimarySession);
  const sourceSessions = sortedSessions
    .filter((session) => !isPrimarySession(session))
    .slice(0, AgentSidebarPageSize.Preview);
  return primarySession ? [primarySession, ...sourceSessions] : sourceSessions;
};

const hasSessionChanged = (
  previous: CoworkSessionSummary,
  next: CoworkSessionSummary,
): boolean => {
  return previous.title !== next.title
    || previous.status !== next.status
    || previous.pinned !== next.pinned
    || previous.pinOrder !== next.pinOrder
    || JSON.stringify(previous.source ?? null) !== JSON.stringify(next.source ?? null)
    || previous.updatedAt !== next.updatedAt
    || previous.createdAt !== next.createdAt
    || normalizeAgentId(previous.agentId) !== normalizeAgentId(next.agentId);
};

export const deriveAgentSidebarIndicator = (
  session: CoworkSessionSummary,
  unreadSessionIds: Set<string>,
) => {
  if (session.status === CoworkSessionStatusValue.Running) {
    return AgentSidebarIndicator.Running;
  }
  if (
    session.status === CoworkSessionStatusValue.Completed
    && unreadSessionIds.has(session.id)
  ) {
    return AgentSidebarIndicator.CompletedUnread;
  }
  return AgentSidebarIndicator.None;
};

export const sortAgentSidebarTasks = (
  tasks: CoworkSessionSummary[],
): CoworkSessionSummary[] => {
  return [...tasks].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) {
      const aPinOrder = a.pinOrder ?? a.updatedAt ?? a.createdAt;
      const bPinOrder = b.pinOrder ?? b.updatedAt ?? b.createdAt;
      if (aPinOrder !== bPinOrder) return aPinOrder - bPinOrder;
    }
    const aUpdatedAt = a.updatedAt || a.createdAt;
    const bUpdatedAt = b.updatedAt || b.createdAt;
    if (bUpdatedAt !== aUpdatedAt) return bUpdatedAt - aUpdatedAt;
    return b.createdAt - a.createdAt;
  });
};

export const sortAgentSidebarAgents = (
  agents: AgentSidebarAgentSummary[],
): AgentSidebarAgentSummary[] => {
  return [...agents].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) {
      const aPinOrder = a.pinOrder ?? Number.MAX_SAFE_INTEGER;
      const bPinOrder = b.pinOrder ?? Number.MAX_SAFE_INTEGER;
      if (aPinOrder !== bPinOrder) return aPinOrder - bPinOrder;
    }
    return 0;
  });
};

export const toAgentSidebarTaskNode = (
  session: CoworkSessionSummary,
  currentSessionId: string | null,
  unreadSessionIds: Set<string>,
): AgentSidebarTaskNode => {
  return {
    id: session.id,
    agentId: normalizeAgentId(session.agentId),
    title: session.title,
    status: session.status,
    pinned: session.pinned,
    pinOrder: session.pinOrder ?? null,
    source: session.source,
    updatedAt: session.updatedAt,
    createdAt: session.createdAt,
    indicator: deriveAgentSidebarIndicator(session, unreadSessionIds),
    isSelected: session.id === currentSessionId,
  };
};

export const collapseAgentSidebarTaskList = (
  expandedTaskListAgentIds: string[],
  agentId: string,
) => {
  return expandedTaskListAgentIds.includes(agentId)
    ? expandedTaskListAgentIds.filter((id) => id !== agentId)
    : expandedTaskListAgentIds;
};

export const removeAgentSidebarTaskPreviews = (
  previewsByAgentId: Record<string, CoworkSessionSummary[]>,
  sessionIds: Iterable<string>,
): Record<string, CoworkSessionSummary[]> => {
  const sessionIdSet = new Set(sessionIds);
  if (sessionIdSet.size === 0) return previewsByAgentId;

  let changed = false;
  const next = { ...previewsByAgentId };

  Object.entries(previewsByAgentId).forEach(([agentId, tasks]) => {
    if (!tasks.some((task) => sessionIdSet.has(task.id))) return;
    next[agentId] = tasks.filter((task) => !sessionIdSet.has(task.id));
    changed = true;
  });

  return changed ? next : previewsByAgentId;
};

export const removeAgentSidebarAgentTaskPreviews = (
  previewsByAgentId: Record<string, CoworkSessionSummary[]>,
  agentId: string,
): Record<string, CoworkSessionSummary[]> => {
  if (!Object.prototype.hasOwnProperty.call(previewsByAgentId, agentId)) {
    return previewsByAgentId;
  }

  const next = { ...previewsByAgentId };
  delete next[agentId];
  return next;
};

export const useAgentSidebarState = () => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const sessions = useSelector(selectCoworkSessions);
  const unreadSessionIds = useSelector(selectUnreadSessionIds);

  const [expandedAgentIds, setExpandedAgentIds] = useState<string[]>([]);
  const [expandedTaskListAgentIds, setExpandedTaskListAgentIds] = useState<string[]>([]);
  const [taskPreviewsByAgentId, setTaskPreviewsByAgentId] = useState<Record<string, CoworkSessionSummary[]>>({});
  const [loadingAgentIds, setLoadingAgentIds] = useState<string[]>([]);
  const [failedAgentIds, setFailedAgentIds] = useState<string[]>([]);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);

  const loadedAgentIdsRef = useRef(new Set<string>());
  const initializedDefaultExpansionRef = useRef(false);

  const enabledAgents = useMemo(() => {
    return agents
      .filter((agent) => agent.enabled)
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        icon: agent.icon,
        enabled: agent.enabled,
        pinned: agent.pinned ?? false,
        pinOrder: agent.pinOrder ?? null,
      }));
  }, [agents]);

  const sortedEnabledAgents = useMemo(() => {
    return sortAgentSidebarAgents(enabledAgents);
  }, [enabledAgents]);

  const unreadSessionIdSet = useMemo(() => new Set(unreadSessionIds), [unreadSessionIds]);
  const expandedAgentIdSet = useMemo(() => new Set(expandedAgentIds), [expandedAgentIds]);
  const expandedTaskListAgentIdSet = useMemo(
    () => new Set(expandedTaskListAgentIds),
    [expandedTaskListAgentIds],
  );
  const loadingAgentIdSet = useMemo(() => new Set(loadingAgentIds), [loadingAgentIds]);
  const failedAgentIdSet = useMemo(() => new Set(failedAgentIds), [failedAgentIds]);

  const refreshAgentSidebarSessions = useCallback(async () => {
    const activeAgentIds = new Set(sortedEnabledAgents.map((agent) => agent.id));
    if (activeAgentIds.size === 0) {
      setTaskPreviewsByAgentId({});
      return;
    }

    setLoadingAgentIds(Array.from(activeAgentIds));
    setFailedAgentIds([]);
    try {
      const result = await coworkService.listAgentSidebarSessions();
      if (!result.success) {
        const fallbackPreviews: Record<string, CoworkSessionSummary[]> = {};
        let hasFallbackFailure = false;

        await Promise.all(sortedEnabledAgents.map(async (agent) => {
          const fallbackResult = await coworkService.listSessionsForAgentPreview(
            agent.id,
            AgentSidebarPageSize.Preview,
            0,
          );
          if (!fallbackResult.success) {
            hasFallbackFailure = true;
            fallbackPreviews[agent.id] = [];
            return;
          }
          fallbackPreviews[agent.id] = limitAgentSessions(fallbackResult.sessions ?? []);
        }));

        if (hasFallbackFailure) {
          setFailedAgentIds(Array.from(activeAgentIds));
        } else {
          loadedAgentIdsRef.current = new Set(Object.keys(fallbackPreviews));
          setTaskPreviewsByAgentId(fallbackPreviews);
        }
        return;
      }

      const nextPreviews: Record<string, CoworkSessionSummary[]> = {};
      const nextLoadedAgentIds = new Set<string>();

      (result.groups ?? []).forEach((group) => {
        const agentId = normalizeAgentId(group.agentId);
        if (!activeAgentIds.has(agentId)) return;
        nextPreviews[agentId] = limitAgentSessions([
          group.primarySession,
          ...group.sourceSessions,
        ]);
        nextLoadedAgentIds.add(agentId);
      });

      sortedEnabledAgents.forEach((agent) => {
        if (!nextPreviews[agent.id]) {
          nextPreviews[agent.id] = [];
        }
      });

      loadedAgentIdsRef.current = nextLoadedAgentIds;
      setTaskPreviewsByAgentId(nextPreviews);
    } finally {
      setLoadingAgentIds([]);
    }
  }, [sortedEnabledAgents]);

  useEffect(() => {
    let cancelled = false;
    void localStore.getItem<AgentSidebarPreferenceState>(AgentSidebarPreferenceKey.State)
      .then((preference) => {
        if (cancelled) return;
        setExpandedAgentIds(preference?.expandedAgentIds ?? []);
        setExpandedTaskListAgentIds(preference?.expandedTaskListAgentIds ?? []);
      })
      .finally(() => {
        if (!cancelled) {
          setPreferenceLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!preferenceLoaded) return;
    const preference: AgentSidebarPreferenceState = {
      expandedAgentIds,
      expandedTaskListAgentIds,
      selectedAgentId: currentAgentId,
      selectedTaskId: currentSessionId ?? undefined,
    };
    void localStore.setItem(AgentSidebarPreferenceKey.State, preference);
  }, [
    currentAgentId,
    currentSessionId,
    expandedAgentIds,
    expandedTaskListAgentIds,
    preferenceLoaded,
  ]);

  useEffect(() => {
    if (!preferenceLoaded || initializedDefaultExpansionRef.current) return;
    if (sortedEnabledAgents.length === 0) return;
    initializedDefaultExpansionRef.current = true;
    setExpandedAgentIds((previous) => {
      if (previous.length > 0) return previous;
      const currentAgentExists = sortedEnabledAgents.some((agent) => agent.id === currentAgentId);
      return [currentAgentExists ? currentAgentId : sortedEnabledAgents[0].id];
    });
  }, [currentAgentId, preferenceLoaded, sortedEnabledAgents]);

  useEffect(() => {
    void refreshAgentSidebarSessions();
  }, [refreshAgentSidebarSessions]);

  useEffect(() => {
    const handleSessionSummaryChanged = (event: Event) => {
      const detail = (event as CustomEvent<CoworkSessionSummaryChangedEventDetail>).detail;
      const agentId = normalizeAgentId(detail?.agentId);
      if (!agentId) return;
      void refreshAgentSidebarSessions();
    };

    window.addEventListener(CoworkUiEvent.SessionSummaryChanged, handleSessionSummaryChanged);
    return () => {
      window.removeEventListener(CoworkUiEvent.SessionSummaryChanged, handleSessionSummaryChanged);
    };
  }, [refreshAgentSidebarSessions]);

  useEffect(() => {
    if (agents.length === 0) return;

    const activeAgentIds = new Set(enabledAgents.map((agent) => agent.id));
    for (const agentId of Array.from(loadedAgentIdsRef.current)) {
      if (!activeAgentIds.has(agentId)) {
        loadedAgentIdsRef.current.delete(agentId);
      }
    }
    setTaskPreviewsByAgentId((previous) => {
      let changed = false;
      const next: Record<string, CoworkSessionSummary[]> = {};
      Object.entries(previous).forEach(([agentId, tasks]) => {
        if (activeAgentIds.has(agentId)) {
          next[agentId] = tasks;
          return;
        }
        changed = true;
      });
      return changed ? next : previous;
    });
    setLoadingAgentIds((previous) => previous.filter((id) => activeAgentIds.has(id)));
    setFailedAgentIds((previous) => previous.filter((id) => activeAgentIds.has(id)));
    setExpandedAgentIds((previous) => previous.filter((id) => activeAgentIds.has(id)));
    setExpandedTaskListAgentIds((previous) => previous.filter((id) => activeAgentIds.has(id)));
  }, [agents.length, enabledAgents]);

  useEffect(() => {
    if (sessions.length === 0) return;
    setTaskPreviewsByAgentId((previous) => {
      let changed = false;
      const next = { ...previous };

      sessions.forEach((session) => {
        const agentId = normalizeAgentId(session.agentId);
        const existingTasks = next[agentId];
        if (!existingTasks) return;

        const index = existingTasks.findIndex((item) => item.id === session.id);
        if (index === -1) {
          if (loadedAgentIdsRef.current.has(agentId)) {
            next[agentId] = limitAgentSessions([session, ...existingTasks]);
            changed = true;
          }
          return;
        }

        if (hasSessionChanged(existingTasks[index], session)) {
          const updatedTasks = [...existingTasks];
          updatedTasks[index] = session;
          next[agentId] = limitAgentSessions(updatedTasks);
          changed = true;
        }
      });

      return changed ? next : previous;
    });
  }, [sessions]);

  const toggleAgentExpanded = useCallback((agentId: string) => {
    setExpandedTaskListAgentIds((previous) => collapseAgentSidebarTaskList(previous, agentId));
    setExpandedAgentIds((previous) => {
      return previous.includes(agentId)
        ? previous.filter((id) => id !== agentId)
        : [...previous, agentId];
    });
  }, []);

  const loadMoreTasks = useCallback((agentId: string) => {
    setExpandedTaskListAgentIds((previous) => {
      return previous.includes(agentId) ? previous : [...previous, agentId];
    });
    return refreshAgentSidebarSessions();
  }, [refreshAgentSidebarSessions]);

  const collapseTasks = useCallback((agentId: string) => {
    setExpandedTaskListAgentIds((previous) => {
      return collapseAgentSidebarTaskList(previous, agentId);
    });
  }, []);

  const retryLoadTasks = useCallback((agentId: string) => {
    loadedAgentIdsRef.current.delete(agentId);
    return refreshAgentSidebarSessions();
  }, [refreshAgentSidebarSessions]);

  const patchTaskPreview = useCallback((
    sessionId: string,
    updates: Partial<Pick<CoworkSessionSummary, 'title' | 'pinned' | 'pinOrder' | 'status'>>,
    options: { preserveUpdatedAt?: boolean } = {},
  ) => {
    setTaskPreviewsByAgentId((previous) => {
      let changed = false;
      const next = { ...previous };
      Object.entries(previous).forEach(([agentId, tasks]) => {
        const index = tasks.findIndex((task) => task.id === sessionId);
        if (index === -1) return;
        const updatedTasks = [...tasks];
        updatedTasks[index] = {
          ...updatedTasks[index],
          ...updates,
          updatedAt: options.preserveUpdatedAt ? updatedTasks[index].updatedAt : Date.now(),
        };
        next[agentId] = updatedTasks;
        changed = true;
      });
      return changed ? next : previous;
    });
  }, []);

  const removeTaskPreview = useCallback((sessionId: string) => {
    setTaskPreviewsByAgentId((previous) => {
      return removeAgentSidebarTaskPreviews(previous, [sessionId]);
    });
  }, []);

  const removeTaskPreviews = useCallback((sessionIds: string[]) => {
    setTaskPreviewsByAgentId((previous) => {
      return removeAgentSidebarTaskPreviews(previous, sessionIds);
    });
  }, []);

  const removeAgentTaskPreviews = useCallback((agentId: string) => {
    loadedAgentIdsRef.current.delete(agentId);

    setTaskPreviewsByAgentId((previous) => {
      return removeAgentSidebarAgentTaskPreviews(previous, agentId);
    });
    setLoadingAgentIds((previous) => previous.filter((id) => id !== agentId));
    setFailedAgentIds((previous) => previous.filter((id) => id !== agentId));
    setExpandedAgentIds((previous) => previous.filter((id) => id !== agentId));
    setExpandedTaskListAgentIds((previous) => previous.filter((id) => id !== agentId));
  }, []);

  const agentNodes = useMemo<AgentSidebarAgentNode[]>(() => {
    return sortedEnabledAgents.map((agent) => {
      const taskPreviews = taskPreviewsByAgentId[agent.id] ?? [];
      const sortedTaskPreviews = limitAgentSessions(taskPreviews);
      const isTaskListExpanded = expandedTaskListAgentIdSet.has(agent.id);
      const tasks = sortedTaskPreviews.map((session) => {
        return toAgentSidebarTaskNode(session, currentSessionId, unreadSessionIdSet);
      });

      return {
        ...agent,
        isExpanded: expandedAgentIdSet.has(agent.id),
        isTaskListExpanded,
        canExpandTasks: false,
        canCollapseTasks: false,
        isLoadingTasks: loadingAgentIdSet.has(agent.id),
        hasLoadError: failedAgentIdSet.has(agent.id),
        tasks,
      };
    });
  }, [
    currentSessionId,
    expandedAgentIdSet,
    expandedTaskListAgentIdSet,
    failedAgentIdSet,
    loadingAgentIdSet,
    sortedEnabledAgents,
    taskPreviewsByAgentId,
    unreadSessionIdSet,
  ]);

  return {
    agentNodes,
    expandedTaskListAgentIdSet,
    patchTaskPreview,
    removeTaskPreview,
    removeTaskPreviews,
    removeAgentTaskPreviews,
    retryLoadTasks,
    loadMoreTasks,
    collapseTasks,
    toggleAgentExpanded,
  };
};
