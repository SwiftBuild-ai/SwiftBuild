export const computations = {
  id: '0003-computations',
  sql: `
CREATE TABLE sb_jobs (
 id uuid PRIMARY KEY, project_id uuid NOT NULL, revision integer NOT NULL,
 workspace_id uuid NOT NULL REFERENCES sb_workspaces(id), actor_id text NOT NULL,
 operation_id uuid NOT NULL, request_digest text NOT NULL, input jsonb NOT NULL,
 state text NOT NULL CHECK (state IN ('queued','running','cancelling','completed','partial','cancelled','timed-out','failed')),
 origin text NOT NULL CHECK (origin IN ('computed','imported')),
 report jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(),
 attempt_id uuid, attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 2),
 lease_until timestamptz, started_at timestamptz,
 FOREIGN KEY (project_id,revision) REFERENCES sb_revisions(project_id,revision),
 UNIQUE(project_id,actor_id,operation_id)
);
CREATE INDEX sb_jobs_queue ON sb_jobs(state,created_at,id);
CREATE UNIQUE INDEX sb_jobs_active_workspace ON sb_jobs(workspace_id) WHERE state IN ('running','cancelling');
CREATE TABLE sb_job_attempts (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES sb_jobs(id),
 input jsonb NOT NULL, digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 prepared_at timestamptz, finished_at timestamptz, outcome text
);
CREATE TABLE sb_worker_heartbeats (id text PRIMARY KEY, updated_at timestamptz NOT NULL DEFAULT now());
`,
} as const;
