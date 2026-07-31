import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { SESSION_AGNOSTIC_PERMISSION_SESSION_ID } from '../../../shared/cowork/constants';
import { coworkService } from '../../services/cowork';
import { localStore } from '../../services/store';
import { RootState } from '../../store';
import {
  selectCoworkSessions,
  selectCurrentSessionId,
  selectPendingPermissionSessionIds,
  selectUnreadSessionIds,
} from '../../store/selectors/coworkSelectors';
import type { CoworkSessionSummary } from '../../types/cowork';
import { CoworkSessionStatusValue } from '../../types/cowork';
import {
  AgentSidebarIndicator,
  AgentSidebarPageSize,
  AgentSidebarPreferenceKey,
} from './constants';
import type {
  AgentSidebarAgentNode,
  AgentSidebarAgentSummary,
  AgentSidebarTaskNode,
} from './types';

const normalizeAgentId = (agentId?: string) => agentId?.trim() || 'main';
const sortSidebarSessions = (sessions: CoworkSessionSummary[]): CoworkSessionSummary[] => (
  sortAgentSidebarTasks(sessions)
);

const mergeSidebarSessions = (
  current: CoworkSessionSummary[],
  incoming: CoworkSessionSummary[],
): CoworkSessionSummary[] => {
  const byId = new Map<string, CoworkSessionSummary>();
  current.forEach((session) => byId.set(session.id, session));
  incoming.forEach((session) => {
    const existing = byId.get(session.id);
    byId.set(session.id, {
      ...existing,
      ...session,
      source: session.source ?? existing?.source,
    });
  });
  return Array.from(byId.values());
};

const hasSessionPreviewChanged = (
  previous: CoworkSessionSummary,
  next: CoworkSessionSummary,
): boolean => {
  return previous.title !== next.title
    || previous.status !== next.status
    || previous.pinned !== next.pinned
    || previous.pinOrder !== next.pinOrder
    || previous.lastMessagePreview !== next.lastMessagePreview
    || previous.updatedAt !== next.updatedAt
    || previous.createdAt !== next.createdAt
    || normalizeAgentId(previous.agentId) !== normalizeAgentId(next.agentId);
};

export const patchExistingAgentSidebarSession = (
  existing: CoworkSessionSummary | undefined,
  next: CoworkSessionSummary,
): CoworkSessionSummary | null => {
  if (!existing) return null;

  return {
    ...existing,
    title: next.title,
    lastMessagePreview: next.lastMessagePreview ?? existing.lastMessagePreview,
    status: next.status,
    pinned: next.pinned,
    pinOrder: next.pinOrder ?? null,
    agentId: normalizeAgentId(next.agentId),
    createdAt: next.createdAt,
    updatedAt: next.updatedAt,
  };
};

export const deriveAgentSidebarIndicator = (
  session: CoworkSessionSummary,
  unreadSessionIds: Set<string>,
  pendingPermissionSessionIds: Set<string> = new Set(),
  currentSessionId: string | null = null,
) => {
  if (
    pendingPermissionSessionIds.has(session.id)
    || (
      session.id === currentSessionId
      && pendingPermissionSessionIds.has(SESSION_AGNOSTIC_PERMISSION_SESSION_ID)
    )
  ) {
    return AgentSidebarIndicator.PendingPermission;
  }
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
  pendingPermissionSessionIds: Set<string> = new Set(),
): AgentSidebarTaskNode => {
  return {
    id: session.id,
    agentId: normalizeAgentId(session.agentId),
    title: session.title,
    lastMessagePreview: session.lastMessagePreview,
    status: session.status,
    pinned: session.pinned,
    pinOrder: session.pinOrder ?? null,
    source: session.source,
    updatedAt: session.updatedAt,
    createdAt: session.createdAt,
    indicator: deriveAgentSidebarIndicator(
      session,
      unreadSessionIds,
      pendingPermissionSessionIds,
      currentSessionId,
    ),
    isSelected: session.id === currentSessionId,
  };
};

