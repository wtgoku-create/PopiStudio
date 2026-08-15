import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { AgentId } from '../../../shared/agent';
import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { selectCurrentSessionId } from '../../store/selectors/coworkSelectors';
import { isDefaultAgentId } from '../../utils/agentDisplay';
import AgentAddFriendModal from '../agent/AgentAddFriendModal';
import AgentCreateModal from '../agent/AgentCreateModal';
import AgentSettingsPanel from '../agent/AgentSettingsPanel';
import { type CoworkOpenShareOptionsEventDetail, CoworkUiEvent } from '../cowork/constants';
import AgentTaskRow from './AgentTaskRow';
import AgentTreeNode from './AgentTreeNode';
import ExpandAgentTasksRow from './ExpandAgentTasksRow';
import MyAgentSidebarHeader from './MyAgentSidebarHeader';
import type { AgentSidebarAgentNode, AgentSidebarTaskNode } from './types';
import { useAgentSidebarState } from './useAgentSidebarState';

const AGENT_TASKS_TRANSITION_MS = 200;

const AgentTaskGroup: React.FC<{
  isExpanded: boolean;
  children: React.ReactNode;
}> = ({ isExpanded, children }) => {
  const [shouldRender, setShouldRender] = useState(isExpanded);
  const [isVisible, setIsVisible] = useState(isExpanded);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const previousExpandedRef = useRef(isExpanded);

  useEffect(() => {
    let animationFrame: number | undefined;
    let transitionTimeout: number | undefined;
    const wasExpanded = previousExpandedRef.current;
    previousExpandedRef.current = isExpanded;

    if (wasExpanded === isExpanded) {
      return undefined;
    }

    if (isExpanded) {
      setShouldRender(true);
      setIsVisible(false);
      setIsTransitioning(true);
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = window.requestAnimationFrame(() => {
          setIsVisible(true);
          transitionTimeout = window.setTimeout(() => {
            setIsTransitioning(false);
          }, AGENT_TASKS_TRANSITION_MS);
        });
      });
    } else {
      setIsTransitioning(true);
      setIsVisible(false);
      transitionTimeout = window.setTimeout(() => {
        setShouldRender(false);
        setIsTransitioning(false);
      }, AGENT_TASKS_TRANSITION_MS);
    }

    return () => {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (transitionTimeout !== undefined) {
        window.clearTimeout(transitionTimeout);
      }
    };
  }, [isExpanded]);

  if (!shouldRender) return null;

  return (
    <div
      className={`grid w-full min-w-0 max-w-full transition-all duration-200 ease-out motion-reduce:transition-none ${
        isVisible ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div
        className={`min-h-0 min-w-0 max-w-full ${
          isVisible && !isTransitioning ? 'overflow-visible' : 'overflow-hidden'
        } ${isVisible ? '' : 'pointer-events-none'}`}
        role="group"
        aria-hidden={!isExpanded}
      >
        {children}
      </div>
    </div>
  );
};

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
  isBatchMode,
  batchAgentId,
  deletedSessionIds,
  selectedIds,
  onShowCowork,
  onToggleSelection,
  onEnterBatchMode,
  onBatchSelectableIdsChange,
  onSearch,
}) => {
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const [isAddFriendOpen, setIsAddFriendOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const {
    agentNodes,
    patchTaskPreview,
    removeTaskPreview,
    removeTaskPreviews,
    removeAgentTaskPreviews,
    retryLoadTasks,
    loadMoreTasks,
    collapseTasks,
    collapseAgent,
    toggleAgentExpanded,
  } = useAgentSidebarState();

  const visibleAgentNodes = useMemo(() => agentNodes
    .map((agent) => ({
      ...agent,
      canExpandTasks: agent.canExpandTasks,
      canCollapseTasks: agent.canCollapseTasks,
    })), [agentNodes]);
  const isBatchSelectableTask = useCallback((_task: AgentSidebarTaskNode) => true, []);
  const getChildTasks = useCallback((agent: AgentSidebarAgentNode) => agent.tasks, []);
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

  const handleCreateTask = async (agent: AgentSidebarAgentNode) => {
    if (agent.id !== currentAgentId) {
      agentService.switchAgent(agent.id);
      await coworkService.loadSessions(agent.id);
    }
    coworkService.clearSession();
    onShowCowork();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('cowork:focus-input', {
        detail: { clear: false },
      }));
    }, 0);
  };

  const handleDeleteAgent = async (agent: AgentSidebarAgentNode) => {
    if (isDefaultAgentId(agent.id)) {
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('agentDefaultCannotDelete') }));
      return;
    }

    const deleted = await agentService.deleteAgent(agent.id);
    if (deleted) {
      removeAgentTaskPreviews(agent.id);
      if (settingsAgentId === agent.id) {
        setSettingsAgentId(null);
      }
      return;
    }

    window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('agentDeleteFailed') }));
  };

  const handleToggleAgentPin = async (agent: AgentSidebarAgentNode, pinned: boolean) => {
    const updated = await agentService.updateAgent(agent.id, { pinned });
    if (!updated) {
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('agentSaveFailed') }));
    }
  };

  const handleReturnToMainAgent = async () => {
    agentService.switchAgent(AgentId.Main);
    onShowCowork();

    const result = await coworkService.listAgentSidebarSessions();
    const mainTaskSession = result.success
      ? result.sessions?.find((session) => (
        (session.agentId?.trim() || AgentId.Main) === AgentId.Main
      ))
      : null;

    if (mainTaskSession) {
      await coworkService.loadSession(mainTaskSession.id);
      return;
    }

    await coworkService.loadSessions(AgentId.Main);
    coworkService.clearSession();
  };

  const handleDeleteSession = async (task: AgentSidebarTaskNode) => {
    const deleted = await coworkService.deleteSession(task.id);
    if (deleted) {
      removeTaskPreview(task.id);
      if (currentSessionId === task.id) {
        const nextAgent = agentNodes.find((item) => (
          item.id === task.agentId
          && item.tasks.some((candidate) => candidate.id !== task.id)
        ));
        const nextTask = nextAgent?.tasks.find((candidate) => (
          candidate.id !== task.id
        ));
        if (nextAgent && nextTask) {
          await handleSelectAgentSession(nextAgent, nextTask);
        } else {
          await handleReturnToMainAgent();
        }
      }
      return;
    }
    window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('coworkDeleteSessionFailed') }));
  };

  const handleToggleTaskPin = async (task: AgentSidebarTaskNode, pinned: boolean) => {
    const result = await coworkService.setSessionPinned(task.id, pinned);
    if (result.success) {
      patchTaskPreview(task.id, { pinned, pinOrder: result.pinOrder }, { preserveUpdatedAt: true });
      return;
    }
    window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('failedToSaveSettings') }));
  };

  const handleRenameTask = async (task: AgentSidebarTaskNode, title: string) => {
    const renamed = await coworkService.renameSession(task.id, title);
    if (renamed) {
      patchTaskPreview(task.id, { title }, { preserveUpdatedAt: true });
      return;
    }
    window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('failedToSaveSettings') }));
  };

  const renderTaskRow = (agent: AgentSidebarAgentNode, task: AgentSidebarTaskNode) => (
      <AgentTaskRow
        key={`${agent.id}:${task.id}`}
        task={task}
        isBatchMode={isBatchMode && (!batchAgentId || batchAgentId === agent.id)}
        isSelected={selectedIds.has(task.id)}
        isSelectionDisabled={
          (isBatchMode && batchAgentId !== null && batchAgentId !== agent.id)
          || (isBatchMode && !isBatchSelectableTask(task))
        }
        showBatchOption={!isBatchMode && agent.tasks.some(isBatchSelectableTask)}
        onSelect={() => void handleSelectAgentSession(agent, task)}
        onDelete={() => handleDeleteSession(task)}
        onShare={() => handleShareAgentSession(agent, task)}
        onTogglePin={(pinned) => handleToggleTaskPin(task, pinned)}
        onRename={(title) => handleRenameTask(task, title)}
        onToggleSelection={() => onToggleSelection(task.id, task.agentId)}
        onEnterBatchMode={() => {
          onEnterBatchMode(task.id, task.agentId);
        }}
      />
  );

  const renderAgentNode = (agent: AgentSidebarAgentNode) => {
    const childTasks = getChildTasks(agent);
    const isAgentActive = agent.id === currentAgentId && !currentSessionId;

    return (
      <div key={agent.id} className="space-y-1">
        <AgentTreeNode
          agent={agent}
          isActive={isAgentActive}
          onToggleExpanded={toggleAgentExpanded}
          onEditAgent={(agent) => setSettingsAgentId(agent.id)}
          onCreateTask={(agent) => void handleCreateTask(agent)}
          onDeleteAgent={(agent) => handleDeleteAgent(agent)}
          onToggleAgentPin={(agent, pinned) => handleToggleAgentPin(agent, pinned)}
          onRetryLoadTasks={(agentId) => void retryLoadTasks(agentId)}
        />
        <AgentTaskGroup isExpanded={agent.isExpanded}>
          <div className="space-y-1">
            {childTasks.length > 0 ? (
              childTasks.map((task) => renderTaskRow(agent, task))
            ) : (
              <div className="flex h-9 w-full items-center pl-9 pr-3 text-[13px] text-secondary">
                {i18nService.t('myAgentSidebarNoTasks')}
              </div>
            )}
            {(agent.canExpandTasks || agent.canCollapseTasks) && (
              <ExpandAgentTasksRow
                isLoading={agent.isLoadingTasks}
                label={agent.canExpandTasks
                  ? i18nService.t('myAgentSidebarExpandMore')
                  : i18nService.t('myAgentSidebarCollapse')}
                onClick={() => {
                  if (agent.canExpandTasks) {
                    void loadMoreTasks(agent.id);
                  } else {
                    collapseTasks(agent.id);
                  }
                }}
                secondaryLabel={agent.canExpandTasks && agent.canCollapseTasks
                  ? i18nService.t('myAgentSidebarCollapse')
                  : undefined}
                onSecondaryClick={agent.canExpandTasks && agent.canCollapseTasks
                  ? () => collapseTasks(agent.id)
                  : undefined}
              />
            )}
          </div>
        </AgentTaskGroup>
      </div>
    );
  };

  useEffect(() => {
    if (deletedSessionIds.length === 0) return;
    removeTaskPreviews(deletedSessionIds);
  }, [deletedSessionIds, removeTaskPreviews]);

  useEffect(() => {
    const handleCollapseCurrentAgentTasks = () => {
      collapseTasks(currentAgentId);
      collapseAgent(currentAgentId);
      onShowCowork();
    };
    window.addEventListener(CoworkUiEvent.CollapseCurrentAgentTasks, handleCollapseCurrentAgentTasks);
    return () => window.removeEventListener(CoworkUiEvent.CollapseCurrentAgentTasks, handleCollapseCurrentAgentTasks);
  }, [collapseAgent, collapseTasks, currentAgentId, onShowCowork]);

  useEffect(() => {
    const batchScopedAgentNodes = batchAgentId
      ? visibleAgentNodes.filter((agent) => agent.id === batchAgentId)
      : visibleAgentNodes;
    onBatchSelectableIdsChange(batchScopedAgentNodes.flatMap((agent) => (
      agent.tasks
        .filter(isBatchSelectableTask)
        .map((task) => task.id)
    )));
  }, [batchAgentId, isBatchSelectableTask, onBatchSelectableIdsChange, visibleAgentNodes]);

  return (
    <div className="pb-3" role="tree" aria-label={i18nService.t('myAgents')}>
      <MyAgentSidebarHeader
        onAddFriend={() => setIsAddFriendOpen(true)}
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
      ) : visibleAgentNodes.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-xs font-medium text-secondary">
            {i18nService.t('myAgentSidebarNoTasks')}
          </p>
        </div>
      ) : (
        <div className="space-y-1 px-0">
          {visibleAgentNodes.map(renderAgentNode)}
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
