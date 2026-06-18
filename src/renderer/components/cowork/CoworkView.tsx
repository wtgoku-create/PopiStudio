import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useRef,useState } from 'react';
import { useDispatch,useSelector } from 'react-redux';

import { buildSessionTitleFromInput } from '../../../common/sessionTitle';
import { authService } from '../../services/auth';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { appendPopiTVCanvasContext } from '../../services/popitvCanvasContext';
import { registerPopiTVCanvasAutoOpenHandler } from '../../services/popitvCanvasToolRouter';
import { quickActionService } from '../../services/quickAction';
import { RootState } from '../../store';
import {
  selectCoworkConfig,
  selectCurrentSession,
  selectIsStreaming,
} from '../../store/selectors/coworkSelectors';
import { addMessage, setCurrentSession, setStreaming, updateSessionStatus } from '../../store/slices/coworkSlice';
import { clearSelection,selectAction, setActions } from '../../store/slices/quickActionSlice';
import { clearActiveSkills, setActiveSkillIds } from '../../store/slices/skillSlice';
import type { CoworkImageAttachment, CoworkSession, OpenClawEngineStatus, SubagentSessionSummary } from '../../types/cowork';
import { toOpenClawModelRef } from '../../utils/openclawModelRef';
import { PromptPanel,QuickActionBar } from '../quick-actions';
import type { SettingsOpenOptions } from '../Settings';
import { useAgentSelectedModel } from './agentModelSelection';
import { CoworkUiEvent } from './constants';
import CoworkPromptInput, { type CoworkPromptInputRef } from './CoworkPromptInput';
import CoworkSessionDetail from './CoworkSessionDetail';
import { buildCoworkContinuationSystemPrompt, buildCoworkSystemPrompt } from './skillSystemPrompt';
import SubagentSessionDetail from './SubagentSessionDetail';

const POPITV_SKILL_ID = 'popitv';

const isPopiTVSession = (session: CoworkSession | null | undefined): boolean => {
  if (!session) return false;
  if (session.activeSkillIds.includes(POPITV_SKILL_ID)) return true;

  return session.messages.some(message => {
    const skillIds = (message.metadata as { skillIds?: unknown } | undefined)?.skillIds;
    return Array.isArray(skillIds) && skillIds.includes(POPITV_SKILL_ID);
  });
};

