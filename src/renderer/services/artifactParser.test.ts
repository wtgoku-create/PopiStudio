import { describe, expect, test } from 'vitest';

import type { Artifact } from '../types/artifact';
import { dedupeArtifactsForDisplay, normalizeFilePathForDedup, parseFileLinksFromMessage, parseFilePathsFromText, parseLocalServiceUrlsFromText, parseMediaTokensFromText, parseRemoteImageArtifactsFromText, parseToolArtifact, parseToolResultMediaArtifacts, shouldParseFilePathsFromToolResult } from './artifactParser';

describe('normalizeFilePathForDedup', () => {
  test('strips leading / before Windows drive letter', () => {
    expect(normalizeFilePathForDedup('/D:/path/file.html')).toBe('d:/path/file.html');
  });

  test('normalizes backslashes to forward slashes', () => {
    expect(normalizeFilePathForDedup('D:\\path\\file.html')).toBe('d:/path/file.html');
  });

  test('lowercases for case-insensitive comparison', () => {
    expect(normalizeFilePathForDedup('D:/Path/File.HTML')).toBe('d:/path/file.html');
  });

  test('handles Unix absolute paths unchanged (except lowercase)', () => {
    expect(normalizeFilePathForDedup('/home/user/file.html')).toBe('/home/user/file.html');
  });

  test('dedup matches: file:// derived path vs tool path', () => {
    const fromFileUrl = '/D:/new_ws_test_2/hello-slide.html';
    const fromTool = 'D:\\new_ws_test_2\\hello-slide.html';
    expect(normalizeFilePathForDedup(fromFileUrl)).toBe(normalizeFilePathForDedup(fromTool));
  });
});

describe('parseFileLinksFromMessage', () => {
  test('strips leading / from Windows file:// link path', () => {
    const content = '文件：[hello.pptx](file:///D:/workspace/hello.pptx)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/workspace/hello.pptx');
  });

  test('preserves Unix file:// link path', () => {
    const content = '[report.pdf](file:///home/user/report.pdf)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/home/user/report.pdf');
  });

  test('handles URI-encoded paths', () => {
    const content = '[文件.pptx](file:///D:/my%20folder/%E6%96%87%E4%BB%B6.pptx)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/my folder/文件.pptx');
  });
});

describe('parseFilePathsFromText', () => {
  test('strips leading / after file:/// protocol removal on Windows', () => {
    const content = 'output at file:///D:/project/output.pdf done';
    const artifacts = parseFilePathsFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/project/output.pdf');
  });

  test('detects common video file paths as previewable artifacts', () => {
    const content = 'video saved at D:/project/output.mkv';
    const artifacts = parseFilePathsFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('video');
    expect(artifacts[0].filePath).toBe('D:/project/output.mkv');
  });
});

