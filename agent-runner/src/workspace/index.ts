import type { WorkspaceMode } from '../config';
import { inPlaceWorkspace } from './in-place';
import { noneWorkspace } from './none';
import type { WorkspaceStrategy } from './strategy';
import { worktreeWorkspace } from './worktree';

export * from './git';
export type { PreparedWorkspace, Published, WorkspaceContext, WorkspaceStrategy } from './strategy';

/** Registry mode workspace → cách chuẩn bị nơi làm / đẩy sản phẩm. */
export const workspaces: Record<WorkspaceMode, WorkspaceStrategy> = {
  worktree: worktreeWorkspace,
  in_place: inPlaceWorkspace,
  none: noneWorkspace,
};
