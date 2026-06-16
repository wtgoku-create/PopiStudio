import { AgentAvatarSvg, encodeAgentAvatarIcon } from '@shared/agent/avatar';
import React from 'react';

import {
  CoworkSystemMessageKind,
  isSubagentLifecycleStatus,
  SubagentLifecycleStatus,
} from '../../../common/coworkSystemMessages';
import { formatAgentTaskRelativeTime } from '../agentSidebar/time';
import AgentAvatarIcon from '../agent/AgentAvatarIcon';
import { i18nService } from '../../services/i18n';
import type { CoworkMessage } from '../../types/cowork';
import { CoworkUiEvent } from './constants';

const getAgentName = (message: CoworkMessage): string => {
  const agentName = typeof message.metadata?.agentName === 'string' ? message.metadata.agentName.trim() : '';
  if (agentName) return agentName;
  const label = typeof message.metadata?.label === 'string' ? message.metadata.label.trim() : '';
  if (label) return label;
  const agentId = typeof message.metadata?.agentId === 'string' ? message.metadata.agentId.trim() : '';
  return agentId || i18nService.t('subagentUnnamed');
};

const getStatus = (message: CoworkMessage) => {
  const value = message.metadata?.subagentStatus;
  return isSubagentLifecycleStatus(value) ? value : SubagentLifecycleStatus.Running;
};

const getTask = (message: CoworkMessage): string | null => {
  const task = typeof message.metadata?.task === 'string' ? message.metadata.task.trim() : '';
  return task || null;
};

const getError = (message: CoworkMessage): string | null => {
  const error = typeof message.metadata?.error === 'string' ? message.metadata.error.trim() : '';
  return error || null;
};

const getStatusLabel = (status: ReturnType<typeof getStatus>): string => {
  switch (status) {
    case SubagentLifecycleStatus.Completed:
      return i18nService.t('subagentCompleted');
    case SubagentLifecycleStatus.Error:
      return i18nService.t('subagentError');
    case SubagentLifecycleStatus.Spawned:
      return i18nService.t('subagentQueued');
    case SubagentLifecycleStatus.Running:
    default:
      return i18nService.t('subagentWorking');
  }
};

const getStatusDotClassName = (status: ReturnType<typeof getStatus>): string => {
  switch (status) {
    case SubagentLifecycleStatus.Completed:
      return 'bg-emerald-500';
    case SubagentLifecycleStatus.Error:
      return 'bg-red-500';
    case SubagentLifecycleStatus.Spawned:
      return 'bg-amber-500';
    case SubagentLifecycleStatus.Running:
    default:
      return 'bg-sky-500 animate-pulse';
  }
};

const getStatusBadgeClassName = (status: ReturnType<typeof getStatus>): string => {
  switch (status) {
    case SubagentLifecycleStatus.Completed:
      return 'bg-emerald-500/12 text-emerald-700 ring-emerald-500/15 dark:bg-emerald-500/15 dark:text-emerald-300';
    case SubagentLifecycleStatus.Error:
      return 'bg-red-500/12 text-red-700 ring-red-500/15 dark:bg-red-500/15 dark:text-red-300';
    case SubagentLifecycleStatus.Spawned:
      return 'bg-amber-500/12 text-amber-700 ring-amber-500/15 dark:bg-amber-500/15 dark:text-amber-300';
    case SubagentLifecycleStatus.Running:
    default:
      return 'bg-sky-500/12 text-sky-700 ring-sky-500/15 dark:bg-sky-500/15 dark:text-sky-300';
  }
};

const getDetailText = (message: CoworkMessage): string => {
  const status = getStatus(message);
  if (status === SubagentLifecycleStatus.Error) {
    return getError(message) ?? message.content;
  }
  const task = getTask(message);
  if (task) return task;
  return message.content;
};

const getAvatarSvg = (message: CoworkMessage): AgentAvatarSvg => {
  const normalized = getAgentName(message).toLowerCase();
  if (normalized.includes('法务') || normalized.includes('legal') || normalized.includes('risk')) {
    return AgentAvatarSvg.Scales;
  }
  if (normalized.includes('视频') || normalized.includes('video')) {
    return AgentAvatarSvg.Artboard;
  }
  if (normalized.includes('研发') || normalized.includes('engineer') || normalized.includes('code')) {
    return AgentAvatarSvg.Code;
  }
  if (normalized.includes('文案') || normalized.includes('copy') || normalized.includes('write')) {
    return AgentAvatarSvg.Creation;
  }
  if (normalized.includes('数据') || normalized.includes('data')) {
    return AgentAvatarSvg.Data;
  }
  if (normalized.includes('运营') || normalized.includes('ops')) {
    return AgentAvatarSvg.Briefcase;
  }
  return AgentAvatarSvg.Brain;
};