export interface CoworkViewProps {
  onRequestAppSettings?: (options?: SettingsOpenOptions) => void;
  onShowSkills?: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

const CoworkView: React.FC<CoworkViewProps> = ({ onShowSkills, isSidebarCollapsed, onToggleSidebar, onNewChat, updateBadge }) => {
  const dispatch = useDispatch();
  const [isInitialized, setIsInitialized] = useState(false);
  const [openClawStatus, setOpenClawStatus] = useState<OpenClawEngineStatus | null>(null);
  const [isRestartingGateway, setIsRestartingGateway] = useState(false);
  // Track if we're starting/continuing a session to prevent duplicate submissions
  const isStartingRef = useRef(false);
  const isContinuingRef = useRef(false);
  // Track pending start request so stop can cancel delayed startup.
  const pendingStartRef = useRef<{
    requestId: number;
    cancelled: boolean;
    cancellationAction: 'stop' | 'delete' | null;
  } | null>(null);
  const startRequestIdRef = useRef(0);
  // Ref for CoworkPromptInput
  const promptInputRef = useRef<CoworkPromptInputRef>(null);

  const currentSession = useSelector(selectCurrentSession);
  const isStreaming = useSelector(selectIsStreaming);
  const config = useSelector(selectCoworkConfig);
  const isLoggedIn = useSelector((state: RootState) => state.auth.isLoggedIn);
  const availableModels = useSelector((state: RootState) => state.model.availableModels);

  // Subagent detail view state
  const [viewingSubagent, setViewingSubagent] = useState<SubagentSessionSummary | null>(null);

  // Listen for subagent selection events from sidebar
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SubagentSessionSummary | null>).detail;
      setViewingSubagent(detail ?? null);
    };
    window.addEventListener(CoworkUiEvent.SelectSubagent, handler);
    return () => window.removeEventListener(CoworkUiEvent.SelectSubagent, handler);
  }, []);

  // Clear subagent view when session changes
  useEffect(() => {
    setViewingSubagent(null);
  }, [currentSession?.id]);

  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const skills = useSelector((state: RootState) => state.skill.skills);
  const quickActions = useSelector((state: RootState) => state.quickAction.actions);
  const selectedActionId = useSelector((state: RootState) => state.quickAction.selectedActionId);
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentAgent = agents.find((agent) => agent.id === currentAgentId);
  const currentAgentWorkingDirectory = currentAgent?.workingDirectory?.trim() || config.workingDirectory || '';
  const currentAgentSelectedModel = useAgentSelectedModel(currentAgentId, currentAgent?.model ?? '');
  const hasCurrentSessionMessages = Boolean(
    currentSession && ((currentSession.totalMessages ?? 0) > 0 || currentSession.messages.length > 0),
  );

  const resolveEngineStatusText = (status: OpenClawEngineStatus): string => {
    switch (status.phase) {
      case 'not_installed':
        return i18nService.t('coworkOpenClawNotInstalledNotice');
      case 'installing':
        return i18nService.t('coworkOpenClawInstalling');
      case 'ready':
        return i18nService.t('coworkOpenClawReadyNotice');
      case 'starting':
        return i18nService.t('coworkOpenClawStarting');
      case 'error':
        return i18nService.t('coworkOpenClawError');
      case 'running':
      default:
        return i18nService.t('coworkOpenClawRunning');
    }
  };

  const isOpenClawReadyForSession = (status: OpenClawEngineStatus | null): boolean => {
    if (!status) return false;
    return status.phase === 'running' || status.phase === 'ready';
  };

  const handleRestartGateway = async () => {
    if (isRestartingGateway) return;
    setIsRestartingGateway(true);
    try {
      await coworkService.restartOpenClawGateway();
    } catch (error) {
      console.error('[CoworkView] Failed to restart gateway:', error);
    } finally {
      setIsRestartingGateway(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      await coworkService.init();
      const initialEngineStatus = await coworkService.getOpenClawEngineStatus();
      if (initialEngineStatus) {
        setOpenClawStatus(initialEngineStatus);
      }
      // Load quick actions with localization
      try {
        quickActionService.initialize();
        const actions = await quickActionService.getLocalizedActions();
        dispatch(setActions(actions));
      } catch (error) {
        console.error('Failed to load quick actions:', error);
      }
      try {
        const apiConfig = await coworkService.checkApiConfig();
        if (apiConfig && !apiConfig.hasConfig) {
          if (!isLoggedIn) {
            await authService.login();
          }
        }
      } catch (error) {
        console.error('Failed to check cowork API config:', error);
      }
      setIsInitialized(true);
    };
    init();

    const unsubscribeOpenClawStatus = coworkService.onOpenClawEngineStatus((status) => {
      setOpenClawStatus(status);
    });

    // Subscribe to language changes to reload quick actions
    const unsubscribe = quickActionService.subscribe(async () => {
      try {
        const actions = await quickActionService.getLocalizedActions();
        dispatch(setActions(actions));
      } catch (error) {
        console.error('Failed to reload quick actions:', error);
      }
    });

    return () => {
      unsubscribe();
      unsubscribeOpenClawStatus();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  useEffect(() => {
    return registerPopiTVCanvasAutoOpenHandler(async sessionId => {
      const cowork = window.electron?.cowork;
      if (!cowork?.getSession) return false;

      const result = await cowork.getSession(sessionId);
      if (!result.success || !isPopiTVSession(result.session)) {
        return false;
      }

      const loadedSession = await coworkService.loadSession(sessionId);
      return isPopiTVSession(loadedSession);
    });
  }, []);

  const handleStartSession = async (prompt: string, skillPrompt?: string, imageAttachments?: CoworkImageAttachment[]): Promise<boolean | void> => {
    console.log('[CoworkView] handleStartSession: imageAttachments diagnosis', {
      hasImageAttachments: !!imageAttachments,
      count: imageAttachments?.length ?? 0,
      details: imageAttachments?.map(a => ({ name: a.name, mimeType: a.mimeType, base64Length: a.base64Data?.length ?? 0 })) ?? [],
    });
    if (openClawStatus && !isOpenClawReadyForSession(openClawStatus)) {
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('coworkErrorEngineNotReady') }));
      return false;
    }
    // Prevent duplicate submissions
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    const requestId = ++startRequestIdRef.current;
    pendingStartRef.current = { requestId, cancelled: false, cancellationAction: null };
    const isPendingStartCancelled = () => {
      const pending = pendingStartRef.current;
      return !pending || pending.requestId !== requestId || pending.cancelled;
    };
    const getPendingCancellationAction = () => {
      const pending = pendingStartRef.current;
      if (!pending || pending.requestId !== requestId || !pending.cancelled) {
        return null;
      }
      return pending.cancellationAction;
    };

    try {
      if (!isLoggedIn || availableModels.length === 0) {
        await authService.login();
        isStartingRef.current = false;
        return false;
      }

      try {
        const apiConfig = await coworkService.checkApiConfig();
        if (apiConfig && !apiConfig.hasConfig) {
          await authService.login();
          isStartingRef.current = false;
          return false;
        }
      } catch (error) {
        console.error('Failed to check cowork API config:', error);
      }

      // Capture active skill IDs before clearing them
      const sessionSkillIds = [...activeSkillIds];
      const existingSessionResult = await coworkService.listSessionsForAgentPreview(currentAgentId, 1, 0);
      const existingSessionSummary = existingSessionResult.success
        ? existingSessionResult.sessions?.[0]
        : null;

      if (existingSessionSummary) {
        const loadedSession = await coworkService.loadSession(existingSessionSummary.id);
        const popitvContextSkillIds = sessionSkillIds.length > 0
          ? sessionSkillIds
          : loadedSession?.activeSkillIds ?? [];
        const effectiveSkillPrompt = appendPopiTVCanvasContext(skillPrompt, {
          shouldInclude: popitvContextSkillIds.includes(POPITV_SKILL_ID),
          sessionId: existingSessionSummary.id,
        });
        const combinedSystemPrompt = buildCoworkContinuationSystemPrompt(effectiveSkillPrompt, config.systemPrompt);
        const sent = await coworkService.continueSession({
          sessionId: existingSessionSummary.id,
          prompt,
          systemPrompt: combinedSystemPrompt,
          activeSkillIds: sessionSkillIds.length > 0 ? sessionSkillIds : undefined,
          imageAttachments,
        });
        if (sent && sessionSkillIds.length > 0) {
          dispatch(clearActiveSkills());
        }
        dispatch(clearSelection());
        return sent;
      }

      // Create a temporary session with user message to show immediately
      const tempSessionId = `temp-${Date.now()}`;
      const fallbackTitle = buildSessionTitleFromInput(
        prompt,
        i18nService.t('coworkDefaultSessionTitle')
      );
      const now = Date.now();

      const tempSession: CoworkSession = {
        id: tempSessionId,
        title: fallbackTitle,
        claudeSessionId: null,
        status: 'running',
        pinned: false,
        createdAt: now,
        updatedAt: now,
        cwd: currentAgentWorkingDirectory,
        systemPrompt: '',
        modelOverride: currentAgentSelectedModel ? toOpenClawModelRef(currentAgentSelectedModel) : '',
        executionMode: config.executionMode || 'local',
        activeSkillIds: sessionSkillIds,
        agentId: currentAgentId,
        messages: [
          {
            id: `msg-${now}`,
            type: 'user',
            content: prompt,
            timestamp: now,
            metadata: (sessionSkillIds.length > 0 || (imageAttachments && imageAttachments.length > 0))
              ? {
                ...(sessionSkillIds.length > 0 ? { skillIds: sessionSkillIds } : {}),
                ...(imageAttachments && imageAttachments.length > 0 ? { imageAttachments } : {}),
              }
              : undefined,
          },
        ],
        messagesOffset: 0,
        totalMessages: 1,
      };

      // Immediately show the session detail page with user message
      dispatch(setCurrentSession(tempSession));
      dispatch(setStreaming(true));

      // Clear active skills and quick action selection after starting session
      // so they don't persist to next session
      dispatch(clearActiveSkills());
      dispatch(clearSelection());

      // Combine skill prompt with system prompt.
      // OpenClaw loads skills natively via skills.load.extraDirs, so skip the
      // auto-routing prompt to avoid injecting Claude SDK tool-calling instructions
      // that confuse non-Claude models (e.g. kimi-k2.5 falls back to text-based
      // tool calls, producing empty tool names and err=true failures).
      const effectiveSkillPrompt = appendPopiTVCanvasContext(skillPrompt, {
        shouldInclude: sessionSkillIds.includes(POPITV_SKILL_ID),
      });
      const combinedSystemPrompt = buildCoworkSystemPrompt(effectiveSkillPrompt, config.systemPrompt);

      // Start the actual session immediately with fallback title
      const sessionModelOverride = currentAgentSelectedModel ? toOpenClawModelRef(currentAgentSelectedModel) : '';
      console.log('[CoworkView] creating session:', { modelId: currentAgentSelectedModel?.id, providerKey: currentAgentSelectedModel?.providerKey, isServerModel: currentAgentSelectedModel?.isServerModel, sessionModelOverride, agentModel: currentAgent?.model });
      const { session: startedSession, error: startError } = await coworkService.startSession({
        prompt,
        title: fallbackTitle,
        cwd: currentAgentWorkingDirectory || undefined,
        systemPrompt: combinedSystemPrompt,
        activeSkillIds: sessionSkillIds,
        agentId: currentAgentId,
        modelOverride: sessionModelOverride,
        imageAttachments,
      });

      if (!startedSession && startError) {
        // Show the error as a system message in the temp session
        dispatch(addMessage({
          sessionId: tempSessionId,
          message: {
            id: `error-${Date.now()}`,
            type: 'system',
            content: i18nService.t('coworkErrorSessionStartFailed').replace('{error}', startError),
            timestamp: Date.now(),
          },
        }));
        dispatch(updateSessionStatus({ sessionId: tempSessionId, status: 'error' }));
        return;
      }

      // Stop immediately if user cancelled while startup request was in flight.
      if (isPendingStartCancelled() && startedSession) {
        await coworkService.stopSession(startedSession.id);
        if (getPendingCancellationAction() === 'delete') {
          await coworkService.deleteSession(startedSession.id);
        }
      }
    } finally {
      if (pendingStartRef.current?.requestId === requestId) {
        pendingStartRef.current = null;
      }
      isStartingRef.current = false;
    }
  };

  const handleContinueSession = async (prompt: string, skillPrompt?: string, imageAttachments?: CoworkImageAttachment[]) => {
    if (!currentSession) return false;
    // Prevent duplicate submissions
    if (isContinuingRef.current) return false;
    if (openClawStatus && !isOpenClawReadyForSession(openClawStatus)) {
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('coworkErrorEngineNotReady') }));
      return false;
    }

    isContinuingRef.current = true;
    try {
      console.log('[CoworkView] handleContinueSession called', {
        hasImageAttachments: !!imageAttachments,
        imageAttachmentsCount: imageAttachments?.length ?? 0,
        imageAttachmentsNames: imageAttachments?.map(a => a.name),
        imageAttachmentsBase64Lengths: imageAttachments?.map(a => a.base64Data.length),
      });

      // Capture active skill IDs before clearing
      const sessionSkillIds = [...activeSkillIds];

      // Only send a continuation system prompt when this turn selects new skills.
      // Otherwise the main process falls back to the session prompt created on the first turn.
      const popitvContextSkillIds = sessionSkillIds.length > 0
        ? sessionSkillIds
        : currentSession.activeSkillIds;
      const effectiveSkillPrompt = appendPopiTVCanvasContext(skillPrompt, {
        shouldInclude: popitvContextSkillIds.includes(POPITV_SKILL_ID),
        sessionId: currentSession.id,
      });
      const combinedSystemPrompt = buildCoworkContinuationSystemPrompt(effectiveSkillPrompt, config.systemPrompt);

      const sent = await coworkService.continueSession({
        sessionId: currentSession.id,
        prompt,
        systemPrompt: combinedSystemPrompt,
        activeSkillIds: sessionSkillIds.length > 0 ? sessionSkillIds : undefined,
        imageAttachments,
      });
      if (sent && sessionSkillIds.length > 0) {
        dispatch(clearActiveSkills());
      }
      return sent;
    } finally {
      isContinuingRef.current = false;
    }
  };

  const handleHomeSubmit = async (
    prompt: string,
    skillPrompt?: string,
    imageAttachments?: CoworkImageAttachment[],
  ): Promise<boolean | void> => {
    if (currentSession && !hasCurrentSessionMessages) {
      return handleContinueSession(prompt, skillPrompt, imageAttachments);
    }
    return handleStartSession(prompt, skillPrompt, imageAttachments);
  };

  const handleStopSession = async () => {
    if (!currentSession) return;
    if (currentSession.id.startsWith('temp-') && pendingStartRef.current) {
      pendingStartRef.current.cancelled = true;
      pendingStartRef.current.cancellationAction = 'stop';
    }
    await coworkService.stopSession(currentSession.id);
  };

  // Get selected quick action
  const selectedAction = React.useMemo(() => {
    return quickActions.find(action => action.id === selectedActionId);
  }, [quickActions, selectedActionId]);

  // Handle quick action button click: select action + activate skill in one batch
  const handleActionSelect = (actionId: string) => {
    dispatch(selectAction(actionId));
    const action = quickActions.find(a => a.id === actionId);
    if (action) {
      const targetSkill = skills.find(s => s.id === action.skillMapping);
      if (targetSkill) {
        dispatch(setActiveSkillIds([targetSkill.id]));
      }
    }
  };

  // When the mapped skill is deactivated from input area, restore the QuickActionBar
  useEffect(() => {
    if (!selectedActionId) return;
    const action = quickActions.find(a => a.id === selectedActionId);
    if (action) {
      const skillStillActive = activeSkillIds.includes(action.skillMapping);
      if (!skillStillActive) {
        dispatch(clearSelection());
      }
    }
  }, [activeSkillIds, dispatch, quickActions, selectedActionId]);

  // Handle prompt selection from QuickAction
  const handleQuickActionPromptSelect = (prompt: string) => {
    // Fill the prompt into input
    promptInputRef.current?.setValue(prompt);
    promptInputRef.current?.focus();
  };

  useEffect(() => {
    const handleNewSession = () => {
      // Only clear when already on home (no session) — preserve __home__ draft when returning from a session
      const shouldClear = !currentSession;
      coworkService.clearSession({ restoreAgentSkills: true });
      dispatch(clearSelection());
      window.dispatchEvent(new CustomEvent('cowork:focus-input', {
        detail: { clear: shouldClear },
      }));
    };
    window.addEventListener('cowork:shortcut:new-session', handleNewSession);
    return () => {
      window.removeEventListener('cowork:shortcut:new-session', handleNewSession);
    };
  }, [dispatch, currentSession]);

  useEffect(() => {
    if (!currentSession || currentSession.status !== 'running') return;

    const runningSessionId = currentSession.id;
    const handleWindowFocus = () => {
      void coworkService.loadSession(runningSessionId);
    };

    window.addEventListener('focus', handleWindowFocus);
    return () => {
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [currentSession]);

  if (!isInitialized) {
    return (
      <div className="flex-1 h-full flex flex-col bg-background">
        <div className="draggable flex h-12 items-center justify-end px-4 border-b border-border shrink-0">
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-secondary">
            {i18nService.t('loading')}
          </div>
        </div>
      </div>
    );
  }

  const shouldShowEngineStatus = Boolean(openClawStatus && openClawStatus.phase !== 'running');
  const isEngineError = openClawStatus?.phase === 'error';
  const isEngineReady = isOpenClawReadyForSession(openClawStatus);

  const homeHeader = (
    <div className="draggable flex h-12 items-center justify-between px-4 shrink-0">
      <div className="non-draggable h-8 flex items-center">
        {/* {isSidebarCollapsed && (
          <div className={`flex items-center gap-1 mr-2 ${isMac ? 'pl-[68px]' : ''}`}>
            <button
              type="button"
              onClick={onToggleSidebar}
              className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-secondary hover:bg-surface-raised transition-colors"
            >
              <SidebarToggleIcon className="h-4 w-4" isCollapsed={true} />
            </button>
            <button
              type="button"
              onClick={onNewChat}
              className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-secondary hover:bg-surface-raised transition-colors"
            >
              <ComposeIcon className="h-4 w-4" />
            </button>
            {updateBadge}
          </div>
        )} */}
      </div>
      <div className="non-draggable flex items-center">
        <div className="flex items-center gap-1.5 mr-2 px-2.5 py-1">
          <ShieldCheckIcon className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
          <span className="text-xs text-green-600 dark:text-green-400 whitespace-nowrap">
            {i18nService.t('lobsterGuardEnabled')}
          </span>
        </div>
      </div>
    </div>
  );

  // Engine status banner for error/non-running states (starting overlay is now global in App.tsx)
  const engineStatusBanner = shouldShowEngineStatus && openClawStatus && openClawStatus.phase !== 'starting' ? (
    <div className={`shrink-0 flex items-center justify-between px-4 py-2 text-xs ${isEngineError
      ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
      : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
    }`}>
      <div className="flex items-center gap-2">
        <span>{resolveEngineStatusText(openClawStatus)}</span>
        {typeof openClawStatus.progressPercent === 'number' && (
          <span className="opacity-70">({Math.round(openClawStatus.progressPercent)}%)</span>
        )}
      </div>
      <button
        type="button"
        onClick={handleRestartGateway}
        disabled={isRestartingGateway}
        className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isEngineError
          ? 'bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600'
          : 'bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600'
        }`}
      >
        {i18nService.t('coworkOpenClawRestartGateway')}
      </button>
    </div>
  ) : null;

  // When viewing a subagent, show the subagent detail view
  if (viewingSubagent) {
    return (
      <div className="flex-1 flex flex-col h-full">
        {engineStatusBanner}
        <SubagentSessionDetail
          subagent={viewingSubagent}
          onBack={() => {
            setViewingSubagent(null);
            window.dispatchEvent(new CustomEvent(CoworkUiEvent.SelectSubagent, { detail: null }));
          }}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          onNewChat={onNewChat}
          updateBadge={updateBadge}
        />
      </div>
    );
  }

  // When there's a current session with chat messages, show the session detail view.
  // Empty agentHome sessions still use the home prompt state.
  if (currentSession && hasCurrentSessionMessages) {
    return (
      <div className="flex-1 flex flex-col h-full">
        {engineStatusBanner}
        <CoworkSessionDetail
          onManageSkills={() => onShowSkills?.()}
          onContinue={handleContinueSession}
          onStop={handleStopSession}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          onNewChat={onNewChat}
          updateBadge={updateBadge}
        />
      </div>
    );
  }

  // Home view - no current session, or current session has no chat messages yet
  return (
    <div className="flex-1 flex flex-col bg-background h-full">
      {/* Engine status banner for error states */}
      {engineStatusBanner}

      {/* Header */}
      {homeHeader}

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto min-h-0 relative">
        <div className="relative flex min-h-full w-full min-w-[320px] flex-col items-center px-4 pt-[clamp(88px,19vh,140px)] pb-8">
          {/* Welcome Section - staggered entrance animation */}
          <div className="w-full max-w-3xl text-center">
            <img
              src="popi_mcn.png"
              alt="Popiai"
              className="mx-auto h-8 animate-fade-in-up"
            />
            <p
              className="mt-4 text-[15px] font-normal leading-6 text-secondary animate-fade-in-up"
              style={{ animationDelay: '120ms', animationFillMode: 'both' }}
            >
              {i18nService.t('coworkDescription')}
            </p>
          </div>

          {/* Prompt Input Area - Large version with folder selector */}
          <div
            className="mt-9 w-full max-w-3xl animate-fade-in-up"
            style={{ animationDelay: '180ms', animationFillMode: 'both' }}
          >
            <CoworkPromptInput
              ref={promptInputRef}
              onSubmit={handleHomeSubmit}
              onStop={handleStopSession}
              isStreaming={isStreaming}
              disabled={!isEngineReady}
              placeholder={i18nService.t('coworkPlaceholder')}
              size="large"
              workingDirectory={currentAgentWorkingDirectory}
              showFolderSelector={true}
              showModelSelector={true}
              showAgentSelector={true}
              onManageSkills={() => onShowSkills?.()}
            />
          </div>

          {/* Quick Actions */}
          <div
            className="mt-8 w-full max-w-3xl space-y-4 animate-fade-in-up"
            style={{ animationDelay: '260ms', animationFillMode: 'both' }}
          >
            {selectedAction ? (
              <PromptPanel
                action={selectedAction}
                onPromptSelect={handleQuickActionPromptSelect}
              />
            ) : (
              <QuickActionBar actions={quickActions} onActionSelect={handleActionSelect} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoworkView;
