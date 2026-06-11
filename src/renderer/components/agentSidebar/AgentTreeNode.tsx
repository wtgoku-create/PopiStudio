import { ShareIcon } from '@heroicons/react/20/solid';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import { getAgentDisplayName, isDefaultAgentId, shouldUseDefaultAgentIcon } from '../../utils/agentDisplay';
import AgentAvatarIcon from '../agent/AgentAvatarIcon';
import AgentConfirmDialog from '../agent/AgentConfirmDialog';
import { AgentConfirmDialogVariant } from '../agent/constants';
import DefaultAgentIcon from '../icons/DefaultAgentIcon';
import EditIcon from '../icons/EditIcon';
import EllipsisHorizontalIcon from '../icons/EllipsisHorizontalIcon';
import LoadingIcon from '../icons/LoadingIcon';
import PushPinIcon from '../icons/PushPinIcon';
import TrashIcon from '../icons/TrashIcon';
import { AgentSidebarIndicator } from './constants';
import { formatAgentTaskRelativeTime } from './time';
import type { AgentSidebarAgentNode } from './types';

interface AgentTreeNodeProps {
  agent: AgentSidebarAgentNode;
  isActive: boolean;
  onEditAgent: (agent: AgentSidebarAgentNode) => void;
  onSelectAgent: (agent: AgentSidebarAgentNode) => void;
  onDeleteAgent: (agent: AgentSidebarAgentNode) => Promise<void>;
  onShareAgentSession: (agent: AgentSidebarAgentNode) => Promise<void>;
  onToggleAgentPin: (agent: AgentSidebarAgentNode, pinned: boolean) => Promise<void>;
  onRetryLoadTasks: (agentId: string) => void;
}

const ACTION_MENU_VIEWPORT_PADDING = 8;
const ACTION_MENU_VERTICAL_GAP = 4;
const ACTION_MENU_HEIGHT = 136;

const AgentAvatar: React.FC<{ agent: AgentSidebarAgentNode }> = ({ agent }) => {
  if (shouldUseDefaultAgentIcon(agent)) {
    return <DefaultAgentIcon className="h-4 w-4" />;
  }

  return (
    <AgentAvatarIcon
      value={agent.icon}
      className="h-8 w-8"
      iconClassName="h-4 w-4"
      legacyClassName="text-[16px]"
      fallbackText={getAgentDisplayName(agent).trim().slice(0, 1).toUpperCase() || 'A'}
    />
  );
};

