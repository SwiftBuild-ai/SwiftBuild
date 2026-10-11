import { z } from 'zod';
import {
  ScenarioSchema,
  PerformanceProfileSchema,
  FlowPolicySchema,
  AssessmentSchema,
  EngineeringSettingsSchema,
} from './engineering';
export * from './engineering';
export const SCHEMA_VERSION = '1.1' as const;
export const IdSchema = z.string().min(1).max(128);
export const MetadataSchema = z.record(z.string(), z.json()).default({});
export const RelationshipSchema = z.enum([
  'request',
  'cache-lookup',
  'database-connection',
  'async-message',
  'event-stream',
  'replication',
  'file-transfer',
  'network-dependency',
  'public-access',
]);
export const CategorySchema = z.enum([
  'client',
  'compute',
  'database',
  'cache',
  'messaging',
  'boundary',
]);
export const PortSchema = z.object({
  id: IdSchema,
  label: z.string(),
  direction: z.enum(['input', 'output']),
  relationships: z.array(RelationshipSchema).min(1),
});
export const ConfigurationFieldSchema = z.object({
  key: IdSchema,
  label: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'select']),
  required: z.boolean().default(true),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.string()).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]),
  unit: z.string().optional(),
  description: z.string().optional(),
  integer: z.boolean().optional(),
  advanced: z.boolean().optional(),
});
export const CatalogIdentitySchema = z.object({
  category: z.enum([
    'clients',
    'networking',
    'compute',
    'databases',
    'caching',
    'messaging',
    'storage',
    'search',
    'observability',
    'constructs',
  ]),
  subcategory: z.string().min(1),
  identity: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('generic') }),
    z.object({ kind: z.literal('technology'), technology: z.string().min(1) }),
    z.object({
      kind: z.literal('provider'),
      technology: z.string().min(1),
      provider: z.string().min(1),
    }),
  ]),
  semanticType: z.enum([
    'client',
    'service',
    'worker',
    'database',
    'cache',
    'queue',
    'router',
    'storage',
    'boundary',
  ]),
  aliases: z.array(z.string()),
  serializationVersion: z.literal('1.0'),
  capacityModel: z.enum([
    'service',
    'database',
    'cache',
    'queue',
    'router',
    'unmodeled',
  ]),
  resourceBindings: z
    .partialRecord(
      z.enum([
        'memoryBytes',
        'storageBytes',
        'replicas',
        'readReplicas',
        'cpuCores',
        'cacheHitRatio',
        'queueBufferMessages',
        'queueRetentionSeconds',
      ]),
      z.object({ field: IdSchema, multiplier: z.number().finite().positive() }),
    )
    .default({}),
  examples: z.array(z.string()).default([]),
});
export const ConfigurationRuleSchema = z.object({
  kind: z.literal('field-at-most-field'),
  field: IdSchema,
  limitField: IdSchema,
  message: z.string().min(1),
});
export const ComponentDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string(),
  category: CategorySchema,
  version: z.string(),
  schemaVersion: z.enum(['1.0', '1.1']),
  capabilities: z.array(z.string()),
  configurationSchema: z.array(ConfigurationFieldSchema),
  ports: z.array(PortSchema),
  constraints: z.array(z.string()),
  documentation: z.string(),
  icon: z.string(),
  tags: z.array(z.string()),
  metadata: MetadataSchema,
  catalog: CatalogIdentitySchema.optional(),
  validationRules: z.array(ConfigurationRuleSchema).optional(),
});
export const NodeSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  componentId: IdSchema,
  componentVersion: z.string(),
  configuration: z.record(
    z.string(),
    z.union([z.string(), z.number().finite(), z.boolean()]),
  ),
  parentId: IdSchema.optional(),
  metadata: MetadataSchema,
});
export const EdgeSchema = z.object({
  id: IdSchema,
  source: z.object({ nodeId: IdSchema, portId: IdSchema }),
  target: z.object({ nodeId: IdSchema, portId: IdSchema }),
  relationship: RelationshipSchema,
  label: z.string().max(120).default(''),
  metadata: MetadataSchema,
});
export const LayoutSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});
export const ViewSchema = z.object({
  id: IdSchema,
  name: z.string(),
  nodeIds: z.array(IdSchema),
  layout: z.record(IdSchema, LayoutSchema),
  viewport: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
      zoom: z.number().positive(),
    })
    .default({ x: 0, y: 0, zoom: 1 }),
});
export const RequirementSchema = z.object({
  id: IdSchema,
  title: z.string(),
  description: z.string(),
  nodeIds: z.array(IdSchema).default([]),
});
export const NonFunctionalRequirementSchema = RequirementSchema.extend({
  metric: z.string(),
  target: z.number(),
  unit: z.string(),
});
export const DecisionSchema = z.object({
  id: IdSchema,
  title: z.string(),
  context: z.string(),
  alternatives: z.array(z.string()),
  reason: z.string(),
  consequences: z.string(),
  nodeIds: z.array(IdSchema).default([]),
  edgeIds: z.array(IdSchema).default([]),
  requirementIds: z.array(IdSchema).default([]),
  versionIds: z.array(IdSchema).default([]),
  status: z.enum(['proposed', 'accepted', 'superseded']).default('proposed'),
});
export const EstimateSchema = z.object({
  id: IdSchema,
  name: z.string(),
  input: z.record(z.string(), z.number()),
  formula: z.string(),
  result: z.number(),
  unit: z.string(),
  assumption: z.string(),
});
export const EnvironmentSchema = z.object({
  id: IdSchema,
  name: z.string(),
  production: z.boolean(),
});
export const DeploymentSchema = z.object({
  id: IdSchema,
  nodeId: IdSchema,
  environmentId: IdSchema,
  region: z.string(),
  replicas: z.number().int().positive(),
});
export const AnnotationSchema = z.object({
  id: IdSchema,
  text: z.string(),
  nodeIds: z.array(IdSchema).default([]),
});
export const RuleFindingSchema = z.object({
  id: IdSchema,
  ruleId: IdSchema,
  severity: z.enum(['info', 'warning', 'error']),
  nodeIds: z.array(IdSchema),
  edgeIds: z.array(IdSchema),
  title: z.string(),
  description: z.string(),
  reason: z.string(),
  recommendation: z.string(),
  documentationReference: z.string(),
});
export const VersionSchema = z.object({
  id: IdSchema,
  name: z.string(),
  createdAt: z.string().datetime(),
});
export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  description: z.string(),
});
export const ArchitectureSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string(),
});
export const ArchitectureDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  project: ProjectSchema,
  architecture: ArchitectureSchema,
  components: z.array(ComponentDefinitionSchema),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  views: z.array(ViewSchema).min(1),
  requirements: z.array(RequirementSchema).default([]),
  nonFunctionalRequirements: z
    .array(NonFunctionalRequirementSchema)
    .default([]),
  decisions: z.array(DecisionSchema).default([]),
  estimates: z.array(EstimateSchema).default([]),
  environments: z.array(EnvironmentSchema).default([]),
  deployments: z.array(DeploymentSchema).default([]),
  annotations: z.array(AnnotationSchema).default([]),
  findings: z.array(RuleFindingSchema).default([]),
  versions: z.array(VersionSchema).default([]),
  scenarios: z.array(ScenarioSchema).default([]),
  performanceProfiles: z.array(PerformanceProfileSchema).default([]),
  flowPolicies: z.array(FlowPolicySchema).default([]),
  assessments: z.array(AssessmentSchema).default([]),
  engineering: EngineeringSettingsSchema,
  metadata: MetadataSchema,
});
export type ArchitectureDocument = z.infer<typeof ArchitectureDocumentSchema>;
export type ArchitectureNode = z.infer<typeof NodeSchema>;
export type ArchitectureEdge = z.infer<typeof EdgeSchema>;
export type ComponentDefinition = z.infer<typeof ComponentDefinitionSchema>;
export type ConfigurationField = z.infer<typeof ConfigurationFieldSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export function parseDocument(input: unknown): ArchitectureDocument {
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === '1.0'
  )
    return migrateDocument(input);
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion !== SCHEMA_VERSION
  )
    throw new Error(
      `Unsupported schema version: ${String(input.schemaVersion)}. Original file was not modified.`,
    );
  return ArchitectureDocumentSchema.parse(input);
}
export function serializeDocument(document: ArchitectureDocument): string {
  return JSON.stringify(parseDocument(document), null, 2);
}
export function migrateDocument(input: unknown): ArchitectureDocument {
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === '1.0'
  ) {
    const legacy = z
      .object({
        schemaVersion: z.literal('1.0'),
        project: ProjectSchema,
        architecture: ArchitectureSchema,
        components: z.array(ComponentDefinitionSchema),
        nodes: z.array(NodeSchema),
        edges: z.array(EdgeSchema),
        views: z.array(ViewSchema).min(1),
        metadata: MetadataSchema,
      })
      .passthrough()
      .parse(input);
    return ArchitectureDocumentSchema.parse({
      ...structuredClone(legacy),
      schemaVersion: SCHEMA_VERSION,
    });
  }
  return parseDocument(input);
}
export function configurationErrors(
  definition: ComponentDefinition,
  configuration: ArchitectureNode['configuration'],
): string[] {
  const errors: string[] = [];
  for (const field of definition.configurationSchema) {
    const value = configuration[field.key];
    if (value === undefined) {
      if (field.required) errors.push(`${field.label} is required.`);
      continue;
    }
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value))
        errors.push(`${field.label} must be a number.`);
      else {
        if (field.integer && !Number.isInteger(value))
          errors.push(`${field.label} must be a whole number.`);
        if (field.min !== undefined && value < field.min)
          errors.push(`${field.label} must be at least ${field.min}.`);
        if (field.max !== undefined && value > field.max)
          errors.push(`${field.label} must be at most ${field.max}.`);
      }
    }
    if (field.type === 'boolean' && typeof value !== 'boolean')
      errors.push(`${field.label} must be true or false.`);
    if (
      field.type === 'string' &&
      (typeof value !== 'string' || (field.required && !value.trim()))
    )
      errors.push(`${field.label} must be text.`);
    if (
      field.type === 'select' &&
      (typeof value !== 'string' || !field.options?.includes(value))
    )
      errors.push(
        `${field.label} must be one of ${field.options?.join(', ')}.`,
      );
  }
  for (const rule of definition.validationRules ?? []) {
    const value = configuration[rule.field],
      limit = configuration[rule.limitField];
    if (typeof value === 'number' && typeof limit === 'number' && value > limit)
      errors.push(rule.message);
  }
  return errors;
}
