import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Type } from '@sinclair/typebox';
import type {
  OpenClawPluginApi,
  PluginCommandContext,
  PluginHookAgentContext,
  PluginHookBeforeToolCallEvent,
  PluginHookToolContext,
} from 'openclaw/plugin-sdk';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

const PLAN_MODE_STATE = {
  planning: 'planning',
  awaitingApproval: 'awaiting_approval',
  executing: 'executing',
} as const;
type PlanModeState = typeof PLAN_MODE_STATE[keyof typeof PLAN_MODE_STATE];

const PLAN_CONTROL_ACTION = {
  start: 'start',
  approve: 'approve',
  cancel: 'cancel',
  status: 'status',
} as const;

const PLAN_MODE_COMMAND = {
  plan: 'plan',
} as const;

const PLAN_MODE_TOOL = {
  complete: 'plan_mode_complete',
} as const;

const MAX_PLAN_LENGTH = 12000;

const PLAN_MODE_HOOK = {
  beforeToolCall: 'popi-plan-mode.before-tool-call',
  beforeAgentReply: 'popi-plan-mode.before-agent-reply',
} as const;

let pluginLogger: OpenClawPluginApi['logger'] | undefined;

const READ_ONLY_TOOLS = new Set([
  'read',
  'grep',
  'find',
  'ls',
  'glob',
  'web_search',
  'web_fetch',
  'askuserquestion',
]);

const SAFE_EXEC_COMMANDS = new Set([
  'cat',
  'file',
  'find',
  'git',
  'grep',
  'head',
  'ls',
  'pwd',
  'rg',
  'sed',
  'stat',
  'tail',
  'wc',
]);

type SessionState = {
  mode: PlanModeState;
  plan?: string;
  planId?: string;
  planHash?: string;
  revision?: number;
};

const log = (message: string, ...details: unknown[]): void => {
  pluginLogger?.info(`[PopiPlanMode] ${message}`, ...details);
};

const logJson = (message: string, value: unknown): void => {
  try {
    pluginLogger?.info(`[PopiPlanMode] ${message} ${JSON.stringify(value)}`);
  } catch {
    pluginLogger?.info(`[PopiPlanMode] ${message} [unserializable]`);
  }
};

const logSessionState = (sessionKey: string, state: SessionState, phase: string): void => {
  logJson('session plan mode state', {
    phase,
    sessionKey: sessionLabel(sessionKey),
    mode: state.mode,
    revision: state.revision ?? 0,
    hasPlan: Boolean(state.plan),
    hasPlanId: Boolean(state.planId),
    hasPlanHash: Boolean(state.planHash),
  });
};

const sessionLabel = (sessionKey: string): string => {
  if (sessionKey.length <= 48) return sessionKey;
  return `${sessionKey.slice(0, 24)}...${sessionKey.slice(-16)}`;
};

const sessionStates = new Map<string, SessionState>();
const stateRoot = join(
  process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw'),
  'plugins',
  'popi-plan-mode',
);

const getSessionKey = (value: PluginCommandContext | PluginHookToolContext | PluginHookAgentContext): string => (
  value.sessionKey || value.sessionId || 'global'
);

const getStatePath = (sessionKey: string): string => {
  const digest = createHash('sha256').update(sessionKey).digest('hex');
  return join(stateRoot, `${digest}.json`);
};

const isPlanModeState = (value: unknown): value is PlanModeState => (
  value === PLAN_MODE_STATE.planning
  || value === PLAN_MODE_STATE.awaitingApproval
  || value === PLAN_MODE_STATE.executing
);

const hashPlan = (value: string): string => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return `${value.length}:${(hash >>> 0).toString(36)}`;
};

