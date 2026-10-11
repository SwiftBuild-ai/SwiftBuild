import type {
  ArchitectureDocument,
  Assessment,
} from '@swiftbuild/architecture-schema';
import { inputFingerprint } from '@swiftbuild/architecture-model';
import { graphIssues } from '@swiftbuild/graph-engine';
import {
  ENGINE_VERSION,
  type CapacityReport,
} from '@swiftbuild/capacity-engine';

export const RULE_ENGINE_VERSION = '1.0.0';
export type Finding = {
  id: string;
  ruleId: string;
  severity: 'info' | 'warning' | 'error';
  nodeIds: string[];
  edgeIds: string[];
  title: string;
  description: string;
  reason: string;
  recommendation: string;
  documentationReference: string;
  evidence: string[];
  fix?: { nodeId: string; key: string; value: boolean };
};
export type RuleOutcome = {
  ruleId: string;
  nodeId?: string;
  status: 'passed' | 'failed' | 'not-applicable' | 'insufficient-information';
  explanation: string;
};
export type ValidationReport = {
  engineVersion: string;
  modelVersion: string;
  fingerprint: string;
  findings: Finding[];
  outcomes: RuleOutcome[];
  assessments: Assessment[];
  structuralIssues: ReturnType<typeof graphIssues>;
  capacityStale: boolean;
};
export type RuleContext = { capacity?: CapacityReport; scenarioId?: string };
function findingIdentity(ruleId: string, values: unknown[]): string {
  const key = JSON.stringify(values);
  let first = 2166136261,
    second = 2246822519;
  for (let i = 0; i < key.length; i++) {
    first = Math.imul(first ^ key.charCodeAt(i), 16777619);
    second = Math.imul(second ^ key.charCodeAt(i), 3266489917);
  }
  // Presentation identity only; not an authenticity or security digest.
  return `${ruleId.slice(0, 40)}:${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}
export function evaluateArchitecture(
  document: ArchitectureDocument,
  context: RuleContext = {},
): ValidationReport {
  const fingerprint = inputFingerprint(document);
  const capacityStale =
    !!context.capacity &&
    (context.capacity.fingerprint !== fingerprint ||
      context.capacity.origin === 'imported' ||
      context.capacity.modelVersion !== '1.0' ||
      context.capacity.engineVersion !== ENGINE_VERSION);
  const capacity = capacityStale ? undefined : context.capacity;
  const result: ValidationReport = {
    engineVersion: RULE_ENGINE_VERSION,
    modelVersion: '1.0',
    fingerprint,
    findings: [],
    outcomes: [],
    assessments: [],
    structuralIssues: graphIssues(document),
    capacityStale,
  };
  const finding = (
    ruleId: string,
    title: string,
    reason: string,
    recommendation: string,
    nodeIds: string[] = [],
    severity: Finding['severity'] = 'warning',
    edgeIds: string[] = [],
    fix?: Finding['fix'],
  ) => {
    result.findings.push({
      id: findingIdentity(ruleId, [
        ruleId,
        title,
        reason,
        [...nodeIds].sort(),
        [...edgeIds].sort(),
      ]),
      ruleId,
      severity,
      nodeIds,
      edgeIds,
      title,
      description: reason,
      reason,
      recommendation,
      evidence: [reason],
      documentationReference: `/guide#${ruleId.startsWith('target:') ? 'targets' : ruleId}`,
      fix,
    });
  };
  for (const n of document.nodes) {
    const component = document.components.find((c) => c.id === n.componentId);
    if (!component) continue;
    const production =
      document.engineering.production ||
      document.deployments.some(
        (d) =>
          d.nodeId === n.id &&
          document.environments.some(
            (e) => e.id === d.environmentId && e.production,
          ),
      );
    if (component.category === 'compute' || component.category === 'database') {
      const replicas = n.configuration.replicas;
      const status = !production
        ? 'not-applicable'
        : typeof replicas !== 'number'
          ? 'insufficient-information'
          : replicas < document.engineering.minimumReplicas
            ? 'failed'
            : 'passed';
      result.outcomes.push({
        ruleId: 'redundancy',
        nodeId: n.id,
        status,
        explanation: !production
          ? 'No production designation for this node.'
          : `Configured replicas: ${String(replicas ?? 'unknown')}; policy minimum: ${document.engineering.minimumReplicas}. Replica count alone does not establish failure-domain redundancy.`,
      });
      if (status === 'failed')
        finding(
          'redundancy',
          `${n.name} has insufficient configured replicas`,
          `${replicas} replicas are configured for a production node.`,
          'Review replication, failover, and independent failure domains.',
          [n.id],
        );
    }
    const checks: {
      category: string;
      key: string;
      ruleId: string;
      title: string;
      recommendation: string;
      requiresProduction: boolean;
    }[] = [
      {
        category: 'compute',
        key: 'healthChecks',
        ruleId: 'health-checks',
        title: 'Health checks are disabled',
        recommendation:
          'Enable health checks and verify their readiness/liveness behavior.',
        requiresProduction: true,
      },
      {
        category: 'database',
        key: 'backups',
        ruleId: 'backups',
        title: 'Backups are disabled',
        recommendation:
          'Enable backups and test restoration against recovery requirements.',
        requiresProduction: true,
      },
      {
        category: 'messaging',
        key: 'deadLetter',
        ruleId: 'dead-letter',
        title: 'Dead-letter handling is disabled',
        recommendation:
          'Configure a dead-letter path and an operational recovery procedure.',
        requiresProduction: false,
      },
    ];
    for (const check of checks)
      if (component.category === check.category) {
        const value = n.configuration[check.key];
        const status =
          check.requiresProduction && !production
            ? 'not-applicable'
            : typeof value !== 'boolean'
              ? 'insufficient-information'
              : value
                ? 'passed'
                : 'failed';
        result.outcomes.push({
          ruleId: check.ruleId,
          nodeId: n.id,
          status,
          explanation:
            status === 'not-applicable'
              ? 'No production designation.'
              : `${check.key} = ${String(value ?? 'unknown')}.`,
        });
        if (status === 'failed')
          finding(
            check.ruleId,
            `${n.name}: ${check.title}`,
            `${check.key} is explicitly disabled.`,
            check.recommendation,
            [n.id],
            'warning',
            [],
            component.configurationSchema.some(
              (f) => f.key === check.key && f.type === 'boolean',
            )
              ? { nodeId: n.id, key: check.key, value: true }
              : undefined,
          );
      }
    if (component.category !== 'client' && component.category !== 'boundary') {
      const profile = document.performanceProfiles.find(
        (p) => p.nodeId === n.id,
      );
      result.outcomes.push({
        ruleId: 'measurements',
        nodeId: n.id,
        status:
          profile?.provenance.kind === 'measured'
            ? 'passed'
            : 'insufficient-information',
        explanation: profile
          ? `Profile evidence is ${profile.provenance.kind}: ${profile.provenance.source}.`
          : 'No performance profile.',
      });
      if (!profile || profile.provenance.kind !== 'measured')
        finding(
          'measurements',
          `${n.name}: capacity evidence is incomplete`,
          profile
            ? `Inputs are ${profile.provenance.kind}; production accuracy is not established.`
            : 'No capacity measurements or declared model are available.',
          'Record representative load-test measurements and their operating context.',
          [n.id],
          'info',
        );
    }
  }
  for (const edge of document.edges) {
    const target = document.nodes.find((n) => n.id === edge.target.nodeId);
    const source = document.nodes.find((n) => n.id === edge.source.nodeId);
    const sourceCategory = document.components.find(
      (c) => c.id === source?.componentId,
    )?.category;
    const targetCategory = document.components.find(
      (c) => c.id === target?.componentId,
    )?.category;
    if (
      targetCategory === 'database' &&
      (edge.relationship === 'public-access' || sourceCategory === 'client')
    )
      finding(
        'trust-exposure',
        'Database has an external access path',
        'An external client or explicitly public connection directly targets durable storage.',
        'Review authentication, authorization and trust boundaries; route through an appropriate application interface.',
        [edge.target.nodeId],
        'warning',
        [edge.id],
      );
    const sourceBoundary = document.nodes.find(
      (n) => n.id === source?.parentId,
    );
    const targetBoundary = document.nodes.find(
      (n) => n.id === target?.parentId,
    );
    if (
      source?.parentId !== target?.parentId &&
      (sourceBoundary?.configuration.kind === 'Trust' ||
        targetBoundary?.configuration.kind === 'Trust')
    )
      finding(
        'trust-boundary',
        'Connection crosses a trust boundary',
        'The connection crosses an explicitly declared trust boundary. The model cannot infer transport protection or authorization.',
        'Document and verify transport protection and authorization for this connection.',
        [edge.source.nodeId, edge.target.nodeId],
        'info',
        [edge.id],
      );
  }
  if (capacity) {
    for (const issue of capacity.coverage)
      finding(
        'model-coverage',
        'Capacity model needs attention',
        issue.message,
        'Supply the missing behavior or measurement, or revise the unsupported path.',
        issue.nodeId ? [issue.nodeId] : [],
        'info',
        issue.edgeId ? [issue.edgeId] : [],
      );
    for (const node of capacity.nodes)
      for (const m of node.metrics) {
        if (
          (m.id === 'utilization' || m.id === 'cpu') &&
          m.value !== undefined &&
          m.value >= 1
        )
          finding(
            'overload',
            'Offered load exceeds modeled capacity',
            `${m.name} is ${m.value.toFixed(3)} ${m.unit}.`,
            'Compare scaling and workload scenarios using measured component behavior.',
            [node.nodeId],
            'error',
          );
        if (m.id === 'backlog-growth' && m.value !== undefined && m.value > 0)
          finding(
            'queue-stability',
            'Queue backlog is growing',
            `Modeled arrival demand exceeds consumer capacity by ${m.value.toFixed(2)} messages/s.`,
            'Increase measured consumer capacity, reduce production, or revise admission policy.',
            [node.nodeId],
            'error',
          );
        if (m.id === 'storage' && m.value !== undefined && m.value >= 1)
          finding(
            'storage',
            'Retention exceeds configured storage',
            `Estimated retained storage utilization is ${m.value.toFixed(3)}.`,
            'Review retention, object growth, overhead, and storage capacity.',
            [node.nodeId],
            'error',
          );
      }
    const scenario = document.scenarios.find(
      (s) => s.id === capacity.scenarioId,
    );
    for (const target of scenario?.targets ?? []) {
      const metrics = target.nodeId
        ? capacity.nodes.find((n) => n.nodeId === target.nodeId)?.metrics
        : target.trafficClassId
          ? capacity.traffic?.find(
              (t) => t.trafficClassId === target.trafficClassId,
            )?.metrics
          : capacity.metrics;
      const m = metrics?.find((v) => v.id === target.metric);
      const value =
        capacity.status === 'complete' &&
        !(target.nodeId && target.trafficClassId)
          ? m?.value
          : undefined;
      const censoredDeadline =
        target.metric === 'deadline' &&
        value !== undefined &&
        value <= target.value &&
        capacity.accounting &&
        (capacity.accounting.outstanding > 0 ||
          capacity.accounting.failed > 0 ||
          capacity.accounting.dropped > 0);
      const status =
        value === undefined || censoredDeadline
          ? 'insufficient-information'
          : (
                target.comparator === 'at-most'
                  ? value <= target.value
                  : value >= target.value
              )
            ? 'passed'
            : 'failed';
      result.outcomes.push({
        ruleId: `target:${target.id}`,
        status,
        explanation:
          value === undefined
            ? 'No complete, matching metric for this target. Traffic-class-specific and deadline assessments require matching evidence.'
            : `${value} ${target.unit} compared with ${target.comparator} ${target.value} ${target.unit}.`,
      });
      if (status === 'failed')
        finding(
          `target:${target.id}`,
          'Performance target violated',
          `${target.metric}: ${value} ${target.unit}; target ${target.comparator} ${target.value}.`,
          'Inspect the limiting component and compare workload/scaling alternatives.',
          target.nodeId ? [target.nodeId] : [],
          'error',
        );
    }
  }
  for (const requirement of [
    ...document.requirements,
    ...document.nonFunctionalRequirements,
  ]) {
    const existing = document.assessments.find(
      (a) => a.requirementId === requirement.id,
    );
    if (
      existing?.status === 'manually-reviewed' &&
      existing.fingerprint === fingerprint
    )
      result.assessments.push(existing);
    else if (existing?.targetId && capacity && capacity.status === 'complete') {
      const outcome = result.outcomes.find(
        (o) => o.ruleId === `target:${existing.targetId}`,
      );
      result.assessments.push({
        ...existing,
        status:
          outcome?.status === 'passed'
            ? 'met'
            : outcome?.status === 'failed'
              ? 'violated'
              : 'unknown',
        evidence: outcome?.explanation ?? 'No current result.',
        fingerprint,
      });
    } else
      result.assessments.push({
        id: existing?.id ?? `assessment:${requirement.id}`,
        requirementId: requirement.id,
        status: 'unknown',
        evidence:
          'No current assessment evidence. Link a measurable scenario target or record a manual review.',
      });
  }
  return result;
}
