import { describe, expect, test } from 'vitest';

import { extractUserMessageFileAttachments } from './userMessageFileAttachments';

describe('extractUserMessageFileAttachments', () => {
  test('extracts files and folders while keeping the prompt text', () => {
    const result = extractUserMessageFileAttachments(
      '请分析这些文件\n\n输入文件: /tmp/report.csv\n输入文件夹: C:\\work\\src',
    );
    expect(result.text).toBe('请分析这些文件');
    expect(result.attachments).toEqual([
      { path: '/tmp/report.csv', name: 'report.csv', isDirectory: false },
      { path: 'C:\\work\\src', name: 'src', isDirectory: true },
    ]);
  });

  test('deduplicates paths case-insensitively and leaves unrelated paths alone', () => {
    const content = '输入文件: /tmp/a.txt\n输入文件: /tmp/A.txt\n路径 /tmp/other.txt';
    const result = extractUserMessageFileAttachments(content);
    expect(result.attachments).toHaveLength(1);
    expect(result.text).toContain('路径 /tmp/other.txt');
  });
});
