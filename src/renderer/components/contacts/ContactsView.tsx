import {
  ChatBubbleOvalLeftEllipsisIcon,
  Cog6ToothIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import type { AgentSummary } from '../../store/slices/agentSlice';
import { getAgentDisplayName, isDefaultAgentId } from '../../utils/agentDisplay';
import AgentAvatarIcon from '../agent/AgentAvatarIcon';
import AgentConfirmDialog from '../agent/AgentConfirmDialog';
import AgentSettingsPanel from '../agent/AgentSettingsPanel';
import { AgentConfirmDialogVariant } from '../agent/constants';
import TrashIcon from '../icons/TrashIcon';

interface ContactsViewProps {
  onShowCowork: () => void;
}

const DEFAULT_CONTACTS_PANEL_WIDTH = 306;
const MIN_CONTACTS_PANEL_WIDTH = 260;
const MAX_CONTACTS_PANEL_WIDTH = 420;

const getAgentSearchText = (agent: AgentSummary): string => {
  return `${getAgentDisplayName(agent)} ${agent.description} ${agent.model}`.toLowerCase();
};

const ContactsView: React.FC<ContactsViewProps> = ({ onShowCowork }) => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const loading = useSelector((state: RootState) => state.agent.loading);
  const [query, setQuery] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const [deleteAgent, setDeleteAgent] = useState<AgentSummary | null>(null);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_CONTACTS_PANEL_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(DEFAULT_CONTACTS_PANEL_WIDTH);

  useEffect(() => {
    void agentService.loadAgents();
  }, []);

  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const enabledAgents = agents.filter(agent => agent.enabled);
    if (!normalizedQuery) return enabledAgents;
    return enabledAgents.filter(agent => getAgentSearchText(agent).includes(normalizedQuery));
  }, [agents, query]);

  const selectedAgent = useMemo(() => {
    if (!selectedAgentId) return null;
    return filteredAgents.find(agent => agent.id === selectedAgentId) ?? null;
  }, [filteredAgents, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) return;
    if (filteredAgents.some(agent => agent.id === selectedAgentId)) return;
    setSelectedAgentId(null);
  }, [filteredAgents, selectedAgentId]);

  const handleResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      isResizingRef.current = true;
      setIsResizing(true);
      resizeStartXRef.current = event.clientX;
      resizeStartWidthRef.current = panelWidth;
      document.body.classList.add('select-none');

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizingRef.current) return;
        const nextWidth = resizeStartWidthRef.current + moveEvent.clientX - resizeStartXRef.current;
        setPanelWidth(
          Math.min(MAX_CONTACTS_PANEL_WIDTH, Math.max(MIN_CONTACTS_PANEL_WIDTH, nextWidth)),
        );
      };

      const handleMouseUp = () => {
        isResizingRef.current = false;
        setIsResizing(false);
        document.body.classList.remove('select-none');
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [panelWidth],
  );

  useEffect(() => {
    return () => {
      document.body.classList.remove('select-none');
    };
  }, []);

  const showToast = useCallback((message: string) => {
    window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
  }, []);

  const openAgentEntry = useCallback(
    async (agent: AgentSummary): Promise<void> => {
      agentService.switchAgent(agent.id);
      onShowCowork();
      await coworkService.loadSessions(agent.id);
      coworkService.clearSession({ restoreAgentSkills: true });
    },
    [onShowCowork],
  );

  const handleMessageAgent = useCallback(
    async (agent: AgentSummary) => {
      await openAgentEntry(agent);
    },
    [openAgentEntry],
  );

  const handleDeleteAgent = useCallback(async () => {
    if (!deleteAgent) return;
    if (isDefaultAgentId(deleteAgent.id)) {
      showToast(i18nService.t('agentDefaultCannotDelete'));
      setDeleteAgent(null);
      return;
    }

    const success = await agentService.deleteAgent(deleteAgent.id);
    if (success) {
      setSelectedAgentId(previousId => (previousId === deleteAgent.id ? null : previousId));
      setDeleteAgent(null);
      return;
    }
    showToast(i18nService.t('agentDeleteFailed'));
  }, [deleteAgent, showToast]);

  const actionCards = selectedAgent
    ? [
        {
          key: 'message',
          label: i18nService.t('contactsSendMessage'),
          icon: ChatBubbleOvalLeftEllipsisIcon,
          onClick: () => void handleMessageAgent(selectedAgent),
          tone: 'normal',
        },
        {
          key: 'settings',
          label: i18nService.t('contactsSettings'),
          icon: Cog6ToothIcon,
          onClick: () => setSettingsAgentId(selectedAgent.id),
          tone: 'normal',
        },
        {
          key: 'delete',
          label: i18nService.t('delete'),
          icon: TrashIcon,
          onClick: () => setDeleteAgent(selectedAgent),
          tone: 'danger',
        },
      ]
    : [];

  return (
    <>
      <div className="flex h-full min-h-0 gap-[6px] bg-surface-raised p-[10px] pl-0 pt-0">
        <aside
          className={`relative shrink-0 ${isResizing ? '' : 'sidebar-transition'}`}
          style={{ width: panelWidth }}
        >
          <div
            className="flex h-full flex-col overflow-hidden rounded-xl bg-background"
            style={{ width: panelWidth }}
          >
            <div className="draggable flex h-12 shrink-0 items-center px-4">
              <h1 className="text-lg font-semibold text-foreground">
                {i18nService.t('contactsTitle')}
              </h1>
            </div>

            <div className="shrink-0 px-3 pb-3">
              <label className="flex h-[34px] items-center gap-2 rounded-lg border border-transparent bg-surface-raised/70 px-3 text-[13px] font-medium transition-colors hover:border-border hover:bg-surface focus-within:border-border focus-within:bg-surface dark:bg-white/[0.04] dark:hover:bg-white/[0.06] dark:focus-within:bg-white/[0.06]">
                <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-secondary/70" />
                <input
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted"
                  placeholder={i18nService.t('contactsSearchPlaceholder')}
                  aria-label={i18nService.t('contactsSearchPlaceholder')}
                />
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              <div className="px-2 pb-2 text-xs font-medium text-secondary">
                {i18nService.t('contactsAgentSection')}
              </div>
              {loading && filteredAgents.length === 0 ? (
                <div className="px-2 py-8 text-center text-sm text-secondary">
                  {i18nService.t('folderLoading')}
                </div>
              ) : filteredAgents.length === 0 ? (
                <div className="px-2 py-8 text-center text-sm text-secondary">
                  {i18nService.t('contactsAgentsEmpty')}
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredAgents.map(agent => {
                    const isActive = agent.id === selectedAgent?.id;
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => setSelectedAgentId(agent.id)}
                        className={`group relative h-[58px] w-full rounded-lg text-left text-foreground transition-colors hover:bg-[#f0edf9] dark:hover:bg-white/[0.06] ${
                          isActive
                            ? 'bg-[#f0edf9] dark:bg-white/[0.06]'
                            : 'bg-white dark:bg-transparent'
                        }`}
                      >
                        <span className="flex h-full w-full items-center gap-2 rounded-lg bg-transparent px-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-transparent leading-none text-foreground dark:border-white/[0.12]">
                            <AgentAvatarIcon
                              value={agent.icon}
                              fallbackText={getAgentDisplayName(agent).slice(0, 1)}
                              className="h-8 w-8"
                              iconClassName="h-4 w-4"
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {getAgentDisplayName(agent)}
                              </span>
                              {/* {agent.source === 'preset' && (
                                <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                  {i18nService.t('contactsAgentBadge')}
                                </span>
                              )} */}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-secondary">
                              {agent.description || '-'}
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <div
            className="non-draggable group absolute right-[-6px] top-0 z-20 h-full w-[6px] cursor-col-resize"
            onMouseDown={handleResizeStart}
          >
            <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-primary/60 group-active:bg-primary" />
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-background">
          {selectedAgent ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8">
              <div className="flex w-full max-w-[520px] flex-col items-center gap-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-transparent leading-none text-foreground dark:border-white/[0.12]">
                  <AgentAvatarIcon
                    value={selectedAgent.icon}
                    fallbackText={getAgentDisplayName(selectedAgent).slice(0, 1)}
                    className="h-18 w-18"
                    iconClassName="h-10 w-10"
                    legacyClassName="text-5xl"
                  />
                </div>

                <div className="flex flex-col items-center">
                  <h2 className="max-w-full truncate text-lg font-medium leading-6 text-foreground">
                    {getAgentDisplayName(selectedAgent)}
                  </h2>
                  <p className="mt-1 max-w-md text-center text-sm leading-5 text-secondary">
                    {selectedAgent.description || '-'}
                  </p>
                </div>

                <div className="grid w-full max-w-[420px] grid-cols-3 gap-[5px]">
                  {actionCards.map(action => {
                    const Icon = action.icon;
                    const isDanger = action.tone === 'danger';
                    return (
                      <button
                        key={action.key}
                        type="button"
                        onClick={action.onClick}
                        disabled={action.key === 'delete' && isDefaultAgentId(selectedAgent.id)}
                        className={`flex min-h-[76px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl bg-[#eeeeee] px-3 py-3 text-center transition-colors dark:bg-white/[0.04] ${
                          isDanger
                            ? 'text-destructive hover:bg-destructive/15 disabled:cursor-not-allowed disabled:opacity-45'
                            : 'text-foreground hover:bg-[#e7e2f1] dark:hover:bg-white/[0.07]'
                        }`}
                      >
                        <Icon className="h-6 w-6 shrink-0" />
                        <span className="max-w-full truncate text-base font-medium leading-5">
                          {action.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center px-8">
              <div
                className="flex flex-col items-center justify-center gap-1.5"
                aria-label={i18nService.t('contactsDefaultBrand')}
              >
                <img src="popi_mcn.png" className="h-8" alt="popi_mcn" />
                <span className="text-center text-[16px] text-secondary dark:text-white/60">
                  {i18nService.t('contactsCreateAgentHint')}
                </span>
              </div>
            </div>
          )}
        </main>
      </div>

      <AgentSettingsPanel agentId={settingsAgentId} onClose={() => setSettingsAgentId(null)} />

      {deleteAgent && (
        <AgentConfirmDialog
          variant={AgentConfirmDialogVariant.Delete}
          title={i18nService.t('agentDeleteConfirmTitle')}
          message={i18nService
            .t('agentDeleteConfirmMessage')
            .replace('{name}', getAgentDisplayName(deleteAgent))}
          cancelLabel={i18nService.t('cancel')}
          confirmLabel={i18nService.t('delete')}
          onCancel={() => setDeleteAgent(null)}
          onConfirm={() => void handleDeleteAgent()}
        />
      )}
    </>
  );
};

export default ContactsView;
