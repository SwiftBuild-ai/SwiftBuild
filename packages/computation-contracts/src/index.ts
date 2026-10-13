import { z } from 'zod';
import canonicalize from 'canonicalize';
import { AnalysisDefinitionSchema } from '@swiftbuild/architecture-schema/analysis';
export { AnalysisDefinitionSchema };
export type { AnalysisDefinition } from '@swiftbuild/architecture-schema/analysis';
export const CONTRACT_VERSION = '1.0' as const;
export const MAX_COMPUTATION_BYTES = 8 * 1024 * 1024;
export const JobStateSchema = z.enum([
  'queued',
  'running',
  'cancelling',
  'completed',
  'partial',
  'cancelled',
  'timed-out',
  'failed',
]);
export const ExecutionInputSchema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  projectId: z.uuid(),
  revision: z.number().int().positive().max(2147483647),
  definition: AnalysisDefinitionSchema,
  seed: z.number().int().min(0).max(4294967295),
  samples: z.number().int().min(100).max(100000),
  deadlineMs: z.number().int().min(100).max(120000),
  capacitySamples: z
    .array(
      z.strictObject({
        x: z.number().finite(),
        value: z.number().finite().nullable(),
        status: z.enum(['complete', 'partial', 'cancelled']),
        coverage: z.array(z.string().max(4096)).max(1000),
        fingerprint: z.string(),
        engineVersion: z.string(),
        modelVersion: z.string(),
        unit: z.string(),
        evidence: z
          .strictObject({
            formula: z.string(),
            inputs: z.record(z.string(), z.number().finite()),
            assumptions: z.array(z.string()),
            limitations: z.array(z.string()),
            sources: z.array(z.string()),
            interval: z
              .strictObject({
                lower: z.number().finite(),
                upper: z.number().finite(),
                level: z.number().min(0).max(1),
                replications: z.number().int().positive(),
              })
              .optional(),
            accounting: z
              .strictObject({
                offered: z.number().finite().nonnegative(),
                admitted: z.number().finite().nonnegative(),
                completed: z.number().finite().nonnegative(),
                failed: z.number().finite().nonnegative(),
                dropped: z.number().finite().nonnegative(),
                outstanding: z.number().finite().nonnegative(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .max(50)
    .optional(),
});
export const ExecutionRequestSchema = z.strictObject({
  attemptId: z.uuid(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  input: ExecutionInputSchema,
});
export const ComputationReportSchema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  modelVersion: z.literal('1.0'),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['complete', 'partial']),
  method: z.enum(['exact', 'monte-carlo', 'finite-difference']),
  availability: z.number().finite().min(0).max(1).optional(),
  interval: z
    .tuple([
      z.number().finite().min(0).max(1),
      z.number().finite().min(0).max(1),
    ])
    .optional(),
  impacts: z.array(
    z.strictObject({
      targetId: z.string(),
      availability: z.number().finite().min(0).max(1),
      loss: z.number().finite(),
    }),
  ),
  sensitivity: z.array(
    z.strictObject({
      targetId: z.string(),
      parameter: z.string(),
      x: z.number().finite(),
      value: z.number().finite().nullable(),
      slope: z.number().finite().nullable(),
      unit: z.string(),
      slopeUnit: z.string(),
    }),
  ),
  coverage: z.array(z.string()),
  assumptions: z.array(z.string()),
  runtime: z.record(z.string(), z.string()),
});
export const AnalysisBundleSchema = z.strictObject({
  format: z.literal('swiftbuild-analysis'),
  bundleVersion: z.literal('1.0'),
  input: ExecutionInputSchema,
  report: ComputationReportSchema.nullable(),
  origin: z.enum(['computed', 'imported']),
});
export type ExecutionInput = z.infer<typeof ExecutionInputSchema>;
export type ComputationReport = z.infer<typeof ComputationReportSchema>;
export type AnalysisBundle = z.infer<typeof AnalysisBundleSchema>;
export type JobState = z.infer<typeof JobStateSchema>;
export type AnalysisJob = {
  id: string;
  projectId: string;
  revision: number;
  state: JobState;
  input: ExecutionInput;
  report: ComputationReport | null;
  error: string | null;
  origin: 'computed' | 'imported';
};
export interface AnalysisAdapter {
  pendingDefinition?(): ExecutionInput['definition'] | undefined;
  revision(): number;
  canSubmit: boolean;
  list(): Promise<AnalysisJobSummary[]>;
  read(id: string): Promise<AnalysisJob>;
  submit(
    definition: ExecutionInput['definition'],
    operationId: string,
  ): Promise<AnalysisJob>;
  cancel(id: string): Promise<void>;
  export(id: string): Promise<AnalysisBundle>;
  import(bundle: AnalysisBundle, operationId: string): Promise<AnalysisJob>;
}
export type AnalysisJobSummary = Pick<
  AnalysisJob,
  'id' | 'projectId' | 'revision' | 'state' | 'error' | 'origin'
> & { kind: ExecutionInput['definition']['kind'] };
export function canonicalJson(input: unknown): string {
  function unicode(value: unknown): void {
    if (typeof value === 'string') {
      for (const character of value) {
        const point = character.codePointAt(0)!;
        if (point >= 0xd800 && point <= 0xdfff)
          throw new Error('Canonical JSON requires valid Unicode.');
      }
    } else if (Array.isArray(value)) {
      for (const item of value) unicode(item);
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        unicode(key);
        unicode(item);
      }
    }
  }
  unicode(input);
  const result = canonicalize(input);
  if (!result) throw new Error('Input is not canonical JSON.');
  return result;
}
