import { XMarkIcon } from '@heroicons/react/24/outline';
import React from 'react';

import { i18nService } from '../../services/i18n';
import type { PresetAgent } from '../../types/agent';
import AgentAvatarIcon from './AgentAvatarIcon';

interface AgentTemplatePickerContentProps {
  presets: PresetAgent[];
  loading: boolean;
  onClose: () => void;
  onToggle: (preset: PresetAgent) => void;
  onConfirm: () => void;
  onNew?: () => void;
  selectedPresetIds?: Set<string>;
  disabledPresetIds?: Set<string>;
  pendingPresetIds?: Set<string>;
  confirming?: boolean;
}

const AgentTemplatePickerContent: React.FC<AgentTemplatePickerContentProps> = ({
  presets,
  loading,
  onClose,
  onToggle,
  onConfirm,
  onNew,
  selectedPresetIds = new Set(),
  disabledPresetIds = new Set(),
  pendingPresetIds = new Set(),
  confirming = false,
}) => {
  const isEn = i18nService.getLanguage() === 'en';
  const selectedCount = selectedPresetIds.size;

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
            onClick={onConfirm}
            disabled={selectedCount === 0 || confirming}
            className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirming
              ? i18nService.t('creating')
              : i18nService.t('agentAddSelectedFriends').replace('{count}', String(selectedCount))}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={confirming}
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
              const isSelected = selectedPresetIds.has(preset.id);
              const isInstalled = disabledPresetIds.has(preset.id);
              const isPending = pendingPresetIds.has(preset.id);
              const isDisabled = isInstalled || isPending || confirming;

              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onToggle(preset)}
                  disabled={isDisabled}
                  className={`group flex min-h-[132px] flex-col items-start rounded-xl border bg-surface p-4 text-left transition-colors hover:border-primary/40 hover:bg-surface-raised disabled:cursor-not-allowed ${
                    isSelected ? 'border-primary/70 bg-primary/5' : 'border-border'
                  } ${
                    isInstalled ? 'opacity-45' : ''
                  }`}
                >
                  <div className="flex w-full items-center gap-3">
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary text-white'
                          : 'border-border bg-surface'
                      }`}
                      aria-hidden="true"
                    >
                      {isSelected && (
                        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                          <path
                            d="M2.5 6.2 4.7 8.4 9.5 3.6"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.7"
                          />
                        </svg>
                      )}
                    </span>
                    <AgentAvatarIcon
                      value={preset.icon}
                      className="h-8 w-8"
                      iconClassName="h-5 w-5"
                      legacyClassName="text-2xl"
                    />
                    <div className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                      {name}
                    </div>
                    {isInstalled ? (
                      <span className="shrink-0 text-xs font-medium text-secondary">
                        {i18nService.t('agentFriendAdded')}
                      </span>
                    ) : isPending ? (
                      <span className="shrink-0 text-xs font-medium text-primary">
                        {i18nService.t('creating')}
                      </span>
                    ) : null}
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
