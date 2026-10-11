import { simulateTopology } from '@swiftbuild/capacity-engine';
import { validateDocument } from '@swiftbuild/graph-engine';
let cancelled = false;
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
};
scope.onmessage = async (event) => {
  if (event.data.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (event.data.type !== 'run') return;
  cancelled = false;
  const { runId, scenarioId, options } = event.data;
  try {
    const result = await simulateTopology(
      validateDocument(event.data.document),
      scenarioId,
      {
        ...options,
        shouldCancel: () => cancelled,
        onProgress: (progress) =>
          scope.postMessage({ type: 'progress', runId, progress }),
      },
    );
    scope.postMessage({ type: 'result', runId, result });
  } catch (error) {
    scope.postMessage({
      type: 'error',
      runId,
      message: error instanceof Error ? error.message : 'Simulation failed.',
    });
  }
};
