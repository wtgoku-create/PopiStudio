import { FolderOpenIcon } from '@heroicons/react/24/outline';
import { FolderIcon } from '@heroicons/react/24/solid';
import React, { useCallback } from 'react';

import { i18nService } from '../../services/i18n';
import type { UserMessageFileAttachment } from '../../utils/userMessageFileAttachments';
import FileTypeIcon from '../icons/fileTypes/FileTypeIcon';
import { getFileTypeInfo } from '../icons/fileTypes/index';

const showToast = (message: string): void => {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
};

const UserMessageFileAttachments: React.FC<{ attachments: UserMessageFileAttachment[]; className?: string }> = ({
  attachments,
  className = '',
}) => {
  const handleReveal = useCallback(async (attachment: UserMessageFileAttachment) => {
    try {
      const result = await window.electron.shell.showItemInFolder(attachment.path);
      if (!result?.success) {
        showToast(i18nService.t(
          /not found|no such file|cannot find/i.test(result?.error ?? '')
            ? 'coworkFileAttachmentMissing'
            : 'coworkFileAttachmentRevealFailed',
        ));
      }
    } catch (error) {
      console.warn('[UserMessageFileAttachments] failed to reveal attachment:', error);
      showToast(i18nService.t('coworkFileAttachmentRevealFailed'));
    }
  }, []);

  if (attachments.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {attachments.map(attachment => (
        <button
          key={attachment.path}
          type="button"
          onClick={() => { void handleReveal(attachment); }}
          className="group flex h-[52px] w-[200px] items-center gap-2.5 rounded-xl border border-border bg-background px-2.5 text-left shadow-subtle transition-colors hover:border-primary dark:bg-surface-raised"
          title={`${attachment.path}\n${i18nService.t('coworkFileAttachmentRevealHint')}`}
          aria-label={`${attachment.name} - ${i18nService.t('coworkFileAttachmentRevealHint')}`}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] dark:bg-white/[0.08]">
            {attachment.isDirectory
              ? <FolderIcon className="h-5 w-5 text-amber-500" />
              : <FileTypeIcon fileName={attachment.name} className="h-5 w-5" />}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <span className="truncate text-[13px] font-medium leading-4 text-foreground">{attachment.name}</span>
            <span className="mt-0.5 truncate text-[11px] leading-4 text-secondary">
              {attachment.isDirectory ? i18nService.t('folderAttachmentType') : getFileTypeInfo(attachment.name).label}
            </span>
          </div>
          <FolderOpenIcon className="h-4 w-4 shrink-0 text-secondary opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      ))}
    </div>
  );
};

export default UserMessageFileAttachments;
