import {
  parseDocument,
  type ArchitectureDocument,
  type ArchitectureNode,
  type Layout,
} from '@swiftbuild/architecture-schema';
export * from './engineering';
export function editDocument(
  document: ArchitectureDocument,
  edit: (draft: ArchitectureDocument) => void,
): ArchitectureDocument {
  const draft = structuredClone(document);
  edit(draft);
  return parseDocument(draft);
}
export function moveNode(
  document: ArchitectureDocument,
  id: string,
  position: Layout,
): ArchitectureDocument {
  return editDocument(document, (draft) => {
    const view = draft.views[0];
    if (view && draft.nodes.some((n) => n.id === id))
      view.layout[id] = { ...view.layout[id], ...position };
  });
}
export function deleteNodes(
  document: ArchitectureDocument,
  ids: string[],
): ArchitectureDocument {
  const removed = new Set(ids);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const n of document.nodes)
      if (n.parentId && removed.has(n.parentId) && !removed.has(n.id)) {
        removed.add(n.id);
        expanded = true;
      }
  }
  return editDocument(document, (draft) => {
    const edgeIds = new Set(
      draft.edges
        .filter(
          (e) =>
            removed.has(e.id) ||
            removed.has(e.source.nodeId) ||
            removed.has(e.target.nodeId),
        )
        .map((e) => e.id),
    );
    draft.nodes = draft.nodes.filter((n) => !removed.has(n.id));
    draft.edges = draft.edges.filter((e) => !edgeIds.has(e.id));
    for (const view of draft.views) {
      view.nodeIds = view.nodeIds.filter((id) => !removed.has(id));
      for (const id of removed) delete view.layout[id];
    }
    for (const item of [
      ...draft.requirements,
      ...draft.nonFunctionalRequirements,
      ...draft.decisions,
      ...draft.annotations,
      ...draft.findings,
    ])
      item.nodeIds = item.nodeIds.filter((id) => !removed.has(id));
    for (const item of [...draft.decisions, ...draft.findings])
      item.edgeIds = item.edgeIds.filter((id) => !edgeIds.has(id));
    draft.deployments = draft.deployments.filter((d) => !removed.has(d.nodeId));
    draft.performanceProfiles = draft.performanceProfiles.filter(
      (p) => !removed.has(p.nodeId),
    );
    draft.flowPolicies = draft.flowPolicies.filter(
      (p) =>
        !edgeIds.has(p.edgeId) &&
        (!p.cacheNodeId || !removed.has(p.cacheNodeId)),
    );
    for (const scenario of draft.scenarios) {
      scenario.trafficClasses = scenario.trafficClasses.filter(
        (t) => !removed.has(t.entryNodeId),
      );
      scenario.targets = scenario.targets.filter(
        (t) =>
          (!t.nodeId || !removed.has(t.nodeId)) &&
          (!t.trafficClassId ||
            scenario.trafficClasses.some(
              (traffic) => traffic.id === t.trafficClassId,
            )),
      );
    }
    const removedScenarios = new Set(
      draft.scenarios.filter((s) => !s.trafficClasses.length).map((s) => s.id),
    );
    draft.scenarios = draft.scenarios.filter(
      (s) => !removedScenarios.has(s.id),
    );
    const trafficIds = new Set(
      draft.scenarios.flatMap((s) => s.trafficClasses.map((t) => t.id)),
    );
    draft.flowPolicies = draft.flowPolicies.filter(
      (p) => !p.trafficClassId || trafficIds.has(p.trafficClassId),
    );
    draft.assessments = draft.assessments.filter(
      (a) => !a.scenarioId || !removedScenarios.has(a.scenarioId),
    );
    const targetIds = new Set(
      draft.scenarios.flatMap((s) => s.targets.map((t) => t.id)),
    );
    for (const assessment of draft.assessments)
      if (assessment.targetId && !targetIds.has(assessment.targetId)) {
        assessment.targetId = undefined;
        assessment.fingerprint = undefined;
        assessment.status = 'unknown';
      }
  });
}
export function duplicateNodes(
  document: ArchitectureDocument,
  ids: string[],
  idFactory: () => string,
): { document: ArchitectureDocument; ids: string[] } {
  const selected = new Set(ids);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const n of document.nodes)
      if (n.parentId && selected.has(n.parentId) && !selected.has(n.id)) {
        selected.add(n.id);
        expanded = true;
      }
  }
  const mapping = new Map(
    document.nodes
      .filter((n) => selected.has(n.id))
      .map((n) => [n.id, idFactory()]),
  );
  return {
    ids: [...mapping.values()],
    document: editDocument(document, (draft) => {
      const copies: ArchitectureNode[] = document.nodes
        .filter((n) => mapping.has(n.id))
        .map((n) => ({
          ...structuredClone(n),
          id: mapping.get(n.id)!,
          name: `${n.name} copy`,
          parentId: n.parentId
            ? (mapping.get(n.parentId) ?? n.parentId)
            : undefined,
        }));
      draft.nodes.push(...copies);
      for (const e of document.edges)
        if (mapping.has(e.source.nodeId) && mapping.has(e.target.nodeId)) {
          const edgeId = idFactory();
          draft.edges.push({
            ...structuredClone(e),
            id: edgeId,
            source: { ...e.source, nodeId: mapping.get(e.source.nodeId)! },
            target: { ...e.target, nodeId: mapping.get(e.target.nodeId)! },
          });
          for (const policy of document.flowPolicies.filter(
            (p) => p.edgeId === e.id,
          ))
            draft.flowPolicies.push({
              ...structuredClone(policy),
              id: idFactory(),
              edgeId,
              cacheNodeId: policy.cacheNodeId
                ? (mapping.get(policy.cacheNodeId) ?? policy.cacheNodeId)
                : undefined,
            });
        }
      for (const profile of document.performanceProfiles)
        if (mapping.has(profile.nodeId))
          draft.performanceProfiles.push({
            ...structuredClone(profile),
            id: idFactory(),
            nodeId: mapping.get(profile.nodeId)!,
          });
      for (const view of draft.views)
        for (const [oldId, newId] of mapping) {
          const old = view.layout[oldId];
          if (old) {
            view.nodeIds.push(newId);
            const parentId = document.nodes.find(
              (n) => n.id === oldId,
            )?.parentId;
            const offset = parentId && mapping.has(parentId) ? 0 : 32;
            view.layout[newId] = {
              ...old,
              x: old.x + offset,
              y: old.y + offset,
            };
          }
        }
    }),
  };
}
export function semanticSnapshot(document: ArchitectureDocument): string {
  const { views: _views, ...semantic } = document;
  return JSON.stringify(semantic, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
}
export type History = {
  past: ArchitectureDocument[];
  present: ArchitectureDocument;
  future: ArchitectureDocument[];
};
export function commit(history: History, next: ArchitectureDocument): History {
  if (JSON.stringify(history.present) === JSON.stringify(next)) return history;
  return {
    past: [...history.past, history.present].slice(-100),
    present: next,
    future: [],
  };
}
export function undo(history: History): History {
  const previous = history.past.at(-1);
  return previous
    ? {
        past: history.past.slice(0, -1),
        present: previous,
        future: [history.present, ...history.future],
      }
    : history;
}
export function redo(history: History): History {
  const next = history.future[0];
  return next
    ? {
        past: [...history.past, history.present],
        present: next,
        future: history.future.slice(1),
      }
    : history;
}
