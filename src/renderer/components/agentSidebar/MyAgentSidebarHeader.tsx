import { MagnifyingGlassIcon, PlusCircleIcon } from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { i18nService } from '../../services/i18n';
import BoltIcon from '../icons/BoltIcon';
import UserPlusIcon from '../icons/UserPlusIcon';
import { AgentSidebarTaskTab, type AgentSidebarTaskTab as AgentSidebarTaskTabValue } from './constants';

interface MyAgentSidebarHeaderProps {
  activeTab: AgentSidebarTaskTabValue;
  onAddFriend: () => void;
  onCreateAgent: () => void;
  onSearch: () => void;
  onTaskTabChange: (tab: AgentSidebarTaskTabValue) => void;
}

const ADD_MENU_OFFSET_X = -10;
const ADD_MENU_OFFSET_Y = 8;
const ADD_MENU_VIEWPORT_PADDING = 8;
const ADD_MENU_WIDTH = 216;

const MyAgentSidebarHeader: React.FC<MyAgentSidebarHeaderProps> = ({
  activeTab,
  onAddFriend,
  onCreateAgent,
  onSearch,
  onTaskTabChange,
}) => {
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuItemClassName =
    'flex w-full items-center gap-2 whitespace-nowrap px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]';
  const menuIconClassName = 'h-5 w-5 shrink-0';

  const closeAddMenu = useCallback(() => {
    setIsAddMenuOpen(false);
  }, []);

  const updateMenuPosition = useCallback(() => {
    const button = menuButtonRef.current;
    if (!button) return;

    const buttonRect = button.getBoundingClientRect();
    const menuWidth = menuRef.current?.offsetWidth ?? ADD_MENU_WIDTH;
    const menuHeight = menuRef.current?.offsetHeight ?? 88;
    const maxLeft = Math.max(
      ADD_MENU_VIEWPORT_PADDING,
      window.innerWidth - menuWidth - ADD_MENU_VIEWPORT_PADDING,
    );
    const maxTop = Math.max(
      ADD_MENU_VIEWPORT_PADDING,
      window.innerHeight - menuHeight - ADD_MENU_VIEWPORT_PADDING,
    );

    setMenuPosition({
      left: Math.max(
        ADD_MENU_VIEWPORT_PADDING,
        Math.min(buttonRect.left + ADD_MENU_OFFSET_X, maxLeft),
      ),
      top: Math.max(
        ADD_MENU_VIEWPORT_PADDING,
        Math.min(buttonRect.bottom + ADD_MENU_OFFSET_Y, maxTop),
      ),
    });
  }, []);

  useEffect(() => {
    if (!isAddMenuOpen) {
      setMenuPosition(null);
      return;
    }

    updateMenuPosition();

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuButtonRef.current?.contains(target)) {
        closeAddMenu();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAddMenu();
      }
    };
    const handleLayoutChange = () => {
      updateMenuPosition();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('scroll', handleLayoutChange, true);
    window.addEventListener('resize', handleLayoutChange);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('scroll', handleLayoutChange, true);
      window.removeEventListener('resize', handleLayoutChange);
    };
  }, [closeAddMenu, isAddMenuOpen, updateMenuPosition]);

  const handleShowContacts = () => {
    closeAddMenu();
    onAddFriend();
  };

  const handleCreateAgent = () => {
    closeAddMenu();
    onCreateAgent();
  };

  const addMenu =
    isAddMenuOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 w-[180px] max-w-[calc(100vw-16px)] overflow-hidden rounded-[12px] border border-black/[0.05] bg-white p-1 shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:border-white/[0.08] dark:bg-[#1f1f1f] dark:shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
            style={menuPosition ?? { visibility: 'hidden' }}
            role="menu"
          >
            <button
              type="button"
              onClick={handleShowContacts}
              className={`${menuItemClassName} h-[43px] rounded-[8px] px-3 hover:bg-[#f7f7f7] dark:hover:bg-white/[0.06]`}
              role="menuitem"
            >
              <UserPlusIcon  className={menuIconClassName} />
              <span className="text-[14px] font-medium leading-none text-[#666666] dark:text-foreground">{i18nService.t('agentSidebarAddFriend')}</span>
            </button>
            <button
              type="button"
              onClick={handleCreateAgent}
              className={`${menuItemClassName} h-[43px] rounded-[8px] px-3 hover:bg-[#f7f7f7] dark:hover:bg-white/[0.06]`}
              role="menuitem"
            >
              <BoltIcon className={menuIconClassName} />
              <span className="text-[14px] font-medium leading-none text-[#666666] dark:text-foreground">{i18nService.t('createNewAgent')}</span>
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="sticky top-0 z-30 w-full bg-background pb-2">
      <div className="flex h-[52px] items-center justify-between">
        <h2 className="min-w-0 truncate text-lg font-semibold leading-none text-[#333] dark:text-foreground">
          {i18nService.t('agentSidebarMessages')}
        </h2>
        <div className="relative">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setIsAddMenuOpen(prev => !prev)}
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#666] transition-colors hover:bg-[#f0f0f0] hover:text-[#333] focus:bg-[#f0f0f0] focus:text-[#333] dark:text-secondary dark:hover:bg-white/[0.06] dark:hover:text-foreground dark:focus:bg-white/[0.06] dark:focus:text-foreground ${
              isAddMenuOpen
                ? 'bg-[#f0f0f0] text-[#333] dark:bg-white/[0.06] dark:text-foreground'
                : ''
            }`}
            aria-expanded={isAddMenuOpen}
            aria-haspopup="menu"
            aria-label={i18nService.t('add')}
          >
            <PlusCircleIcon className="h-6 w-6" />
          </button>
        </div>
      </div>
      {addMenu}
      <button
        type="button"
        onClick={onSearch}
        className="flex h-[34px] w-full items-center gap-2 rounded-lg border border-transparent bg-surface-raised/70 px-3 text-left text-[13px] font-medium transition-colors hover:border-border hover:bg-surface focus-visible:border-border focus-visible:bg-surface focus-visible:outline-none dark:bg-white/[0.04] dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]"
      >
        <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-secondary/70" />
        <span className="truncate text-muted">{i18nService.t('mcpCategorySearch')}</span>
      </button>
      <div className="mt-2 flex items-center rounded-lg bg-black/[0.03] p-0.5 text-[12px] font-medium text-secondary dark:bg-white/[0.04]">
        <button
          type="button"
          onClick={() => onTaskTabChange(AgentSidebarTaskTab.Main)}
          className={`h-7 min-w-0 flex-1 rounded-md px-2 transition-colors ${
            activeTab === AgentSidebarTaskTab.Main
              ? 'bg-white text-foreground shadow-sm dark:bg-white/[0.08]'
              : 'hover:text-foreground'
          }`}
          aria-pressed={activeTab === AgentSidebarTaskTab.Main}
        >
          {i18nService.t('myAgentSidebarMainTasks')}
        </button>
        <button
          type="button"
          onClick={() => onTaskTabChange(AgentSidebarTaskTab.Scheduled)}
          className={`h-7 min-w-0 flex-1 rounded-md px-2 transition-colors ${
            activeTab === AgentSidebarTaskTab.Scheduled
              ? 'bg-white text-foreground shadow-sm dark:bg-white/[0.08]'
              : 'hover:text-foreground'
          }`}
          aria-pressed={activeTab === AgentSidebarTaskTab.Scheduled}
        >
          {i18nService.t('myAgentSidebarScheduledTasks')}
        </button>
      </div>
    </div>
  );
};

export default MyAgentSidebarHeader;
