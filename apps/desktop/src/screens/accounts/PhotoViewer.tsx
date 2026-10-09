// A transaction's photo (S7.6), as YNAB's viewer (2026-10-09): the image large, with Delete Image
// (confirmed: "Are you sure you want to delete this image?"), Download Image and Close.
import { useEffect, useState } from 'react';
import { photos, usePhotosVersion, type PhotoInfo } from '../../shell/photos.ts';
import { Icon } from '../../ui/Icon.tsx';
import { saveFile } from '../../shell/files.ts';
import { Button } from '../../ui/Button.tsx';
import { Dialog, useConfirm } from '../../ui/Dialog.tsx';
import styles from './PhotoViewer.module.css';

export function PhotoViewer({ photo, label, onClose, notify }: { photo: PhotoInfo; label: string; onClose: () => void; notify: (text: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const confirm = useConfirm();
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    photos.bytes(photo).then(
      (bytes) => {
        if (!live) return;
        made = URL.createObjectURL(new Blob([bytes], { type: photo.mimeType }));
        setUrl(made);
      },
      (e: unknown) => {
        notify(`Couldn’t open the photo: ${e instanceof Error ? e.message : String(e)}`);
      },
    );
    return () => {
      live = false;
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [photo, notify]);
  return (
    <Dialog
      open
      onClose={onClose}
      size="wide"
      title={label}
      footer={
        <>
          <Button
            variant="danger"
            icon="dismiss"
            onClick={() => {
              void confirm({ title: 'Delete Image', body: 'Are you sure you want to delete this image?', confirmLabel: 'Delete', danger: true }).then((ok) => {
                if (!ok) return;
                photos.remove(photo).then(onClose, (e: unknown) => {
                  notify(`Couldn’t delete the photo: ${e instanceof Error ? e.message : String(e)}`);
                });
              });
            }}
          >
            Delete Image
          </Button>
          <Button
            icon="export"
            onClick={() => {
              photos
                .bytes(photo)
                .then((bytes) => saveFile(photo.fileName, new Uint8Array(bytes)))
                .then(
                  (saved) => {
                    if (saved !== null) notify(`Saved the photo to ${saved}.`);
                  },
                  (e: unknown) => {
                    notify(`Couldn’t save the photo: ${e instanceof Error ? e.message : String(e)}`);
                  },
                );
            }}
          >
            Download Image
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className={styles.frame}>{url !== null && <img className={styles.image} src={url} alt={`Photo attached to ${label}: ${photo.fileName}`} />}</div>
    </Dialog>
  );
}

/**
 * A register's photo cell: the thumbnail opens the viewer; with no photo, the image icon attaches
 * one (YNAB). The browser preview has no plan file to keep photos in.
 */
export function PhotoCell({ transactionId, label, onOpen, notify }: { transactionId: string; label: string; onOpen: (open: { photo: PhotoInfo; label: string }) => void; notify: (text: string) => void }) {
  usePhotosVersion();
  const photo = photos.get(transactionId);
  const [thumb, setThumb] = useState<{ id: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!photo) return;
    let live = true;
    photos.thumbnailUrl(photo).then(
      (url) => {
        if (live) setThumb({ id: photo.id, url });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [photo]);
  if (photo) {
    const url = thumb?.id === photo.id ? thumb.url : null;
    return (
      <button
        type="button"
        data-interactive=""
        className={styles.cellButton}
        aria-label={`Photo attached: ${photo.fileName}. Open`}
        title="View photo"
        onClick={() => {
          onOpen({ photo, label });
        }}
      >
        {url !== null ? <img className={styles.thumb} src={url} alt="" /> : <Icon name="image" />}
      </button>
    );
  }
  return (
    <button
      type="button"
      data-interactive=""
      className={styles.cellButton}
      aria-label="Attach a photo"
      title="Attach a photo"
      onClick={() => {
        if (!photos.available) {
          notify('Photos are kept in the plan file, so they work in the installed app, not this browser preview.');
          return;
        }
        photos.attach(transactionId).then(
          () => undefined,
          (e: unknown) => {
            notify(`Couldn’t attach the photo: ${e instanceof Error ? e.message : String(e)}`);
          },
        );
      }}
    >
      <Icon name="image" />
    </button>
  );
}
