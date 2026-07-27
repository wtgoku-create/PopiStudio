import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { AgentId } from '../../../shared/agent';
import {
  CoworkSessionSourceKind,
  SESSION_AGNOSTIC_PERMISSION_SESSION_ID,
} from '../../../shared/cowork/constants';
import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import {
  selectCurrentSessionId,
  selectPendingPermissions,
} from '../../store/selectors/coworkSelectors';
import { isDefaultAgentId } from '../../utils/agentDisplay';
import AgentAddFriendModal from '../agent/AgentAddFriendModal';
import AgentCreateModal from '../agent/AgentCreateModal';
import AgentSettingsPanel from '../agent/AgentSettingsPanel';
import { type CoworkOpenShareOptionsEventDetail, CoworkUiEvent } from '../cowork/constants';
import AgentSessionNode from './AgentSessionNode';
import { AgentSidebarTaskTab } from './constants';
import MyAgentSidebarHeader from './MyAgentSidebarHeader';
import type { AgentSidebarAgentNode, AgentSidebarTaskNode } from './types';
import { useAgentSidebarState } from './useAgentSidebarState';

interface MyAgentSidebarTreeProps {
  isBatchMode: boolean;
  batchAgentId: string | null;
  deletedSessionIds: string[];
  selectedIds: Set<string>;
  activeTab: AgentSidebarTaskTab;
  onShowCowork: () => void;
  onTaskTabChange: (tab: AgentSidebarTaskTab) => void;
  onToggleSelection: (sessionId: string, agentId: string) => void;
  onEnterBatchMode: (sessionId: string, agentId: string) => void;
  onBatchSelectableIdsChange: (sessionIds: string[]) => void;
  onSearch: () => void;
}

