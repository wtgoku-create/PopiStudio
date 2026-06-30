import type { CoworkSession } from '../types/cowork';

export function sanitizeExportFileName(name: string): string {
  const sanitized = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || 'session-export';
}

export function sessionToMarkdown(session: CoworkSession): string {
  const lines: string[] = [];
  lines.push(`# ${session.title}`);
  lines.push('');
  lines.push(`- Created: ${new Date(session.createdAt).toLocaleString()}`);
  lines.push(`- Updated: ${new Date(session.updatedAt).toLocaleString()}`);
  lines.push(`- Status: ${session.status}`);
  lines.push('');

  for (const msg of session.messages) {
    if (msg.type === 'user') {
      lines.push('## User');
      lines.push('');
      lines.push(msg.content);
      lines.push('');
    } else if (msg.type === 'assistant') {
      lines.push('## Assistant');
      lines.push('');
      lines.push(msg.content);
      lines.push('');
    } else if (msg.type === 'tool_use' && msg.metadata?.toolName) {
      lines.push(`### Tool: ${msg.metadata.toolName}`);
      lines.push('');
      if (msg.metadata.toolInput) {
        lines.push('```json');
        lines.push(JSON.stringify(msg.metadata.toolInput, null, 2));
        lines.push('```');
        lines.push('');
      }
    } else if (msg.type === 'tool_result') {
      lines.push('#### Tool Result');
      lines.push('');
      lines.push('```');
      lines.push(msg.content.slice(0, 2000) + (msg.content.length > 2000 ? '\n... (truncated)' : ''));
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function sessionToJSON(session: CoworkSession): string {
  return JSON.stringify({
    title: session.title,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    status: session.status,
    messages: session.messages.map(msg => ({
      type: msg.type,
      content: msg.content,
      timestamp: new Date(msg.timestamp).toISOString(),
      ...(msg.metadata?.toolName ? { toolName: msg.metadata.toolName } : {}),
      ...(msg.metadata?.toolInput ? { toolInput: msg.metadata.toolInput } : {}),
    })),
  }, null, 2);
}
