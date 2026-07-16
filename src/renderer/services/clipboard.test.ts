import { afterEach, describe, expect, test, vi } from 'vitest';

import { writeBlobToClipboard, writeTextToClipboard } from './clipboard';

describe('clipboard service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('reports successful text writes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(writeTextToClipboard('hello')).resolves.toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  test('returns text write failures instead of throwing', async () => {
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
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal('ClipboardItem', clipboardItem);

    const blob = new Blob(['data'], { type: 'image/png' });
    await expect(writeBlobToClipboard(blob)).resolves.toEqual({ ok: true });
    expect(clipboardItem).toHaveBeenCalledWith({ 'image/png': blob });
    expect(write).toHaveBeenCalledTimes(1);
  });
});
