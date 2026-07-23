/**
 * Models that carry a `deletedAt` column and are soft-deleted instead of hard-deleted
 * (see extensions/soft-delete.extension.ts). Shared with the audit-log extension so it
 * can skip its `delete` hook for these models - their deletion always resolves to an
 * `update` under the hood, which is where it gets logged instead. Without this, both
 * hooks fire for the same logical delete and produce two audit rows for one action.
 */
export const SOFT_DELETE_MODELS = new Set(['User', 'Role']);
