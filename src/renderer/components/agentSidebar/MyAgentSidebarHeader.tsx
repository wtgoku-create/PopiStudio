import {
  BoltIcon,
  MagnifyingGlassIcon,
  PlusCircleIcon,
  UserPlusIcon,
} from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';

interface MyAgentSidebarHeaderProps {
  onCreateAgent: () => void;
  onShowContacts: () => void;
  onSearch: () => void;
}

const MyAgentSidebarHeader: React.FC<MyAgentSidebarHeaderProps> = ({
  onCreateAgent,
  onShowContacts,
  onSearch,
}) => {
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuItemClassName =
    'flex w-full items-center gap-2 whitespace-nowrap px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]';
  const menuIconClassName = 'h-3.5 w-3.5 shrink-0';

  const closeAddMenu = useCallback(() => {
    setIsAddMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!isAddMenuOpen) return;

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

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [closeAddMenu, isAddMenuOpen]);

  const handleShowContacts = () => {
    closeAddMenu();
    onShowContacts();
  };

  const handleCreateAgent = () => {
    closeAddMenu();
    onCreateAgent();
  };

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
              isAddMenuOpen ? 'bg-[#f0f0f0] text-[#333] dark:bg-white/[0.06] dark:text-foreground' : ''
            }`}
            aria-expanded={isAddMenuOpen}
            aria-haspopup="menu"
            aria-label={i18nService.t('add')}
          >
            <PlusCircleIcon className="h-5 w-5" />
          </button>
          {isAddMenuOpen && (
            <div
              ref={menuRef}
              className="absolute right-0 top-[32px] z-50 w-max min-w-[124px] max-w-[calc(100vw-16px)] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
              role="menu"
            >
              <button
                type="button"
                onClick={handleShowContacts}
                className={menuItemClassName}
                role="menuitem"
              >
                <UserPlusIcon className={menuIconClassName} />
                <span className="truncate">{i18nService.t('agentSidebarAddFriend')}</span>
              </button>
              <button
                type="button"
                onClick={handleCreateAgent}
                className={menuItemClassName}
                role="menuitem"
              >
                <BoltIcon className={menuIconClassName} />
                <span className="truncate">{i18nService.t('createNewAgent')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onSearch}
        className="flex h-[34px] w-full items-center gap-2 rounded-lg bg-[#f9f9f9] px-3 text-left text-[13px] font-medium text-[#d1d1d1] transition-colors hover:bg-black/[0.04] dark:bg-white/[0.04] dark:text-secondary"
      >
        <MagnifyingGlassIcon className="h-4 w-4 shrink-0" />
        <span className="truncate">{i18nService.t('mcpCategorySearch')}</span>
      </button>
    </div>
  );
};

export default MyAgentSidebarHeader;