export const groupAgentSidebarSessions = (
  agents: AgentSidebarAgentSummary[],
  sessions: CoworkSessionSummary[],
  currentSessionId: string | null,
  unreadSessionIds: Set<string>,
  pendingPermissionSessionIds: Set<string> = new Set(),
  loadingAgentIds: Set<string> = new Set(),
  failedAgentIds: Set<string> = new Set(),
  expandedAgentIds: Set<string> = new Set(),
  expandedTaskListAgentIds: Set<string> = new Set(),
  hasMoreTasksByAgentId: Record<string, boolean> = {},
  visibleTaskLimitByAgentId: Record<string, number> = {},
): AgentSidebarAgentNode[] => {
  const sessionsByAgentId = new Map<string, CoworkSessionSummary[]>();
  sessions.forEach((session) => {
    const agentId = normalizeAgentId(session.agentId);
    const existing = sessionsByAgentId.get(agentId) ?? [];
    existing.push(session);
    sessionsByAgentId.set(agentId, existing);
  });

  return agents
    .map((agent) => {
      const sortedSessions = sortSidebarSessions(sessionsByAgentId.get(agent.id) ?? []);
      const isTaskListExpanded = expandedTaskListAgentIds.has(agent.id);
      const visibleTaskLimit = visibleTaskLimitByAgentId[agent.id]
        ?? (isTaskListExpanded
          ? AgentSidebarPageSize.Preview + AgentSidebarPageSize.ExpandBatch
          : AgentSidebarPageSize.Preview);
      const visibleSessions = sortedSessions.slice(0, visibleTaskLimit);
      const tasks = visibleSessions
        .map((session) => toAgentSidebarTaskNode(
          session,
          currentSessionId,
          unreadSessionIds,
          pendingPermissionSessionIds,
        ));
      return {
        ...agent,
        isExpanded: expandedAgentIds.has(agent.id),
        isTaskListExpanded,
        canExpandTasks: (hasMoreTasksByAgentId[agent.id] ?? false) || sortedSessions.length > visibleTaskLimit,
        canCollapseTasks: isTaskListExpanded,
        isLoadingTasks: loadingAgentIds.has(agent.id),
        hasLoadError: failedAgentIds.has(agent.id),
        tasks,
      };
    })
};

