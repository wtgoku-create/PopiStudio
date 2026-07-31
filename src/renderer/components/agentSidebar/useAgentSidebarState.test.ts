import { expect, test } from 'vitest';

import {
  CoworkSessionSourceKind,
  SESSION_AGNOSTIC_PERMISSION_SESSION_ID,
} from '../../../shared/cowork/constants';
import {
  type CoworkSessionSource,
  type CoworkSessionStatus,
  CoworkSessionStatusValue,
  type CoworkSessionSummary,
} from '../../types/cowork';
import { AgentSidebarIndicator } from './constants';
import type { AgentSidebarAgentSummary } from './types';
import {
  deriveAgentSidebarIndicator,
  groupAgentSidebarSessions,
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
  agentId = 'main',
): CoworkSessionSummary => ({
  id,
  title: id,
  status,
  pinned,
  pinOrder,
  agentId,
  createdAt,
  updatedAt,
});

const withSource = (
  session: CoworkSessionSummary,
  kind: CoworkSessionSource['kind'] = CoworkSessionSourceKind.IM,
): CoworkSessionSummary => ({
  ...session,
  source: { kind, label: session.title },
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

test('patchExistingAgentSidebarSession ignores missing existing session', () => {
  expect(patchExistingAgentSidebarSession(undefined, makeSession('plain-session', 100))).toBeNull();
});

test('groupAgentSidebarSessions groups multiple sessions under the owning agent', () => {
  const grouped = groupAgentSidebarSessions(
    [makeAgent('main'), makeAgent('agent-1')],
    [
      makeSession('main-newer', 100, 400, CoworkSessionStatusValue.Completed, false, null, 'main'),
      makeSession('main-older', 100, 200, CoworkSessionStatusValue.Completed, false, null, 'main'),
      makeSession('custom-session', 100, 300, CoworkSessionStatusValue.Completed, false, null, 'agent-1'),
    ],
    null,
    new Set(),
  );

  expect(grouped.map((agent) => agent.id)).toEqual(['main', 'agent-1']);
  expect(grouped[0].tasks.map((task) => task.id)).toEqual(['main-newer', 'main-older']);
  expect(grouped[1].tasks.map((task) => task.id)).toEqual(['custom-session']);
});

test('groupAgentSidebarSessions keeps task ordering within each agent', () => {
  const grouped = groupAgentSidebarSessions(
    [makeAgent('main')],
    [
      makeSession('newer-unpinned', 100, 400),
      makeSession('second-pinned', 100, 200, CoworkSessionStatusValue.Completed, true, 2),
      makeSession('first-pinned', 100, 100, CoworkSessionStatusValue.Completed, true, 1),
    ],
    null,
    new Set(),
  );

  expect(grouped[0].tasks.map((task) => task.id)).toEqual([
    'first-pinned',
    'second-pinned',
    'newer-unpinned',
  ]);
});

test('deriveAgentSidebarIndicator prioritizes pending permission over running and unread', () => {
  const session = makeSession('pending-session', 100, 200, CoworkSessionStatusValue.Running);

  expect(deriveAgentSidebarIndicator(
    session,
    new Set(['pending-session']),
    new Set(['pending-session']),
    null,
  )).toBe(AgentSidebarIndicator.PendingPermission);
});

test('deriveAgentSidebarIndicator maps session-agnostic permission to current session', () => {
  const session = makeSession('current-session', 100, 200, CoworkSessionStatusValue.Completed);

  expect(deriveAgentSidebarIndicator(
    session,
    new Set(),
    new Set([SESSION_AGNOSTIC_PERMISSION_SESSION_ID]),
    'current-session',
  )).toBe(AgentSidebarIndicator.PendingPermission);
});

test('groupAgentSidebarSessions includes plain sessions without source', () => {
  const grouped = groupAgentSidebarSessions(
    [makeAgent('main')],
    [
      makeSession('plain-session', 100, 400),
      withSource(makeSession('sidebar-session', 100, 300)),
    ],
    null,
    new Set(),
  );

  expect(grouped).toHaveLength(1);
  expect(grouped[0].tasks.map((task) => task.id)).toEqual(['plain-session', 'sidebar-session']);
});

test('groupAgentSidebarSessions includes newly created plain agent sessions', () => {
  const grouped = groupAgentSidebarSessions(
    [makeAgent('agent-1')],
    [
      makeSession('new-agent-session', 100, 400, CoworkSessionStatusValue.Running, false, null, 'agent-1'),
    ],
    'new-agent-session',
    new Set(),
  );

  expect(grouped).toHaveLength(1);
  expect(grouped[0].tasks[0]).toMatchObject({
    id: 'new-agent-session',
    agentId: 'agent-1',
    isSelected: true,
  });
});

test('groupAgentSidebarSessions keeps empty agents visible', () => {
  const grouped = groupAgentSidebarSessions(
    [makeAgent('main'), makeAgent('agent-1')],
    [makeSession('main-session', 100, 400, CoworkSessionStatusValue.Completed, false, null, 'main')],
    null,
    new Set(),
    new Set(),
    new Set(),
    new Set(),
    new Set(['agent-1']),
    new Set(),
    {},
    {},
  );

  expect(grouped.map((agent) => [agent.id, agent.tasks.map((task) => task.id)])).toEqual([
    ['main', ['main-session']],
    ['agent-1', []],
  ]);
});

test('groupAgentSidebarSessions does not mix sessions across agents', () => {
  const grouped = groupAgentSidebarSessions(
    [makeAgent('main'), makeAgent('agent-1'), makeAgent('agent-2')],
    [
      makeSession('agent-2-session', 100, 300, CoworkSessionStatusValue.Completed, false, null, 'agent-2'),
      makeSession('agent-1-session', 100, 400, CoworkSessionStatusValue.Completed, false, null, 'agent-1'),
    ],
    null,
    new Set(),
  );

  expect(grouped.map((agent) => [agent.id, agent.tasks.map((task) => task.id)])).toEqual([
    ['main', []],
    ['agent-1', ['agent-1-session']],
    ['agent-2', ['agent-2-session']],
  ]);
});
