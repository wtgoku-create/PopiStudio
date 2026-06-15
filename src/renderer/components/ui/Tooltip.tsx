import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import React from 'react';

import { cn } from '@/lib/utils';

export const TooltipPosition = {
  Top: 'top',
  Bottom: 'bottom',
} as const;
export type TooltipPosition = typeof TooltipPosition[keyof typeof TooltipPosition];

export const TooltipAlign = {
  Start: 'start',
  Center: 'center',
  End: 'end',
} as const;
export type TooltipAlign = typeof TooltipAlign[keyof typeof TooltipAlign];

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  position?: TooltipPosition;
  align?: TooltipAlign;
  delay?: number;
  minWidth?: string;
  maxWidth?: string;
  disabled?: boolean;
  multiline?: boolean;
}

const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  className,
  position = TooltipPosition.Bottom,
  align = TooltipAlign.Center,
  delay = 400,
  minWidth = '16rem',
  maxWidth = '18rem',
  disabled = false,
  multiline = false,
}) => {
  if (disabled || !content) {
    return <span className={className}>{children}</span>;
  }

  return (
    <TooltipPrimitive.Provider delayDuration={delay} skipDelayDuration={120}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <span className={cn('inline-flex', className)}>
            {children}
          </span>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={position}
            align={align}
            sideOffset={8}
            role="tooltip"
            style={{
              minWidth: `min(${minWidth}, calc(100vw - 2rem))`,
              maxWidth: `min(${maxWidth}, calc(100vw - 2rem))`,
            }}
            className={cn(
              'z-[100] overflow-hidden rounded-md border border-border bg-surface-overlay px-2 py-1 text-[11px] leading-4 text-foreground shadow-popover backdrop-blur-sm',
              'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
              multiline ? 'whitespace-pre-wrap break-words' : 'whitespace-nowrap',
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
};

export {
  TooltipPrimitive,
};

export default Tooltip;
