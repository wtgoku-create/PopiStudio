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
  } = useAgentSidebarState();

  useEffect(() => {
    void agentService.loadAgents();
  }, []);

  const handleSelectAgentSession = async (
    agent: AgentSidebarAgentNode,
    task: AgentSidebarTaskNode,
  ) => {
    if (agent.id !== currentAgentId) {
      agentService.switchAgent(agent.id);
      await coworkService.loadSessions(agent.id);
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
        const agent = agentNodes.find((item) => item.id === task.agentId);
        const nextTask = agent?.tasks[0];
        if (agent && nextTask) {
          await handleSelectAgentSession(agent, nextTask);
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
    <div className="pb-3" role="tree" aria-label={i18nService.t('myAgents')}>
      <MyAgentSidebarHeader
        onCreateAgent={() => setIsCreateOpen(true)}
        onSearch={onSearch}
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
      ) : (
        <div className="space-y-1.5 px-0">
          {agentNodes.map(renderSessionNode)}
        </div>
      )}

      <AgentCreateModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <AgentSettingsPanel
        agentId={settingsAgentId}
        onClose={() => setSettingsAgentId(null)}
      />
    </div>
  );
};

export default MyAgentSidebarTree;
