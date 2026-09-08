import { describe, expect, test, vi } from 'vitest';

import { ArtifactTypeValue } from '../types/artifact';
import type { CoworkMessage } from '../types/cowork';
import { collectSessionArtifacts, loadDetectedFileArtifact } from './artifactDetection';

const message = (
  id: string,
  type: CoworkMessage['type'],
  content: string,
  metadata?: CoworkMessage['metadata'],
): CoworkMessage => ({
  id,
  type,
  content,
  timestamp: 1,
  metadata,
});

describe('collectSessionArtifacts', () => {
  test('filters bare file paths outside the session cwd', () => {
    const artifacts = collectSessionArtifacts([
      message('m1', 'assistant', [
        '/Users/a111/project/PopiStudio/SKILLs/a/SKILL.md',
        '/Users/a111/project/LobsterAI/SKILLs/b/SKILL.md',
      ].join('\n')),
    ], 's1', '/Users/a111/project/PopiStudio');

    expect(artifacts.map(item => item.filePath)).toEqual([
      '/Users/a111/project/PopiStudio/SKILLs/a/SKILL.md',
    ]);
  });

  test('ignores hidden and dependency directories', () => {
    const artifacts = collectSessionArtifacts([
      message('m1', 'assistant', [
        '/repo/.cowork-temp/SKILL.md',
        '/repo/node_modules/pkg/SKILL.md',
        '/repo/output/SKILL.md',
      ].join('\n')),
    ], 's1', '/repo');

    expect(artifacts.map(item => item.filePath)).toEqual(['/repo/output/SKILL.md']);
  });

  test('does not parse bare paths from generic tool results', () => {
    const artifacts = collectSessionArtifacts([
      message('tool-1', 'tool_use', '', {
        toolUseId: 'call-1',
        toolName: 'bash',
      }),
      message('result-1', 'tool_result', '/repo/SKILL.md\n/repo/other/SKILL.md', {
        toolUseId: 'call-1',
      }),
    ], 's1', '/repo');

    expect(artifacts).toHaveLength(0);
  });

  test('links a service started from a child directory to browser navigation', () => {
    const artifacts = collectSessionArtifacts([
      message('user-1', 'user', '启动服务'),
      message('tool-1', 'tool_use', '', {
        toolUseId: 'call-1',
        toolName: 'exec_command',
        toolInput: {
          cwd: '/repo',
          cmd: 'cd ./web && npm run dev -- --port 4173',
        },
      }),
      message('browser-1', 'tool_use', '', {
        toolName: 'browser',
        toolInput: { action: 'navigate', url: 'http://localhost:4173/app' },
      }),
    ], 's1', '/repo');

    const service = artifacts.find(item => item.type === ArtifactTypeValue.LocalService);
    expect(service?.localService?.projectDirectory).toBe('/repo/web');
  });

  test('does not carry service directory evidence across user turns', () => {
    const artifacts = collectSessionArtifacts([
      message('user-1', 'user', '启动旧服务'),
      message('tool-1', 'tool_use', '', {
        toolName: 'bash',
        toolInput: { command: 'cd /repo/old && npm run dev' },
      }),
      message('user-2', 'user', '打开另一个服务'),
      message('browser-2', 'tool_use', '', {
        toolName: 'browser',
        toolInput: { action: 'navigate', url: 'http://localhost:3000' },
      }),
    ], 's1', '/repo');

    const service = artifacts.find(item => item.type === ArtifactTypeValue.LocalService);
    expect(service?.localService?.projectDirectory).toBeUndefined();
  });

  test('uses an explicit pwd result as service directory evidence', () => {
    const artifacts = collectSessionArtifacts([
      message('user-1', 'user', '打开服务'),
      message('tool-1', 'tool_use', '', {
        toolUseId: 'call-1',
        toolName: 'bash',
        toolInput: { command: 'pwd' },
      }),
      message('result-1', 'tool_result', '/repo/web\n', {
        toolUseId: 'call-1',
      }),
      message('browser-1', 'tool_use', '', {
        toolName: 'browser',
        toolInput: { action: 'open', url: 'http://localhost:8080' },
      }),
    ], 's1', '/repo');

    const service = artifacts.find(item => item.type === ArtifactTypeValue.LocalService);
    expect(service?.localService?.projectDirectory).toBe('/repo/web');
  });
});

describe('loadDetectedFileArtifact', () => {
  test('does not read video and audio artifacts into memory', async () => {
    const readFileAsDataUrl = vi.fn();
    vi.stubGlobal('window', {
      electron: {
        dialog: {
          readFileAsDataUrl,
          statFile: vi.fn(),
        },
      },
    });

    const video = await loadDetectedFileArtifact({
      id: 'a1',
      messageId: 'm1',
      sessionId: 's1',
      type: ArtifactTypeValue.Video,
      title: 'demo.mp4',
      content: '',
      fileName: 'demo.mp4',
      filePath: 'demo.mp4',
      createdAt: 1,
    }, '/repo');

    expect(video?.filePath).toBe('/repo/demo.mp4');
    expect(video?.content).toBe('');
    expect(readFileAsDataUrl).not.toHaveBeenCalled();
  });
});