const getRoleTintClassName = (message: CoworkMessage): string => {
  const normalized = getAgentName(message).toLowerCase();
  if (normalized.includes('法务') || normalized.includes('legal') || normalized.includes('risk')) {
    return 'from-amber-500/18 via-orange-500/10 to-transparent';
  }
  if (normalized.includes('视频') || normalized.includes('video')) {
    return 'from-cyan-500/18 via-sky-500/10 to-transparent';
  }
  if (normalized.includes('研发') || normalized.includes('engineer') || normalized.includes('code')) {
    return 'from-emerald-500/18 via-teal-500/10 to-transparent';
  }
  if (normalized.includes('文案') || normalized.includes('copy') || normalized.includes('write')) {
    return 'from-rose-500/16 via-pink-500/10 to-transparent';
  }
  return 'from-slate-500/12 via-slate-400/8 to-transparent';
};

export const isSubagentLifecycleMessage = (message: CoworkMessage): boolean => {
  return message.type === 'system' && message.metadata?.kind === CoworkSystemMessageKind.SubagentLifecycle;
};

const SubagentLifecycleCard: React.FC<{ message: CoworkMessage }> = ({ message }) => {
  const status = getStatus(message);
  const agentName = getAgentName(message);
  const detailText = getDetailText(message);
  const parentSessionId = typeof message.metadata?.parentSessionId === 'string'
    ? message.metadata.parentSessionId
    : '';
  const runId = typeof message.metadata?.subagentRunId === 'string'
    ? message.metadata.subagentRunId
    : '';
  const sessionKey = typeof message.metadata?.sessionKey === 'string'
    ? message.metadata.sessionKey
    : null;
  const relativeTime = formatAgentTaskRelativeTime(message.timestamp);

  const handleOpenSubagent = () => {
    if (!parentSessionId || !runId) return;
    window.dispatchEvent(new CustomEvent(CoworkUiEvent.SelectSubagent, {
      detail: {
        id: runId,
        agentId: typeof message.metadata?.agentId === 'string' ? message.metadata.agentId : null,
        task: typeof message.metadata?.task === 'string' ? message.metadata.task : null,
        label: typeof message.metadata?.label === 'string' ? message.metadata.label : null,
        sessionKey,
        parentSessionId,
        status: status === SubagentLifecycleStatus.Completed
          ? 'done'
          : status === SubagentLifecycleStatus.Error
            ? 'error'
            : 'running',
        createdAt: message.timestamp,
      },
    }));
  };

  return (
    <div className="relative pl-12">
      <div className="absolute left-[19px] top-0 bottom-0 w-px bg-gradient-to-b from-border via-border to-transparent" aria-hidden="true" />
      <div className="absolute left-0 top-1">
        <div className={`relative rounded-2xl bg-gradient-to-br ${getRoleTintClassName(message)} p-[1px] shadow-sm`}>
          <div className="rounded-2xl bg-background/95 p-1 backdrop-blur">
            <AgentAvatarIcon
              value={encodeAgentAvatarIcon({ svg: getAvatarSvg(message) })}
              className="h-8 w-8 text-foreground"
              iconClassName="h-4.5 w-4.5"
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={handleOpenSubagent}
        className="group block w-full rounded-[22px] border border-border/80 bg-[linear-gradient(145deg,rgba(255,255,255,0.88),rgba(248,250,252,0.72))] px-4 py-3.5 text-left shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition-all hover:-translate-y-0.5 hover:border-sky-400/40 hover:shadow-[0_14px_34px_rgba(14,165,233,0.12)] focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:bg-[linear-gradient(145deg,rgba(24,24,27,0.88),rgba(39,39,42,0.72))]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-semibold tracking-[0.01em] text-foreground">
                {agentName}
              </span>
              <span className={`h-2 w-2 shrink-0 rounded-full ${getStatusDotClassName(status)}`} />
              <span className="text-[11px] text-secondary">
                {relativeTime.compact}
              </span>
            </div>
            <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-secondary">
              {detailText}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${getStatusBadgeClassName(status)}`}>
                {getStatusLabel(status)}
              </span>
              <span className="text-[11px] font-medium text-foreground/45 transition-colors group-hover:text-sky-600 dark:group-hover:text-sky-400">
                {i18nService.t('subagentOpenDetail')}
              </span>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
};

export default SubagentLifecycleCard;
