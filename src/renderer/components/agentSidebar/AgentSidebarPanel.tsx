import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { AgentId } from '@shared/agent';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import {
  selectCoworkSessions,
  selectCurrentSessionId,
} from '../../store/selectors/coworkSelectors';
import type { CoworkSessionSummary } from '../../types/cowork';
import { getAgentDisplayNameById } from '../../utils/agentDisplay';
import Modal from '../common/Modal';
import CoworkSearchModal from '../cowork/CoworkSearchModal';
import TrashIcon from '../icons/TrashIcon';
import MyAgentSidebarTree from './MyAgentSidebarTree';

interface AgentSidebarPanelProps {
  isCollapsed: boolean;
  onShowCowork: () => void;
}

const DEFAULT_AGENT_PANEL_WIDTH = 307;
const MIN_AGENT_PANEL_WIDTH = 240;
const MAX_AGENT_PANEL_WIDTH = 440;
const SIDEBAR_COLLAPSE_TRANSITION_MS = 200;
const normalizeAgentId = (agentId?: string | null) => agentId?.trim() || AgentId.Main;

const AgentSidebarPanel: React.FC<AgentSidebarPanelProps> = ({
  isCollapsed,
  onShowCowork,
}) => {
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const agents = useSelector((state: RootState) => state.agent.agents);
  const sessions = useSelector(selectCoworkSessions);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchAgentId, setBatchAgentId] = useState<string | null>(null);
  const [batchSelectableIds, setBatchSelectableIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletedSessionIds, setDeletedSessionIds] = useState<string[]>([]);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_AGENT_PANEL_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [agentScrollEdges, setAgentScrollEdges] = useState({ top: false, bottom: false });
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(DEFAULT_AGENT_PANEL_WIDTH);
  const agentScrollContainerRef = useRef<HTMLDivElement>(null);
  const batchSelectableIdSet = useMemo(() => new Set(batchSelectableIds), [batchSelectableIds]);
  const selectedBatchSelectableCount = useMemo(() => {
    return batchSelectableIds.filter((sessionId) => selectedIds.has(sessionId)).length;
  }, [batchSelectableIds, selectedIds]);
  const isBatchSelectAllChecked =
    batchSelectableIds.length > 0 && selectedBatchSelectableCount === batchSelectableIds.length;
  const batchAgentName = batchAgentId ? getAgentDisplayNameById(batchAgentId, agents) : null;

  useEffect(() => {
    const handleSearch = () => {
      onShowCowork();
      setIsSearchOpen(true);
    };
    window.addEventListener('cowork:shortcut:search', handleSearch);
    return () => {
      window.removeEventListener('cowork:shortcut:search', handleSearch);
    };
  }, [onShowCowork]);

  useEffect(() => {
    if (!isCollapsed) return;
    setIsSearchOpen(false);
    setIsBatchMode(false);
    setBatchAgentId(null);
    setBatchSelectableIds([]);
    setSelectedIds(new Set());
    setShowBatchDeleteConfirm(false);
  }, [isCollapsed]);

  const handleSelectSession = async (session: CoworkSessionSummary) => {
    const agentId = session.agentId?.trim() || AgentId.Main;
    if (agentId !== currentAgentId) {
      agentService.switchAgent(agentId);
      await coworkService.loadSessions(agentId);
    }
    onShowCowork();
    await coworkService.loadSession(session.id);
  };

  const handleOpenSearch = useCallback(() => {
    onShowCowork();
    setIsSearchOpen(true);
  }, [onShowCowork]);

  const handleEnterBatchMode = useCallback((sessionId: string, agentId: string) => {
    setIsBatchMode(true);
    setBatchAgentId(agentId);
    setBatchSelectableIds([]);
    setSelectedIds(new Set([sessionId]));
  }, []);

  const handleExitBatchMode = useCallback(() => {
    setIsBatchMode(false);
    setBatchAgentId(null);
    setBatchSelectableIds([]);
    setSelectedIds(new Set());
    setShowBatchDeleteConfirm(false);
  }, []);

  const handleBatchSelectableIdsChange = useCallback((sessionIds: string[]) => {
    setBatchSelectableIds(sessionIds);
    setSelectedIds((previous) => {
      if (!batchAgentId || sessionIds.length === 0) return previous;
      const sessionIdSet = new Set(sessionIds);
      const next = new Set(Array.from(previous).filter((sessionId) => sessionIdSet.has(sessionId)));
      return next.size === previous.size ? previous : next;
    });
  }, [batchAgentId]);

  const updateAgentScrollEdges = useCallback((element: HTMLDivElement | null) => {
    if (!element) {
      setAgentScrollEdges((previousEdges) => (
        previousEdges.top || previousEdges.bottom ? { top: false, bottom: false } : previousEdges
      ));
      return;
    }

    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    const nextEdges = {
      top: element.scrollTop > 1,
      bottom: maxScrollTop - element.scrollTop > 1,
    };

    setAgentScrollEdges((previousEdges) => {
      if (previousEdges.top === nextEdges.top && previousEdges.bottom === nextEdges.bottom) {
        return previousEdges;
      }
      return nextEdges;
    });
  }, []);

  const handleAgentScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    updateAgentScrollEdges(event.currentTarget);
  }, [updateAgentScrollEdges]);

  const handleToggleSelection = useCallback((sessionId: string, agentId: string) => {
    if (batchAgentId && normalizeAgentId(agentId) !== batchAgentId) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, [batchAgentId]);

  const handleSelectAll = useCallback(() => {
    if (batchSelectableIds.length === 0) return;
    setSelectedIds(prev => {
      const selectedVisibleCount = batchSelectableIds.filter((sessionId) => prev.has(sessionId)).length;
      if (selectedVisibleCount === batchSelectableIds.length) {
        return new Set();
      }
      return new Set(batchSelectableIds);
    });
  }, [batchSelectableIds]);

  const handleBatchDeleteClick = useCallback(() => {
    if (selectedIds.size === 0) return;
    setShowBatchDeleteConfirm(true);
  }, [selectedIds.size]);

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds).filter((sessionId) => {
      return batchSelectableIdSet.size === 0 || batchSelectableIdSet.has(sessionId);
    });
    if (ids.length === 0) return;
    const deleted = await coworkService.deleteSessions(ids);
    if (!deleted) return;
    setDeletedSessionIds(ids);
    handleExitBatchMode();
  }, [batchSelectableIdSet, selectedIds, handleExitBatchMode]);

  const handleResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (isCollapsed) return;
    event.preventDefault();
    isResizingRef.current = true;
    setIsResizing(true);
    resizeStartXRef.current = event.clientX;
    resizeStartWidthRef.current = panelWidth;
    document.body.classList.add('select-none');

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      const nextWidth = resizeStartWidthRef.current + moveEvent.clientX - resizeStartXRef.current;
      setPanelWidth(Math.min(MAX_AGENT_PANEL_WIDTH, Math.max(MIN_AGENT_PANEL_WIDTH, nextWidth)));
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
  }, [isCollapsed, panelWidth]);

  useEffect(() => {
    return () => {
      document.body.classList.remove('select-none');
    };
  }, []);

  useEffect(() => {
    const element = agentScrollContainerRef.current;
    if (!element) return;

    updateAgentScrollEdges(element);

    const resizeObserver = new ResizeObserver(() => updateAgentScrollEdges(element));
    resizeObserver.observe(element);
    if (element.firstElementChild) {
      resizeObserver.observe(element.firstElementChild);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateAgentScrollEdges]);

  return (
    <aside
      className={`relative shrink-0 overflow-hidden border-l border-border-subtle bg-background dark:border-white/[0.04] ${
        isResizing ? '' : 'sidebar-transition'
      }`}
      style={{ width: isCollapsed ? 0 : panelWidth }}
    >
      <div
        className={`flex h-full flex-col transition-opacity ease-out ${
          isCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
        style={{
          width: panelWidth,
          transitionDuration: `${SIDEBAR_COLLAPSE_TRANSITION_MS}ms`,
        }}
      >
        <div className="relative min-h-0 flex-1">
          <div
            ref={agentScrollContainerRef}
            className="scrollbar-hidden h-full overflow-y-auto px-2.5 pb-10"
            onScroll={handleAgentScroll}
          >
            <MyAgentSidebarTree
              isBatchMode={isBatchMode}
              batchAgentId={batchAgentId}
              deletedSessionIds={deletedSessionIds}
              selectedIds={selectedIds}
              onShowCowork={onShowCowork}
              onToggleSelection={handleToggleSelection}
              onEnterBatchMode={handleEnterBatchMode}
              onBatchSelectableIdsChange={handleBatchSelectableIdsChange}
              onSearch={handleOpenSearch}
            />
          </div>
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-background to-transparent transition-opacity duration-150 ${
              agentScrollEdges.top ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <div
            className={`pointer-events-none absolute inset-x-0 top-[68px] z-10 h-3 bg-gradient-to-b from-background to-transparent transition-opacity duration-150 ${
              agentScrollEdges.top ? 'opacity-40' : 'opacity-0'
            }`}
          />
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 h-3 bg-gradient-to-t from-background to-transparent transition-opacity duration-150 ${
              agentScrollEdges.bottom ? 'opacity-40' : 'opacity-0'
            }`}
          />
        </div>
        {isBatchMode ? (
          <div className="border-t border-border/60 px-3 pb-3 pt-2">
            <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs text-secondary">
                {i18nService
                  .t('batchSelectionScope')
                  .replace('{agent}', batchAgentName ?? '')
                  .replace('{count}', String(selectedIds.size))}
              </span>
              <button
                type="button"
                onClick={handleExitBatchMode}
                className="shrink-0 rounded-md px-1.5 py-1 text-xs font-medium text-secondary transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
              >
                {i18nService.t('batchCancel')}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 text-[13px] font-normal text-foreground/80 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                <input
                  type="checkbox"
                  checked={isBatchSelectAllChecked}
                  onChange={handleSelectAll}
                  disabled={batchSelectableIds.length === 0}
                  className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 accent-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600"
                />
                <span className="truncate">{i18nService.t('batchSelectAll')}</span>
              </label>
              <button
                type="button"
                onClick={handleBatchDeleteClick}
                disabled={selectedIds.size === 0}
                className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium transition-colors ${
                  selectedIds.size > 0
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                }`}
              >
                <TrashIcon className="h-3.5 w-3.5" />
                {i18nService.t('batchDelete')} ({selectedIds.size})
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {!isCollapsed && (
        <div
          className="non-draggable absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
          onMouseDown={handleResizeStart}
        />
      )}
      <CoworkSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
      />
      {showBatchDeleteConfirm && (
        <Modal
          onClose={() => setShowBatchDeleteConfirm(false)}
          className="w-full max-w-sm mx-4 bg-surface rounded-2xl shadow-xl overflow-hidden"
        >
          <div className="flex items-center gap-3 px-5 py-4">
            <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
              <ExclamationTriangleIcon className="h-5 w-5 text-red-600 dark:text-red-500" />
            </div>
            <h2 className="text-base font-semibold text-foreground">
              {i18nService.t('batchDeleteConfirmTitle')}
            </h2>
          </div>
          <div className="px-5 pb-4">
            <p className="text-sm text-secondary">
              {i18nService
                .t('batchDeleteConfirmMessage')
                .replace('{count}', String(selectedIds.size))}
            </p>
          </div>
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border">
            <button
              onClick={() => setShowBatchDeleteConfirm(false)}
              className="px-4 py-2 text-sm font-medium rounded-lg text-secondary hover:bg-surface-raised transition-colors"
            >
              {i18nService.t('cancel')}
            </button>
            <button
              onClick={handleBatchDelete}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors"
            >
              {i18nService.t('batchDelete')} ({selectedIds.size})
            </button>
          </div>
        </Modal>
      )}
    </aside>
  );
};

export default AgentSidebarPanel;
