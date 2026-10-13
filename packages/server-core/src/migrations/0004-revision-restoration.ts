export const revisionRestoration = {
  id: '0004-revision-restoration',
  sql: `
ALTER TABLE sb_revisions ADD COLUMN operation_kind text NOT NULL DEFAULT 'save' CHECK (operation_kind IN ('create','save','restore'));
ALTER TABLE sb_revisions ADD COLUMN source_revision integer;
ALTER TABLE sb_revisions ADD COLUMN expected_revision integer;
UPDATE sb_revisions SET operation_kind='create' WHERE revision=1;
ALTER TABLE sb_revisions ADD CONSTRAINT sb_revision_restore_source FOREIGN KEY (project_id,source_revision) REFERENCES sb_revisions(project_id,revision);
ALTER TABLE sb_revisions ADD CONSTRAINT sb_revision_restore_shape CHECK (
  (operation_kind='restore' AND source_revision IS NOT NULL AND source_revision>0 AND expected_revision IS NOT NULL AND expected_revision>0 AND source_revision<revision AND expected_revision=revision-1)
  OR (operation_kind<>'restore' AND source_revision IS NULL AND expected_revision IS NULL)
);
`,
} as const;
