-- =====================================================================
-- Your Space — migration 3: more upload types (PDF, .xls, .doc, more photo formats)
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Safe to run more than once.
-- =====================================================================

-- New file kinds. (ADD VALUE must not be used in the same transaction it is
-- added in — nothing below uses them, so one run is fine.)
alter type public.file_kind add value if not exists 'pdf';
alter type public.file_kind add value if not exists 'xls';

-- The private bucket only accepts this allow-list of content types.
-- The app now always sends the type that matches the file extension.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',                                                          -- .pdf
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', -- .docx
  'application/msword',                                                       -- .doc (download only)
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       -- .xlsx
  'application/vnd.ms-excel',                                                 -- .xls (and .csv on Windows)
  'text/csv',                                                                 -- .csv
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'image/heic', 'image/heif', 'image/avif', 'image/bmp',                      -- iPhone / modern photo formats
  'video/mp4', 'video/quicktime', 'video/webm'
]
where id = 'workspace';
