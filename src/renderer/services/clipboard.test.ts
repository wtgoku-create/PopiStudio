import { afterEach, describe, expect, test, vi } from 'vitest';

import { writeBlobToClipboard, writeTextToClipboard } from './clipboard';

describe('clipboard service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('prefers Electron text clipboard bridge over navigator clipboard', async () => {
    const electronWriteText = vi.fn().mockResolvedValue({ success: true });
    const navigatorWriteText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', {
      electron: {
        clipboard: {
          writeText: electronWriteText,
        },
      },
    });
    vi.stubGlobal('navigator', { clipboard: { writeText: navigatorWriteText } });

    await expect(writeTextToClipboard('hello')).resolves.toEqual({ ok: true });
    expect(electronWriteText).toHaveBeenCalledWith('hello');
    expect(navigatorWriteText).not.toHaveBeenCalled();
  });

  test('falls back to navigator text clipboard when Electron bridge fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const electronWriteText = vi.fn().mockResolvedValue({ success: false, error: 'bridge failed' });
    const navigatorWriteText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', {
      electron: {
        clipboard: {
          writeText: electronWriteText,
        },
      },
    });
    vi.stubGlobal('navigator', { clipboard: { writeText: navigatorWriteText } });

    await expect(writeTextToClipboard('hello')).resolves.toEqual({ ok: true });
    expect(electronWriteText).toHaveBeenCalledWith('hello');
    expect(navigatorWriteText).toHaveBeenCalledWith('hello');
    expect(warn).toHaveBeenCalled();
  });

  test('reports successful text writes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(writeTextToClipboard('hello')).resolves.toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  test('returns text write failures instead of throwing', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      },
    });

    await expect(writeTextToClipboard('hello')).resolves.toEqual({ ok: false, error: 'denied' });
  });

  test('reports successful blob writes', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const clipboardItem = vi.fn(function ClipboardItemMock(this: { items: Record<string, Blob> }, items: Record<string, Blob>) {
      this.items = items;
    });
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal('ClipboardItem', clipboardItem);

    const blob = new Blob(['data'], { type: 'image/png' });
    await expect(writeBlobToClipboard(blob)).resolves.toEqual({ ok: true });
    expect(clipboardItem).toHaveBeenCalledWith({ 'image/png': blob });
    expect(write).toHaveBeenCalledTimes(1);
  });
});
