export type ClipboardWriteResult = {
  ok: boolean;
  error?: string;
};

const toErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

export async function writeTextToClipboard(text: string): Promise<ClipboardWriteResult> {
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
