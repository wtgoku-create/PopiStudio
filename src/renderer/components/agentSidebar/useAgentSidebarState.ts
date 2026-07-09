import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

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
  if (!existing?.source) return null;

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
    lastMessagePreview: session.lastMessagePreview,
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

export const useAgentSidebarState = () => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const sessions = useSelector(selectCoworkSessions);
  const unreadSessionIds = useSelector(selectUnreadSessionIds);

  const [sidebarSessions, setSidebarSessions] = useState<CoworkSessionSummary[]>([]);
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
      const result = await coworkService.listAgentSidebarSessions();
      if (!result.success) {
        setFailedAgentIds(Array.from(activeAgentIds));
        return;
      }

      const sessions = sortSidebarSessions(result.sessions ?? []);
      setSidebarSessions(sessions.filter((session) => (
        session.source && activeAgentIds.has(normalizeAgentId(session.agentId))
      )));
    } finally {
      setLoadingAgentIds([]);
    }
  }, [sortedEnabledAgents]);

  useEffect(() => {
    let cancelled = false;
    void localStore.getItem(AgentSidebarPreferenceKey.State)
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
      selectedAgentId: currentAgentId,
      selectedTaskId: currentSessionId ?? undefined,
    };
    void localStore.setItem(AgentSidebarPreferenceKey.State, preference);
  }, [
    currentAgentId,
    currentSessionId,
    preferenceLoaded,
  ]);

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
    setSidebarSessions((previous) => previous.filter((session) => activeAgentIds.has(normalizeAgentId(session.agentId))));
    setLoadingAgentIds((previous) => previous.filter((id) => activeAgentIds.has(id)));
    setFailedAgentIds((previous) => previous.filter((id) => activeAgentIds.has(id)));
  }, [agents.length, enabledAgents]);

  useEffect(() => {
    if (sessions.length === 0) return;
    const activeAgentIds = new Set(enabledAgents.map((agent) => agent.id));
    setSidebarSessions((previous) => {
      let changed = false;
      const byId = new Map(previous.map((session) => [session.id, session]));
      sessions.forEach((session) => {
        if (!session.source) return;
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

  const agentNodes = useMemo<AgentSidebarAgentNode[]>(() => {
    const agentsById = new Map(sortedEnabledAgents.map((agent) => [agent.id, agent]));
    return sidebarSessions
      .filter((session) => session.source)
      .map((session) => {
        const agentId = normalizeAgentId(session.agentId);
        const agent = agentsById.get(agentId);
        if (!agent) return null;
        const task = toAgentSidebarTaskNode(session, currentSessionId, unreadSessionIdSet);

        return {
          ...agent,
          isLoadingTasks: loadingAgentIdSet.has(agent.id),
          hasLoadError: failedAgentIdSet.has(agent.id),
          tasks: [task],
        };
      })
      .filter((agent): agent is AgentSidebarAgentNode => !!agent);
  }, [
    currentSessionId,
    failedAgentIdSet,
    loadingAgentIdSet,
    sidebarSessions,
    sortedEnabledAgents,
    unreadSessionIdSet,
  ]);

  return {
    agentNodes,
    patchTaskPreview,
    removeTaskPreview,
    removeTaskPreviews,
  };
};
