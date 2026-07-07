import { describe, expect, test } from 'vitest';

import {
  DeliveryChannel,
  DeliveryMode,
  PayloadKind,
  ScheduleKind,
  SessionTarget,
  WakeMode,
} from '../../../scheduledTask/constants';
import type { ScheduledTask } from '../../../scheduledTask/types';
import { i18nService } from '../../services/i18n';
import { buildScheduledTaskInputFromForm, createScheduledTaskFormState } from './TaskForm';
import {
  SCHEDULED_TASK_TEMPLATES,
  ScheduledTaskTemplateId,
  ScheduledTaskTemplatePlanType,
} from './taskTemplates';

const fallbackModelRef = 'openai/gpt-5.5';

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    name: 'Daily summary',
    description: '',
    enabled: true,
    schedule: { kind: ScheduleKind.Cron, expr: '0 9 * * *' },
    sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.Now,
    payload: { kind: PayloadKind.AgentTurn, message: 'Summarize updates' },
    delivery: { mode: DeliveryMode.None },
    agentId: null,
    sessionKey: null,
    state: {
      nextRunAtMs: null,
      lastRunAtMs: null,
      lastStatus: null,
      lastError: null,
      lastDurationMs: null,
      runningAtMs: null,
      consecutiveErrors: 0,
    },
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('createScheduledTaskFormState', () => {
  test('uses the fallback model for new tasks', () => {
    const form = createScheduledTaskFormState(undefined, fallbackModelRef);

    expect(form.modelId).toBe(fallbackModelRef);
  });

  test('backfills old agent-turn tasks that do not have a model', () => {
    const form = createScheduledTaskFormState(makeTask(), fallbackModelRef);

    expect(form.modelId).toBe(fallbackModelRef);
  });

  test('keeps an explicit existing task model', () => {
    const form = createScheduledTaskFormState(makeTask({
      payload: {
        kind: PayloadKind.AgentTurn,
        message: 'Summarize updates',
        model: 'anthropic/claude-sonnet-4',
      },
    }), fallbackModelRef);

    expect(form.modelId).toBe('anthropic/claude-sonnet-4');
  });

  test('does not assign a model when editing a system-event task', () => {
    const form = createScheduledTaskFormState(makeTask({
      payload: {
        kind: PayloadKind.SystemEvent,
        text: 'Reminder',
      },
    }), fallbackModelRef);

    expect(form.payloadText).toBe('Reminder');
    expect(form.modelId).toBe('');
  });

  test('applies template defaults for new tasks', () => {
    const template = SCHEDULED_TASK_TEMPLATES.find(
      item => item.id === ScheduledTaskTemplateId.TechBriefing,
    );

    expect(template).toBeDefined();

    const form = createScheduledTaskFormState(undefined, fallbackModelRef, template);

    expect(form.name).toBe(i18nService.t(template!.titleKey));
    expect(form.payloadText).toBe(i18nService.t(template!.promptKey));
    expect(form.planType).toBe(ScheduledTaskTemplatePlanType.Weekly);
    expect(form.hour).toBe(8);
    expect(form.minute).toBe(30);
    expect(form.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(form.modelId).toBe(fallbackModelRef);
  });

  test('builds manual task input for isolated OpenClaw run chats', () => {
    const form = createScheduledTaskFormState(undefined, fallbackModelRef);
    const input = buildScheduledTaskInputFromForm(
      {
        ...form,
        name: 'Visible session task',
        payloadText: 'Run in a visible session',
        notifyChannel: 'none',
      },
      { kind: ScheduleKind.Cron, expr: '0 9 * * *' },
      {
        kind: PayloadKind.AgentTurn,
        message: 'Run in a visible session',
        model: fallbackModelRef,
      },
    );

    expect(input.sessionTarget).toBe(SessionTarget.Isolated);
    expect(input.payload).toEqual({
      kind: PayloadKind.AgentTurn,
      message: 'Run in a visible session',
      model: fallbackModelRef,
    });
    expect(input.delivery).toEqual({ mode: DeliveryMode.None });
  });

  test('keeps announce delivery on isolated run chat tasks', () => {
    const form = createScheduledTaskFormState(undefined, fallbackModelRef);
    const input = buildScheduledTaskInputFromForm(
      {
        ...form,
        name: 'Notify task',
        notifyChannel: 'feishu',
        notifyTo: 'ou_123',
        notifyAccountId: 'acct-1',
      },
      { kind: ScheduleKind.Cron, expr: '0 9 * * *' },
      {
        kind: PayloadKind.AgentTurn,
        message: 'Notify me',
        model: fallbackModelRef,
      },
    );

    expect(input.sessionTarget).toBe(SessionTarget.Isolated);
    expect(input.payload).toEqual({
      kind: PayloadKind.AgentTurn,
      message: 'Notify me',
      model: fallbackModelRef,
    });
    expect(input.delivery).toEqual({
      mode: DeliveryMode.Announce,
      channel: 'feishu',
      to: 'ou_123',
      accountId: 'acct-1',
    });
  });

  test('treats last-channel placeholder as no delivery for run chat tasks', () => {
    const form = createScheduledTaskFormState(undefined, fallbackModelRef);
    const input = buildScheduledTaskInputFromForm(
      {
        ...form,
        name: 'Run chat only',
        notifyChannel: DeliveryChannel.Last,
      },
      { kind: ScheduleKind.Cron, expr: '0 9 * * *' },
      {
        kind: PayloadKind.AgentTurn,
        message: 'Generate a run chat only',
        model: fallbackModelRef,
      },
    );

    expect(input.sessionTarget).toBe(SessionTarget.Isolated);
    expect(input.delivery).toEqual({ mode: DeliveryMode.None });
  });
});
