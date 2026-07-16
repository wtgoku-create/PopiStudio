import { app, BrowserWindow, nativeImage, Notification } from 'electron';

import { CoworkIpcChannel, SESSION_AGNOSTIC_PERMISSION_SESSION_ID } from '../../shared/cowork/constants';
import {
  classifyWaitingNotificationKind,
  type NotificationSettings,
  TaskCompletionNotificationMode,
  WaitingNotificationKind,
} from '../../shared/notifications/constants';
import { t } from '../i18n';

type WaitingNotificationEntry = {
  notification: Notification;
  requestId: string;
  sessionId: string;
};

type DesktopNotificationManagerOptions = {
  getWindow: () => BrowserWindow | null;
  getNotificationIconPath: () => string;
  getNotificationSettings: () => NotificationSettings;
  getSessionTitle: (sessionId: string) => string | null;
  focusMainWindow: () => void;
};

type PermissionRequestLike = {
  requestId?: string;
  toolName?: string;
};

export class DesktopNotificationManager {
  private completionNotifications = new Map<string, Notification>();
  private waitingNotifications = new Map<string, WaitingNotificationEntry>();
  private activeSessionId: string | null = null;

  constructor(private readonly options: DesktopNotificationManagerOptions) {}

  setActiveSession(sessionId: string | null): void {
    this.activeSessionId = sessionId;
    if (sessionId) {
      this.closeWaitingNotificationsForSession(sessionId);
    }
  }

  markSessionViewed(sessionId: string): void {
    this.closeCompletionNotification(sessionId);
    this.closeWaitingNotificationsForSession(sessionId);
  }

  handleWindowFocused(): void {
    this.completionNotifications.forEach((notification) => notification.close());
    this.completionNotifications.clear();
    if (this.activeSessionId) {
      this.closeWaitingNotificationsForSession(this.activeSessionId);
    }
  }

  handleComplete(sessionId: string): void {
    const settings = this.options.getNotificationSettings();
    if (settings.taskCompletionNotificationMode === TaskCompletionNotificationMode.Off) return;

    const win = this.options.getWindow();
    if (
      settings.taskCompletionNotificationMode === TaskCompletionNotificationMode.Unfocused &&
      win?.isFocused()
    ) {
      return;
    }

    this.closeCompletionNotification(sessionId);
    this.showNotification({
      title: t('taskCompletionNotificationTitle'),
      body: t('taskCompletionNotificationBody', {
        title: this.options.getSessionTitle(sessionId) ?? t('coworkDefaultSessionTitle'),
      }),
      onClick: () => this.openSession(sessionId),
      onCreate: notification => {
        this.completionNotifications.set(sessionId, notification);
      },
      onClose: () => {
        this.completionNotifications.delete(sessionId);
      },
    });
  }

  handlePermissionRequest(sessionId: string, request: PermissionRequestLike): void {
    const requestId = request.requestId;
    if (!requestId) return;

    const kind = classifyWaitingNotificationKind(request.toolName);
    const settings = this.options.getNotificationSettings();
    if (kind === WaitingNotificationKind.Permission && !settings.permissionNotificationsEnabled) return;
    if (kind === WaitingNotificationKind.Question && !settings.questionNotificationsEnabled) return;

    this.handlePermissionResolved(requestId);
    const targetSessionId = sessionId || SESSION_AGNOSTIC_PERMISSION_SESSION_ID;
    const title = kind === WaitingNotificationKind.Question
      ? t('questionNotificationTitle')
      : t('permissionNotificationTitle');
    const sessionTitle = this.options.getSessionTitle(targetSessionId);
    const body = kind === WaitingNotificationKind.Question
      ? t('questionNotificationBody', { title: sessionTitle ?? t('coworkDefaultSessionTitle') })
      : sessionTitle
        ? t('permissionNotificationBody', { title: sessionTitle })
        : t('permissionNotificationBodyGeneric');

    this.showNotification({
      title,
      body,
      onClick: () => this.openSession(targetSessionId),
      onCreate: notification => {
        this.waitingNotifications.set(requestId, {
          notification,
          requestId,
          sessionId: targetSessionId,
        });
      },
      onClose: () => {
        this.waitingNotifications.delete(requestId);
      },
    });
  }

  handlePermissionResolved(requestId: string): void {
    const entry = this.waitingNotifications.get(requestId);
    if (!entry) return;
    entry.notification.close();
    this.waitingNotifications.delete(requestId);
  }

  handleSessionStopped(sessionId: string): void {
    this.closeCompletionNotification(sessionId);
    this.closeWaitingNotificationsForSession(sessionId);
  }

  handleSessionDeleted(sessionId: string): void {
    this.handleSessionStopped(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
  }

  private closeCompletionNotification(sessionId: string): void {
    const notification = this.completionNotifications.get(sessionId);
    if (!notification) return;
    notification.close();
    this.completionNotifications.delete(sessionId);
  }

  private closeWaitingNotificationsForSession(sessionId: string): void {
    for (const [requestId, entry] of this.waitingNotifications.entries()) {
      if (entry.sessionId !== sessionId) continue;
      entry.notification.close();
      this.waitingNotifications.delete(requestId);
    }
  }

  private openSession(sessionId: string): void {
    this.options.focusMainWindow();
    const win = this.options.getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send(CoworkIpcChannel.OpenSessionFromNotification, { sessionId });
  }

  private showNotification(options: {
    title: string;
    body: string;
    onClick: () => void;
    onCreate: (notification: Notification) => void;
    onClose: () => void;
  }): void {
    if (!Notification.isSupported()) return;
    const iconPath = this.options.getNotificationIconPath();
    const notification = new Notification({
      title: options.title,
      body: options.body,
      icon: iconPath ? nativeImage.createFromPath(iconPath) : undefined,
      silent: false,
    });
    notification.on('click', options.onClick);
    notification.on('close', options.onClose);
    options.onCreate(notification);
    notification.show();
    if (process.platform === 'darwin' && app.dock) {
      app.dock.bounce('informational');
    }
  }
}
