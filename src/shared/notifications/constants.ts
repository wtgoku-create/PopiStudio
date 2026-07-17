import { ASK_USER_QUESTION_TOOL_NAME } from '../cowork/constants';

export const TaskCompletionNotificationMode = {
  Always: 'always',
  Unfocused: 'unfocused',
  Off: 'off',
} as const;

export type TaskCompletionNotificationMode =
  typeof TaskCompletionNotificationMode[keyof typeof TaskCompletionNotificationMode];

export const WaitingNotificationKind = {
  Permission: 'permission',
  Question: 'question',
} as const;

export type WaitingNotificationKind =
  typeof WaitingNotificationKind[keyof typeof WaitingNotificationKind];

export interface NotificationSettings {
  taskCompletionNotificationMode: TaskCompletionNotificationMode;
  permissionNotificationsEnabled: boolean;
  questionNotificationsEnabled: boolean;
  taskCompletionNotificationsEnabled?: boolean;
}

export const defaultNotificationSettings: NotificationSettings = {
  taskCompletionNotificationMode: TaskCompletionNotificationMode.Unfocused,
  permissionNotificationsEnabled: true,
  questionNotificationsEnabled: true,
};

export const classifyWaitingNotificationKind = (toolName?: string | null): WaitingNotificationKind => (
  toolName === ASK_USER_QUESTION_TOOL_NAME
    ? WaitingNotificationKind.Question
    : WaitingNotificationKind.Permission
);

export const normalizeNotificationSettings = (value: unknown): NotificationSettings => {
  const input = value && typeof value === 'object'
    ? value as Partial<NotificationSettings>
    : {};
  const legacyCompletionEnabled = input.taskCompletionNotificationsEnabled;
  const mode = Object.values(TaskCompletionNotificationMode).includes(
    input.taskCompletionNotificationMode as TaskCompletionNotificationMode,
  )
    ? input.taskCompletionNotificationMode as TaskCompletionNotificationMode
    : legacyCompletionEnabled === false
      ? TaskCompletionNotificationMode.Off
      : defaultNotificationSettings.taskCompletionNotificationMode;

  return {
    taskCompletionNotificationMode: mode,
    permissionNotificationsEnabled: input.permissionNotificationsEnabled ?? true,
    questionNotificationsEnabled: input.questionNotificationsEnabled ?? true,
  };
};
