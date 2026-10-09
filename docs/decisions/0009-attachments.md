# ADR 0009 — Transaction photos are BLOBs inside the plan file, outside the snapshot and undo

- **Status:** Accepted (2026-10-09), S7.6.
- **Context:** YNAB lets you attach a photo to a transaction. CLAUDE.md §1 promises that a plan is one file the user owns, and the `attachments` table has been in the schema since migration 0001 for this reason. The plan's records travel to the webview as a snapshot (ADR 0002), and every change is an undoable command. Photos are megabytes each, so they can't ride along with either.

## Decision

- **Storage:** photo bytes go in `attachments.data` (a BLOB) inside the `.hafb`. Migration 0005 adds a `thumbnail` BLOB. Backups, Save a copy, restore and Fresh Start's archive carry photos with no extra code. Nothing is written beside the plan file.
- **What YNAB does** (observed in the trial, 2026-10-09):
  - The register has a photo column right after the flag column.
  - Each transaction has one image; attaching another replaces it.
  - The viewer shows the image large, with *Delete Image* (confirmed: "Are you sure you want to delete this image?"), *Download Image* and *Close*.
- **Outside the snapshot and undo:** `attachments` isn't in the snapshot table set (`schema.rs` `SNAPSHOT_TABLES`, codec `KEY_COLUMNS`). The webview reads the list (id, transaction, name, type, size, has thumbnail), then fetches bytes per photo.
  - Attach, replace and delete are direct commands, not undo steps. YNAB confirms a delete instead of offering undo, and HAFB does the same.
  - A photo belongs to its transaction id. A soft-deleted transaction keeps its photo, so undoing the delete brings the photo back.
- **Rust does the file I/O** (`src-tauri/src/photos.rs`, `store/src/attachments.rs`):
  - `attachment_pick_add` shows the native Open dialog, reads the file and stores it.
    - Images only: jpg/jpeg/jfif, png, gif, webp and bmp.
    - Photos are limited to 20 MB each, thumbnails to 512 KB.
    - `HAFB_PICK_FILES` replaces the dialog in smoke tests.
  - `attachment_data` and `attachment_thumbnail` return raw bytes over the IPC binary channel.
  - `attachment_set_thumbnail` takes a raw body, with the attachment id in a header.
- **Thumbnails are made in the webview:** it decodes the image (`createImageBitmap`), draws it at most 96 px on a side on an `OffscreenCanvas`, and stores a JPEG of roughly 10 KB, so the register never decodes full photos while scrolling.
  - Rust needs no image library, so no new dependency and nothing to audit for network calls.
  - A photo whose thumbnail can't be made shows the image icon instead.
- **Showing images:** the webview shows photo and thumbnail bytes through `blob:` URLs, so the CSP's `img-src` allows `blob:` (still nothing from the network). The smoke test checks that both images actually decode, not just that the elements exist.
- **Download Image** reuses the export path (ADR 0008): the bytes are saved through Rust's `save_export`, whose allowed extensions now include the image types.

## Consequences

- The plan file grows with the photos. That's the price of one-file ownership, and the size cap keeps any one photo reasonable.
- Undo/redo stays small and fast, but deleting a photo can't be undone; the confirm dialog guards it, as in YNAB.
- The browser preview has no plan file, so attaching there explains that photos work in the installed app.
- Tests:
  - A Rust integration test covers add, replace, thumbnail, data and delete.
  - A release-app smoke test covers attach, thumbnail, view, download, relaunch and delete.
