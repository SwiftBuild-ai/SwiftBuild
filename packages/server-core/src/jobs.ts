import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { validateArchive } from '@swiftbuild/project-format';
import {
  AnalysisBundleSchema,
  ExecutionInputSchema,
  ComputationReportSchema,
  canonicalJson,
  MAX_COMPUTATION_BYTES,
  type AnalysisJob,
  type AnalysisJobSummary,
  type ExecutionInput,
  type ComputationReport,
} from '@swiftbuild/computation-contracts';
import { transaction } from './migrate';
import { ProjectError } from './projects';
import { validateAnalysis } from './analysis-validation';
export const digest = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
export function boundedComputation(value: unknown) {
  let bytes: number;
  try {
    bytes = Buffer.byteLength(canonicalJson(value));
  } catch {
    throw new ProjectError(
      409,
      'Computation input must contain finite JSON and valid Unicode.',
      'INVALID_COMPUTATION_JSON',
    );
  }
  if (bytes > MAX_COMPUTATION_BYTES)
    throw new ProjectError(
      409,
      'Computation byte limit exceeded.',
      'INPUT_LIMIT',
    );
}
type Row = {
  id: string;
  project_id: string;
  revision: number;
  state: AnalysisJob['state'];
  input: ExecutionInput;
  report: ComputationReport | null;
  error: string | null;
  origin: AnalysisJob['origin'];
  actor_id: string;
  workspace_id: string;
  attempt_id: string;
  request_digest: string;
};
const job = (r: Row): AnalysisJob => ({
  id: r.id,
  projectId: r.project_id,
  revision: r.revision,
  state: r.state,
  input: ExecutionInputSchema.parse(r.input),
  report: r.report ? ComputationReportSchema.parse(r.report) : null,
  error: r.error,
  origin: r.origin,
});
async function authorize(
  c: PoolClient,
  actor: string,
  projectId: string,
  write: boolean,
) {
  const result = await c.query<{
    workspace_id: string;
    current_revision: number;
    role: string;
  }>(
    'SELECT p.workspace_id,p.current_revision,m.role FROM sb_projects p JOIN sb_members m ON m.workspace_id=p.workspace_id AND m.user_id=$2 JOIN sb_admitted_users u ON u.user_id=m.user_id AND u.active WHERE p.id=$1 FOR SHARE OF m,u,p',
    [projectId, actor],
  );
  const row = result.rows[0];
  if (!row) throw new ProjectError(404, 'Project not found.');
  if (write && row.role === 'viewer')
    throw new ProjectError(403, 'Editing permission is required.');
  return row;
}
async function admitted(c: PoolClient, r: Row) {
  return !!(
    await c.query(
      "SELECT 1 FROM sb_members m JOIN sb_admitted_users u ON u.user_id=m.user_id AND u.active WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role IN ('owner','editor') FOR SHARE OF m,u",
      [r.workspace_id, r.actor_id],
    )
  ).rowCount;
}
async function audit(c: PoolClient, r: Row, action: string) {
  await c.query(
    'INSERT INTO sb_audit_events(id,workspace_id,actor_id,action,project_id,revision) VALUES($1,$2,$3,$4,$5,$6)',
    [
      randomUUID(),
      r.workspace_id,
      r.actor_id,
      action,
      r.project_id,
      r.revision,
    ],
  );
}
export function createJobStore(pool: Pool) {
  return {
    async submit(
      actor: string,
      projectId: string,
      revision: number,
      operationId: string,
      input: unknown,
      imported = false,
    ) {
      z.uuid().parse(projectId);
      z.uuid().parse(operationId);
      z.number().int().positive().parse(revision);
      boundedComputation(input);
      return transaction(pool, async (c) => {
        // Serialize queue admission and claims; computations never hold this lock.
        await c.query('SELECT pg_advisory_xact_lock(1398233415)');
        const scope = await authorize(c, actor, projectId, true);
        const requestDigest = digest({ revision, input, imported });
        const existing = await c.query<Row>(
          'SELECT * FROM sb_jobs WHERE project_id=$1 AND actor_id=$2 AND operation_id=$3',
          [projectId, actor, operationId],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].request_digest !== requestDigest)
            throw new ProjectError(
              409,
              'Operation ID was reused with different input.',
            );
          return job(existing.rows[0]);
        }
        if (scope.current_revision !== revision)
          throw new ProjectError(
            409,
            'Save or reload the current project revision.',
            'REVISION_CONFLICT',
          );
        const importedBundle = imported
          ? AnalysisBundleSchema.parse(input)
          : null;
        const targetRevision = importedBundle?.input.revision ?? revision;
        const snapshot = await c.query<{ archive: unknown }>(
          'SELECT archive FROM sb_revisions WHERE project_id=$1 AND revision=$2',
          [projectId, targetRevision],
        );
        if (!snapshot.rows[0])
          throw new ProjectError(404, 'Analysis revision not found.');
        const document = validateArchive(snapshot.rows[0]!.archive).document;
        let execution: ExecutionInput;
        let report: ComputationReport | null = null;
        if (imported) {
          const bundle = importedBundle!;
          if (bundle.input.projectId !== projectId)
            throw new ProjectError(
              409,
              'Bundle belongs to another project or revision.',
            );
          if (bundle.report && bundle.report.digest !== digest(bundle.input))
            throw new ProjectError(
              409,
              'Bundle report digest does not match its input.',
            );
          execution = bundle.input;
          report = bundle.report;
        } else {
          const body = z
            .strictObject({
              definition: z.unknown(),
              seed: z.number().int().min(0).max(4294967295).default(42),
              samples: z.number().int().min(100).max(100000).default(10000),
              deadlineMs: z.number().int().min(100).max(120000).default(120000),
            })
            .parse(input);
          execution = ExecutionInputSchema.parse({
            contractVersion: '1.0',
            projectId,
            revision,
            ...body,
          });
        }
        try {
          validateAnalysis(execution.definition, document);
        } catch (e) {
          throw new ProjectError(
            409,
            e instanceof Error ? e.message : 'Invalid analysis.',
          );
        }
        if (
          !imported &&
          Number(
            (
              await c.query<{ count: string }>(
                "SELECT count(*) FROM sb_jobs WHERE workspace_id=$1 AND state='queued'",
                [scope.workspace_id],
              )
            ).rows[0]!.count,
          ) >= 10
        )
          throw new ProjectError(
            409,
            'Workspace queue is full.',
            'QUEUE_LIMIT',
          );
        const row = (
          await c.query<Row>(
            'INSERT INTO sb_jobs(id,project_id,revision,workspace_id,actor_id,operation_id,request_digest,input,state,origin,report) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
            [
              randomUUID(),
              projectId,
              targetRevision,
              scope.workspace_id,
              actor,
              operationId,
              requestDigest,
              execution,
              imported
                ? report?.status === 'complete'
                  ? 'completed'
                  : 'partial'
                : 'queued',
              imported ? 'imported' : 'computed',
              report,
            ],
          )
        ).rows[0]!;
        await audit(c, row, imported ? 'analysis.imported' : 'analysis.queued');
        return job(row);
      });
    },
    async list(actor: string, projectId: string, before?: string) {
      return transaction(pool, async (c) => {
        await authorize(c, actor, projectId, false);
        if (before) z.uuid().parse(before);
        return (
          await c.query<Row & { kind: AnalysisJobSummary['kind'] }>(
            "SELECT id,project_id,revision,state,error,origin,input->'definition'->>'kind' AS kind FROM sb_jobs WHERE project_id=$1 AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM sb_jobs WHERE id=$2 AND project_id=$1)) ORDER BY created_at DESC,id DESC LIMIT 100",
            [projectId, before ?? null],
          )
        ).rows.map((r): AnalysisJobSummary => ({
          id: r.id,
          projectId: r.project_id,
          revision: r.revision,
          state: r.state,
          error: r.error,
          origin: r.origin,
          kind: r.kind,
        }));
      });
    },
    async read(actor: string, projectId: string, id: string) {
      return transaction(pool, async (c) => {
        await authorize(c, actor, projectId, false);
        z.uuid().parse(id);
        const r = (
          await c.query<Row>(
            'SELECT * FROM sb_jobs WHERE id=$1 AND project_id=$2',
            [id, projectId],
          )
        ).rows[0];
        if (!r) throw new ProjectError(404, 'Job not found.');
        return job(r);
      });
    },
    async export(actor: string, projectId: string, id: string) {
      return transaction(pool, async (c) => {
        await authorize(c, actor, projectId, false);
        z.uuid().parse(id);
        const r = (
          await c.query<Row>(
            'SELECT * FROM sb_jobs WHERE id=$1 AND project_id=$2',
            [id, projectId],
          )
        ).rows[0];
        if (!r) throw new ProjectError(404, 'Job not found.');
        const attempt = r.report
          ? (
              await c.query<{ input: ExecutionInput }>(
                'SELECT input FROM sb_job_attempts WHERE id=$1',
                [r.attempt_id],
              )
            ).rows[0]
          : undefined;
        const bundle = AnalysisBundleSchema.parse({
          format: 'swiftbuild-analysis',
          bundleVersion: '1.0',
          input: attempt?.input ?? r.input,
          report: r.report,
          origin: r.origin,
        });
        boundedComputation(bundle);
        return bundle;
      });
    },
    async cancel(actor: string, projectId: string, id: string) {
      return transaction(pool, async (c) => {
        await authorize(c, actor, projectId, true);
        z.uuid().parse(id);
        const row = (
          await c.query<Row>(
            'SELECT * FROM sb_jobs WHERE id=$1 AND project_id=$2 FOR UPDATE',
            [id, projectId],
          )
        ).rows[0];
        if (!row) throw new ProjectError(404, 'Job not found.');
        if (row.state === 'queued' || row.state === 'running') {
          await c.query(
            "UPDATE sb_jobs SET state=CASE WHEN state='queued' THEN 'cancelled' ELSE 'cancelling' END WHERE id=$1",
            [id],
          );
          await audit(c, row, 'analysis.cancelled');
        }
      });
    },
    async claim() {
      return transaction(pool, async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(1398233415)');
        await c.query(
          "UPDATE sb_job_attempts a SET finished_at=now(),outcome='lease-expired' FROM sb_jobs j WHERE j.attempt_id=a.id AND j.lease_until<now() AND j.state IN ('running','cancelling')",
        );
        await c.query(
          "UPDATE sb_jobs SET state=CASE WHEN state='cancelling' THEN 'cancelled' WHEN attempts<2 THEN 'queued' ELSE 'failed' END,error='LEASE_EXPIRED',attempt_id=NULL,lease_until=NULL WHERE state IN ('running','cancelling') AND lease_until<now()",
        );
        const rows = await c.query<Row>(
          "SELECT * FROM sb_jobs j WHERE state='queued' AND NOT EXISTS(SELECT 1 FROM sb_jobs active WHERE active.workspace_id=j.workspace_id AND active.state IN ('running','cancelling')) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
        );
        const r = rows.rows[0];
        if (!r) return null;
        if (!(await admitted(c, r))) {
          await c.query(
            "UPDATE sb_jobs SET state='cancelled',error='ACCESS_REVOKED' WHERE id=$1",
            [r.id],
          );
          await audit(c, r, 'analysis.access-revoked');
          return null;
        }
        const attemptId = randomUUID();
        await c.query(
          "UPDATE sb_jobs SET state='running',attempt_id=$2,attempts=attempts+1,started_at=now(),lease_until=now()+interval '15 seconds' WHERE id=$1",
          [r.id, attemptId],
        );
        await c.query(
          'INSERT INTO sb_job_attempts(id,job_id,input,digest) VALUES($1,$2,$3,$4)',
          [attemptId, r.id, r.input, digest(r.input)],
        );
        const snapshot = await c.query<{ archive: unknown }>(
          'SELECT archive FROM sb_revisions WHERE project_id=$1 AND revision=$2',
          [r.project_id, r.revision],
        );
        await audit(c, r, 'analysis.started');
        return {
          ...job(r),
          state: 'running' as const,
          attemptId,
          document: validateArchive(snapshot.rows[0]!.archive).document,
        };
      });
    },
    async heartbeat(id: string, attemptId: string) {
      return transaction(pool, async (c) => {
        const r = (
          await c.query<Row>(
            'SELECT * FROM sb_jobs WHERE id=$1 AND attempt_id=$2 AND lease_until>now() FOR UPDATE',
            [id, attemptId],
          )
        ).rows[0];
        if (!r || r.state !== 'running') return false;
        if (!(await admitted(c, r))) {
          await c.query(
            "UPDATE sb_jobs SET state='cancelling',error='ACCESS_REVOKED' WHERE id=$1",
            [id],
          );
          return false;
        }
        await c.query(
          "UPDATE sb_jobs SET lease_until=now()+interval '15 seconds' WHERE id=$1",
          [id],
        );
        return true;
      });
    },
    async setExecution(id: string, attemptId: string, input: ExecutionInput) {
      boundedComputation(input);
      const updated = await pool.query(
        "UPDATE sb_job_attempts a SET input=$3,digest=$4,prepared_at=now() FROM sb_jobs j WHERE a.id=$2 AND a.prepared_at IS NULL AND j.id=$1 AND j.attempt_id=a.id AND j.state='running' AND j.lease_until>now()",
        [id, attemptId, ExecutionInputSchema.parse(input), digest(input)],
      );
      if (!updated.rowCount) throw new Error('Attempt is no longer active.');
    },
    async finish(
      id: string,
      attemptId: string,
      state: AnalysisJob['state'],
      report: ComputationReport | null,
      error: string | null,
    ) {
      if (
        !['completed', 'partial', 'failed', 'timed-out', 'cancelled'].includes(
          state,
        )
      )
        throw new Error('Invalid terminal state.');
      if (report) {
        ComputationReportSchema.parse(report);
        boundedComputation(report);
      }
      return transaction(pool, async (c) => {
        const r = (
          await c.query<Row>(
            'SELECT * FROM sb_jobs WHERE id=$1 AND attempt_id=$2 AND lease_until>now() FOR UPDATE',
            [id, attemptId],
          )
        ).rows[0];
        if (!r || !['running', 'cancelling'].includes(r.state)) return false;
        if (r.state === 'cancelling' || !(await admitted(c, r))) {
          state = 'cancelled';
          report = null;
          error = r.error ?? 'CANCELLED';
        }
        if (report) {
          if ((state === 'completed') !== (report.status === 'complete'))
            throw new Error('Result status mismatch.');
          const attempt = (
            await c.query<{ digest: string; prepared_at: string | null }>(
              'SELECT digest,prepared_at FROM sb_job_attempts WHERE id=$1',
              [attemptId],
            )
          ).rows[0]!;
          if (!attempt.prepared_at || report.digest !== attempt.digest)
            throw new Error('Result digest mismatch.');
        }
        if (['completed', 'partial'].includes(state) && !report)
          throw new Error('A successful result requires a report.');
        await c.query(
          'UPDATE sb_jobs SET state=$3,report=$4,error=$5,lease_until=NULL WHERE id=$1 AND attempt_id=$2',
          [id, attemptId, state, report, error],
        );
        await c.query(
          'UPDATE sb_job_attempts SET finished_at=now(),outcome=$2 WHERE id=$1',
          [attemptId, state],
        );
        await audit(c, r, `analysis.${state}`);
        return true;
      });
    },
  };
}
