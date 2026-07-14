import type Database from 'better-sqlite3';

import { parseManagedSessionKey } from './openclawChannelSessionSync';

const getSessionRowById = (
  db: Database.Database,
  sessionId: string,
): { id: string } | null => {
  const normalized = sessionId.trim();
  if (!normalized) return null;
  const row = db
    .prepare('SELECT id FROM cowork_sessions WHERE id = ? LIMIT 1')
    .get(normalized) as { id: string } | undefined;
  return row ?? null;
};

const getSessionRowByClaudeSessionId = (
  db: Database.Database,
  sessionKey: string,
): { id: string } | null => {
  const normalized = sessionKey.trim();
  if (!normalized) return null;
  const row = db
    .prepare('SELECT id FROM cowork_sessions WHERE claude_session_id = ? LIMIT 1')
    .get(normalized) as { id: string } | undefined;
  return row ?? null;
};

export function resolveCoworkSessionIdByOpenClawSessionKey(
  db: Database.Database,
  sessionKey: string | undefined | null,
): string | null {
  const normalized = (sessionKey ?? '').trim();
  if (!normalized) return null;

  const persisted = getSessionRowByClaudeSessionId(db, normalized);
  if (persisted) return persisted.id;

  const managed = parseManagedSessionKey(normalized);
  if (!managed) return null;

  const session = getSessionRowById(db, managed.sessionId);
  return session?.id ?? null;
}

export function isCoworkSessionBoundToIm(
  db: Database.Database,
  sessionId: string,
): boolean {
  const normalized = sessionId.trim();
  if (!normalized) return false;

  const mapping = db
    .prepare('SELECT 1 FROM im_session_mappings WHERE cowork_session_id = ? LIMIT 1')
    .get(normalized) as { 1: number } | undefined;
  return !!mapping;
}

export function resolveLocalDesktopCoworkSessionIdByOpenClawSessionKey(
  db: Database.Database,
  sessionKey: string | undefined | null,
): string | null {
  const sessionId = resolveCoworkSessionIdByOpenClawSessionKey(db, sessionKey);
  if (!sessionId) return null;
  return isCoworkSessionBoundToIm(db, sessionId) ? null : sessionId;
}
