import { MagnifyingGlassIcon, PlusCircleIcon } from '@heroicons/react/24/outline';
import React from 'react';

import { i18nService } from '../../services/i18n';

interface MyAgentSidebarHeaderProps {
  onCreateAgent: () => void;
  onSearch: () => void;
}

const MyAgentSidebarHeader: React.FC<MyAgentSidebarHeaderProps> = ({
  onCreateAgent,
  onSearch,
}) => {
  return (
    <div className="sticky top-0 z-30 w-full bg-background pb-2">
      <div className="flex h-[52px] items-center justify-between">
        <h2 className="min-w-0 truncate text-[17px] font-medium leading-none text-[#333] dark:text-foreground">
          {i18nService.t('agentSidebarMessages')}
        </h2>
        <button
          type="button"
          onClick={onCreateAgent}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#666] transition-colors hover:bg-[#f0f0f0] hover:text-[#333] focus:bg-[#f0f0f0] focus:text-[#333] dark:text-secondary dark:hover:bg-white/[0.06] dark:hover:text-foreground dark:focus:bg-white/[0.06] dark:focus:text-foreground"
          aria-label={i18nService.t('createNewAgent')}
        >
          <PlusCircleIcon className="h-5 w-5" />
        </button>
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
