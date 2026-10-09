// Transaction photos (S7.6, ADR 0009): the open plan's photo list, thumbnails made here in the
// webview when a photo is attached, and object URLs for showing them. The bytes live in the plan
// file (Rust `attachments`); nothing here goes to the plan's undo history, as in YNAB.
import { useSyncExternalStore } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { uuidv7Generator } from '@hafb/shared';

export interface PhotoInfo {
  id: string;
  transactionId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  hasThumbnail: boolean;
}

const ipc = {
  list: () => invoke<PhotoInfo[]>('attachment_list'),
  pickAdd: (id: string, transactionId: string, createdAt: string) => invoke<PhotoInfo | null>('attachment_pick_add', { id, transactionId, createdAt }),
  data: (id: string) => invoke<ArrayBuffer>('attachment_data', { id }),
  thumbnail: (id: string) => invoke<ArrayBuffer>('attachment_thumbnail', { id }),
  setThumbnail: (id: string, bytes: Uint8Array) => invoke<null>('attachment_set_thumbnail', bytes, { headers: { 'x-attachment-id': id } }),
  remove: (id: string) => invoke<null>('attachment_delete', { id }),
};

const newId = uuidv7Generator(
  () => Date.now(),
  (n) => crypto.getRandomValues(new Uint8Array(n)),
);

/** Thumbnails fit this box (px); a register cell shows them at 20 px, crisp at 200% and on high-DPI screens. */
const THUMB_EDGE = 96;

/** A small JPEG of the photo, made with the webview's own image decoder (no image library). */
export async function makeThumbnail(bytes: ArrayBuffer, mimeType: string): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
  const scale = Math.min(1, THUMB_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  return new Uint8Array(await blob.arrayBuffer());
}

class PhotoStore {
  private byTransaction = new Map<string, PhotoInfo>();
  private readonly urls = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  readonly available = isTauri();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  private changed(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  get(transactionId: string): PhotoInfo | undefined {
    return this.byTransaction.get(transactionId);
  }

  /** Read the open plan's photo list (after a plan opens, or a change). */
  async refresh(): Promise<void> {
    if (!this.available) return;
    const list = await ipc.list();
    this.byTransaction = new Map(list.map((p) => [p.transactionId, p]));
    this.changed();
  }

  /** The plan closed: forget its photos. */
  clear(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.byTransaction = new Map();
    this.changed();
  }

  /** Pick a photo and attach it (replacing the transaction's photo); null if cancelled. */
  async attach(transactionId: string): Promise<PhotoInfo | null> {
    const old = this.byTransaction.get(transactionId);
    const info = await ipc.pickAdd(newId(), transactionId, new Date().toISOString());
    if (!info) return null;
    if (old) this.forget(old.id);
    try {
      await ipc.setThumbnail(info.id, await makeThumbnail(await ipc.data(info.id), info.mimeType));
    } catch {
      // A photo the webview can't decode still attaches; it just shows the photo icon.
    }
    await this.refresh();
    return this.byTransaction.get(transactionId) ?? info;
  }

  async remove(photo: PhotoInfo): Promise<void> {
    await ipc.remove(photo.id);
    this.forget(photo.id);
    await this.refresh();
  }

  /** An object URL for the thumbnail (cached), or null when there is none. */
  async thumbnailUrl(photo: PhotoInfo): Promise<string | null> {
    if (!photo.hasThumbnail) return null;
    const key = `thumb:${photo.id}`;
    const cached = this.urls.get(key);
    if (cached !== undefined) return cached;
    const bytes = await ipc.thumbnail(photo.id);
    if (bytes.byteLength === 0) return null;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
    this.urls.set(key, url);
    return url;
  }

  /** The photo itself, for the viewer and Download Image. */
  async bytes(photo: PhotoInfo): Promise<ArrayBuffer> {
    return ipc.data(photo.id);
  }

  private forget(id: string): void {
    for (const key of [`thumb:${id}`]) {
      const url = this.urls.get(key);
      if (url !== undefined) URL.revokeObjectURL(url);
      this.urls.delete(key);
    }
  }
}

export const photos = new PhotoStore();

/** Re-render when the photo list changes. */
export function usePhotosVersion(): number {
  return useSyncExternalStore(photos.subscribe, photos.getVersion);
}
