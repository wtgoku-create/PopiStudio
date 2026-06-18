import { ShareIcon } from '@heroicons/react/20/solid';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { CoworkSessionSourceKind } from '../../../shared/cowork/constants';
import { PlatformRegistry } from '../../../shared/platform';
import { i18nService } from '../../services/i18n';
import { getAgentDisplayName, isDefaultAgentId, shouldUseDefaultAgentIcon } from '../../utils/agentDisplay';
import AgentConfirmDialog from '../agent/AgentConfirmDialog';
import AgentAvatarIcon from '../agent/AgentAvatarIcon';
import { AgentConfirmDialogVariant } from '../agent/constants';
import DefaultAgentIcon from '../icons/DefaultAgentIcon';
import EditIcon from '../icons/EditIcon';
import EllipsisHorizontalIcon from '../icons/EllipsisHorizontalIcon';
import LoadingIcon from '../icons/LoadingIcon';
import TrashIcon from '../icons/TrashIcon';
import { AgentSidebarIndicator } from './constants';
import { formatAgentTaskRelativeTime } from './time';
import type { AgentSidebarAgentNode, AgentSidebarTaskNode } from './types';

interface AgentSessionNodeProps {
  agent: AgentSidebarAgentNode;
  task: AgentSidebarTaskNode;
  isActive: boolean;
  onSelect: (agent: AgentSidebarAgentNode, task: AgentSidebarTaskNode) => void;
  onDelete: (task: AgentSidebarTaskNode) => Promise<void>;
  onShare: (agent: AgentSidebarAgentNode, task: AgentSidebarTaskNode) => Promise<void>;
  onEditAgent?: (agent: AgentSidebarAgentNode) => void;
}

const ACTION_MENU_VIEWPORT_PADDING = 8;
const ACTION_MENU_VERTICAL_GAP = 4;
const ACTION_MENU_BASE_HEIGHT = 74;
const ACTION_MENU_AGENT_HOME_HEIGHT = 111;

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

const getSessionSourceLabel = (task: AgentSidebarTaskNode): string => {
  if (task.source?.kind === CoworkSessionSourceKind.AgentHome) {
    return '';
  }
  if (task.source?.kind === CoworkSessionSourceKind.ScheduledTask) {
    return i18nService.t('myAgentSidebarScheduledTask');
  }
  if (task.source?.kind === CoworkSessionSourceKind.IM) {
    const platform = task.source.platform?.split(':')[0];
    if (platform) {
      try {
        return PlatformRegistry.get(platform as Parameters<typeof PlatformRegistry.get>[0]).label;
      } catch {
        return task.source.label || i18nService.t('myAgentSidebarIMSession');
      }
    }
    return task.source.label || i18nService.t('myAgentSidebarIMSession');
  }
  return task.source?.label || '';
};

const AgentSessionNode: React.FC<AgentSessionNodeProps> = ({
  agent,
  task,
  isActive,
  onSelect,
  onDelete,
  onShare,
  onEditAgent,
}) => {
  const [menuPosition, setMenuPosition] = useState<{ right: number; top: number } | null>(null);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const isMenuOpen = menuPosition !== null;
  const agentName = getAgentDisplayName(agent);
  const isAgentHomeSession = task.source?.kind === CoworkSessionSourceKind.AgentHome;
  const canDeleteSession = !(isAgentHomeSession && isDefaultAgentId(agent.id));
  const sourceLabel = getSessionSourceLabel(task);
  const indicator = task.indicator;
  const showRunningIndicator = indicator === AgentSidebarIndicator.Running;
  const showUnreadIndicator = indicator === AgentSidebarIndicator.CompletedUnread;
  const relativeTime = formatAgentTaskRelativeTime(task.updatedAt || task.createdAt);
  const subtitle = task.lastMessagePreview || task.title;
  const trailingMetaClassName = isMenuOpen ? 'opacity-0' : 'group-hover:opacity-0';
  const menuItemClassName =
    'flex w-full items-center gap-2 whitespace-nowrap px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]';
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
        window.innerHeight -
          (isAgentHomeSession ? ACTION_MENU_AGENT_HOME_HEIGHT : ACTION_MENU_BASE_HEIGHT) -
          ACTION_MENU_VIEWPORT_PADDING,
      ),
    );

    return { right, top };
  }, [isAgentHomeSession]);

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

  return (
    <div
      role="listitem"
      className={`group relative ${isMenuOpen ? 'z-50' : 'z-20'} h-[58px] w-full rounded-lg transition-colors hover:bg-[#f0edf9] dark:hover:bg-white/[0.06] ${
      isActive ? 'bg-[#f0edf9] dark:bg-white/[0.06]' : 'bg-white dark:bg-transparent'
    }`}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          closeMenu();
          onSelect(agent, task);
        }}
        className="flex h-full w-full items-center gap-2 rounded-lg bg-transparent px-3 text-left"
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
            {sourceLabel && (
              <span className="shrink-0 rounded px-1 py-px text-[10px] leading-3 text-primary bg-primary/10 dark:text-primary-foreground dark:bg-white/[0.08]">
                {sourceLabel}
              </span>
            )}
          </span>
          <span className="mt-0.5 block min-w-0 truncate text-[12px] leading-4 text-[#999] dark:text-secondary">
            {subtitle}
          </span>
        </span>
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
        {!showRunningIndicator && !showUnreadIndicator && (
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
          {isAgentHomeSession && onEditAgent && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                closeMenu();
                onEditAgent(agent);
              }}
              className={menuItemClassName}
              role="menuitem"
            >
              <EditIcon className={menuIconClassName} />
              {i18nService.t('edit')}
            </button>
          )}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              closeMenu();
              void onShare(agent, task);
            }}
            className={menuItemClassName}
            role="menuitem"
          >
            <ShareIcon className={menuIconClassName} />
            {i18nService.t('coworkShareSession')}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (!canDeleteSession) return;
              closeMenu();
              setShowConfirmDelete(true);
            }}
            disabled={!canDeleteSession}
            className={canDeleteSession ? menuItemClassName : disabledMenuItemClassName}
            role="menuitem"
            title={canDeleteSession ? undefined : i18nService.t('agentDefaultCannotDelete')}
          >
            <TrashIcon className={menuIconClassName} />
            {i18nService.t('deleteSession')}
          </button>
        </div>
      )}

      {showConfirmDelete && (
        <AgentConfirmDialog
          variant={AgentConfirmDialogVariant.Delete}
          title={i18nService.t(
            isAgentHomeSession ? 'agentDeleteConfirmTitle' : 'deleteTaskConfirmTitle',
          )}
          message={
            isAgentHomeSession
              ? i18nService.t('agentDeleteConfirmMessage').replace('{name}', agentName)
              : i18nService.t('deleteTaskConfirmMessage')
          }
          cancelLabel={i18nService.t('cancel')}
          confirmLabel={i18nService.t('deleteSession')}
          onCancel={() => setShowConfirmDelete(false)}
          onConfirm={() => {
            setShowConfirmDelete(false);
            void onDelete(task);
          }}
        />
      )}
    </div>
  );
};

export default AgentSessionNode;
