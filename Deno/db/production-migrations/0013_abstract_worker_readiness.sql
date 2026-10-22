ALTER TABLE public.abstract_extraction_worker_state
  ADD COLUMN dependencies_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN dependency_error_code varchar(80),
  ADD COLUMN dependencies_checked_at timestamptz;
