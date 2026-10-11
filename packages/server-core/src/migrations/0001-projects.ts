export const initialProjects = {
  id: '0001-projects',
  sql: `
CREATE TABLE sb_workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sb_members (
  workspace_id uuid NOT NULL REFERENCES sb_workspaces(id),
  user_id text NOT NULL CHECK (char_length(user_id) BETWEEN 1 AND 128),
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE sb_projects (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES sb_workspaces(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_by text NOT NULL,
  creation_key uuid NOT NULL,
  current_revision integer NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, creation_key)
);
CREATE TABLE sb_revisions (
  project_id uuid NOT NULL REFERENCES sb_projects(id),
  revision integer NOT NULL CHECK (revision > 0),
  operation_id uuid NOT NULL,
  archive jsonb NOT NULL,
  digest text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, revision),
  UNIQUE (project_id, operation_id)
);
CREATE TABLE sb_audit_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES sb_workspaces(id),
  actor_id text NOT NULL,
  action text NOT NULL,
  project_id uuid REFERENCES sb_projects(id),
  revision integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sb_projects_workspace ON sb_projects(workspace_id, updated_at DESC, id);
CREATE INDEX sb_members_user ON sb_members(user_id, workspace_id);
CREATE INDEX sb_audit_workspace ON sb_audit_events(workspace_id, created_at DESC);
`,
} as const;
