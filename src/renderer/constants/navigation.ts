export const MainView = {
  Cowork: 'cowork',
  Skills: 'skills',
  ScheduledTasks: 'scheduledTasks',
  Mcp: 'mcp',
  Folder: 'folder',
  Contacts: 'contacts',
} as const;

export type MainView = typeof MainView[keyof typeof MainView];
