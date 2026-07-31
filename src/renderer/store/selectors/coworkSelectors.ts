import { createSelector } from '@reduxjs/toolkit';

import { SESSION_AGNOSTIC_PERMISSION_SESSION_ID } from '../../../shared/cowork/constants';
import type { RootState } from '../index';

// --- Primitive (identity) selectors ---
// These return stable references for primitive values or existing object refs,
// so useSelector's default === check is enough to skip re-renders.

export const selectCoworkSessions = (state: RootState) => state.cowork.sessions;
export const selectCurrentSessionId = (state: RootState) => state.cowork.currentSessionId;
export const selectCurrentSession = (state: RootState) => state.cowork.currentSession;
export const selectIsStreaming = (state: RootState) => state.cowork.isStreaming;
export const selectIsCoworkActive = (state: RootState) => state.cowork.isCoworkActive;
export const selectRemoteManaged = (state: RootState) => state.cowork.remoteManaged;
export const selectCoworkConfig = (state: RootState) => state.cowork.config;
export const selectDraftPrompts = (state: RootState) => state.cowork.draftPrompts;
export const selectPendingPermissions = (state: RootState) => state.cowork.pendingPermissions;
export const selectUnreadSessionIds = (state: RootState) => state.cowork.unreadSessionIds;

// --- Derived (memoized) selectors ---
// These compute new values from the store and use createSelector to avoid
// returning new object references when the inputs haven't changed.

export const selectAgentEngine = createSelector(
  selectCoworkConfig,
  (config) => config.agentEngine,
);

export const selectIsOpenClawEngine = createSelector(
  selectAgentEngine,
  (engine) => engine === 'openclaw',
);

export const selectCurrentMessages = createSelector(
  selectCurrentSession,
  (session) => session?.messages ?? null,
);

export const selectCurrentMessagesLength = createSelector(
  selectCurrentMessages,
  (messages) => messages?.length ?? 0,
);

export const selectLastMessageContent = createSelector(
  selectCurrentMessages,
  (messages) => {
    if (!messages || messages.length === 0) return undefined;
    return messages[messages.length - 1]?.content;
  },
);

export const selectFirstPendingPermission = createSelector(
  selectPendingPermissions,
  (permissions) => permissions[0] ?? null,
);

export const selectFirstCurrentSessionPendingPermission = createSelector(
  selectPendingPermissions,
  selectCurrentSessionId,
  (permissions, currentSessionId) => {
    const sessionScoped = currentSessionId
      ? permissions.find((permission) => permission.sessionId === currentSessionId)
      : undefined;
    if (sessionScoped) return sessionScoped;
    return permissions.find(
      (permission) => permission.sessionId === SESSION_AGNOSTIC_PERMISSION_SESSION_ID
    ) ?? null;
  },
);

export const selectPendingPermissionSessionIds = createSelector(
  selectPendingPermissions,
  (permissions) => {
    const ids = new Set<string>();
    for (const permission of permissions) {
      ids.add(permission.sessionId);
      const sessionKey = typeof permission.toolInput?.sessionKey === 'string'
        ? permission.toolInput.sessionKey.trim()
        : '';
      const parts = sessionKey.split(':');
      if (parts.length < 4 || parts[0] !== 'agent') continue;

      const source = parts[2]?.trim();
      const sessionId = parts.slice(3).join(':').trim();
      if ((source === 'popiai' || source === 'subagent') && sessionId) {
        ids.add(sessionId);
      }
    }
    return Array.from(ids);
  },
);
