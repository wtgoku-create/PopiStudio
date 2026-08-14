import {
  ClipboardDocumentIcon,
  DocumentIcon,
  FolderOpenIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';

type AppInfo = {
  name: string;
  path: string;
  isDefault: boolean;
  icon?: string;
};

interface LocalFileContextMenuProps {
  filePath: string;
  children: React.ReactNode;
}

const LocalFileContextMenu: React.FC<LocalFileContextMenuProps> = ({ filePath, children }) => {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', close, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [position]);

  const openWith = async (appPath: string) => {
    await window.electron.shell.openPathWithApp(filePath, appPath);
    setPosition(null);
  };

  const showMenu = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 240;
    const menuHeight = 260;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - 8);
    setPosition({ x: Math.max(8, x), y: Math.max(8, y) });
    try {
      const result = await window.electron.shell.getAppsForFile(filePath);
      setApps(result?.apps ?? []);
    } catch {
      setApps([]);
    }
  };

  return (
    <>
      <span onContextMenu={showMenu}>{children}</span>
      {position && (
        <div
          ref={menuRef}
          role="menu"
          style={{ left: position.x, top: position.y }}
          className="fixed z-[10060] w-60 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-popover"
          onMouseDown={event => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-surface-raised"
            onClick={() => { void window.electron.shell.openPath(filePath); setPosition(null); }}
          >
            <DocumentIcon className="h-4 w-4" />
            {i18nService.t('localFileOpen')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-surface-raised"
            onClick={() => { void window.electron.shell.showItemInFolder(filePath); setPosition(null); }}
          >
            <FolderOpenIcon className="h-4 w-4" />
            {i18nService.t('showInFolder')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-surface-raised"
            onClick={() => { void window.electron.clipboard.writeText(filePath); setPosition(null); }}
          >
            <ClipboardDocumentIcon className="h-4 w-4" />
            {i18nService.t('localFileCopyPath')}
          </button>
          {apps.length > 0 && (
            <div className="mt-1 border-t border-border pt-1">
              <div className="flex items-center justify-between px-3 py-1 text-[11px] text-secondary">
                <span>{i18nService.t('localFileOpenWith')}</span>
                <button type="button" aria-label={i18nService.t('close')} onClick={() => setPosition(null)}>
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              {apps.map(app => (
                <button
                  key={`${app.path}:${app.name}`}
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface-raised"
                  onClick={() => { void openWith(app.path); }}
                >
                  {app.icon ? <img src={app.icon} alt="" className="h-4 w-4" /> : <DocumentIcon className="h-4 w-4" />}
                  <span className="truncate">{app.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default LocalFileContextMenu;
