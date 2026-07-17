import React from 'react';

import { i18nService } from '../../services/i18n';
import KitsManager from './KitsManager';

interface KitsViewProps {
  onTryAsking?: (text: string, kitId: string) => void;
  onUseKit?: (kitId: string) => void;
}

const KitsView: React.FC<KitsViewProps> = ({ onTryAsking, onUseKit }) => {
  return (
    <div className="flex-1 flex flex-col bg-background h-full">
      <div className="draggable flex h-12 items-center justify-between px-4 border-b border-border shrink-0">
        <div className="flex items-center space-x-3 h-8">
          <h1 className="text-lg font-semibold text-foreground">
            {i18nService.t('kits')}
          </h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 [scrollbar-gutter:stable]">
        <div className="mx-auto w-full max-w-[1120px] px-6 py-6">
          <KitsManager onTryAsking={onTryAsking} onUseKit={onUseKit} />
        </div>
      </div>
    </div>
  );
};

export default KitsView;