const MyAgentSidebarTree: React.FC<MyAgentSidebarTreeProps> = ({
  deletedSessionIds,
  activeTab,
  onShowCowork,
  onTaskTabChange,
  onBatchSelectableIdsChange,
  onSearch,
}) => {
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const pendingPermissions = useSelector(selectPendingPermissions);
  const [isAddFriendOpen, setIsAddFriendOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const {
    agentNodes,
    removeTaskPreview,
    removeTaskPreviews,
  } = useAgentSidebarState();

  const visibleAgentNodes = agentNodes.filter((agent) => {
    const task = agent.tasks[0];
    const isScheduledTask = task?.source?.kind === CoworkSessionSourceKind.ScheduledTask;
    return activeTab === AgentSidebarTaskTab.Scheduled ? isScheduledTask : !isScheduledTask;
  });
  const pendingPermissionSessionIdSet = useMemo(() => {
    const ids = new Set<string>();
    for (const permission of pendingPermissions) {
      ids.add(permission.sessionId);
      const sessionKey = typeof permission.toolInput?.sessionKey === 'string'
        ? permission.toolInput.sessionKey.trim()
        : '';
      const parts = sessionKey.split(':');
      if (parts.length >= 4 && parts[0] === 'agent') {
        const source = parts[2]?.trim();
        const sessionId = parts.slice(3).join(':').trim();
        if ((source === 'popiai' || source === 'subagent') && sessionId) {
          ids.add(sessionId);
        }
      }
    }
    return ids;
  }, [pendingPermissions]);

  useEffect(() => {
    void agentService.loadAgents();
  }, []);

  const handleSelectAgentSession = async (
    agent: AgentSidebarAgentNode,
    task: AgentSidebarTaskNode,
  ) => {
    if (agent.id !== currentAgentId) {
      agentService.switchAgent(agent.id);
    }
    onShowCowork();
    window.dispatchEvent(new CustomEvent(CoworkUiEvent.SelectSubagent, { detail: null }));
    await coworkService.loadSession(task.id);
  };

  const handleShareAgentSession = async (
    agent: AgentSidebarAgentNode,
    task: AgentSidebarTaskNode,
  ) => {
    await handleSelectAgentSession(agent, task);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent<CoworkOpenShareOptionsEventDetail>(
        CoworkUiEvent.OpenShareOptions,
        { detail: { sessionId: task.id } },
      ));
    }, 0);
  };

  const handleReturnToMainAgent = async () => {
    agentService.switchAgent(AgentId.Main);
    onTaskTabChange(AgentSidebarTaskTab.Main);
    onShowCowork();

    const result = await coworkService.listAgentSidebarSessions();
    const mainHomeSession = result.success
      ? result.sessions?.find((session) => (
        (session.agentId?.trim() || AgentId.Main) === AgentId.Main
        && session.source?.kind === CoworkSessionSourceKind.AgentHome
      ))
      : null;
    const mainTaskSession = result.success
      ? result.sessions?.find((session) => (
        (session.agentId?.trim() || AgentId.Main) === AgentId.Main
        && session.source?.kind !== CoworkSessionSourceKind.ScheduledTask
      ))
      : null;

    if (mainHomeSession) {
      await coworkService.loadSession(mainHomeSession.id);
      return;
    }

    if (mainTaskSession) {
      await coworkService.loadSession(mainTaskSession.id);
      return;
    }

    await coworkService.loadSessions(AgentId.Main);
    coworkService.clearSession({ restoreAgentSkills: true });
  };

  const handleDeleteSession = async (task: AgentSidebarTaskNode) => {
    if (task.source?.kind === CoworkSessionSourceKind.AgentHome) {
      if (isDefaultAgentId(task.agentId)) {
        window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('agentDefaultCannotDelete') }));
        return;
      }

      const deleted = await agentService.deleteAgent(task.agentId);
      if (deleted) {
        const deletedSessionIds = agentNodes
          .filter((agent) => agent.id === task.agentId)
          .flatMap((agent) => agent.tasks.map((item) => item.id));
        removeTaskPreviews(deletedSessionIds.length > 0 ? deletedSessionIds : [task.id]);
        if (settingsAgentId === task.agentId) {
          setSettingsAgentId(null);
        }
        return;
      }

      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('agentDeleteFailed') }));
      return;
    }

    const deleted = await coworkService.deleteSession(task.id);
    if (deleted) {
      removeTaskPreview(task.id);
      if (currentSessionId === task.id) {
        const nextAgent = agentNodes.find((item) => (
          item.id === task.agentId
          && item.tasks[0]?.id !== task.id
          && item.tasks[0]?.source?.kind === task.source?.kind
        ));
        const nextTask = nextAgent?.tasks[0];
        if (nextAgent && nextTask) {
          await handleSelectAgentSession(nextAgent, nextTask);
        } else if (task.source?.kind === CoworkSessionSourceKind.ScheduledTask) {
          await handleReturnToMainAgent();
        }
      }
      return;
    }
    window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('coworkDeleteSessionFailed') }));
  };

  const renderSessionNode = (agent: AgentSidebarAgentNode) => {
    const task = agent.tasks[0];
    if (!task) return null;

    return (
      <AgentSessionNode
        key={task.id}
        agent={agent}
        task={task}
        hasPendingConfirmation={
          pendingPermissionSessionIdSet.has(task.id)
          || (
            task.id === currentSessionId
            && pendingPermissionSessionIdSet.has(SESSION_AGNOSTIC_PERMISSION_SESSION_ID)
          )
        }
        isActive={task.id === currentSessionId}
        onSelect={(agent, task) => void handleSelectAgentSession(agent, task)}
        onDelete={handleDeleteSession}
        onShare={(agent, task) => handleShareAgentSession(agent, task)}
        onEditAgent={(agent) => setSettingsAgentId(agent.id)}
      />
    );
  };

  useEffect(() => {
    if (deletedSessionIds.length === 0) return;
    removeTaskPreviews(deletedSessionIds);
  }, [deletedSessionIds, removeTaskPreviews]);

  useEffect(() => {
    onBatchSelectableIdsChange([]);
  }, [onBatchSelectableIdsChange]);

  return (
    <div className="pb-3" role="list" aria-label={i18nService.t('myAgents')}>
      <MyAgentSidebarHeader
        activeTab={activeTab}
        onAddFriend={() => setIsAddFriendOpen(true)}
        onCreateAgent={() => setIsCreateOpen(true)}
        onSearch={onSearch}
        onTaskTabChange={onTaskTabChange}
      />

      {agentNodes.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-xs font-medium text-secondary">
            {i18nService.t('myAgentSidebarNoAgents')}
          </p>
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover"
          >
            {i18nService.t('createNewAgent')}
          </button>
        </div>
      ) : visibleAgentNodes.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-xs font-medium text-secondary">
            {activeTab === AgentSidebarTaskTab.Scheduled
              ? i18nService.t('myAgentSidebarNoScheduledTasks')
              : i18nService.t('myAgentSidebarNoTasks')}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5 px-0">
          {visibleAgentNodes.map(renderSessionNode)}
        </div>
      )}

      <AgentAddFriendModal
        isOpen={isAddFriendOpen}
        onClose={() => setIsAddFriendOpen(false)}
        onShowCowork={onShowCowork}
      />
      <AgentCreateModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <AgentSettingsPanel
        agentId={settingsAgentId}
        onClose={() => setSettingsAgentId(null)}
      />
    </div>
  );
};

export default MyAgentSidebarTree;
