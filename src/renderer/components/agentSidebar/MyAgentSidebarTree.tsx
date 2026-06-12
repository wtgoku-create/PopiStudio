import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { CoworkSessionSourceKind } from '../../../shared/cowork/constants';
import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { selectCurrentSessionId } from '../../store/selectors/coworkSelectors';
import { isDefaultAgentId } from '../../utils/agentDisplay';
import AgentCreateModal from '../agent/AgentCreateModal';
import AgentSettingsPanel from '../agent/AgentSettingsPanel';
import { type CoworkOpenShareOptionsEventDetail, CoworkUiEvent } from '../cowork/constants';
import AgentSessionNode from './AgentSessionNode';
import AgentTreeNode from './AgentTreeNode';
import MyAgentSidebarHeader from './MyAgentSidebarHeader';
import type { AgentSidebarAgentNode, AgentSidebarTaskNode } from './types';
import { useAgentSidebarState } from './useAgentSidebarState';

interface MyAgentSidebarTreeProps {
  isBatchMode: boolean;
  batchAgentId: string | null;
  deletedSessionIds: string[];
  selectedIds: Set<string>;
  onShowCowork: () => void;
  onToggleSelection: (sessionId: string, agentId: string) => void;
  onEnterBatchMode: (sessionId: string, agentId: string) => void;
  onBatchSelectableIdsChange: (sessionIds: string[]) => void;
  onSearch: () => void;
}

const MyAgentSidebarTree: React.FC<MyAgentSidebarTreeProps> = ({
  deletedSessionIds,
  onShowCowork,
  onBatchSelectableIdsChange,
  onSearch,
}) => {
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const {
    agentNodes,
    removeTaskPreview,
    removeTaskPreviews,
    removeAgentTaskPreviews,
    retryLoadTasks,
  } = useAgentSidebarState();

  useEffect(() => {
    void agentService.loadAgents();
  }, []);

  const getPrimaryTask = (agent: AgentSidebarAgentNode): AgentSidebarTaskNode | null => {
    return agent.tasks.find((task) => !task.source || task.source.kind === CoworkSessionSourceKind.AgentHome) ?? null;
  };

  const getExternalTasks = (agent: AgentSidebarAgentNode): AgentSidebarTaskNode[] => {
    return agent.tasks.filter((task) => task.source && task.source.kind !== CoworkSessionSourceKind.AgentHome);
  };

  const handleSelectAgentSession = async (
    agent: AgentSidebarAgentNode,
    task: AgentSidebarTaskNode | null,
  ) => {
    if (agent.id !== currentAgentId) {
      agentService.switchAgent(agent.id);
      await coworkService.loadSessions(agent.id);
    }
    if (task) {
      onShowCowork();
      window.dispatchEvent(new CustomEvent(CoworkUiEvent.SelectSubagent, { detail: null }));
      await coworkService.loadSession(task.id);
      return;
    }
    coworkService.clearSession({ restoreAgentSkills: true });
    onShowCowork();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('cowork:focus-input', {
        detail: { clear: false },
      }));
    }, 0);
  };

  const handleSelectAgent = async (agent: AgentSidebarAgentNode) => {
    await handleSelectAgentSession(agent, getPrimaryTask(agent));
  };

  const handleDeleteAgent = async (agent: AgentSidebarAgentNode) => {
    if (isDefaultAgentId(agent.id)) return;
    const deleted = await agentService.deleteAgent(agent.id);
    if (deleted) {
      removeAgentTaskPreviews(agent.id);
    }
    if (deleted && settingsAgentId === agent.id) {
      setSettingsAgentId(null);
    }
    if (!deleted) {
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('agentDeleteFailed') }));
    }
  };

  const handleToggleAgentPin = async (agent: AgentSidebarAgentNode, pinned: boolean) => {
    const updated = await agentService.updateAgent(agent.id, { pinned });
    if (!updated) {
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('agentPinFailed') }));
    }
  };

  const handleShareAgentSession = async (
    agent: AgentSidebarAgentNode,
    task: AgentSidebarTaskNode | null = getPrimaryTask(agent),
  ) => {
    if (!task) return;
    await handleSelectAgentSession(agent, task);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent<CoworkOpenShareOptionsEventDetail>(
        CoworkUiEvent.OpenShareOptions,
        { detail: { sessionId: task.id } },
      ));
    }, 0);
  };

  const handleDeleteSession = async (task: AgentSidebarTaskNode) => {
    const deleted = await coworkService.deleteSession(task.id);
    if (deleted) {
      removeTaskPreview(task.id);
      if (currentSessionId === task.id) {
        const agent = agentNodes.find((item) => item.id === task.agentId);
        if (agent) {
          await handleSelectAgentSession(agent, getPrimaryTask(agent));
        }
      }
      return;
    }
    window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('coworkDeleteSessionFailed') }));
  };

  const renderAgentNode = (agent: AgentSidebarAgentNode) => {
    const primaryTask = getPrimaryTask(agent);
    const externalTasks = getExternalTasks(agent);
    const displayAgent: AgentSidebarAgentNode = {
      ...agent,
      tasks: primaryTask ? [primaryTask] : [],
    };
    const isMainActive = primaryTask
      ? primaryTask.id === currentSessionId
      : agent.id === currentAgentId && !currentSessionId;

    return (
      <React.Fragment key={agent.id}>
        <AgentTreeNode
          agent={displayAgent}
          isActive={isMainActive}
          onEditAgent={(agent) => setSettingsAgentId(agent.id)}
          onSelectAgent={(agent) => void handleSelectAgent(agent)}
          onDeleteAgent={handleDeleteAgent}
          onShareAgentSession={(agent) => handleShareAgentSession(agent)}
          onToggleAgentPin={handleToggleAgentPin}
          onRetryLoadTasks={(agentId) => void retryLoadTasks(agentId)}
        />
        {externalTasks.map((task) => (
          <AgentSessionNode
            key={task.id}
            agent={agent}
            task={task}
            isActive={task.id === currentSessionId}
            onSelect={(agent, task) => void handleSelectAgentSession(agent, task)}
            onDelete={handleDeleteSession}
            onShare={(agent, task) => handleShareAgentSession(agent, task)}
          />
        ))}
      </React.Fragment>
    );
  };

  const pinnedAgentNodes = agentNodes.filter((agent) => agent.pinned);
  const projectAgentNodes = agentNodes.filter((agent) => !agent.pinned);
  const hasPinnedAgents = pinnedAgentNodes.length > 0;

  useEffect(() => {
    if (deletedSessionIds.length === 0) return;
    removeTaskPreviews(deletedSessionIds);
  }, [deletedSessionIds, removeTaskPreviews]);

  useEffect(() => {
    onBatchSelectableIdsChange([]);
  }, [onBatchSelectableIdsChange]);

  return (
    <div className="pb-3" role="tree" aria-label={i18nService.t('myAgents')}>
      <MyAgentSidebarHeader
        onCreateAgent={() => setIsCreateOpen(true)}
        onSearch={onSearch}
      />

      {hasPinnedAgents && (
        <div className="space-y-1.5 pb-1.5">
          {pinnedAgentNodes.map(renderAgentNode)}
        </div>
      )}

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
      ) : projectAgentNodes.length > 0 ? (
        <div className="space-y-1.5 px-0">
          {projectAgentNodes.map(renderAgentNode)}
        </div>
      ) : null}

      <AgentCreateModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <AgentSettingsPanel
        agentId={settingsAgentId}
        onClose={() => setSettingsAgentId(null)}
      />
    </div>
  );
};

export default MyAgentSidebarTree;
