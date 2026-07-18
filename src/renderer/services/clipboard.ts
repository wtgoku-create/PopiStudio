export type ClipboardWriteResult = {
  ok: boolean;
  error?: string;
};

const toErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

export async function writeTextToClipboard(text: string): Promise<ClipboardWriteResult> {
  const electronClipboard = window.electron?.clipboard;
  if (electronClipboard?.writeText) {
    try {
      const result = await electronClipboard.writeText(text);
      if (result.success) return { ok: true };
      console.warn('[Clipboard] text clipboard IPC failed:', result.error ?? 'Unknown error');
    } catch (error) {
      console.warn('[Clipboard] text clipboard IPC failed:', error);
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function writeBlobToClipboard(blob: Blob): Promise<ClipboardWriteResult> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}
