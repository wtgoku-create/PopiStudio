import { expect, test } from 'vitest';

import {
  CoworkSessionModeValue,
  type CoworkSessionStatus,
  CoworkSessionStatusValue,
  type CoworkSessionSummary,
} from '../../types/cowork';
import type { AgentSidebarAgentSummary } from './types';
import {
  patchExistingAgentSidebarSession,
  sortAgentSidebarAgents,
  sortAgentSidebarTasks,
} from './useAgentSidebarState';

const makeSession = (
  id: string,
  createdAt: number,
  updatedAt = createdAt,
  status: CoworkSessionStatus = CoworkSessionStatusValue.Completed,
  pinned = false,
  pinOrder: number | null = null,
): CoworkSessionSummary => ({
  id,
  title: id,
  status,
  pinned,
  pinOrder,
  agentId: 'main',
  mode: CoworkSessionModeValue.Single,
  selectedAgentIds: ['main'],
  createdAt,
  updatedAt,
});

const makeAgent = (
  id: string,
  pinned = false,
  pinOrder: number | null = null,
): AgentSidebarAgentSummary => ({
  id,
  name: id,
  icon: '',
  enabled: true,
  pinned,
  pinOrder,
});

test('sortAgentSidebarTasks keeps unpinned tasks ordered by last update time', () => {
  const sorted = sortAgentSidebarTasks([
    makeSession('newer-created-older-update', 300, 200),
    makeSession('older-created-newer-update', 100, 500, CoworkSessionStatusValue.Running),
    makeSession('middle', 200, 300),
  ]);

  expect(sorted.map((session) => session.id)).toEqual([
    'older-created-newer-update',
    'middle',
    'newer-created-older-update',
  ]);
});

test('sortAgentSidebarTasks keeps pinned tasks in first-pinned-first order', () => {
  const sorted = sortAgentSidebarTasks([
    makeSession('newer-unpinned', 100, 400),
    makeSession('second-pinned', 100, 200, CoworkSessionStatusValue.Completed, true, 2),
    makeSession('middle-unpinned', 200, 300),
    makeSession('first-pinned', 200, 100, CoworkSessionStatusValue.Completed, true, 1),
  ]);

  expect(sorted.map((session) => session.id)).toEqual([
    'first-pinned',
    'second-pinned',
    'newer-unpinned',
    'middle-unpinned',
  ]);
});

test('sortAgentSidebarAgents keeps pinned agents in first-pinned-first order', () => {
  const sorted = sortAgentSidebarAgents([
    makeAgent('regular'),
    makeAgent('second-pinned', true, 2),
    makeAgent('first-pinned', true, 1),
    makeAgent('another-regular'),
  ]);

  expect(sorted.map((agent) => agent.id)).toEqual([
    'first-pinned',
    'second-pinned',
    'regular',
    'another-regular',
  ]);
});

test('patchExistingAgentSidebarSession updates preview fields while preserving source', () => {
  const existing: CoworkSessionSummary = {
    ...makeSession('home-session', 100, 200),
    source: { kind: 'agentHome', label: 'Main' },
  };
  const plainUpdate: CoworkSessionSummary = {
    ...makeSession('home-session', 100, 300, CoworkSessionStatusValue.Running, true, 1),
    title: 'Updated title',
  };

  expect(patchExistingAgentSidebarSession(existing, plainUpdate)).toEqual({
    ...existing,
    title: plainUpdate.title,
    status: plainUpdate.status,
    pinned: plainUpdate.pinned,
    pinOrder: plainUpdate.pinOrder,
    agentId: plainUpdate.agentId,
    createdAt: plainUpdate.createdAt,
    updatedAt: plainUpdate.updatedAt,
  });
});

test('patchExistingAgentSidebarSession does not add plain sessions to the sidebar', () => {
  expect(patchExistingAgentSidebarSession(undefined, makeSession('plain-session', 100))).toBeNull();
});
