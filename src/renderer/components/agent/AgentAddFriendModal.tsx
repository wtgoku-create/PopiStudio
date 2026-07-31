import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import type { Agent } from '../../types/agent';
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
  const agents = useSelector((state: RootState) => state.agent.agents);
  const [presetTemplates, setPresetTemplates] = useState<PresetAgent[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedPresetIds, setSelectedPresetIds] = useState<Set<string>>(new Set());
  const [addingPresetIds, setAddingPresetIds] = useState<Set<string>>(new Set());
  const isAdding = addingPresetIds.size > 0;
  const installedPresetIds = useMemo(() => {
    return new Set(agents.filter((agent) => agent.source === 'preset').map((agent) => agent.id));
  }, [agents]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedPresetIds(new Set());
      setAddingPresetIds(new Set());
      return;
    }

    setTemplatesLoading(true);
    agentService.getPresetTemplates()
      .then(setPresetTemplates)
      .finally(() => setTemplatesLoading(false));
  }, [isOpen]);

  const handleToggleTemplate = (preset: PresetAgent) => {
    if (isAdding || installedPresetIds.has(preset.id)) return;
    setSelectedPresetIds((previous) => {
      const next = new Set(previous);
      if (next.has(preset.id)) {
        next.delete(preset.id);
      } else {
        next.add(preset.id);
      }
      return next;
    });
  };

  const openAgentEntry = async (agent: Agent) => {
    agentService.switchAgent(agent.id);
    onShowCowork();
    await coworkService.loadSessions(agent.id);
    coworkService.clearSession({ restoreAgentSkills: true });
  };

  const handleAddSelectedTemplates = async () => {
    if (isAdding) return;

    const presetIds = Array.from(selectedPresetIds).filter((presetId) => (
      !installedPresetIds.has(presetId)
    ));
    if (presetIds.length === 0) return;

    setAddingPresetIds(new Set(presetIds));
    try {
      let lastAddedAgent: Agent | null = null;

      for (const presetId of presetIds) {
        const agent = await agentService.addPreset(presetId);
        if (!agent) {
          window.dispatchEvent(new CustomEvent('app:showToast', {
            detail: i18nService.t('agentCreateFailed'),
          }));
          return;
        }
        lastAddedAgent = agent;
      }

      if (lastAddedAgent) {
        await openAgentEntry(lastAddedAgent);
      }

      setSelectedPresetIds(new Set());
      onClose();
    } catch {
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('agentCreateFailed'),
      }));
    } finally {
      setAddingPresetIds(new Set());
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={isAdding ? () => undefined : onClose}
      overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/10 dark:bg-black/50"
      className="flex h-[82vh] max-h-[664px] w-[calc(100vw-56px)] max-w-[854px] flex-col overflow-hidden rounded-xl border border-surface bg-surface shadow-[0_12px_40px_rgba(0,0,0,0.16)]"
    >
      <AgentTemplatePickerContent
        presets={presetTemplates}
        loading={templatesLoading}
        onClose={isAdding ? () => undefined : onClose}
        onToggle={handleToggleTemplate}
        onConfirm={handleAddSelectedTemplates}
        selectedPresetIds={selectedPresetIds}
        disabledPresetIds={installedPresetIds}
        pendingPresetIds={addingPresetIds}
        confirming={isAdding}
      />
    </Modal>
  );
};

export default AgentAddFriendModal;
