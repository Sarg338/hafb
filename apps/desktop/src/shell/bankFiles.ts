// Picking bank files for import (S6.5). In the app: the native dialog (several files at once), and
// Rust reads only what was picked. In the browser preview: a file input. Files never leave the PC.
import { isTauri } from '@tauri-apps/api/core';
import { decodeBankFile } from '../screens/accounts/importModel.ts';
import { planIpc } from './ipc.ts';

export interface PickedFile {
  name: string;
  text: string;
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

export async function pickBankFiles(): Promise<PickedFile[]> {
  if (isTauri()) {
    const paths = await planIpc.pickBankFiles();
    const out: PickedFile[] = [];
    for (const p of paths) out.push({ name: baseName(p), text: decodeBankFile(new Uint8Array(await planIpc.readImportFile(p))) });
    return out;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.csv,.ofx,.qfx,.qif,.txt';
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      void Promise.all(files.map(async (f) => ({ name: f.name, text: decodeBankFile(new Uint8Array(await f.arrayBuffer())) }))).then(resolve);
    });
    input.addEventListener('cancel', () => {
      resolve([]);
    });
    input.click();
  });
}
