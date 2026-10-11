import type { SimulationOptions } from '@swiftbuild/architecture-schema';
export const ENGINE_VERSION = '1.2.0';
export type Metric = {
  id: string;
  name: string;
  value?: number;
  unit: string;
  status: 'known' | 'unknown' | 'unstable';
  formula: string;
  inputs: Record<string, number>;
  assumptions: string[];
  limitations: string[];
  sources: string[];
  interval?: {
    lower: number;
    upper: number;
    level: number;
    replications: number;
  };
};
export type CoverageIssue = {
  nodeId?: string;
  edgeId?: string;
  message: string;
};
export type NodeResult = {
  nodeId: string;
  metrics: Metric[];
  bottleneck: boolean;
};
export type CapacityReport = {
  origin?: 'computed' | 'imported';
  engineVersion: string;
  modelVersion: string;
  fingerprint: string;
  scenarioId: string;
  scenarioName?: string;
  runSettings?: SimulationOptions;
  kind: 'estimate' | 'analytical' | 'simulation';
  status: 'complete' | 'partial' | 'cancelled';
  metrics: Metric[];
  nodes: NodeResult[];
  coverage: CoverageIssue[];
  assumptions: string[];
  accounting?: {
    offered: number;
    admitted: number;
    completed: number;
    failed: number;
    dropped: number;
    outstanding: number;
  };
  series?: {
    seconds: number;
    completed: number;
    outstanding: number;
    queueDepth: number;
    dropped: number;
  }[];
  replications?: number;
  seed?: number;
  traffic?: { trafficClassId: string; metrics: Metric[] }[];
  processedEvents?: number;
};
export function metric(
  id: string,
  name: string,
  value: number | undefined,
  unit: string,
  formula: string,
  inputs: Record<string, number | undefined> = {},
  assumptions: string[] = [],
  limitations: string[] = [],
  sources: string[] = [],
): Metric {
  return {
    id,
    name,
    ...(value !== undefined && Number.isFinite(value) ? { value } : {}),
    unit,
    status: value !== undefined && Number.isFinite(value) ? 'known' : 'unknown',
    formula,
    inputs: Object.fromEntries(
      Object.entries(inputs).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      ),
    ),
    assumptions: [...new Set(assumptions)],
    limitations: [
      ...new Set([
        ...limitations,
        ...(value !== undefined && !Number.isFinite(value)
          ? [
              'Calculation exceeded the finite numerical range. Revise input magnitudes.',
            ]
          : []),
      ]),
    ],
    sources: [...new Set(sources)],
  };
}
