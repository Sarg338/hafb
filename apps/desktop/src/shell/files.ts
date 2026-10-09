// Saving a file the app built (exports, chart images). In the app: the native Save dialog. In the
// browser preview (no Rust side): the browser's own download, which never leaves the machine.
import { isTauri } from '@tauri-apps/api/core';
import { fileIpc } from './ipc.ts';

/** Resolves to where the file went (a path or the file name), or null if the user cancelled. */
export async function saveFile(fileName: string, bytes: Uint8Array): Promise<string | null> {
  if (isTauri()) return fileIpc.saveExport(fileName, bytes);
  const copy = new Uint8Array(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer]));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
  return fileName;
}
