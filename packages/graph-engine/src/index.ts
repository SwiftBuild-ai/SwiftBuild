import {
  configurationErrors,
  parseDocument,
  type ArchitectureDocument,
  type ArchitectureEdge,
  type Relationship,
} from '@swiftbuild/architecture-schema';
export type GraphIssue = { path: string; message: string };
export function compatibleRelationships(
  document: ArchitectureDocument,
  source: ArchitectureEdge['source'],
  target: ArchitectureEdge['target'],
): Relationship[] {
  const sourceNode = document.nodes.find((n) => n.id === source.nodeId),
    targetNode = document.nodes.find((n) => n.id === target.nodeId);
  if (!sourceNode || !targetNode || source.nodeId === target.nodeId) return [];
  const output = document.components
    .find((c) => c.id === sourceNode.componentId)
    ?.ports.find((p) => p.id === source.portId);
  const input = document.components
    .find((c) => c.id === targetNode.componentId)
    ?.ports.find((p) => p.id === target.portId);
  if (output?.direction !== 'output' || input?.direction !== 'input') return [];
  return output.relationships.filter((r) => input.relationships.includes(r));
}
export function graphIssues(document: ArchitectureDocument): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const collections = [
    'nodes',
    'edges',
    'components',
    'views',
    'requirements',
    'nonFunctionalRequirements',
    'decisions',
    'estimates',
    'environments',
    'deployments',
    'annotations',
    'findings',
    'versions',
  ] as const;
  for (const key of collections) {
    const ids = new Set<string>();
    for (const item of document[key]) {
      if (ids.has(item.id)) add(key, `Duplicate ID ${item.id}.`);
      ids.add(item.id);
    }
  }
  const nodes = new Map(document.nodes.map((n) => [n.id, n]));
  const edges = new Set(document.edges.map((e) => e.id));
  const requirements = new Set(
    [...document.requirements, ...document.nonFunctionalRequirements].map(
      (r) => r.id,
    ),
  );
  const versions = new Set(document.versions.map((v) => v.id));
  const environments = new Set(document.environments.map((e) => e.id));
  for (const node of document.nodes) {
    const definition = document.components.find(
      (c) => c.id === node.componentId,
    );
    if (!definition) {
      add(node.id, `Unknown component ${node.componentId}.`);
      continue;
    }
    if (node.componentVersion !== definition.version)
      add(node.id, 'Component version does not match embedded definition.');
    for (const error of configurationErrors(definition, node.configuration))
      add(node.id, error);
    if (node.parentId) {
      const parent = nodes.get(node.parentId);
      if (
        !parent ||
        document.components.find((c) => c.id === parent.componentId)
          ?.category !== 'boundary'
      )
        add(node.id, 'Parent must reference a boundary.');
      const visited = new Set([node.id]);
      let cursor = node.parentId;
      while (cursor) {
        if (visited.has(cursor)) {
          add(node.id, 'Boundary containment cycle.');
          break;
        }
        visited.add(cursor);
        cursor = nodes.get(cursor)?.parentId ?? '';
      }
    }
  }
  for (const component of document.components) {
    const portIds = new Set<string>();
    for (const port of component.ports) {
      if (portIds.has(port.id)) add(component.id, `Duplicate port ${port.id}.`);
      portIds.add(port.id);
    }
    const keys = new Set<string>();
    for (const field of component.configurationSchema) {
      if (keys.has(field.key))
        add(component.id, `Duplicate configuration field ${field.key}.`);
      keys.add(field.key);
    }
    for (const error of configurationErrors(
      component,
      Object.fromEntries(
        component.configurationSchema.map((f) => [f.key, f.default]),
      ),
    ))
      add(component.id, `Invalid default: ${error}`);
  }
  for (const edge of document.edges)
    if (
      !compatibleRelationships(document, edge.source, edge.target).includes(
        edge.relationship,
      )
    )
      add(
        edge.id,
        'Connection references missing or incompatible nodes/ports.',
      );
  for (const view of document.views) {
    const listed = new Set<string>();
    for (const id of view.nodeIds) {
      if (listed.has(id)) add(view.id, `Duplicate view node ${id}.`);
      listed.add(id);
      if (!nodes.has(id)) add(view.id, `Missing node ${id}.`);
      if (!Object.hasOwn(view.layout, id))
        add(view.id, `Missing layout for ${id}.`);
    }
    for (const id of Object.keys(view.layout))
      if (!listed.has(id))
        add(view.id, `Layout references unlisted node ${id}.`);
  }
  for (const item of [
    ...document.requirements,
    ...document.nonFunctionalRequirements,
    ...document.decisions,
    ...document.annotations,
    ...document.findings,
  ])
    for (const id of item.nodeIds)
      if (!nodes.has(id)) add(item.id, `Missing node ${id}.`);
  for (const item of [...document.decisions, ...document.findings])
    for (const id of item.edgeIds)
      if (!edges.has(id)) add(item.id, `Missing edge ${id}.`);
  for (const item of document.decisions) {
    for (const id of item.requirementIds)
      if (!requirements.has(id)) add(item.id, `Missing requirement ${id}.`);
    for (const id of item.versionIds)
      if (!versions.has(id)) add(item.id, `Missing version ${id}.`);
  }
  for (const deployment of document.deployments) {
    if (!nodes.has(deployment.nodeId))
      add(deployment.id, 'Missing deployment node.');
    if (!environments.has(deployment.environmentId))
      add(deployment.id, 'Missing deployment environment.');
  }
  return issues;
}
export function validateDocument(input: unknown): ArchitectureDocument {
  const document = parseDocument(input);
  const issues = graphIssues(document);
  if (issues.length)
    throw new Error(issues.map((i) => `${i.path}: ${i.message}`).join('\n'));
  return document;
}
