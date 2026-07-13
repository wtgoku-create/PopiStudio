// OpenClaw rejects chat.send payloads containing U+0000. Strip NUL at both
// ingestion and final outbound boundaries so old local history cannot poison
// later prompts through context bridges.
export const stripNullChars = (value: string): string => (
  value.includes('\u0000') ? value.replace(/\u0000/g, '') : value
);
