import { z } from 'zod';
import { ProvenanceSchema } from './engineering';

const id = z.string().min(1).max(128);
const life = {
  meanUpSeconds: z.number().finite().positive().max(1e15),
  meanRepairSeconds: z.number().finite().nonnegative().max(1e15),
  provenance: ProvenanceSchema,
};
export const ReliabilityDefinitionSchema = z.strictObject({
  components: z
    .array(z.strictObject({ nodeId: id, ...life }))
    .min(1)
    .max(100),
  groups: z
    .array(
      z.strictObject({ id, nodeIds: z.array(id).min(1).max(100), ...life }),
    )
    .max(100),
  gates: z
    .array(
      z.strictObject({
        id,
        kind: z.enum(['and', 'or', 'k-of-n']),
        inputs: z.array(id).min(1).max(100),
        k: z.number().int().positive().max(100).optional(),
      }),
    )
    .max(100),
  root: id,
});
export const AnalysisDefinitionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('reliability'),
    reliability: ReliabilityDefinitionSchema,
    ranges: z
      .array(
        z.strictObject({
          targetId: id,
          parameter: z.enum(['meanUpSeconds', 'meanRepairSeconds']),
          values: z
            .array(z.number().finite().nonnegative().max(1e15))
            .min(2)
            .max(50),
        }),
      )
      .max(10),
  }),
  z.strictObject({
    kind: z.literal('capacity-sensitivity'),
    scenarioId: id,
    engine: z.enum(['analytical', 'simulation']),
    targetId: id,
    parameter: z.enum([
      'requestsPerSecond',
      'peakMultiplier',
      'meanMs',
      'concurrency',
      'replicas',
    ]),
    values: z.array(z.number().finite().nonnegative().max(1e9)).min(2).max(50),
    metricId: id,
    nodeId: id.optional(),
  }),
]);
export type AnalysisDefinition = z.infer<typeof AnalysisDefinitionSchema>;
export type ReliabilityDefinition = z.infer<typeof ReliabilityDefinitionSchema>;