const loadState = (sessionKey: string): SessionState => {
  const cached = sessionStates.get(sessionKey);
  if (cached) return cached;

  try {
    const parsed = JSON.parse(readFileSync(getStatePath(sessionKey), 'utf8')) as Record<string, unknown>;
    const state: SessionState = {
      mode: isPlanModeState(parsed.mode) ? parsed.mode : PLAN_MODE_STATE.executing,
      ...(typeof parsed.plan === 'string' && parsed.plan.trim() ? { plan: parsed.plan } : {}),
      ...(typeof parsed.planId === 'string' ? { planId: parsed.planId } : {}),
      ...(typeof parsed.planHash === 'string' ? { planHash: parsed.planHash } : {}),
      ...(typeof parsed.revision === 'number' ? { revision: parsed.revision } : {}),
    };
    sessionStates.set(sessionKey, state);
    return state;
  } catch {
    return { mode: PLAN_MODE_STATE.executing };
  }
};

const saveState = (sessionKey: string, state: SessionState): void => {
  mkdirSync(stateRoot, { recursive: true });
  const statePath = getStatePath(sessionKey);
  const tempPath = `${statePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state)}\n`, 'utf8');
  renameSync(tempPath, statePath);
  sessionStates.set(sessionKey, state);
  logSessionState(sessionKey, state, 'state_saved');
  log('state saved', {
    sessionKey: sessionLabel(sessionKey),
    mode: state.mode,
    revision: state.revision ?? 0,
    hasPlan: Boolean(state.plan),
  });
};

const clearState = (sessionKey: string): void => {
  sessionStates.delete(sessionKey);
  try {
    rmSync(getStatePath(sessionKey), { force: true });
  } catch {
    // State cleanup is best effort during session teardown.
  }
};

const getPlanState = (sessionKey: string): SessionState => loadState(sessionKey);

const saveSubmittedPlan = (
  sessionKey: string,
  state: SessionState,
  plan: string,
): void => {
  if (plan.length > MAX_PLAN_LENGTH) return;
  const planHash = hashPlan(plan);
  saveState(sessionKey, {
    ...state,
    mode: PLAN_MODE_STATE.awaitingApproval,
    plan,
    planId: state.planId || `${sessionKey}:${planHash.slice(0, 16)}`,
    planHash,
    revision: (state.revision || 0) + 1,
  });
};

const getExecCommand = (params: Record<string, unknown>): string => {
  const value = params.command ?? params.cmd;
  return typeof value === 'string' ? value.trim() : '';
};

