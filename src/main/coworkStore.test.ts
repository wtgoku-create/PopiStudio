/**
 * Unit tests for CoworkStore – resilient metadata parsing.
 *
 * Verifies that corrupt JSON in the metadata column of cowork_messages does NOT
 * prevent a session from loading.  Valid/null metadata must still work correctly.
 *
 * Mocks the `electron` module so CoworkStore can be imported outside Electron.
 */
import { beforeEach, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock electron so the import of coworkStore.ts succeeds in Node
// ---------------------------------------------------------------------------
vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock' },
}));

// ---------------------------------------------------------------------------
// Now import the class under test
// ---------------------------------------------------------------------------
import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { AgentAvatarSvg, DefaultAgentAvatarIcon, encodeAgentAvatarIcon } from '../shared/agent/avatar';
import { CoworkSessionSourceKind } from '../shared/cowork/constants';
import { CoworkStore } from './coworkStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: BetterSqlite3.Database;
let store: CoworkStore;

/** Initialise a fresh in-memory database with the minimum schema. */
function setupDb(): void {
  db = new BetterSqlite3(':memory:');

  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      last_message_preview TEXT,
      claude_session_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      pinned INTEGER NOT NULL DEFAULT 0,
      pin_order INTEGER,
      cwd TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      model_override TEXT NOT NULL DEFAULT '',
      execution_mode TEXT NOT NULL DEFAULT 'local',
      active_skill_ids TEXT,
      agent_id TEXT NOT NULL DEFAULT 'main',
      parent_session_id TEXT,
      goal_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      sequence INTEGER,
      FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      identity_key TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      file_name TEXT,
      file_path TEXT,
      url TEXT,
      remote_url TEXT,
      source TEXT,
      metadata TEXT,
      content_version INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(session_id, identity_key)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_session_sources (
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      label TEXT,
      task_id TEXT,
      platform TEXT,
      conversation_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, kind)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      identity TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      working_directory TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      skill_ids TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      pinned INTEGER NOT NULL DEFAULT 0,
      pin_order INTEGER,
      is_default INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'custom',
      preset_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_memories (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.75,
      is_explicit INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'created',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_used_at INTEGER
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_memory_sources (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      session_id TEXT,
      message_id TEXT,
      role TEXT NOT NULL DEFAULT 'system',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cowork_user_memories (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      fingerprint TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0.5,
      is_explicit INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL
    );
  `);

  // CoworkStore only needs (db)
  store = new CoworkStore(db);
  store.setConfig({ workingDirectory: fs.mkdtempSync(path.join(os.tmpdir(), 'popiai-cowork-project-')) });
}

/** Insert a session row directly. */
function insertSession(id: string, agentId = 'main', updatedAt = Date.now()): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO cowork_sessions (id, title, last_message_preview, claude_session_id, status, pinned, pin_order, cwd, system_prompt, execution_mode, active_skill_ids, agent_id, created_at, updated_at)
     VALUES (?, 'test', NULL, NULL, 'idle', 0, NULL, '/tmp', '', 'local', '[]', ?, ?, ?)`,
  ).run(id, agentId, now, updatedAt);
}

/** Insert a message row directly, bypassing CoworkStore.addMessage. */
function insertMessage(
  id: string,
  sessionId: string,
  type: string,
  content: string,
  metadata: string | null,
  sequence: number,
  createdAt = Date.now(),
): void {
  db.prepare(
    `INSERT INTO cowork_messages (id, session_id, type, content, metadata, created_at, sequence)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, sessionId, type, content, metadata, createdAt, sequence);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupDb();
});

test('listAgentSidebarSessions returns only sessions registered in source table', () => {
  insertSession('plain-session', 'main', 4000);
  insertSession('home-session', 'main', 3000);
  insertSession('im-session', 'main', 2000);
  insertSession('task-session', 'agent-2', 1000);

  store.upsertSessionSource({
    sessionId: 'home-session',
    kind: CoworkSessionSourceKind.AgentHome,
    label: 'Home',
  });
  store.upsertSessionSource({
    sessionId: 'im-session',
    kind: CoworkSessionSourceKind.IM,
    platform: 'popo',
    conversationId: 'conversation-1',
  });
  store.upsertSessionSource({
    sessionId: 'task-session',
    kind: CoworkSessionSourceKind.ScheduledTask,
    taskId: 'task-1',
  });

  const sessions = store.listAgentSidebarSessions();

  expect(sessions.map((session) => session.id)).toEqual([
    'home-session',
    'im-session',
    'task-session',
  ]);
  expect(sessions.map((session) => session.source?.kind)).toEqual([
    CoworkSessionSourceKind.AgentHome,
    CoworkSessionSourceKind.IM,
    CoworkSessionSourceKind.ScheduledTask,
  ]);
});

test('listAgentSidebarSessions returns cached last message previews from sessions', () => {
  insertSession('home-session', 'main', 1000);
  db.prepare('UPDATE cowork_sessions SET last_message_preview = ? WHERE id = ?')
    .run('cached preview', 'home-session');
  insertMessage('newer-message', 'home-session', 'assistant', 'newer message from message table', null, 1, 2000);
  store.upsertSessionSource({
    sessionId: 'home-session',
    kind: CoworkSessionSourceKind.AgentHome,
    label: 'Home',
  });

  const sessions = store.listAgentSidebarSessions();

  expect(sessions[0]?.lastMessagePreview).toBe('cached preview');
});

test('addMessage stores the latest user or assistant message preview on the session', () => {
  const sid = 'sess-preview-add';
  insertSession(sid);

  store.addMessage(sid, { type: 'tool_result', content: 'tool output' });
  expect(store.listSessions(10, 0)[0]?.lastMessagePreview).toBeUndefined();

  store.addMessage(sid, { type: 'assistant', content: ' assistant reply\nwith spaces ' });

  expect(store.listSessions(10, 0)[0]?.lastMessagePreview).toBe('assistant reply with spaces');
});

test('updateMessage refreshes the cached session preview', () => {
  const sid = 'sess-preview-update';
  insertSession(sid);
  const message = store.addMessage(sid, { type: 'assistant', content: 'draft' });

  store.updateMessage(sid, message.id, { content: 'final answer' });

  expect(store.listSessions(10, 0)[0]?.lastMessagePreview).toBe('final answer');
});

test('addMessage syncs detected artifacts into the resource table', () => {
  const sid = 'sess-artifact-add';
  insertSession(sid, 'main', 1000);
  db.prepare('UPDATE cowork_sessions SET cwd = ? WHERE id = ?').run('/repo', sid);

  store.addMessage(sid, { type: 'assistant', content: 'created /repo/output/report.pdf' });

  const artifacts = store.listArtifacts(sid);
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0]).toMatchObject({
    sessionId: sid,
    type: 'document',
    fileName: 'report.pdf',
    filePath: '/repo/output/report.pdf',
    content: '',
  });
});

test('updateMessage syncs artifacts discovered in finalized long messages', () => {
  const sid = 'sess-artifact-update';
  insertSession(sid, 'main', 1000);
  db.prepare('UPDATE cowork_sessions SET cwd = ? WHERE id = ?').run('/repo', sid);
  const message = store.addMessage(sid, { type: 'assistant', content: 'streaming...' });

  expect(store.listArtifacts(sid)).toEqual([]);

  store.updateMessage(sid, message.id, {
    content: 'final output at /repo/output/final.html',
    metadata: { isFinal: true },
  });

  expect(store.listArtifacts(sid).map(artifact => artifact.filePath)).toEqual([
    '/repo/output/final.html',
  ]);
});

test('deleteSession clears persisted artifacts', () => {
  const sid = 'sess-artifact-delete';
  insertSession(sid, 'main', 1000);
  db.prepare('UPDATE cowork_sessions SET cwd = ? WHERE id = ?').run('/repo', sid);
  store.addMessage(sid, { type: 'assistant', content: 'created /repo/output/report.pdf' });

  expect(store.listArtifacts(sid)).toHaveLength(1);

  store.deleteSession(sid);

  const row = db.prepare('SELECT COUNT(*) AS count FROM cowork_artifacts WHERE session_id = ?')
    .get(sid) as { count: number };
  expect(row.count).toBe(0);
});

test('listArtifactResources groups artifacts by sessions with resources including agent home sessions', () => {
  insertSession('main-session', 'main', 3000);
  insertSession('empty-agent-session', 'agent-1', 2500);
  insertSession('agent-session', 'agent-1', 2000);
  insertSession('agent-home-session', 'main', 1000);
  db.prepare('UPDATE cowork_sessions SET title = ?, cwd = ? WHERE id = ?')
    .run('Main Session', '/repo/main', 'main-session');
  db.prepare('UPDATE cowork_sessions SET title = ?, cwd = ? WHERE id = ?')
    .run('Empty Agent Session', '/repo/empty-agent', 'empty-agent-session');
  db.prepare('UPDATE cowork_sessions SET title = ?, cwd = ? WHERE id = ?')
    .run('Agent Session', '/repo/agent', 'agent-session');
  db.prepare('UPDATE cowork_sessions SET title = ?, cwd = ? WHERE id = ?')
    .run('Popiai', '/repo/home', 'agent-home-session');
  db.prepare(
    `INSERT INTO cowork_session_sources (session_id, kind, priority, label, task_id, platform, conversation_id, created_at, updated_at)
     VALUES (?, ?, 0, NULL, NULL, NULL, NULL, ?, ?)`,
  ).run('agent-home-session', CoworkSessionSourceKind.AgentHome, Date.now(), Date.now());

  store.addMessage('main-session', { type: 'assistant', content: 'created /repo/main/report.pdf' });
  store.addMessage('agent-session', { type: 'assistant', content: 'created /repo/agent/output.html' });
  store.addMessage('agent-home-session', { type: 'assistant', content: 'created /repo/home/home.html' });

  const sessions = store.listArtifactResources();

  expect(sessions.map((session) => [session.id, session.agentId, session.title])).toEqual([
    ['agent-session', 'agent-1', 'Agent Session'],
    ['agent-home-session', 'main', 'Popiai'],
    ['main-session', 'main', 'Main Session'],
  ]);
  expect(sessions.find((session) => session.id === 'empty-agent-session')).toBeUndefined();
  expect(sessions.find((session) => session.id === 'agent-home-session')?.artifacts[0]).toMatchObject({
    sessionId: 'agent-home-session',
    fileName: 'home.html',
    filePath: '/repo/home/home.html',
  });
  expect(sessions.find((session) => session.id === 'agent-session')?.artifacts[0]).toMatchObject({
    sessionId: 'agent-session',
    fileName: 'output.html',
    filePath: '/repo/agent/output.html',
  });
  expect(sessions.find((session) => session.id === 'main-session')?.artifacts[0]).toMatchObject({
    sessionId: 'main-session',
    fileName: 'report.pdf',
    filePath: '/repo/main/report.pdf',
  });
});

test('deleteMessage falls back to the previous latest preview', () => {
  const sid = 'sess-preview-delete';
  insertSession(sid);
  store.addMessage(sid, { type: 'user', content: 'first' }, 1000);
  const second = store.addMessage(sid, { type: 'assistant', content: 'second' }, 2000);

  expect(store.listSessions(10, 0)[0]?.lastMessagePreview).toBe('second');

  store.deleteMessage(sid, second.id);

  expect(store.listSessions(10, 0)[0]?.lastMessagePreview).toBe('first');
});

test('replaceConversationMessages stores the latest authoritative message preview', () => {
  const sid = 'sess-preview-replace';
  insertSession(sid);
  store.addMessage(sid, { type: 'assistant', content: 'old' }, 1000);

  store.replaceConversationMessages(sid, [
    { role: 'user', text: 'question', timestamp: 2000 },
    { role: 'assistant', text: 'answer', timestamp: 3000 },
  ]);

  expect(store.listSessions(10, 0)[0]?.lastMessagePreview).toBe('answer');
});

test('getSession returns all messages when one has corrupt metadata', () => {
  const sid = 'sess-1';
  insertSession(sid);

  insertMessage('msg-valid', sid, 'user', 'hello', '{"key":"value"}', 1);
  insertMessage('msg-corrupt', sid, 'tool_use', 'do something', '{broken', 2);
  insertMessage('msg-null', sid, 'assistant', 'reply', null, 3);

  const session = store.getSession(sid);
  expect(session).not.toBeNull();
  expect(session!.messages).toHaveLength(3);

  // Valid metadata preserved
  const validMsg = session!.messages.find((m) => m.id === 'msg-valid')!;
  expect(validMsg.metadata).toEqual({ key: 'value' });

  // Corrupt metadata discarded
  const corruptMsg = session!.messages.find((m) => m.id === 'msg-corrupt')!;
  expect(corruptMsg.metadata).toBeUndefined();
  expect(corruptMsg.content).toBe('do something');
  expect(corruptMsg.type).toBe('tool_use');

  // Null metadata → undefined
  const nullMsg = session!.messages.find((m) => m.id === 'msg-null')!;
  expect(nullMsg.metadata).toBeUndefined();
});

test('replaceConversationMessages preserves existing timestamps and uses gateway timestamps', () => {
  const sid = 'sess-replace-timestamps';
  insertSession(sid, 'main', 1000);

  insertMessage('msg-user', sid, 'user', 'old user', '{}', 1, 1000);
  insertMessage('msg-assistant', sid, 'assistant', 'old assistant', '{}', 2, 2000);

  store.replaceConversationMessages(sid, [
    { role: 'user', text: 'old user' },
    { role: 'assistant', text: 'old assistant' },
    { role: 'user', text: 'new user', timestamp: 3000 },
  ]);

  const session = store.getSession(sid);
  expect(session?.messages.map((message) => ({
    type: message.type,
    content: message.content,
    timestamp: message.timestamp,
  }))).toEqual([
    { type: 'user', content: 'old user', timestamp: 1000 },
    { type: 'assistant', content: 'old assistant', timestamp: 2000 },
    { type: 'user', content: 'new user', timestamp: 3000 },
  ]);
  expect(session?.updatedAt).toBe(3000);
});

test('replaceConversationMessages never moves the session updated time backwards', () => {
  const sid = 'sess-replace-backwards';
  insertSession(sid, 'main', 5000);

  store.replaceConversationMessages(sid, [
    { role: 'user', text: 'old prompt', timestamp: 3000 },
    { role: 'assistant', text: 'old reply', timestamp: 3500 },
  ]);

  expect(store.getSession(sid)?.updatedAt).toBe(5000);
});

test('replaceConversationMessages ignores assistant-only entries for the updated time', () => {
  const sid = 'sess-replace-assistant-only';
  insertSession(sid, 'main', 2000);

  store.replaceConversationMessages(sid, [
    { role: 'assistant', text: 'streamed reply', timestamp: 9000 },
  ]);

  expect(store.getSession(sid)?.updatedAt).toBe(2000);
});

test('getSession returns all messages when ALL have corrupt metadata', () => {
  const sid = 'sess-2';
  insertSession(sid);

  insertMessage('m1', sid, 'user', 'one', '{bad1', 1);
  insertMessage('m2', sid, 'assistant', 'two', '{{bad2', 2);
  insertMessage('m3', sid, 'tool_use', 'three', 'not json at all', 3);

  const session = store.getSession(sid);
  expect(session).not.toBeNull();
  expect(session!.messages).toHaveLength(3);

  for (const msg of session!.messages) {
    expect(msg.metadata).toBeUndefined();
    expect(msg.id).toBeTruthy();
    expect(msg.content).toBeTruthy();
  }
});

test('console.warn is called exactly once for single corrupt metadata row', () => {
  const sid = 'sess-3';
  insertSession(sid);

  insertMessage('msg-ok', sid, 'user', 'hi', '{"a":1}', 1);
  insertMessage('msg-bad', sid, 'tool_use', 'oops', '{broken', 2);
  insertMessage('msg-nil', sid, 'assistant', 'reply', null, 3);

  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  store.getSession(sid);

  expect(warnSpy).toHaveBeenCalledTimes(1);

  const warnMessage = warnSpy.mock.calls[0][0] as string;
  expect(warnMessage).toContain('[CoworkStore]');
  expect(warnMessage).toContain('msg-bad');
  expect(warnMessage).toContain(sid);

  warnSpy.mockRestore();
});

test('no console.warn when all metadata is valid or null', () => {
  const sid = 'sess-4';
  insertSession(sid);

  insertMessage('m1', sid, 'user', 'hi', '{"ok":true}', 1);
  insertMessage('m2', sid, 'assistant', 'reply', null, 2);

  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  store.getSession(sid);

  expect(warnSpy).not.toHaveBeenCalled();

  warnSpy.mockRestore();
});

test('updateMessage refreshes the session updated time', () => {
  const sid = 'sess-update-time';
  insertSession(sid);
  insertMessage('msg-edit', sid, 'assistant', 'draft', null, 1);
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(1000, sid);
  db.prepare('UPDATE cowork_messages SET created_at = ? WHERE id = ?').run(1000, 'msg-edit');

  const beforeUpdate = Date.now();

  store.updateMessage(sid, 'msg-edit', { content: 'final' });

  const session = store.getSession(sid);
  expect(session?.updatedAt).toBeGreaterThanOrEqual(beforeUpdate);
  expect(session?.messages[0]?.content).toBe('final');
});

test('updateSession refreshes the session updated time by default', () => {
  const sid = 'sess-update-session-time';
  insertSession(sid);
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(1000, sid);

  const beforeUpdate = Date.now();

  store.updateSession(sid, { status: 'completed' });

  const session = store.getSession(sid);
  expect(session?.status).toBe('completed');
  expect(session?.updatedAt).toBeGreaterThanOrEqual(beforeUpdate);
});

test('updateSession can patch model override without refreshing the session updated time', () => {
  const sid = 'sess-model-only';
  insertSession(sid);
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(1000, sid);

  store.updateSession(
    sid,
    { modelOverride: 'popiai-server/qwen3.6-plus-YoudaoInner' },
    { touchUpdatedAt: false },
  );

  const session = store.getSession(sid);
  expect(session?.modelOverride).toBe('popiai-server/qwen3.6-plus-YoudaoInner');
  expect(session?.updatedAt).toBe(1000);
});

test('updateSession can rename without refreshing the session updated time', () => {
  const sid = 'sess-title-only';
  insertSession(sid);
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(1000, sid);

  store.updateSession(sid, { title: 'Renamed task' }, { touchUpdatedAt: false });

  const session = store.getSession(sid);
  expect(session?.title).toBe('Renamed task');
  expect(session?.updatedAt).toBe(1000);
});

test('deleteSession removes messages without relying on foreign key cascade', () => {
  const sid = 'sess-delete-hard';
  insertSession(sid);
  insertMessage('msg-delete-hard', sid, 'user', 'remove me', '{}', 1);

  store.deleteSession(sid);

  expect(store.getSession(sid)).toBeNull();
  const messageCount = db
    .prepare('SELECT COUNT(*) AS count FROM cowork_messages WHERE session_id = ?')
    .get(sid) as { count: number };
  expect(messageCount.count).toBe(0);
});

test('agent CRUD stores working directory independently', () => {
  const agent = store.createAgent({
    name: 'Docs Agent',
    model: 'openai/gpt-4o',
    workingDirectory: '/tmp/docs-project',
  });

  expect(agent.workingDirectory).toBe('/tmp/docs-project');

  const updated = store.updateAgent(agent.id, {
    workingDirectory: '/tmp/docs-next',
  });

  expect(updated?.workingDirectory).toBe('/tmp/docs-next');
  expect(store.getAgent(agent.id)?.workingDirectory).toBe('/tmp/docs-next');
});

test('createAgent creates default working directory from stable agent id', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'popiai-agent-project-'));
  store.setConfig({ workingDirectory: projectRoot });

  const agent = store.createAgent({ name: '中文 Agent' });
  const expectedWorkingDirectory = path.join(projectRoot, 'agents', agent.id);

  expect(agent.workingDirectory).toBe(expectedWorkingDirectory);
  expect(fs.existsSync(expectedWorkingDirectory)).toBe(true);
  expect(fs.existsSync(path.join(projectRoot, '中文 Agent'))).toBe(false);
});

test('createAgent does not create an agent home session', () => {
  const agent = store.createAgent({ name: 'Docs Agent' });

  expect(store.listSessions(20, 0, agent.id)).toEqual([]);
});

test('agent home session uses stable default directory for custom agent', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'popiai-agent-project-'));
  store.setConfig({ workingDirectory: projectRoot });

  const agent = store.createAgent({ name: 'Docs Agent' });
  const homeSession = store.ensureAgentHomeSession(agent.id);
  const session = store.getSession(homeSession.id);

  expect(session?.cwd).toBe(path.join(projectRoot, 'agents', agent.id));
});

test('createAgent creates main agent working directory under cowork config main directory', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'popiai-main-agent-project-'));
  store.setConfig({ workingDirectory: projectRoot });

  const agent = store.createAgent({ id: 'main', name: 'Popiai' });
  const expectedWorkingDirectory = path.join(projectRoot, 'main');

  expect(agent.workingDirectory).toBe(expectedWorkingDirectory);
  expect(fs.existsSync(expectedWorkingDirectory)).toBe(true);
});

test('deleteAgent removes its task history before an agent with the same name is recreated', () => {
  const agent = store.createAgent({ name: 'Docs Agent' });
  const session = store.createSession('Old Docs Task', '/tmp/docs-project', '', 'local', [], agent.id);
  insertMessage('msg-agent-delete', session.id, 'assistant', 'old result', '{}', 1);

  expect(store.listSessionIdsByAgent(agent.id)).toEqual([session.id]);
  expect(store.deleteAgent(agent.id)).toBe(true);

  expect(store.getAgent(agent.id)).toBeNull();
  expect(store.listSessions(20, 0, agent.id)).toEqual([]);
  const messageCount = db
    .prepare('SELECT COUNT(*) AS count FROM cowork_messages WHERE session_id = ?')
    .get(session.id) as { count: number };
  expect(messageCount.count).toBe(0);

  const recreated = store.createAgent({ name: 'Docs Agent' });
  expect(recreated.id).toBe(agent.id);
  expect(store.listSessions(20, 0, recreated.id)).toEqual([]);
});

test('createAgent clears orphaned task history left by legacy agent deletion', () => {
  const agent = store.createAgent({ name: 'Legacy Deleted Agent' });
  const session = store.createSession('Legacy Orphan Task', '/tmp/docs-project', '', 'local', [], agent.id);
  insertMessage('msg-legacy-orphan', session.id, 'assistant', 'legacy result', '{}', 1);
  db.prepare('DELETE FROM agents WHERE id = ?').run(agent.id);

  const recreated = store.createAgent({ name: 'Legacy Deleted Agent' });

  expect(recreated.id).toBe(agent.id);
  expect(store.listSessions(20, 0, recreated.id)).toEqual([]);
  const messageCount = db
    .prepare('SELECT COUNT(*) AS count FROM cowork_messages WHERE session_id = ?')
    .get(session.id) as { count: number };
  expect(messageCount.count).toBe(0);
});

test('agent CRUD normalizes legacy icons to the default svg avatar', () => {
  const designedIcon = encodeAgentAvatarIcon({
    svg: AgentAvatarSvg.Artboard,
  });

  const missingIconAgent = store.createAgent({ name: 'Missing Icon Agent' });
  const legacyIconAgent = store.createAgent({ name: 'Legacy Icon Agent', icon: 'legacy-icon' });
  const legacyDesignedIconAgent = store.createAgent({
    name: 'Legacy Designed Icon Agent',
    icon: 'agent-avatar:blue:code',
  });
  const designedIconAgent = store.createAgent({ name: 'Designed Icon Agent', icon: designedIcon });

  expect(missingIconAgent.icon).toBe(DefaultAgentAvatarIcon);
  expect(legacyIconAgent.icon).toBe(DefaultAgentAvatarIcon);
  expect(legacyDesignedIconAgent.icon).toBe(DefaultAgentAvatarIcon);
  expect(designedIconAgent.icon).toBe(designedIcon);

  const updated = store.updateAgent(designedIconAgent.id, { icon: 'legacy-icon' });
  expect(updated?.icon).toBe(DefaultAgentAvatarIcon);
});

test('agent pinning stores first-pinned-first order', () => {
  const first = store.createAgent({ name: 'First Agent' });
  const second = store.createAgent({ name: 'Second Agent' });

  const pinnedFirst = store.updateAgent(first.id, { pinned: true });
  const pinnedSecond = store.updateAgent(second.id, { pinned: true });

  expect(pinnedFirst?.pinned).toBe(true);
  expect(pinnedSecond?.pinned).toBe(true);
  expect(pinnedFirst?.pinOrder).toBe(1);
  expect(pinnedSecond?.pinOrder).toBe(2);
});

test('agent unpinning clears pin order', () => {
  const agent = store.createAgent({ name: 'Pinned Agent' });
  store.updateAgent(agent.id, { pinned: true });

  const unpinned = store.updateAgent(agent.id, { pinned: false });

  expect(unpinned?.pinned).toBe(false);
  expect(unpinned?.pinOrder).toBeNull();
});

test('getConfig defaults skipMissedJobs to true when config is missing', () => {
  const config = store.getConfig();

  expect(config.skipMissedJobs).toBe(true);
});

test('backfillEmptyAgentModels assigns the current default model to empty agents only', () => {
  const now = Date.now();
  db.prepare(
    `INSERT INTO agents (id, name, model, icon, skill_ids, enabled, is_default, source, preset_id, description, system_prompt, identity, created_at, updated_at)
     VALUES
     ('main', 'main', '', '', '[]', 1, 1, 'custom', '', '', '', '', ?, ?),
     ('writer', 'Writer', '', '', '[]', 1, 0, 'custom', '', '', '', '', ?, ?),
     ('stockexpert', 'Stock Expert', 'qwen3.5-plus', '', '[]', 1, 0, 'preset', 'stockexpert', '', '', '', ?, ?)`,
  ).run(now, now, now, now, now, now);

  expect(store.backfillEmptyAgentModels('deepseek-v3.2')).toBe(2);

  const rows = (db.prepare(`SELECT id, model FROM agents ORDER BY id`).all() as Array<{ id: string; model: string }>).map((r) => [r.id, r.model]);
  expect(rows).toEqual([
    ['main', 'deepseek-v3.2'],
    ['stockexpert', 'qwen3.5-plus'],
    ['writer', 'deepseek-v3.2'],
  ]);
});
