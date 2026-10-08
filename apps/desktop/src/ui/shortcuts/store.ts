// The live set of registered shortcuts (registration order matters: later wins within a scope).
import type { ShortcutDef } from './registry.ts';

export interface RegisteredShortcut extends ShortcutDef {
  run: (event: KeyboardEvent) => void;
}

export class ShortcutStore {
  private readonly entries = new Map<number, RegisteredShortcut>();
  private nextToken = 1;
  private snapshot: RegisteredShortcut[] = [];
  private readonly listeners = new Set<() => void>();

  /** Add a shortcut; returns a function that removes exactly this registration. */
  register(def: RegisteredShortcut): () => void {
    const token = this.nextToken;
    this.nextToken += 1;
    this.entries.set(token, def);
    this.changed();
    return () => {
      if (this.entries.delete(token)) this.changed();
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Registration order; a stable array between changes (for useSyncExternalStore). */
  readonly getSnapshot = (): RegisteredShortcut[] => this.snapshot;

  private changed(): void {
    this.snapshot = [...this.entries.values()];
    for (const l of this.listeners) l();
  }
}
