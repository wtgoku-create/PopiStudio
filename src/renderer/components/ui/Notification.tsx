import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useState } from 'react';

export type NotificationTone = 'info' | 'success' | 'warning' | 'danger';
export type NotificationPlacement = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

export interface NotificationAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

export interface NotificationProps {
  title: string;
  message?: string;
  tone?: NotificationTone;
  icon?: React.ReactNode;
  progressPercent?: number | null;
  actions?: NotificationAction[];
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
}

export interface NotificationOptions extends Omit<NotificationProps, 'onClose'> {
  id?: string;
  durationMs?: number;
}

interface NotificationRecord extends NotificationOptions {
  id: string;
}

type NotificationListener = (items: NotificationRecord[]) => void;

const notificationListeners = new Set<NotificationListener>();
let notificationItems: NotificationRecord[] = [];

const emitNotifications = (): void => {
  notificationListeners.forEach((listener) => listener(notificationItems));
};

export const dismissNotification = (id: string): void => {
  notificationItems = notificationItems.filter((item) => item.id !== id);
  emitNotifications();
};

export const notify = (options: NotificationOptions): string => {
  const id = options.id ?? `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const nextItem: NotificationRecord = { ...options, id };
  notificationItems = [
    nextItem,
    ...notificationItems.filter((item) => item.id !== id),
  ];
  emitNotifications();

  if (options.durationMs && options.durationMs > 0) {
    window.setTimeout(() => dismissNotification(id), options.durationMs);
  }

  return id;
};

const subscribeNotifications = (listener: NotificationListener): (() => void) => {
  notificationListeners.add(listener);
  listener(notificationItems);
  return () => {
    notificationListeners.delete(listener);
  };
};

const toneClassNames: Record<NotificationTone, {
  icon: string;
  progress: string;
  primary: string;
}> = {
  info: {
    icon: 'bg-primary-muted text-primary',
    progress: 'bg-primary',
    primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
  },
  success: {
    icon: 'bg-primary-muted text-success',
    progress: 'bg-success',
    primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
  },
  warning: {
    icon: 'bg-primary-muted text-warning',
    progress: 'bg-warning',
    primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
  },
  danger: {
    icon: 'bg-destructive/10 text-destructive',
    progress: 'bg-destructive',
    primary: 'bg-destructive text-destructive-foreground hover:opacity-90',
  },
};

const placementClassNames: Record<NotificationPlacement, string> = {
  'top-right': 'right-4 top-4',
  'top-left': 'left-4 top-4',
  'bottom-right': 'bottom-4 right-4',
  'bottom-left': 'bottom-4 left-4',
};

export const Notification: React.FC<NotificationProps> = ({
  title,
  message,
  tone = 'info',
  icon,
  progressPercent,
  actions = [],
  onClose,
  closeLabel = 'Close',
  className,
}) => {
  const toneClasses = toneClassNames[tone];
  const normalizedProgress = typeof progressPercent === 'number'
    ? Math.max(0, Math.min(100, progressPercent))
    : null;

  return (
    <div className={[
      'rounded-lg border border-border-subtle bg-surface/95 p-3.5 text-foreground shadow-xl backdrop-blur-md',
      className,
    ].filter(Boolean).join(' ')}>
      <div className="flex items-start gap-3">
        {icon && (
          <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneClasses.icon}`}>
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold leading-5">
              {title}
            </h3>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                aria-label={closeLabel}
                title={closeLabel}
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            )}
          </div>
          {message && (
            <p className="mt-1 text-xs leading-5 text-secondary">
              {message}
            </p>
          )}
          {normalizedProgress !== null && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border-subtle">
              <div
                className={`h-full rounded-full transition-all duration-300 ${toneClasses.progress}`}
                style={{ width: `${normalizedProgress}%` }}
              />
            </div>
          )}
          {actions.length > 0 && (
            <div className="mt-3 flex items-center justify-end gap-2">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className={[
                    'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                    action.variant === 'primary'
                      ? toneClasses.primary
                      : 'text-secondary hover:bg-surface-raised hover:text-foreground',
                  ].join(' ')}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface NotificationViewportProps {
  children?: React.ReactNode;
  placement?: NotificationPlacement;
}

export const NotificationViewport: React.FC<NotificationViewportProps> = ({
  children,
  placement = 'bottom-right',
}) => {
  const [items, setItems] = useState<NotificationRecord[]>(notificationItems);

  useEffect(() => subscribeNotifications(setItems), []);

  if (!children && items.length === 0) return null;

  return (
    <div className={`non-draggable fixed z-[9000] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2 ${placementClassNames[placement]}`}>
      {children}
      {items.map((item) => (
        <Notification
          key={item.id}
          title={item.title}
          message={item.message}
          tone={item.tone}
          icon={item.icon}
          progressPercent={item.progressPercent}
          actions={item.actions}
          closeLabel={item.closeLabel}
          className={item.className}
          onClose={() => dismissNotification(item.id)}
        />
      ))}
    </div>
  );
};

export default Notification;
