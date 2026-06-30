import { AgentId } from '@shared/agent';
import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import type { CoworkSessionSummary } from '../../types/cowork';
import { CoworkSessionStatusValue } from '../../types/cowork';
import { getAgentDisplayNameById } from '../../utils/agentDisplay';
import Modal from '../common/Modal';

const SESSION_LIMIT = 100;

const getSessionAgentId = (session: CoworkSessionSummary): string => (
  session.agentId?.trim() || AgentId.Main
);

interface KnowledgeSessionUploadModalProps {
  isOpen: boolean;
  knowledgeBaseName: string;
  isUploading: boolean;
  progressText: string;
  onCancel: () => void;
  onSubmit: (sessions: CoworkSessionSummary[]) => void;
}

const KnowledgeSessionUploadModal: React.FC<KnowledgeSessionUploadModalProps> = ({
  isOpen,
  knowledgeBaseName,
  isUploading,
  progressText,
  onCancel,
  onSubmit,
}) => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const [sessions, setSessions] = useState<CoworkSessionSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const agentNameBySessionId = useMemo(() => {
    const names = new Map<string, string>();
    sessions.forEach((session) => {
      const agentId = getSessionAgentId(session);
      names.set(session.id, getAgentDisplayNameById(agentId, agents) ?? agentId);
    });
    return names;
  }, [agents, sessions]);

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) => {
      const agentName = agentNameBySessionId.get(session.id) ?? '';
      return session.title.toLowerCase().includes(query)
        || (session.lastMessagePreview ?? '').toLowerCase().includes(query)
        || agentName.toLowerCase().includes(query);
    });
  }, [agentNameBySessionId, searchQuery, sessions]);

  const selectedSessions = useMemo(() => {
    const selected = new Set(selectedIds);
    return sessions.filter((session) => selected.has(session.id));
  }, [selectedIds, sessions]);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setSelectedIds([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    void coworkService.listSessionsForSearch(SESSION_LIMIT, 0)
      .then((result) => {
        if (cancelled) return;
        setSessions(result.success && result.sessions ? result.sessions : []);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const toggleSession = (sessionId: string): void => {
    if (isUploading) return;
    setSelectedIds((current) => (
      current.includes(sessionId)
        ? current.filter((id) => id !== sessionId)
        : [...current, sessionId]
    ));
  };

  const handleSubmit = (): void => {
    if (selectedSessions.length === 0 || isUploading) return;
    onSubmit(selectedSessions);
  };

  if (!isOpen) return null;

  return (
    <Modal
      onClose={isUploading ? () => undefined : onCancel}
      overlayClassName="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm"
      className="modal-content flex max-h-[78vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-modal"
    >
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-foreground">
          {i18nService.t('knowledgeUploadLocalSessionTitle')}
        </h2>
        <p className="mt-1 text-sm text-secondary">
          {i18nService.t('knowledgeUploadLocalSessionDesc').replace('{name}', knowledgeBaseName || i18nService.t('knowledgeBase'))}
        </p>
      </div>

      <div className="border-b border-border p-3">
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          disabled={isUploading}
          placeholder={i18nService.t('searchConversations')}
          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-secondary disabled:opacity-60"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-secondary">{i18nService.t('loading')}</div>
        ) : filteredSessions.length === 0 ? (
          <div className="py-12 text-center text-sm text-secondary">{i18nService.t('searchNoResults')}</div>
        ) : (
          filteredSessions.map((session) => {
            const checked = selectedIds.includes(session.id);
            const isRunning = session.status === CoworkSessionStatusValue.Running;
            const agentName = agentNameBySessionId.get(session.id) ?? getSessionAgentId(session);
            return (
              <button
                key={session.id}
                type="button"
                disabled={isUploading}
                onClick={() => toggleSession(session.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                  checked
                    ? 'bg-primary/10 text-foreground'
                    : 'text-secondary hover:bg-surface-hover hover:text-foreground'
                } disabled:cursor-not-allowed disabled:opacity-70`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  checked ? 'border-primary bg-primary text-white' : 'border-border bg-background'
                }`}>
                  {checked ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{session.title}</span>
                    {isRunning ? (
                      <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                        {i18nService.t('coworkStatusRunning')}
                      </span>
                    ) : null}
                  </span>
                  {session.lastMessagePreview ? (
                    <span className="mt-0.5 block truncate text-xs text-secondary/80">
                      {session.lastMessagePreview}
                    </span>
                  ) : null}
                </span>
                <span className="max-w-[120px] shrink-0 truncate text-xs text-secondary/75">
                  {agentName}
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
        <div className="min-w-0 text-sm text-secondary">
          {isUploading
            ? progressText
            : i18nService.t('knowledgeUploadLocalSessionSelected').replace('{count}', String(selectedSessions.length))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={isUploading}
            onClick={onCancel}
            className="rounded-lg border border-border px-3 py-2 text-sm text-secondary hover:text-foreground disabled:opacity-60"
          >
            {i18nService.t('cancel')}
          </button>
          <button
            type="button"
            disabled={isUploading || selectedSessions.length === 0}
            onClick={handleSubmit}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUploading ? i18nService.t('knowledgeUploadLocalSessionUploading') : i18nService.t('knowledgeUploadLocalSessionAction')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default KnowledgeSessionUploadModal;