export const useAgentSidebarState = () => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const sessions = useSelector(selectCoworkSessions);
  const unreadSessionIds = useSelector(selectUnreadSessionIds);
  const pendingPermissionSessionIds = useSelector(selectPendingPermissionSessionIds);

  const [sidebarSessions, setSidebarSessions] = useState<CoworkSessionSummary[]>([]);
  const [expandedAgentIds, setExpandedAgentIds] = useState<string[]>([]);
  const [expandedTaskListAgentIds, setExpandedTaskListAgentIds] = useState<string[]>([]);
  const [visibleTaskLimitByAgentId, setVisibleTaskLimitByAgentId] = useState<Record<string, number>>({});
  const [hasMoreTasksByAgentId, setHasMoreTasksByAgentId] = useState<Record<string, boolean>>({});
  const [loadingAgentIds, setLoadingAgentIds] = useState<string[]>([]);
  const [failedAgentIds, setFailedAgentIds] = useState<string[]>([]);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);

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
  const pendingPermissionSessionIdSet = useMemo(
    () => new Set(pendingPermissionSessionIds),
    [pendingPermissionSessionIds],
  );
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
      setSidebarSessions([]);
      return;
    }

    setLoadingAgentIds(Array.from(activeAgentIds));
    setFailedAgentIds([]);
    try {
      const [sourceResult, ...agentResults] = await Promise.all([
        coworkService.listAgentSidebarSessions(),
        ...sortedEnabledAgents.map((agent) => (
          coworkService.listSessionsForAgentPreview(agent.id, AgentSidebarPageSize.Preview, 0)
        )),
      ]);
      if (!sourceResult.success || agentResults.some((result) => !result.success)) {
        setFailedAgentIds(Array.from(activeAgentIds));
        return;
      }

      const sourceSessions = sourceResult.sessions ?? [];
      const sourceSessionById = new Map(sourceSessions.map((session) => [session.id, session]));
      const agentSessions = agentResults.flatMap((result) => result.sessions ?? []);
      const sessions = sortSidebarSessions(mergeSidebarSessions(agentSessions, sourceSessions)
        .map((session) => {
          const sourceSession = sourceSessionById.get(session.id);
          return sourceSession?.source ? { ...session, source: sourceSession.source } : session;
        }));
      setSidebarSessions(sessions.filter((session) => (
        activeAgentIds.has(normalizeAgentId(session.agentId))
      )));
      setHasMoreTasksByAgentId(Object.fromEntries(sortedEnabledAgents.map((agent, index) => [
        agent.id,
        agentResults[index]?.hasMore ?? false,
      ])));
    } finally {
      setLoadingAgentIds([]);
    }
  }, [sortedEnabledAgents]);

  useEffect(() => {
    let cancelled = false;
    void localStore.getItem(AgentSidebarPreferenceKey.State)
      .then((preference) => {
        if (cancelled) return;
        const value = preference as {
          expandedAgentIds?: string[];
          expandedTaskListAgentIds?: string[];
        } | null;
        setExpandedAgentIds(value?.expandedAgentIds ?? []);
        setExpandedTaskListAgentIds(value?.expandedTaskListAgentIds ?? []);
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
    const preference = {
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
    if (!preferenceLoaded || sortedEnabledAgents.length === 0) return;
    setExpandedAgentIds((previous) => {
      if (previous.length > 0) return previous;
      const currentAgentExists = sortedEnabledAgents.some((agent) => agent.id === currentAgentId);
      return [currentAgentExists ? currentAgentId : sortedEnabledAgents[0].id];
    });
  }, [currentAgentId, preferenceLoaded, sortedEnabledAgents]);

  useEffect(() => {
    if (!preferenceLoaded || sortedEnabledAgents.length === 0) return;
    if (!sortedEnabledAgents.some((agent) => agent.id === currentAgentId)) return;
    setExpandedAgentIds((previous) => (
      previous.includes(currentAgentId) ? previous : [...previous, currentAgentId]
    ));
  }, [currentAgentId, preferenceLoaded, sortedEnabledAgents]);

  useEffect(() => {
    void refreshAgentSidebarSessions();
  }, [refreshAgentSidebarSessions]);

  useEffect(() => {
    if (agents.length === 0) return;

    const activeAgentIds = new Set(enabledAgents.map((agent) => agent.id));
    setSidebarSessions((previous) => previous.filter((session) => activeAgentIds.has(normalizeAgentId(session.agentId))));
    setLoadingAgentIds((previous) => previous.filter((id) => activeAgentIds.has(id)));
    setFailedAgentIds((previous) => previous.filter((id) => activeAgentIds.has(id)));
    setExpandedAgentIds((previous) => previous.filter((id) => activeAgentIds.has(id)));
    setExpandedTaskListAgentIds((previous) => previous.filter((id) => activeAgentIds.has(id)));
    setVisibleTaskLimitByAgentId((previous) => Object.fromEntries(
      Object.entries(previous).filter(([agentId]) => activeAgentIds.has(agentId)),
    ));
    setHasMoreTasksByAgentId((previous) => Object.fromEntries(
      Object.entries(previous).filter(([agentId]) => activeAgentIds.has(agentId)),
    ));
  }, [agents.length, enabledAgents]);

  useEffect(() => {
    if (sessions.length === 0) return;
    const activeAgentIds = new Set(enabledAgents.map((agent) => agent.id));
    setSidebarSessions((previous) => {
      let changed = false;
      const byId = new Map(previous.map((session) => [session.id, session]));
      sessions.forEach((session) => {
        if (!activeAgentIds.has(normalizeAgentId(session.agentId))) return;

        const existing = byId.get(session.id);
        const patched = existing
          ? patchExistingAgentSidebarSession(existing, session)
          : session;
        if (!patched) return;
        if (!existing || hasSessionPreviewChanged(existing, patched)) {
          byId.set(session.id, patched);
          changed = true;
        }
      });
      return changed ? sortSidebarSessions(Array.from(byId.values())) : previous;
    });
  }, [enabledAgents, sessions]);

  const patchTaskPreview = useCallback((
    sessionId: string,
    updates: Partial<Pick<CoworkSessionSummary, 'title' | 'pinned' | 'pinOrder' | 'status'>>,
    options: { preserveUpdatedAt?: boolean } = {},
  ) => {
    setSidebarSessions((previous) => {
      let changed = false;
      const next = previous.map((session) => {
        if (session.id !== sessionId) return session;
        changed = true;
        return {
          ...session,
          ...updates,
          updatedAt: options.preserveUpdatedAt ? session.updatedAt : Date.now(),
        };
      });
      return changed ? sortSidebarSessions(next) : previous;
    });
  }, []);

  const removeTaskPreview = useCallback((sessionId: string) => {
    setSidebarSessions((previous) => previous.filter((session) => session.id !== sessionId));
  }, []);

  const removeTaskPreviews = useCallback((sessionIds: string[]) => {
    setSidebarSessions((previous) => previous.filter((session) => !sessionIds.includes(session.id)));
  }, []);

  const removeAgentTaskPreviews = useCallback((agentId: string) => {
    setSidebarSessions((previous) => previous.filter((session) => normalizeAgentId(session.agentId) !== agentId));
    setLoadingAgentIds((previous) => previous.filter((id) => id !== agentId));
    setFailedAgentIds((previous) => previous.filter((id) => id !== agentId));
    setExpandedAgentIds((previous) => previous.filter((id) => id !== agentId));
    setExpandedTaskListAgentIds((previous) => previous.filter((id) => id !== agentId));
    setVisibleTaskLimitByAgentId((previous) => {
      if (!Object.prototype.hasOwnProperty.call(previous, agentId)) return previous;
      const next = { ...previous };
      delete next[agentId];
      return next;
    });
    setHasMoreTasksByAgentId((previous) => {
      if (!Object.prototype.hasOwnProperty.call(previous, agentId)) return previous;
      const next = { ...previous };
      delete next[agentId];
      return next;
    });
  }, []);

  const toggleAgentExpanded = useCallback((agentId: string) => {
    setExpandedAgentIds((previous) => (
      previous.includes(agentId)
        ? previous.filter((id) => id !== agentId)
        : [...previous, agentId]
    ));
  }, []);

  const expandAgent = useCallback((agentId: string) => {
    setExpandedAgentIds((previous) => (
      previous.includes(agentId) ? previous : [...previous, agentId]
    ));
  }, []);

  const loadMoreTasks = useCallback(async (agentId: string) => {
    const loadedTasks = sidebarSessions.filter((session) => normalizeAgentId(session.agentId) === agentId);
    const nextVisibleLimit = (visibleTaskLimitByAgentId[agentId] ?? AgentSidebarPageSize.Preview)
      + AgentSidebarPageSize.ExpandBatch;
    setExpandedTaskListAgentIds((previous) => (
      previous.includes(agentId) ? previous : [...previous, agentId]
    ));
    setVisibleTaskLimitByAgentId((previous) => ({
      ...previous,
      [agentId]: nextVisibleLimit,
    }));

    if (loadedTasks.length >= nextVisibleLimit || !(hasMoreTasksByAgentId[agentId] ?? false)) {
      return;
    }

    setLoadingAgentIds((previous) => previous.includes(agentId) ? previous : [...previous, agentId]);
    setFailedAgentIds((previous) => previous.filter((id) => id !== agentId));
    try {
      const result = await coworkService.listSessionsForAgentPreview(
        agentId,
        Math.max(AgentSidebarPageSize.ExpandBatch, nextVisibleLimit - loadedTasks.length),
        loadedTasks.length,
      );
      if (!result.success) {
        setFailedAgentIds((previous) => previous.includes(agentId) ? previous : [...previous, agentId]);
        return;
      }
      setSidebarSessions((previous) => sortSidebarSessions(mergeSidebarSessions(
        previous,
        result.sessions ?? [],
      )));
      setHasMoreTasksByAgentId((previous) => ({
        ...previous,
        [agentId]: result.hasMore ?? false,
      }));
    } finally {
      setLoadingAgentIds((previous) => previous.filter((id) => id !== agentId));
    }
  }, [hasMoreTasksByAgentId, sidebarSessions, visibleTaskLimitByAgentId]);

  const collapseTasks = useCallback((agentId: string) => {
    setExpandedTaskListAgentIds((previous) => previous.filter((id) => id !== agentId));
    setVisibleTaskLimitByAgentId((previous) => {
      if (!Object.prototype.hasOwnProperty.call(previous, agentId)) return previous;
      const next = { ...previous };
      delete next[agentId];
      return next;
    });
  }, []);

  const retryLoadTasks = useCallback((agentId: string) => {
    setSidebarSessions((previous) => previous.filter((session) => normalizeAgentId(session.agentId) !== agentId));
    setHasMoreTasksByAgentId((previous) => {
      const next = { ...previous };
      delete next[agentId];
      return next;
    });
    return refreshAgentSidebarSessions();
  }, [refreshAgentSidebarSessions]);

  const agentNodes = useMemo<AgentSidebarAgentNode[]>(() => {
    return groupAgentSidebarSessions(
      sortedEnabledAgents,
      sidebarSessions,
      currentSessionId,
      unreadSessionIdSet,
      pendingPermissionSessionIdSet,
      loadingAgentIdSet,
      failedAgentIdSet,
      expandedAgentIdSet,
      expandedTaskListAgentIdSet,
      hasMoreTasksByAgentId,
      visibleTaskLimitByAgentId,
    );
  }, [
    currentSessionId,
    expandedAgentIdSet,
    expandedTaskListAgentIdSet,
    failedAgentIdSet,
    hasMoreTasksByAgentId,
    loadingAgentIdSet,
    pendingPermissionSessionIdSet,
    sidebarSessions,
    sortedEnabledAgents,
    unreadSessionIdSet,
    visibleTaskLimitByAgentId,
  ]);

  return {
    agentNodes,
    patchTaskPreview,
    removeTaskPreview,
    removeTaskPreviews,
    removeAgentTaskPreviews,
    retryLoadTasks,
    loadMoreTasks,
    collapseTasks,
    toggleAgentExpanded,
    expandAgent,
  };
};
