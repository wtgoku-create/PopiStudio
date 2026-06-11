export const FolderIpc = {
  ListChildren: 'folder:listChildren',
} as const;

export type FolderIpc = typeof FolderIpc[keyof typeof FolderIpc];

export interface FolderTreeEntry {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
  childCount?: number;
}

export interface FolderListChildrenResult {
  success: boolean;
  entries?: FolderTreeEntry[];
  error?: string;
}
