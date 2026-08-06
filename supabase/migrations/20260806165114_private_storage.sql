begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'capital-lab-research',
  'capital-lab-research',
  false,
  26214400,
  array['text/markdown', 'text/plain', 'text/csv', 'application/json', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- There is deliberately no authenticated direct-object policy. Uploads, downloads,
-- and signed URLs must pass through an owner-checked server boundary using service_role.

commit;
