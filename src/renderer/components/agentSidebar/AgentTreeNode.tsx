import React, { useCallback, useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import { getAgentDisplayName, isDefaultAgentId, shouldUseDefaultAgentIcon } from '../../utils/agentDisplay';
import AgentAvatarIcon from '../agent/AgentAvatarIcon';
import AgentConfirmDialog from '../agent/AgentConfirmDialog';
import { AgentConfirmDialogVariant } from '../agent/constants';
import DefaultAgentIcon from '../icons/DefaultAgentIcon';
import EditIcon from '../icons/EditIcon';
import EllipsisHorizontalIcon from '../icons/EllipsisHorizontalIcon';
import PushPinIcon from '../icons/PushPinIcon';
import TrashIcon from '../icons/TrashIcon';
import { AgentSidebarIndicator } from './constants';
import type { AgentSidebarAgentNode } from './types';

interface AgentTreeNodeProps {
  agent: AgentSidebarAgentNode;
  isActive: boolean;
  onEditAgent: (agent: AgentSidebarAgentNode) => void;
  onSelectAgent: (agent: AgentSidebarAgentNode) => void;
  onDeleteAgent: (agent: AgentSidebarAgentNode) => Promise<void>;
  onToggleAgentPin: (agent: AgentSidebarAgentNode, pinned: boolean) => Promise<void>;
  onRetryLoadTasks: (agentId: string) => void;
}

const ACTION_MENU_VIEWPORT_PADDING = 8;
const ACTION_MENU_VERTICAL_GAP = 4;
const ACTION_MENU_HEIGHT = 104;

const AgentAvatar: React.FC<{ agent: AgentSidebarAgentNode }> = ({ agent }) => {
  if (shouldUseDefaultAgentIcon(agent)) {
    return <DefaultAgentIcon className="h-4 w-4" />;
  }

  return (
    <AgentAvatarIcon
      value={agent.icon}
      className="h-4 w-4"
      iconClassName="h-4 w-4"
      legacyClassName="text-[14px]"
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
  const menuItemClassName =
    'flex w-full items-center gap-2 whitespace-nowrap px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]';
  const dangerMenuItemClassName =
    'flex w-full items-center gap-2 whitespace-nowrap px-2.5 py-1.5 text-left text-[13px] text-red-500 transition-colors hover:bg-red-500/10';
  const disabledMenuItemClassName =
    'flex w-full cursor-not-allowed items-center gap-2 whitespace-nowrap px-2.5 py-1.5 text-left text-[13px] text-secondary/40';
  const rowActionButtonClassName =
    'inline-flex h-5 w-5 items-center justify-center rounded text-foreground opacity-[0.3] transition-opacity hover:opacity-[0.46]';
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

  return (
    <div className="space-y-0.5">
      <div className={`group sticky top-[60px] ${isMenuOpen ? 'z-50' : 'z-20'} -ml-[6px] h-9 w-[calc(100%+12px)] bg-background`}>
        <button
          type="button"
          onClick={handleAgentClick}
          className={`flex h-full w-full items-center gap-2 rounded-[18px] py-0 pl-3.5 pr-12 text-left text-[14px] font-normal text-foreground transition-colors hover:bg-surface-raised dark:hover:bg-white/[0.04] ${
            isActive ? 'bg-surface-raised dark:bg-white/[0.04]' : ''
          }`}
          role="treeitem"
          aria-level={1}
          aria-current={isActive ? 'page' : undefined}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center leading-none text-foreground">
            <AgentAvatar agent={agent} />
          </span>
          <span className="min-w-0 flex-1 truncate opacity-[0.76]">
            {agentName}
          </span>
          {agent.isLoadingTasks && agent.tasks.length === 0 && (
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-secondary/50" />
          )}
          {showRunningIndicator && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
              title={i18nService.t('myAgentSidebarRunning')}
              aria-label={i18nService.t('myAgentSidebarRunning')}
            />
          )}
          {showUnreadIndicator && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
              title={i18nService.t('myAgentSidebarUnreadResult')}
              aria-label={i18nService.t('myAgentSidebarUnreadResult')}
            />
          )}
          {agent.hasLoadError && agent.tasks.length === 0 && (
            <span className="shrink-0 text-[11px] text-red-500">
              {i18nService.t('myAgentSidebarLoadFailed')}
            </span>
          )}
        </button>

        <div
          className={`absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 transition-opacity ${
            isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
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
            className={rowActionButtonClassName}
            aria-label={i18nService.t('coworkSessionActions')}
          >
            <EllipsisHorizontalIcon className="h-3.5 w-3.5" />
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
