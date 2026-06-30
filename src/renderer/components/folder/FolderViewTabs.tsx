import React from 'react';

import { i18nService } from '../../services/i18n';

export type FolderViewTab = 'files' | 'knowledge';

interface FolderViewTabsProps {
  activeTab: FolderViewTab;
  onChange: (tab: FolderViewTab) => void;
}

const FolderViewTabs: React.FC<FolderViewTabsProps> = ({ activeTab, onChange }) => {
  const tabs: Array<{ key: FolderViewTab; label: string }> = [
    { key: 'files', label: i18nService.t('folderAllFiles') },
    { key: 'knowledge', label: i18nService.t('knowledgeBase') },
  ];

  return (
    <div className="non-draggable flex h-8 items-baseline gap-5">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={`transition-all ${
            activeTab === tab.key
              ? 'text-lg font-semibold text-foreground'
              : 'text-sm font-medium text-secondary hover:text-foreground'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

export default FolderViewTabs;
