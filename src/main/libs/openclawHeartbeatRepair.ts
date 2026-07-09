import fs from 'fs';
import path from 'path';

const HEARTBEAT_FILENAME = 'HEARTBEAT.md';

const LEGACY_HEARTBEAT_PROSE_TEMPLATE = [
  '# HEARTBEAT.md',
  'Keep this file empty unless you want a tiny checklist. Keep it small.',
];

const LEGACY_HEARTBEAT_HEADING_FENCED_TEMPLATE = [
  '# HEARTBEAT.md Template',
  '```markdown',
  '# Keep this file empty (or with only comments) to skip heartbeat API calls.',
  '# Add tasks below when you want the agent to check something periodically.',
  '```',
];

const LEGACY_HEARTBEAT_FENCED_TEMPLATE = [
  '```markdown',
  '# Keep this file empty (or with only comments) to skip heartbeat API calls.',
  '# Add tasks below when you want the agent to check something periodically.',
  '```',
];

const LEGACY_HEARTBEAT_FENCED_RELATED_TEMPLATE = [
  ...LEGACY_HEARTBEAT_FENCED_TEMPLATE,
  '## Related',
  '- [Heartbeat config](/gateway/config-agents)',
];

const DOCS_HEARTBEAT_TEMPLATE_PAGE_AS_TEMPLATE = [
  '# HEARTBEAT.md template',
  '`HEARTBEAT.md` lives in the agent workspace. Keep the file empty, or with only Markdown comments and headings, when you want OpenClaw to skip heartbeat model calls.',
  'The default runtime template is:',
  '```markdown',
  '# Keep this file empty (or with only comments) to skip heartbeat API calls.',
  '# Add tasks below when you want the agent to check something periodically.',
  '```',
  'Add short tasks below the comments only when you want the agent to check something periodically. Keep heartbeat instructions small because they are read during recurring wakes.',
  '## Related',
  '- [Heartbeat config](/gateway/config-agents)',
];

const KNOWN_REPAIRABLE_TEMPLATES = [
  LEGACY_HEARTBEAT_PROSE_TEMPLATE,
  LEGACY_HEARTBEAT_HEADING_FENCED_TEMPLATE,
  LEGACY_HEARTBEAT_FENCED_TEMPLATE,
  LEGACY_HEARTBEAT_FENCED_RELATED_TEMPLATE,
  DOCS_HEARTBEAT_TEMPLATE_PAGE_AS_TEMPLATE,
];

export const HEARTBEAT_EMPTY_TEMPLATE_LINES = [
  '# Keep this file empty (or with only comments) to skip heartbeat API calls.',
  '# Add tasks below when you want the agent to check something periodically.',
] as const;

export const HEARTBEAT_EMPTY_TEMPLATE = `${HEARTBEAT_EMPTY_TEMPLATE_LINES.join('\n')}\n`;

const normalizeLines = (content: string): string[] =>
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const linesEqual = (left: string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((line, index) => line === right[index]);

export const isLegacyHeartbeatTemplate = (content: string): boolean => {
  const lines = normalizeLines(content);
  if (lines.length === 0) {
    return false;
  }
  return KNOWN_REPAIRABLE_TEMPLATES.some((template) => linesEqual(lines, template));
};

export const repairHeartbeatFile = (workspaceDir: string): boolean => {
  if (!fs.existsSync(workspaceDir)) {
    return false;
  }
  const heartbeatPath = path.join(workspaceDir, HEARTBEAT_FILENAME);

  let content: string | null = null;
  try {
    content = fs.readFileSync(heartbeatPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  if (content !== null && !isLegacyHeartbeatTemplate(content)) {
    return false;
  }

  const tmpPath = `${heartbeatPath}.tmp-${Date.now()}`;
  fs.writeFileSync(tmpPath, HEARTBEAT_EMPTY_TEMPLATE, 'utf8');
  fs.renameSync(tmpPath, heartbeatPath);
  return true;
};

const PROACTIVE_HEARTBEAT_SECTION_HEADING = '## 💓 Heartbeats - Be Proactive!';

export const stripProactiveHeartbeatSection = (content: string): string => {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => line.trim() === PROACTIVE_HEARTBEAT_SECTION_HEADING);
  if (start < 0) {
    return content;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  lines.splice(start, end - start);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
};
