import React from 'react';

import { cn } from '../../lib/utils';

type SwitchSize = 'default' | 'sm';

interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  ariaLabel?: string;
  className?: string;
  size?: SwitchSize;
  title?: string;
}

const switchSizeClass: Record<SwitchSize, {
  track: string;
  thumb: string;
  checked: string;
  unchecked: string;
}> = {
  default: {
    track: 'h-[30px] w-[59px]',
    thumb: 'h-5 w-5',
    checked: 'translate-x-[34px]',
    unchecked: 'translate-x-[5px]',
  },
  sm: {
    track: 'h-5 w-9',
    thumb: 'h-4 w-4',
    checked: 'translate-x-[18px]',
    unchecked: 'translate-x-0.5',
  },
};

const Switch: React.FC<SwitchProps> = ({
  checked,
  disabled,
  onClick,
  ariaLabel,
  className,
  size = 'default',
  title,
}) => {
  const sizeClass = switchSizeClass[size];

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out',
        'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2 focus:ring-offset-background',
        checked
          ? 'bg-gradient-to-r from-[#D6CEEF] to-primary'
          : 'bg-[#F0F0F0] dark:bg-surface-raised',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        sizeClass.track,
        className,
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block rounded-full bg-white shadow-[0_2px_6px_rgba(31,31,31,0.18)] transition-transform duration-200 ease-in-out',
          sizeClass.thumb,
          checked ? sizeClass.checked : sizeClass.unchecked,
        )}
      />
    </button>
  );
};

export default Switch;