describe('parseLocalServiceUrlsFromText', () => {
  test('parses localhost service URLs', () => {
    const content = '服务已启动：http://localhost:4173/login-react.html';
    const artifacts = parseLocalServiceUrlsFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('local-service');
    expect(artifacts[0].url).toBe('http://localhost:4173/login-react.html');
    expect(artifacts[0].title).toBe('login-react.html');
  });

  test('uses markdown link text as title', () => {
    const content = '[登录页面](http://localhost:4173/login-react.html)';
    const artifacts = parseLocalServiceUrlsFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe('登录页面');
  });

  test('deduplicates repeated markdown and bare URLs', () => {
    const content = '[http://localhost:4173/](http://localhost:4173/)\nhttp://localhost:4173/';
    const artifacts = parseLocalServiceUrlsFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
  });

  test('ignores remote URLs', () => {
    const artifacts = parseLocalServiceUrlsFromText('https://example.com/app', 'msg1', 'sess1');
    expect(artifacts).toHaveLength(0);
  });

  test('attaches explicit project directory metadata', () => {
    const artifacts = parseLocalServiceUrlsFromText(
      '项目目录：/Users/admin/project/fanren-vote\n服务已启动：http://localhost:4173/',
      'msg1',
      'sess1',
      { projectDirectory: '/Users/admin/project' },
    );
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].localService).toEqual({
      url: 'http://localhost:4173/',
      origin: 'http://localhost:4173',
      projectDirectory: '/Users/admin/project/fanren-vote',
      projectCandidates: [
        expect.objectContaining({
          directory: '/Users/admin/project/fanren-vote',
          source: 'text-labeled-path',
          confidence: 85,
          messageId: 'msg1',
        }),
      ],
    });
  });

  test('resolves relative cd command against current project directory', () => {
    const artifacts = parseLocalServiceUrlsFromText(
      'cd ./web\nhttp://localhost:5173/',
      'msg1',
      'sess1',
      { projectDirectory: '/Users/admin/project/fanren' },
    );
    expect(artifacts[0].localService?.projectDirectory).toBe('/Users/admin/project/fanren/web');
  });

  test('uses local file links as project directory candidates', () => {
    const artifacts = parseLocalServiceUrlsFromText(
      'Preview: http://localhost:4173/\nFiles: [index.html](file:///Users/admin/project/app/index.html)',
      'msg1',
      'sess1',
    );
    expect(artifacts[0].localService?.projectDirectory).toBe('/Users/admin/project/app');
    expect(artifacts[0].localService?.projectCandidates).toEqual([
      expect.objectContaining({
        directory: '/Users/admin/project/app',
        source: 'text-file-link',
      }),
    ]);
  });
});

describe('parseMediaTokensFromText', () => {
  test('parses MEDIA token with Windows path (no space)', () => {
    const content = 'MEDIA:C:\\Users\\test\\images\\output.png';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('C:\\Users\\test\\images\\output.png');
    expect(artifacts[0].type).toBe('image');
  });

  test('parses MEDIA token with space after colon', () => {
    const content = 'MEDIA: /tmp/output.png';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/tmp/output.png');
  });

  test('parses macOS path with spaces (Application Support)', () => {
    const content = 'MEDIA: /Users/test/Library/Application Support/com.popiai/images/output.png';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/Users/test/Library/Application Support/com.popiai/images/output.png');
    expect(artifacts[0].type).toBe('image');
  });

  test('parses backtick-wrapped path with spaces', () => {
    const content = 'MEDIA: `/Users/test/Library/Application Support/output.png`';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/Users/test/Library/Application Support/output.png');
  });

  test('parses file:// prefixed MEDIA path', () => {
    const content = 'MEDIA: file:///D:/workspace/image.jpg';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/workspace/image.jpg');
  });

  test('parses multiple MEDIA tokens on separate lines', () => {
    const content = 'MEDIA: /tmp/img1.png\nMEDIA: /tmp/img2.jpg';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].filePath).toBe('/tmp/img1.png');
    expect(artifacts[1].filePath).toBe('/tmp/img2.jpg');
  });

  test('ignores MEDIA token with unknown extension', () => {
    const content = 'MEDIA: /tmp/data.xyz';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(0);
  });

  test('trims trailing whitespace from path', () => {
    const content = 'MEDIA: /tmp/output.png   ';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/tmp/output.png');
  });
});

