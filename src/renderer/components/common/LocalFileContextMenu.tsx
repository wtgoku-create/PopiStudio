import {
  ClipboardDocumentIcon,
  DocumentIcon,
  FolderOpenIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';

const showToast = (message: string): void => {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
};

type AppInfo = {
  name: string;
  path: string;
  isDefault: boolean;
  icon?: string;
};

interface LocalFileContextMenuProps {
  filePath: string;
  isDirectory?: boolean;
  children: React.ReactNode;
}

const LocalFileContextMenu: React.FC<LocalFileContextMenuProps> = ({ filePath, isDirectory: isDirectoryProp, children }) => {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const isDirectory = isDirectoryProp ?? (/[\\/]$/.test(filePath) || !/\.[^\\/\.]{1,12}$/.test(filePath));
  const fileExtension = filePath.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() ?? '';
  const isImageFile = /^(png|jpe?g|gif|webp|bmp|tiff?|ico|avif)$/i.test(fileExtension);
  const supportsCopyContents = !isDirectory && !/^(png|jpe?g|gif|webp|bmp|tiff?|ico|avif|mp3|wav|mp4|mov|avi|mkv)$/i.test(fileExtension);

  const closeMenu = () => setPosition(null);

  const copyPath = async () => {
    const result = await window.electron.clipboard.writeText(filePath);
    showToast(i18nService.t(result?.success ? 'copied' : 'copyFailed'));
    closeMenu();
  };

  const copyContents = async () => {
    const result = await window.electron.dialog.readTextFile(filePath);
    if (!result.success || typeof result.content !== 'string' || result.content.includes('\u0000')) {
      showToast(i18nService.t('copyFailed'));
      closeMenu();
      return;
    }
    const writeResult = await window.electron.clipboard.writeText(result.content);
    showToast(i18nService.t(writeResult?.success ? 'copied' : 'copyFailed'));
    closeMenu();
  };

  const copyImage = async () => {
    const result = await window.electron.clipboard.writeImageFromFile(filePath);
    showToast(i18nService.t(result?.success ? 'copied' : 'copyFailed'));
    closeMenu();
  };

  const saveCopy = async () => {
    const result = await window.electron.dialog.saveFileCopy(filePath);
    if (result && !result.success) showToast(i18nService.t('fileMenuSaveFailed'));
    closeMenu();
  };

  useEffect(() => {
    if (!position) return;
    const close = (event?: MouseEvent) => {
      if (event?.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setPosition(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', close);
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
    const menuHeight = 390;
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
          className="fixed z-[10060] max-h-[calc(100vh-16px)] w-60 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-popover"
          onMouseDown={event => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-surface-raised"
            onClick={() => { void window.electron.shell.openPath(filePath); closeMenu(); }}
          >
            <DocumentIcon className="h-4 w-4" />
            {i18nService.t('localFileOpen')}
          </button>
          {!isDirectory && (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-surface-raised"
              onClick={() => { void saveCopy(); }}
            >
              <DocumentIcon className="h-4 w-4" />
              {i18nService.t('fileMenuSaveAs')}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-surface-raised"
            onClick={() => { void window.electron.shell.showItemInFolder(filePath); closeMenu(); }}
          >
            <FolderOpenIcon className="h-4 w-4" />
            {i18nService.t('showInFolder')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-surface-raised"
            onClick={() => { void copyPath(); }}
          >
            <ClipboardDocumentIcon className="h-4 w-4" />
            {i18nService.t('localFileCopyPath')}
          </button>
          {isImageFile && (
            <button type="button" role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-surface-raised" onClick={() => { void copyImage(); }}>
              <DocumentIcon className="h-4 w-4" />
              {i18nService.t('fileMenuCopyImage')}
            </button>
          )}
          {supportsCopyContents && (
            <button type="button" role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-surface-raised" onClick={() => { void copyContents(); }}>
              <ClipboardDocumentIcon className="h-4 w-4" />
              {i18nService.t('fileMenuCopyContents')}
            </button>
          )}
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
