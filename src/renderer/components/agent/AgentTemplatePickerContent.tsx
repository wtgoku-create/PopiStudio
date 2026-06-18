import { XMarkIcon } from '@heroicons/react/24/outline';
import React from 'react';

import { i18nService } from '../../services/i18n';
import type { PresetAgent } from '../../types/agent';
import AgentAvatarIcon from './AgentAvatarIcon';

interface AgentTemplatePickerContentProps {
  presets: PresetAgent[];
  loading: boolean;
  onClose: () => void;
  onSelect: (preset: PresetAgent) => void;
  onNew?: () => void;
  selectedPresetId?: string | null;
}

const AgentTemplatePickerContent: React.FC<AgentTemplatePickerContentProps> = ({
  presets,
  loading,
  onClose,
  onSelect,
  onNew,
  selectedPresetId = null,
}) => {
  const isEn = i18nService.getLanguage() === 'en';

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 px-7 py-5">
        <h2 className="text-lg font-semibold text-foreground">
          {i18nService.t('agentTemplateTitle')}
        </h2>
        <div className="flex items-center gap-2">
          {onNew && (
            <button
              type="button"
              onClick={onNew}
              className="h-8 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
            >
              {i18nService.t('agentTemplateNew')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-surface-raised"
          >
            <XMarkIcon className="h-5 w-5 text-secondary" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-secondary">
            {i18nService.t('loading')}
          </div>
        ) : presets.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-secondary">
            {i18nService.t('agentTemplateEmpty')}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {presets.map((preset) => {
              const name = isEn && preset.nameEn ? preset.nameEn : preset.name;
              const description = isEn && preset.descriptionEn
                ? preset.descriptionEn
                : preset.description;
              const isSelected = selectedPresetId === preset.id;
              const isDisabled = Boolean(selectedPresetId);

              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onSelect(preset)}
                  disabled={isDisabled}
                  className={`group flex min-h-[132px] flex-col items-start rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-primary/40 hover:bg-surface-raised disabled:cursor-not-allowed ${
                    isDisabled && !isSelected ? 'opacity-45' : ''
                  }`}
                >
                  <div className="flex w-full items-center gap-3">
                    <AgentAvatarIcon
                      value={preset.icon}
                      className="h-8 w-8"
                      iconClassName="h-5 w-5"
                      legacyClassName="text-2xl"
                    />
                    <div className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                      {name}
                    </div>
                    {isSelected && (
                      <span className="shrink-0 text-xs font-medium text-primary">
                        {i18nService.t('creating')}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 line-clamp-3 text-sm leading-6 text-foreground/90">
                    {description}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};

export default AgentTemplatePickerContent;