describe('parseToolArtifact', () => {
  test('extracts file path from Write tool input', () => {
    const toolUseMsg = {
      id: 'tool1',
      type: 'tool_use' as const,
      content: '',
      timestamp: Date.now(),
      metadata: {
        toolName: 'Write',
        toolUseId: 'tu1',
        toolInput: { file_path: 'D:\\workspace\\hello.html', content: '<html></html>' },
      },
    };
    const toolResultMsg = {
      id: 'result1',
      type: 'tool_result' as const,
      content: 'OK',
      timestamp: Date.now(),
      metadata: { toolUseId: 'tu1' },
    };
    const artifact = parseToolArtifact(toolUseMsg, toolResultMsg, 'sess1');
    expect(artifact).not.toBeNull();
    expect(artifact!.filePath).toBe('D:\\workspace\\hello.html');
  });

  test('dedup: tool path and file link path normalize to same value', () => {
    const toolPath = 'D:\\new_ws_test_2\\hello-slide.pptx';
    const linkContent = '[hello-slide.pptx](file:///D:/new_ws_test_2/hello-slide.pptx)';
    const linkArtifacts = parseFileLinksFromMessage(linkContent, 'msg1', 'sess1');
    expect(linkArtifacts).toHaveLength(1);

    expect(normalizeFilePathForDedup(toolPath))
      .toBe(normalizeFilePathForDedup(linkArtifacts[0].filePath!));
  });
});

describe('parseRemoteImageArtifactsFromText', () => {
  test('parses markdown and bare remote image URLs', () => {
    const content = '![result](https://cdn.example.com/a.png)\nhttps://cdn.example.com/b.webp';
    const artifacts = parseRemoteImageArtifactsFromText(content, 'msg1', 'sess1');

    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].type).toBe('image');
    expect(artifacts[0].content).toBe('https://cdn.example.com/a.png');
    expect(artifacts[0].fileName).toBe('result');
    expect(artifacts[1].content).toBe('https://cdn.example.com/b.webp');
    expect(artifacts[1].fileName).toBe('b.webp');
  });

  test('deduplicates repeated remote image URLs within one message', () => {
    const content = 'https://cdn.example.com/a.png\nhttps://cdn.example.com/a.png';
    const artifacts = parseRemoteImageArtifactsFromText(content, 'msg1', 'sess1');

    expect(artifacts).toHaveLength(1);
  });

  test('uses stable URL-derived names for untitled remote images', () => {
    const first = parseRemoteImageArtifactsFromText('![](https://cdn.example.com/render?id=1)', 'msg1', 'sess1');
    const second = parseRemoteImageArtifactsFromText('![](https://cdn.example.com/render?id=2)', 'msg2', 'sess1');

    expect(first[0].fileName).toMatch(/^remote-image-[a-z0-9]+\.png$/);
    expect(second[0].fileName).toMatch(/^remote-image-[a-z0-9]+\.png$/);
    expect(first[0].fileName).not.toBe(second[0].fileName);
    expect(first[0].fileName).not.toBe('generated-image-1');
  });
});

describe('parseToolResultMediaArtifacts', () => {
  test('parses image and video assets from toolResultDetails', () => {
    const toolResultMsg = {
      id: 'result1',
      type: 'tool_result' as const,
      content: '',
      timestamp: 123,
      metadata: {
        toolResultDetails: {
          assets: [
            { type: 'image', url: 'https://cdn.example.com/image.png', filename: 'image.png' },
            { type: 'video', filePath: '/tmp/movie.mp4' },
          ],
        },
      },
    };

    const artifacts = parseToolResultMediaArtifacts(toolResultMsg, 'sess1');
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].content).toBe('https://cdn.example.com/image.png');
    expect(artifacts[1].filePath).toBe('/tmp/movie.mp4');
  });

  test('uses remote image file name when a downloaded asset has a local cache path', () => {
    const toolResultMsg = {
      id: 'result1',
      type: 'tool_result' as const,
      content: '',
      timestamp: 123,
      metadata: {
        toolResultDetails: {
          assets: [
            {
              type: 'image',
              url: 'https://cdn.example.com/output/165749.png',
              localPath: '/tmp/download-cache/165749.jpeg',
            },
          ],
        },
      },
    };

    const artifacts = parseToolResultMediaArtifacts(toolResultMsg, 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].fileName).toBe('165749.png');
    expect(artifacts[0].filePath).toBe('/tmp/download-cache/165749.jpeg');
    expect(artifacts[0].remoteUrl).toBe('https://cdn.example.com/output/165749.png');
  });

  test('ignores errored tool results', () => {
    const artifacts = parseToolResultMediaArtifacts({
      id: 'result1',
      type: 'tool_result' as const,
      content: '',
      timestamp: 123,
      metadata: {
        isError: true,
        toolResultDetails: {
          assets: [{ type: 'image', url: 'https://cdn.example.com/image.png' }],
        },
      },
    }, 'sess1');

    expect(artifacts).toHaveLength(0);
  });
});