const AgentTreeNode: React.FC<AgentTreeNodeProps> = ({
  agent,
  isActive,
  onEditAgent,
  onSelectAgent,
  onDeleteAgent,
  onShareAgentSession,
  onToggleAgentPin,
  onRetryLoadTasks,
}) => {
  const [menuPosition, setMenuPosition] = useState<{ right: number; top: number } | null>(null);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const isMenuOpen = menuPosition !== null;
  const isMainAgent = isDefaultAgentId(agent.id);
  const agentName = getAgentDisplayName(agent);
  const boundTask = agent.tasks[0] ?? null;
  const indicator = boundTask?.indicator ?? AgentSidebarIndicator.None;
  const showRunningIndicator = indicator === AgentSidebarIndicator.Running;
  const showUnreadIndicator = indicator === AgentSidebarIndicator.CompletedUnread;
  const relativeTime = boundTask ? formatAgentTaskRelativeTime(boundTask.updatedAt || boundTask.createdAt) : null;
  const subtitle = agent.hasLoadError && agent.tasks.length === 0
    ? i18nService.t('myAgentSidebarLoadFailed')
    : boundTask?.title ?? i18nService.t('myAgentSidebarNoTasks');
  const trailingMetaClassName = isMenuOpen ? 'opacity-0' : 'group-hover:opacity-0';
  const menuItemClassName =
    'flex w-full items-center gap-2 whitespace-nowrap px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]';
  const dangerMenuItemClassName =
    'flex w-full items-center gap-2 whitespace-nowrap px-2.5 py-1.5 text-left text-[13px] text-red-500 transition-colors hover:bg-red-500/10';
  const disabledMenuItemClassName =
    'flex w-full cursor-not-allowed items-center gap-2 whitespace-nowrap px-2.5 py-1.5 text-left text-[13px] text-secondary/40';
  const rowActionButtonClassName =
    'inline-flex h-7 w-7 items-center justify-center rounded-lg text-foreground opacity-[0.46] transition-colors hover:bg-black/[0.06] hover:opacity-[0.7] dark:hover:bg-white/[0.06]';
  const menuIconClassName = 'h-3.5 w-3.5';

  const calculateMenuPosition = useCallback(() => {
    const rect = menuButtonRef.current?.getBoundingClientRect();
    if (!rect) return null;

    const right = Math.max(ACTION_MENU_VIEWPORT_PADDING, window.innerWidth - rect.right);
    const top = Math.max(
      ACTION_MENU_VIEWPORT_PADDING,
      Math.min(
        rect.bottom + ACTION_MENU_VERTICAL_GAP,
        window.innerHeight - ACTION_MENU_HEIGHT - ACTION_MENU_VIEWPORT_PADDING,
      ),
    );

    return { right, top };
  }, []);

  const closeMenu = useCallback(() => {
    setMenuPosition(null);
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuButtonRef.current?.contains(target)) {
        closeMenu();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [closeMenu, isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const updateMenuPosition = () => {
      const position = calculateMenuPosition();
      if (position) {
        setMenuPosition(position);
      } else {
        closeMenu();
      }
    };
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [calculateMenuPosition, closeMenu, isMenuOpen]);

  const handleEditAgent = (event: React.MouseEvent) => {
    event.stopPropagation();
    closeMenu();
    onEditAgent(agent);
  };

  const handleAgentClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    closeMenu();
    if (agent.hasLoadError && agent.tasks.length === 0) {
      onRetryLoadTasks(agent.id);
      return;
    }
    onSelectAgent(agent);
  };

  const handleDeleteMenuClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (isMainAgent) return;
    closeMenu();
    setShowConfirmDelete(true);
  };

  const handleToggleAgentPin = (event: React.MouseEvent) => {
    event.stopPropagation();
    closeMenu();
    void onToggleAgentPin(agent, !agent.pinned);
  };

  const handleShareSession = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!boundTask) return;
    closeMenu();
    void onShareAgentSession(agent);
  };

  return (
    <div>
      <div className={`group relative ${isMenuOpen ? 'z-50' : 'z-20'} h-[58px] w-full rounded-lg transition-colors hover:bg-[#f0edf9] dark:hover:bg-primary/15 ${
        isActive ? 'bg-[#f0edf9] dark:bg-primary/15' : 'bg-white dark:bg-transparent'
      }`}
      >
        <button
          type="button"
          onClick={handleAgentClick}
          className="flex h-full w-full items-center gap-2 rounded-lg bg-transparent px-3 text-left"
          role="treeitem"
          aria-level={1}
          aria-current={isActive ? 'page' : undefined}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-transparent leading-none text-foreground dark:border-white/[0.12]">
            <AgentAvatar agent={agent} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-[14px] font-medium leading-[18px] text-[#333] dark:text-foreground">
                {agentName}
              </span>
              {agent.pinned && (
                <PushPinIcon className="h-3 w-3 shrink-0 text-[#333]/70 dark:text-foreground/60" />
              )}
            </span>
            <span className={`mt-0.5 block min-w-0 truncate text-[12px] leading-4 ${
              agent.hasLoadError && agent.tasks.length === 0 ? 'text-red-500' : 'text-[#999] dark:text-secondary'
            }`}
            >
              {subtitle}
            </span>
          </span>
          {agent.isLoadingTasks && agent.tasks.length === 0 && (
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-secondary/50" />
          )}
          {showRunningIndicator && (
            <LoadingIcon
              className={`h-3 w-3 shrink-0 animate-spin text-secondary transition-opacity ${trailingMetaClassName}`}
              aria-label={i18nService.t('myAgentSidebarRunning')}
            />
          )}
          {showUnreadIndicator && (
            <span
              className={`h-2 w-2 shrink-0 rounded-full bg-primary transition-opacity ${trailingMetaClassName}`}
              title={i18nService.t('myAgentSidebarUnreadResult')}
              aria-label={i18nService.t('myAgentSidebarUnreadResult')}
            />
          )}
          {relativeTime && !showRunningIndicator && !showUnreadIndicator && (
            <span className={`shrink-0 text-[12px] leading-4 text-[#999] transition-opacity dark:text-secondary ${trailingMetaClassName}`}>
              {relativeTime.compact}
            </span>
          )}
        </button>

        <div
          className={`absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-0.5 transition-opacity ${
            isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <button
            ref={menuButtonRef}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (isMenuOpen) {
                closeMenu();
                return;
              }
              const position = calculateMenuPosition();
              if (position) {
                setMenuPosition(position);
              }
            }}
            className={`${rowActionButtonClassName} ${isMenuOpen ? 'bg-black/[0.06] opacity-[0.7] dark:bg-white/[0.06]' : 'bg-transparent'}`}
            aria-label={i18nService.t('coworkSessionActions')}
          >
            <EllipsisHorizontalIcon className="h-4 w-4" />
          </button>
        </div>

        {menuPosition && (
          <div
            ref={menuRef}
            className="fixed z-[60] w-max min-w-[104px] max-w-[calc(100vw-16px)] overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
            style={{ top: menuPosition.top, right: menuPosition.right }}
            role="menu"
          >
            <button
              type="button"
              onClick={handleEditAgent}
              className={menuItemClassName}
              role="menuitem"
            >
              <EditIcon className={menuIconClassName} />
              {i18nService.t('edit')}
            </button>
            <button
              type="button"
              onClick={handleToggleAgentPin}
              className={menuItemClassName}
              role="menuitem"
            >
              <PushPinIcon slashed={agent.pinned} className={menuIconClassName} />
              {agent.pinned ? i18nService.t('agentUnpin') : i18nService.t('agentPin')}
            </button>
            <button
              type="button"
              onClick={handleShareSession}
              disabled={!boundTask}
              className={boundTask ? menuItemClassName : disabledMenuItemClassName}
              role="menuitem"
            >
              <ShareIcon className={menuIconClassName} />
              {i18nService.t('coworkShareSession')}
            </button>
            {isMainAgent ? (
              <button
                type="button"
                disabled
                className={disabledMenuItemClassName}
                role="menuitem"
                title={i18nService.t('agentDefaultCannotDelete')}
              >
                <TrashIcon className={menuIconClassName} />
                {i18nService.t('delete')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDeleteMenuClick}
                className={dangerMenuItemClassName}
                role="menuitem"
              >
                <TrashIcon className={menuIconClassName} />
                {i18nService.t('delete')}
              </button>
            )}
          </div>
        )}

        {showConfirmDelete && (
          <AgentConfirmDialog
            variant={AgentConfirmDialogVariant.Delete}
            title={i18nService.t('agentDeleteConfirmTitle')}
            message={i18nService.t('agentDeleteConfirmMessage').replace('{name}', agentName)}
            cancelLabel={i18nService.t('cancel')}
            confirmLabel={i18nService.t('delete')}
            onCancel={() => setShowConfirmDelete(false)}
            onConfirm={() => {
              setShowConfirmDelete(false);
              void onDeleteAgent(agent);
            }}
          />
        )}
      </div>
    </div>
  );
};

export default AgentTreeNode;
