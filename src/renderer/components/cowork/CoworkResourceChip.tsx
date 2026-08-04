import React from 'react';

import { i18nService } from '../../services/i18n';
import FileTypeIcon from '../icons/fileTypes/FileTypeIcon';
import XMarkIcon from '../icons/XMarkIcon';
import Tooltip, { TooltipPosition } from '../ui/Tooltip';

interface CoworkResourceChipProps {
  name: string;
  path: string;
  onRemove?: () => void;
  className?: string;
}

const CoworkResourceChip: React.FC<CoworkResourceChipProps> = ({
  name,
  path,
  onRemove,
  className = '',
}) => (
  <Tooltip
    content={path}
    position={TooltipPosition.Top}
    maxWidth="32rem"
    multiline
    className="align-middle"
  >
    <span
      className={`relative -top-px mx-0.5 inline-flex h-[22px] max-w-[360px] select-none items-center gap-1.5 rounded-md border border-border bg-surface-raised px-1.5 align-middle text-[13px] leading-none text-foreground shadow-subtle ${onRemove ? 'group' : ''} ${className}`}
      contentEditable={false}
    >
      {onRemove ? (
        <button
          type="button"
          className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center text-secondary transition-colors group-hover:text-foreground"
          aria-label={i18nService.t('coworkAttachmentRemove')}
          title={i18nService.t('coworkAttachmentRemove')}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
        >
          <FileTypeIcon fileName={name} className="h-4 w-4 transition-opacity group-hover:opacity-0" />
          <XMarkIcon className="absolute h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      ) : (
        <FileTypeIcon fileName={name} className="h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 truncate">{name}</span>
    </span>
  </Tooltip>
);

export default CoworkResourceChip;
