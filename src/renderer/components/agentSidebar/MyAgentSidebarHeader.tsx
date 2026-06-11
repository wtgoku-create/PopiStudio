import { PlusIcon } from '@heroicons/react/24/outline';
import React from 'react';

import { i18nService } from '../../services/i18n';

interface MyAgentSidebarHeaderProps {
  onCreateAgent: () => void;
}

const MyAgentSidebarHeader: React.FC<MyAgentSidebarHeaderProps> = ({
  onCreateAgent,
}) => {
  return (
    <div className="sticky top-0 z-30 -ml-[6px] flex h-[60px] w-[calc(100%+12px)] items-center justify-between bg-background pl-3 pr-1">
      <h2 className="min-w-0 truncate text-[20px] font-medium text-foreground">
        {i18nService.t('myAgents')}
      </h2>
      <button
        type="button"
        onClick={onCreateAgent}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-foreground opacity-[0.34] transition-opacity hover:opacity-[0.5]"
        aria-label={i18nService.t('createNewAgent')}
      >
        <PlusIcon className="h-4 w-4" />
      </button>
    </div>
  );
};

export default MyAgentSidebarHeader;
