-- Research from uploaded files: a finding can cite one of the payer's uploaded PDFs (payer_files)
-- instead of a web page. For those findings source_url holds 'uploaded-file:<payer_files.id>' so the
-- existing "no source, no finding" check still applies, and source_file_id links to the file so the
-- review page can preview it. If the file is deleted later, the finding keeps its quote and URL text.
alter table findings
  add column source_file_id uuid references payer_files(id) on delete set null;
create index findings_source_file_idx on findings (source_file_id) where source_file_id is not null;
