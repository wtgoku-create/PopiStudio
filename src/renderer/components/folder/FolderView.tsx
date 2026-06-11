import { FolderOpenIcon } from '@heroicons/react/24/outline';
import React, { useCallback, useEffect } from 'react';
import { useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import WindowTitleBar from '../window/WindowTitleBar';

interface FolderViewProps {
  updateBadge?: React.ReactNode;
}

const openFolder = async (path: string): Promise<void> => {
  const normalizedPath = path.trim();
  if (!normalizedPath) return;
  const result = await window.electron?.shell?.openPath(normalizedPath);
  if (result && !result.success) {
    window.dispatchEvent(new CustomEvent('app:showToast', { detail: result.error || i18nService.t('showInFolderFailed') }));
  }
};

const FolderView: React.FC<FolderViewProps> = ({ updateBadge }) => {
  const configWorkingDirectory = useSelector((state: RootState) => state.cowork.config.workingDirectory);
  const agents = useSelector((state: RootState) => state.agent.agents);
  

  useEffect(() => {
    void coworkService.loadConfig();
    void agentService.loadAgents();
    console.log('agents', agents);
  }, []);

  const handleOpenFolder = useCallback((path: string) => {
    void openFolder(path);
  }, []);

  const folders = [
    ...(configWorkingDirectory.trim()
      ? [{
          id: '__cowork__',
          name: i18nService.t('folderWorkspaceRoot'),
          description: i18nService.t('folderWorkspaceRootDescription'),
          path: configWorkingDirectory,
        }]
      : []),
    ...agents
      .filter((agent) => agent.workingDirectory.trim())
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.isDefault
          ? i18nService.t('folderMainAgentDescription')
          : i18nService.t('folderAgentDescription'),
        path: agent.workingDirectory,
      })),
  ];

  return (
    <div className="flex h-full flex-1 flex-col bg-background">
      <div className="draggable flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex h-8 items-center gap-3">
          <h1 className="text-lg font-semibold text-foreground">
            {i18nService.t('folder')}
          </h1>
          {updateBadge}
        </div>
        <WindowTitleBar inline />
      </div>

      <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6">
          {folders.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface-raised px-4 py-8 text-center text-sm text-secondary">
              {i18nService.t('folderEmpty')}
            </div>
          ) : (
            folders.map((folder) => (
              <div
                key={folder.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-3 py-3"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-secondary">
                  <FolderOpenIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{folder.name}</div>
                  <div className="truncate text-xs text-secondary">{folder.description}</div>
                  <div className="mt-1 truncate font-mono text-xs text-muted" title={folder.path}>
                    {folder.path}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenFolder(folder.path)}
                  className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface hover:text-foreground"
                >
                  {i18nService.t('openFolder')}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default FolderView;
