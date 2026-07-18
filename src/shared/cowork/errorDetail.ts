export interface CoworkErrorDetail {
  rawErrorMessage?: string;
  provider?: string;
  model?: string;
  httpCode?: string;
  providerErrorType?: string;
  providerErrorMessagePreview?: string;
  rawErrorPreview?: string;
  failoverReason?: string;
  providerRuntimeFailureKind?: string;
}

const COWORK_ERROR_DETAIL_DISPLAY_ORDER: Array<keyof CoworkErrorDetail> = [
  'provider',
  'model',
  'httpCode',
  'providerErrorType',
  'failoverReason',
  'providerRuntimeFailureKind',
  'providerErrorMessagePreview',
  'rawErrorMessage',
  'rawErrorPreview',
];

const normalizeField = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export type CoworkErrorDetailSourceMetadata = Partial<
  Record<keyof CoworkErrorDetail, string | undefined>
>;

export function buildCoworkErrorDetail(input: {
  rawErrorMessage?: string;
  displayMessage?: string;
  metadata?: CoworkErrorDetailSourceMetadata;
}): CoworkErrorDetail | undefined {
  const detail: CoworkErrorDetail = {};

  for (const key of COWORK_ERROR_DETAIL_DISPLAY_ORDER) {
    const value = normalizeField(input.metadata?.[key]);
    if (value) detail[key] = value;
  }

  const rawErrorMessage = normalizeField(input.rawErrorMessage);
  const displayMessage = normalizeField(input.displayMessage);
  if (rawErrorMessage && rawErrorMessage !== displayMessage) {
    detail.rawErrorMessage = rawErrorMessage;
  }

  return Object.keys(detail).length > 0 ? detail : undefined;
}

export function formatCoworkErrorDetailText(detail: CoworkErrorDetail): string {
  const lines: string[] = [];
  for (const key of COWORK_ERROR_DETAIL_DISPLAY_ORDER) {
    const value = normalizeField(detail[key]);
    if (value) lines.push(`${key}: ${value}`);
  }
  return lines.join('\n');
}

export function parseCoworkErrorDetail(value: unknown): CoworkErrorDetail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const detail: CoworkErrorDetail = {};
  for (const key of COWORK_ERROR_DETAIL_DISPLAY_ORDER) {
    const raw = record[key];
    if (typeof raw !== 'string') continue;
    const normalized = normalizeField(raw);
    if (normalized) detail[key] = normalized;
  }
  return Object.keys(detail).length > 0 ? detail : null;
}
