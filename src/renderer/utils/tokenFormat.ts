export function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  const isToday = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (isToday) return time;

  const isThisYear = date.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${time}`;
  }

  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${time}`;
}

export function formatMessageDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');

  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const isPowerOfTwo = (value: number): boolean => (
  Number.isInteger(value) && value > 0 && Math.log2(value) % 1 === 0
);

const formatBinaryContextWindowTokenCount = (tokens: number): string | null => {
  if (tokens < 64 * 1024 || tokens % 1024 !== 0) return null;

  const kibitokens = tokens / 1024;
  if (!isPowerOfTwo(kibitokens)) return null;

  if (kibitokens >= 1024 && kibitokens % 1024 === 0) {
    return `${kibitokens / 1024}M`;
  }
  return `${kibitokens}k`;
};

export function formatTokenCount(tokens: number): string {
  const binaryContextWindow = formatBinaryContextWindowTokenCount(tokens);
  if (binaryContextWindow) {
    return binaryContextWindow;
  }

  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(tokens);
}
