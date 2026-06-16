import { CheckIcon } from '@heroicons/react/24/outline';
import React, { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { AgentId } from '../../../shared/agent';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import type { AgentSubagentConfig } from '../../types/agent';
import { getAgentDisplayName } from '../../utils/agentDisplay';
import SearchIcon from '../icons/SearchIcon';
import AgentAvatarIcon from './AgentAvatarIcon';

interface AgentSubagentSelectorProps {
  agentId?: string | null;
  selectedSubagents: AgentSubagentConfig[];
  onChange: (subagents: AgentSubagentConfig[]) => void;
}

const AgentSubagentSelector: React.FC<AgentSubagentSelectorProps> = ({
  agentId,
  selectedSubagents,
  onChange,
}) => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const [search, setSearch] = useState('');

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents
      .filter((agent) => agent.id !== agentId)
      .filter((agent) => agent.enabled)
      .filter((agent) => {
        if (!q) return true;
        const name = getAgentDisplayName(agent).toLowerCase();
        return name.includes(q) || agent.description.toLowerCase().includes(q);
      });
  }, [agentId, agents, search]);

  const selectedById = useMemo(() => {
    return new Map(selectedSubagents.map((subagent) => [subagent.agentId, subagent]));
  }, [selectedSubagents]);

  const toggle = (targetAgentId: string) => {
    const existing = selectedById.get(targetAgentId);
    if (existing) {
      onChange(selectedSubagents.filter((subagent) => subagent.agentId !== targetAgentId));
      return;
    }
    onChange([
      ...selectedSubagents,
      {
        agentId: targetAgentId,
        label: '',
        description: '',
        enabled: true,
      },
    ]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex items-center gap-2 text-xs leading-5 text-secondary/60">
        <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-secondary/30 text-secondary/60">
          <span className="text-[10px] font-medium leading-none">i</span>
        </div>
        <span>{i18nService.t('agentSubagentsHint')}</span>
      </div>

      <div className="mb-3 shrink-0">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary/45" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={i18nService.t('agentSubagentsSearch')}
            className="h-9 w-full rounded-md border border-border-subtle bg-surface-raised/30 pl-9 pr-3 text-xs text-foreground placeholder:text-secondary/45 focus:border-border focus:bg-surface focus:outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {candidates.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-sm text-secondary/60">
            {agents.filter((agent) => agent.id !== agentId && agent.enabled).length === 0
              ? i18nService.t('agentSubagentsNoAgents')
              : i18nService.t('agentSubagentsNoMatches')}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {candidates.map((agent) => {
              const selected = selectedById.get(agent.id);
              const isSelected = Boolean(selected);
              const displayName = getAgentDisplayName(agent);
              const isMainAgent = agent.id === AgentId.Main;

              return (
                <div
                  key={agent.id}
                  className={`group rounded-lg border bg-surface transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/60 hover:bg-surface-raised/50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(agent.id)}
                    className="relative flex w-full min-h-[92px] items-start gap-3 px-3.5 py-3 text-left"
                  >
                    <AgentAvatarIcon
                      value={agent.icon}
                      className="h-9 w-9 shrink-0"
                      iconClassName="h-5 w-5"
                      legacyClassName="text-xl"
                    />
                    <div className="min-w-0 flex-1 pr-8">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-medium leading-5 text-foreground">
                          {displayName}
                        </div>
                        {isMainAgent && (
                          <span className="shrink-0 rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-secondary">
                            {i18nService.t('defaultAgentDisplayName')}
                          </span>
                        )}
                      </div>
                      {agent.description && (
                        <div className="mt-1 line-clamp-2 text-xs leading-[18px] text-secondary/80">
                          {agent.description}
                        </div>
                      )}
                    </div>
                    <div
                      className={`absolute right-3.5 top-3.5 flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary'
                          : 'border-border bg-surface group-hover:border-primary/50'
                      }`}
                    >
                      {isSelected && <CheckIcon className="h-3.5 w-3.5 text-white" />}
                    </div>
                  </button>

                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentSubagentSelector;
