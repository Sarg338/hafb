// Undo/redo (ADR 0002 §6). Immutable: every operation returns a new History, so a caller whose
// write to disk fails can keep the old one. No I/O; the caller persists `rows` and `log` together.
import { applyChanges, type ChangeSet } from './changes.ts';
import type { RowChanges } from './codec.ts';
import type { PlanData } from './records.ts';

export interface HistoryEntry {
  label: string;
  forward: ChangeSet;
  inverse: ChangeSet;
}

export interface History {
  readonly undo: readonly HistoryEntry[];
  readonly redo: readonly HistoryEntry[];
  /** Oldest entries are dropped beyond this depth. */
  readonly limit: number;
}

/** One command_log row: what was applied (`forward`) and what reverses it (`inverse`). */
export interface LogEntry {
  direction: 'do' | 'undo' | 'redo';
  label: string;
  forward: ChangeSet;
  inverse: ChangeSet;
}

export interface HistoryStep {
  history: History;
  plan: PlanData;
  rows: RowChanges;
  log: LogEntry;
}

export function emptyHistory(limit = 500): History {
  return { undo: [], redo: [], limit };
}

const changedNothing = (rows: RowChanges): boolean => rows.upserts.length === 0 && rows.deletes.length === 0;

/**
 * Apply a command. Returns null when it changes nothing (no undo entry, nothing to write).
 * Clears the redo stack.
 */
export function historyDo(history: History, plan: PlanData, forward: ChangeSet, label: string): HistoryStep | null {
  const applied = applyChanges(plan, forward);
  if (changedNothing(applied.rows)) return null;
  const entry: HistoryEntry = { label, forward, inverse: applied.inverse };
  const undo = [...history.undo, entry].slice(-history.limit);
  return {
    history: { ...history, undo, redo: [] },
    plan: applied.plan,
    rows: applied.rows,
    log: { direction: 'do', label, forward, inverse: applied.inverse },
  };
}

export function historyUndo(history: History, plan: PlanData): HistoryStep | null {
  const entry = history.undo.at(-1);
  if (!entry) return null;
  const applied = applyChanges(plan, entry.inverse);
  return {
    history: { ...history, undo: history.undo.slice(0, -1), redo: [...history.redo, entry] },
    plan: applied.plan,
    rows: applied.rows,
    log: { direction: 'undo', label: entry.label, forward: entry.inverse, inverse: applied.inverse },
  };
}

export function historyRedo(history: History, plan: PlanData): HistoryStep | null {
  const entry = history.redo.at(-1);
  if (!entry) return null;
  const applied = applyChanges(plan, entry.forward);
  const redone: HistoryEntry = { label: entry.label, forward: entry.forward, inverse: applied.inverse };
  return {
    history: { ...history, undo: [...history.undo, redone].slice(-history.limit), redo: history.redo.slice(0, -1) },
    plan: applied.plan,
    rows: applied.rows,
    log: { direction: 'redo', label: entry.label, forward: entry.forward, inverse: applied.inverse },
  };
}

export const canUndo = (h: History): boolean => h.undo.length > 0;
export const canRedo = (h: History): boolean => h.redo.length > 0;
export const undoLabel = (h: History): string | undefined => h.undo.at(-1)?.label;
export const redoLabel = (h: History): string | undefined => h.redo.at(-1)?.label;
