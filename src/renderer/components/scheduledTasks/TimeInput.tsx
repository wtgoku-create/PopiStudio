import { ClockIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, useState } from 'react';

interface TimeInputProps {
  value: string;
  onChange: (value: string) => void;
  includeSeconds?: boolean;
  className?: string;
}

interface LoopingNumberInputProps {
  value: number;
  max: number;
  onChange: (value: number) => void;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function parseTime(value: string): [number, number, number] {
  const [hour = 0, minute = 0, second = 0] = value.split(':').map(Number);
  return [
    Number.isFinite(hour) ? hour : 0,
    Number.isFinite(minute) ? minute : 0,
    Number.isFinite(second) ? second : 0,
  ];
}

export function LoopingNumberInput({ value, max, onChange }: LoopingNumberInputProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const options = Array.from({ length: max + 1 }, (_, index) => index);
  const repeatedOptions = [...options, ...options, ...options];

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open || !columnRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (columnRef.current) columnRef.current.scrollTop = (options.length + value - 2) * 36;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, options.length, value]);

  const cycleHeight = options.length * 36;
  return (
    <div ref={containerRef} className="relative w-20 shrink-0">
      <button
        type="button"
        aria-label={pad(value)}
        onClick={() => setOpen(current => !current)}
        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-left text-sm text-foreground outline-none hover:border-primary/50 focus-visible:border-primary"
      >
        {pad(value)}
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded border border-border bg-surface shadow-lg">
          <div
            ref={columnRef}
            className="scrollbar-hidden max-h-64 w-20 overflow-y-auto p-1"
            onScroll={event => {
              const column = event.currentTarget;
              if (column.scrollTop < cycleHeight / 2) column.scrollTop += cycleHeight;
              if (column.scrollTop > cycleHeight * 1.5) column.scrollTop -= cycleHeight;
            }}
          >
            {repeatedOptions.map((option, index) => (
              <button
                key={index}
                type="button"
                onClick={() => onChange(option)}
                className={`h-9 w-full rounded text-sm ${
                  index >= options.length && index < options.length * 2 && option === value
                    ? 'bg-primary font-semibold text-white'
                    : 'text-foreground hover:bg-surface-raised'
                }`}
              >
                {pad(option)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TimeInput({
  value,
  onChange,
  includeSeconds = false,
  className = '',
}: TimeInputProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [hour, minute, second] = parseTime(value);
  const hours = Array.from({ length: 24 }, (_, index) => index);
  const minutes = Array.from({ length: 60 }, (_, index) => index);
  const columns = [
    [...hours, ...hours, ...hours],
    [...minutes, ...minutes, ...minutes],
    ...(includeSeconds ? [[...minutes, ...minutes, ...minutes]] : []),
  ];

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const selectedValues = [hour, minute, second];
    const frame = requestAnimationFrame(() => {
      columnRefs.current.forEach((column, index) => {
        if (!column) return;
        const selectedIndex = selectedValues[index] ?? 0;
        const cycleOffset = index === 0 ? hours.length : minutes.length;
        column.scrollTop = Math.max(0, (cycleOffset + selectedIndex - 2) * 36);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, hour, minute, second]);

  const updatePart = (part: number, nextValue: number) => {
    const next = [hour, minute, second];
    next[part] = nextValue;
    onChange(includeSeconds
      ? `${pad(next[0])}:${pad(next[1])}:${pad(next[2])}`
      : `${pad(next[0])}:${pad(next[1])}`);
  };

  return (
    <div ref={containerRef} className={`relative min-w-0 flex-1 ${className}`}>
      <button
        type="button"
        aria-label={value}
        onClick={() => setOpen(current => !current)}
        className="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-surface px-3 text-left text-sm text-foreground outline-none transition-colors hover:border-primary/50 focus-visible:border-primary"
      >
        <span>{includeSeconds ? `${pad(hour)}:${pad(minute)}:${pad(second)}` : `${pad(hour)}:${pad(minute)}`}</span>
        <ClockIcon className="h-4 w-4 shrink-0 text-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 flex overflow-hidden rounded border border-border bg-surface shadow-lg">
          {columns.map((options, part) => (
            <div
              key={part}
              ref={column => {
                columnRefs.current[part] = column;
              }}
              onScroll={event => {
                const column = event.currentTarget;
                const cycleHeight = (part === 0 ? hours.length : minutes.length) * 36;
                if (column.scrollTop < cycleHeight / 2) {
                  column.scrollTop += cycleHeight;
                } else if (column.scrollTop > cycleHeight * 1.5) {
                  column.scrollTop -= cycleHeight;
                }
              }}
              className="scrollbar-hidden max-h-64 w-16 overflow-y-auto p-1"
            >
              {options.map((option, optionIndex) => {
                const cycleLength = part === 0 ? hours.length : minutes.length;
                const displayValue = option % cycleLength;
                const selected = optionIndex >= cycleLength
                  && optionIndex < cycleLength * 2
                  && displayValue === [hour, minute, second][part];
                return (
                  <button
                    key={`${part}-${optionIndex}`}
                    type="button"
                    onClick={() => updatePart(part, displayValue)}
                    className={`h-9 w-full rounded text-sm ${
                      selected
                        ? 'bg-primary font-semibold text-white'
                        : 'text-foreground hover:bg-surface-raised'
                    }`}
                  >
                    {pad(displayValue)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