describe('shouldParseFilePathsFromToolResult', () => {
  test('allows image generation tools only', () => {
    expect(shouldParseFilePathsFromToolResult('image_generate')).toBe(true);
    expect(shouldParseFilePathsFromToolResult('lobsterai_image_generate')).toBe(true);
    expect(shouldParseFilePathsFromToolResult('bash')).toBe(false);
    expect(shouldParseFilePathsFromToolResult(undefined)).toBe(false);
  });
});

describe('dedupeArtifactsForDisplay', () => {
  const artifact = (overrides: Partial<Artifact>): Artifact => ({
    id: 'artifact-1',
    messageId: 'msg1',
    sessionId: 'sess1',
    type: 'image',
    title: 'image.png',
    content: '',
    createdAt: 100,
    ...overrides,
  });

  test('deduplicates artifacts with the same normalized file path', () => {
    const artifacts = dedupeArtifactsForDisplay([
      artifact({ id: 'a', filePath: 'D:\\Project\\image.png', createdAt: 100 }),
      artifact({ id: 'b', filePath: 'd:/project/image.png', createdAt: 200 }),
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].id).toBe('b');
  });

  test('prefers local file artifact over remote-only artifact for the same remote url', () => {
    const artifacts = dedupeArtifactsForDisplay([
      artifact({ id: 'remote', content: 'https://cdn.example.com/image.png', remoteUrl: 'https://cdn.example.com/image.png' }),
      artifact({ id: 'local', filePath: '/tmp/image.png', remoteUrl: 'https://cdn.example.com/image.png' }),
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].id).toBe('local');
  });

  test('deduplicates local service artifacts by normalized url', () => {
    const artifacts = dedupeArtifactsForDisplay([
      artifact({
        id: 'svc-a',
        type: 'local-service',
        content: 'http://localhost:3000/',
        url: 'http://localhost:3000/',
      }),
      artifact({
        id: 'svc-b',
        type: 'local-service',
        content: 'http://localhost:3000',
        url: 'http://localhost:3000',
        createdAt: 200,
      }),
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].id).toBe('svc-b');
  });

  test('prefers local service artifact with detected project metadata', () => {
    const artifacts = dedupeArtifactsForDisplay([
      artifact({
        id: 'plain-service',
        type: 'local-service',
        content: 'http://localhost:5173/',
        url: 'http://localhost:5173/',
        createdAt: 300,
      }),
      artifact({
        id: 'project-service',
        type: 'local-service',
        content: 'http://localhost:5173/app',
        url: 'http://localhost:5173/app',
        createdAt: 200,
        localService: {
          url: 'http://localhost:5173/app',
          origin: 'http://localhost:5173',
          projectDirectory: '/Users/admin/project/app',
        },
      }),
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].id).toBe('project-service');
  });

  test('keeps local service artifacts on different ports', () => {
    const artifacts = dedupeArtifactsForDisplay([
      artifact({
        id: 'service-3000',
        type: 'local-service',
        content: 'http://localhost:3000/',
        url: 'http://localhost:3000/',
      }),
      artifact({
        id: 'service-5174',
        type: 'local-service',
        content: 'http://localhost:5174/',
        url: 'http://localhost:5174/',
      }),
    ]);

    expect(artifacts.map(item => item.id)).toEqual(['service-3000', 'service-5174']);
  });
});
