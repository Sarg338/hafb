-- 0005 (S7.6): transaction photos (ADR 0009). The attachments table has been in the schema since
-- 0001; each photo now also keeps a small thumbnail the webview makes when it is attached, so a
-- register shows its thumbnails without loading every full image. Additive only.
ALTER TABLE attachments ADD COLUMN thumbnail BLOB;
