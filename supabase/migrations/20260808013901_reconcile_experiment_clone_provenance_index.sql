begin;

drop index if exists public.experiments_source_experiment_idx;

create index experiments_source_experiment_idx
on public.experiments(source_experiment_id, owner_id)
where source_experiment_id is not null;

commit;
