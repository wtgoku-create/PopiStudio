import React, { useEffect, useState } from 'react';

import { CoworkSessionSourceKind } from '../../../shared/cowork/constants';
import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import type { PresetAgent } from '../../types/agent';
import Modal from '../common/Modal';
import AgentTemplatePickerContent from './AgentTemplatePickerContent';

interface AgentAddFriendModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowCowork: () => void;
}

const AgentAddFriendModal: React.FC<AgentAddFriendModalProps> = ({
  isOpen,
  onClose,
  onShowCowork,
}) => {
  const [presetTemplates, setPresetTemplates] = useState<PresetAgent[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [addingPresetId, setAddingPresetId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setAddingPresetId(null);
      return;
    }

    setTemplatesLoading(true);
    agentService.getPresetTemplates()
      .then(setPresetTemplates)
      .finally(() => setTemplatesLoading(false));
  }, [isOpen]);

  const handleSelectTemplate = async (preset: PresetAgent) => {
    if (addingPresetId) return;

    setAddingPresetId(preset.id);
    try {
      const agent = await agentService.addPreset(preset.id);
      if (!agent) {
        window.dispatchEvent(new CustomEvent('app:showToast', {
          detail: i18nService.t('agentCreateFailed'),
        }));
        return;
      }

      agentService.switchAgent(agent.id);
      onShowCowork();

      const sidebarSessionsResult = await coworkService.listAgentSidebarSessions();
      const homeSession = sidebarSessionsResult.success
        ? sidebarSessionsResult.sessions?.find((session) => (
          session.agentId === agent.id && session.source?.kind === CoworkSessionSourceKind.AgentHome
        ))
        : null;

      if (homeSession) {
        await coworkService.loadSession(homeSession.id);
      } else {
        await coworkService.loadSessions(agent.id);
      }

      onClose();
    } catch {
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('agentCreateFailed'),
      }));
    } finally {
      setAddingPresetId(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={addingPresetId ? () => undefined : onClose}
      overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/10 dark:bg-black/50"
      className="flex h-[82vh] max-h-[664px] w-[calc(100vw-56px)] max-w-[854px] flex-col overflow-hidden rounded-xl border border-surface bg-surface shadow-[0_12px_40px_rgba(0,0,0,0.16)]"
    >
      <AgentTemplatePickerContent
        presets={presetTemplates}
        loading={templatesLoading}
        onClose={addingPresetId ? () => undefined : onClose}
        onSelect={handleSelectTemplate}
        selectedPresetId={addingPresetId}
      />
    </Modal>
  );
};

export default AgentAddFriendModal;