const isSafeExecCommand = (command: string): boolean => {
  const firstCommand = command.match(/^([A-Za-z0-9._-]+)/)?.[1]?.toLowerCase();
  if (!firstCommand || !SAFE_EXEC_COMMANDS.has(firstCommand)) return false;
  return !/[;&|<>$`]|\b(rm|mv|cp|chmod|chown|touch|truncate|tee|apply_patch)\b/i.test(command);
};

const isAllowedDuringPlanning = (
  event: PluginHookBeforeToolCallEvent,
): boolean => {
  if (READ_ONLY_TOOLS.has(event.toolName)) return true;
  if (event.toolName === 'exec') return isSafeExecCommand(getExecCommand(event.params));
  return false;
};

const buildModeSystemPrompt = (
  sessionKey: string,
  mode: PlanModeState,
  plan?: string,
): string => {
  const boundedPlan = plan?.slice(0, MAX_PLAN_LENGTH);
  const text = mode === PLAN_MODE_STATE.planning
    ? [
        'You are in PLAN MODE for this session.',
        'Only inspect and analyze the repository. Do not modify files, run mutating commands, or perform implementation work.',
        'Do not read skill definition directories or use skill-specific tools while planning.',
        'Ask focused questions when requirements are unclear.',
        'When the plan is ready, first write the complete Markdown plan in your normal assistant response so the user can see it stream progressively.',
        'After the plan text is complete, call plan_mode_complete with exactly the same complete Markdown plan to submit it for approval.',
        'Do not wrap the plan in XML tags. The assistant response is a live draft; the tool call is the authoritative submission.',
        'Use the same language as the user and include Summary, Implementation Approach, Key Changes, Validation, and Assumptions or Questions.',
      ].join('\n')
    : mode === PLAN_MODE_STATE.awaitingApproval
      ? [
          'You are in PLAN APPROVAL mode for this session.',
          'A plan has been submitted and is waiting for the user to approve it.',
          'Do not modify files, execute commands, or continue implementation until approval is received.',
          'If asked to proceed, wait for the application to switch the session to execution mode.',
          boundedPlan ? `\nSubmitted plan:\n${boundedPlan}` : '',
        ].filter(Boolean).join('\n')
      : [
          'You are in PLAN EXECUTION mode for this session.',
          'The user approved the plan below. Execute it with the available tools and follow the plan.',
          boundedPlan ? `\nApproved plan:\n${boundedPlan}` : '',
        ].filter(Boolean).join('\n');

  return [
    '[Popi Plan Mode]',
    `Session: ${sessionLabel(sessionKey)}`,
    text,
  ].join('\n');
};

const logPromptInjection = (sessionKey: string, mode: PlanModeState, promptLength: number): void => {
  log('system prompt guidance prepared', {
    sessionKey: sessionLabel(sessionKey),
    mode,
    promptLength,
  });
};

const enterPlanning = (ctx: PluginCommandContext) => {
  const sessionKey = getSessionKey(ctx);
  saveState(sessionKey, { mode: PLAN_MODE_STATE.planning });
  return { text: 'Plan mode enabled. The agent can inspect files but cannot modify them.' };
};

const approvePlan = (ctx: PluginCommandContext) => {
  const sessionKey = getSessionKey(ctx);
  const state = loadState(sessionKey);
  if (!state.plan) {
    return { text: 'No completed plan is available to approve.', isError: true };
  }
  saveState(sessionKey, { ...state, mode: PLAN_MODE_STATE.executing });
  return { text: 'Plan approved. Execution mode enabled.' };
};

const leavePlanning = (ctx: PluginCommandContext) => {
  const sessionKey = getSessionKey(ctx);
  saveState(sessionKey, { mode: PLAN_MODE_STATE.executing });
  return { text: 'Plan mode disabled. Full tool access restored.' };
};

/*
 * Prompt guidance is returned from before_prompt_build so OpenClaw adds it to
 * the actual system prompt for every model request. This avoids relying on a
 * queued user-context injection being consumed by a later turn.
 */
const getModePrompt = (sessionKey: string): string | undefined => {
  const state = loadState(sessionKey);
  logSessionState(sessionKey, state, 'before_prompt_build');
  if (state.mode === PLAN_MODE_STATE.executing && !state.plan) return undefined;
  const prompt = buildModeSystemPrompt(sessionKey, state.mode, state.plan);
  logPromptInjection(sessionKey, state.mode, prompt.length);
  return prompt;
};

export default definePluginEntry({
  id: 'popi-plan-mode',
  name: 'Popi Plan Mode',
  description: 'Read-only planning mode with explicit plan handoff.',
  register(api) {
    pluginLogger = api.logger;
    log('plugin registered');
    api.on('agent_turn_prepare', async (event, ctx) => {
      const sessionKey = ctx.sessionKey || ctx.sessionId || 'unknown';
      logSessionState(sessionKey, getPlanState(sessionKey), 'agent_turn_prepare');
      const queuedInjections = Array.isArray(event.queuedInjections)
        ? event.queuedInjections
        : [];
      logJson('agent_turn_prepare observed', {
        sessionKey: sessionLabel(sessionKey),
        injectionCount: queuedInjections.length,
        injections: queuedInjections.map((injection) => ({
          id: injection.id,
          pluginId: injection.pluginId,
          placement: injection.placement,
          textLength: typeof injection.text === 'string' ? injection.text.length : 0,
        })),
      });
    });
    api.on('before_prompt_build', async (_event, ctx) => {
      const sessionKey = getSessionKey(ctx);
      const prompt = getModePrompt(sessionKey);
      if (!prompt) return;
      return { prependSystemContext: prompt };
    }, { name: 'popi-plan-mode.before-prompt-build' });
    api.registerGatewayMethod('popi.plan.control', async ({ params, respond }) => {
      const request = (params || {}) as Record<string, unknown>;
      const sessionKey = typeof request.sessionKey === 'string' && request.sessionKey.trim()
        ? request.sessionKey.trim()
        : 'global';
      const action = typeof request.action === 'string' ? request.action : '';
      const state = getPlanState(sessionKey);
      log('control request received', {
        sessionKey: sessionLabel(sessionKey),
        action,
        currentMode: state.mode,
        revision: state.revision ?? 0,
      });

      if (action === PLAN_CONTROL_ACTION.start) {
        saveState(sessionKey, { mode: PLAN_MODE_STATE.planning, revision: 0 });
      } else if (action === PLAN_CONTROL_ACTION.cancel) {
        saveState(sessionKey, { mode: PLAN_MODE_STATE.executing, revision: state.revision || 0 });
      } else if (action === PLAN_CONTROL_ACTION.approve) {
        if (state.mode !== PLAN_MODE_STATE.awaitingApproval || !state.planHash) {
          respond(false, undefined, { code: 'PLAN_NOT_READY', message: 'No plan is waiting for approval.' });
          return;
        }
        if (
          request.planHash !== state.planHash
          || request.revision !== (state.revision || 0)
        ) {
          respond(false, undefined, { code: 'PLAN_STALE', message: 'The proposed plan is stale.' });
          return;
        }
        saveState(sessionKey, {
          ...state,
          mode: PLAN_MODE_STATE.executing,
          planHash: request.planHash,
        });
      } else if (action !== PLAN_CONTROL_ACTION.status) {
        respond(false, undefined, { code: 'PLAN_ACTION_INVALID', message: 'Unsupported plan action.' });
        return;
      }

      respond(true, { state: loadState(sessionKey) });
      log('control request completed', {
        sessionKey: sessionLabel(sessionKey),
        action,
        mode: loadState(sessionKey).mode,
        revision: loadState(sessionKey).revision ?? 0,
      });
    }, { scope: 'operator.write' });

    api.lifecycle.registerRuntimeLifecycle({
      id: 'popi-plan-mode-state',
      description: 'Clean persisted plan mode state when an OpenClaw session is removed.',
      cleanup: ({ sessionKey }) => {
        if (sessionKey) clearState(sessionKey);
      },
    });

    api.registerCommand({
      name: PLAN_MODE_COMMAND.plan,
      description: 'Enter, inspect, approve, or exit plan mode.',
      acceptsArgs: true,
      requireAuth: false,
      handler: async (ctx) => {
        const action = (ctx.args || '').trim().toLowerCase();
        if (action === 'approve') return approvePlan(ctx);
        if (action === 'off' || action === 'exit') return leavePlanning(ctx);
        if (action === 'status') {
          const state = loadState(getSessionKey(ctx));
          return { text: `Plan mode: ${state.mode}${state.plan ? '; plan ready for approval' : ''}.` };
        }
        return enterPlanning(ctx);
      },
    });

    api.registerTool({
      name: PLAN_MODE_TOOL.complete,
      description: 'Submit the complete Markdown plan after displaying it in the assistant response. Pass exactly the same plan text for authoritative approval.',
      executionMode: 'sequential',
      parameters: Type.Object({
        plan: Type.String({
          minLength: 1,
          maxLength: MAX_PLAN_LENGTH,
          description: 'A complete, decision-ready implementation plan.',
        }),
      }),
      async execute(_toolCallId: string, params: { plan: string }) {
        log('plan completion tool called', {
          toolCallId: _toolCallId,
          planLength: typeof params.plan === 'string' ? params.plan.trim().length : 0,
        });
        return {
          content: [{
            type: 'text',
            text: params.plan.trim(),
          }],
          details: {
            status: PLAN_MODE_STATE.awaitingApproval,
            message: 'Plan submitted and waiting for user approval.',
          },
          // Stop the current agent loop so no implementation tool runs before approval.
          terminate: true,
        };
      },
    });

    api.on('before_tool_call', async (event, ctx) => {
      const sessionKey = getSessionKey(ctx);
      const state = loadState(sessionKey);
      logSessionState(sessionKey, state, 'before_tool_call');
      log('before_tool_call evaluated', {
        sessionKey: sessionLabel(sessionKey),
        mode: state.mode,
        toolName: event.toolName,
      });
      if (event.toolName === PLAN_MODE_TOOL.complete && state.mode === PLAN_MODE_STATE.planning) {
        const plan = event.params.plan;
        const normalizedPlan = typeof plan === 'string' ? plan.trim() : '';
        if (normalizedPlan && normalizedPlan.length <= MAX_PLAN_LENGTH) {
          saveSubmittedPlan(sessionKey, state, normalizedPlan);
          log('plan saved from tool call', {
            sessionKey: sessionLabel(sessionKey),
            planLength: normalizedPlan.length,
            revision: (state.revision || 0) + 1,
          });
        } else {
          log('plan completion tool received an empty or oversized plan', {
            sessionKey: sessionLabel(sessionKey),
          });
        }
        if (!normalizedPlan || normalizedPlan.length > MAX_PLAN_LENGTH) {
          return {
            block: true,
            blockReason: `Plan must contain 1-${MAX_PLAN_LENGTH} characters.`,
          };
        }
        log('plan completion tool allowed during plan mode', {
          sessionKey: sessionLabel(sessionKey),
          toolName: event.toolName,
        });
        return;
      }
      if (event.toolName === PLAN_MODE_TOOL.complete && state.mode === PLAN_MODE_STATE.awaitingApproval) {
        log('duplicate plan completion blocked while awaiting approval', {
          sessionKey: sessionLabel(sessionKey),
        });
        return {
          block: true,
          blockReason: 'A plan is already waiting for approval. Approve or cancel it before submitting another plan.',
        };
      }
      if (
        (state.mode !== PLAN_MODE_STATE.planning && state.mode !== PLAN_MODE_STATE.awaitingApproval)
        || isAllowedDuringPlanning(event)
      ) {
        log('tool allowed during plan mode', {
          sessionKey: sessionLabel(sessionKey),
          toolName: event.toolName,
        });
        return;
      }
      log('tool blocked during plan mode', {
        sessionKey: sessionLabel(sessionKey),
        toolName: event.toolName,
      });
      return {
        block: true,
        blockReason: 'Plan mode only allows read-only inspection and plan submission.',
      };
    }, { name: PLAN_MODE_HOOK.beforeToolCall });

    api.on('before_agent_reply', async (event, ctx) => {
      const sessionKey = getSessionKey(ctx);
      const state = loadState(sessionKey);
      logSessionState(sessionKey, state, 'before_agent_reply');
      log('before_agent_reply evaluated', {
        sessionKey: sessionLabel(sessionKey),
        mode: state.mode,
        bodyLength: event.cleanedBody.length,
      });
      if (state.mode !== PLAN_MODE_STATE.planning) return;
      const match = event.cleanedBody.match(/<proposed_plan\b[^>]*>([\s\S]*?)<\/proposed_plan\s*>/i);
      const plan = match?.[1]?.trim();
      if (plan && plan.length <= MAX_PLAN_LENGTH) {
        saveSubmittedPlan(sessionKey, state, plan);
        log('plan saved from legacy reply marker', {
          sessionKey: sessionLabel(sessionKey),
          planLength: plan.length,
          revision: (state.revision || 0) + 1,
        });
      } else {
        log('agent reply did not contain a valid legacy plan marker', {
          sessionKey: sessionLabel(sessionKey),
        });
      }
    }, { name: PLAN_MODE_HOOK.beforeAgentReply });
  },
});
