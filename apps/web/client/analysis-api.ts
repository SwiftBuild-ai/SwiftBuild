import {
  AnalysisDefinitionSchema,
  AnalysisBundleSchema,
  type AnalysisAdapter,
  type AnalysisJob,
  type AnalysisJobSummary,
  type AnalysisBundle,
} from '@swiftbuild/computation-contracts';
import { api } from './project-api';
export function analysisAdapter(
  projectId: string,
  revision: () => number,
  canSubmit: boolean,
  userId: string,
): AnalysisAdapter {
  const path = `projects/${projectId}/jobs`;
  const pendingKey = `swiftbuild-analysis-submission:${userId}:${projectId}`;
  const post = async (
    input: unknown,
    operationId: string,
    imported = false,
  ) => {
    const key = pendingKey;
    const version = revision();
    const signature = JSON.stringify({ input, imported, revision: version });
    const existing = localStorage.getItem(key);
    if (existing) {
      const retained = JSON.parse(existing) as {
        signature: string;
        operationId: string;
      };
      if (retained.signature === signature) operationId = retained.operationId;
    }
    localStorage.setItem(key, JSON.stringify({ signature, operationId }));
    const result = await api<AnalysisJob>(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'if-match': `"${version}"`,
      },
      body: JSON.stringify({ input, operationId, imported }),
    });
    localStorage.removeItem(key);
    return result;
  };
  return {
    pendingDefinition: () => {
      try {
        const retained = JSON.parse(localStorage.getItem(pendingKey) ?? 'null');
        if (!retained) return undefined;
        const pending = JSON.parse(retained.signature);
        return AnalysisDefinitionSchema.parse(
          pending.imported
            ? pending.input.input.definition
            : pending.input.definition,
        );
      } catch {
        return undefined;
      }
    },
    revision,
    canSubmit,
    list: async () => {
      const items: AnalysisJobSummary[] = [];
      let before: string | null = null;
      do {
        const page: { items: AnalysisJobSummary[]; nextCursor: string | null } =
          await api(path + (before ? `?before=${before}` : ''));
        items.push(...page.items);
        before = page.nextCursor;
      } while (before && items.length < 1000);
      return items;
    },
    read: (id) => api<AnalysisJob>(`${path}/${id}`),
    submit: (definition, operationId) => post({ definition }, operationId),
    cancel: async (id) => {
      await api(`${path}/${id}/cancel`, { method: 'POST' });
    },
    export: async (id) =>
      AnalysisBundleSchema.parse(
        await api<AnalysisBundle>(`${path}/${id}/export`),
      ),
    import: (bundle, operationId) =>
      post(AnalysisBundleSchema.parse(bundle), operationId, true),
  };
}
