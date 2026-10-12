import {
  serializeArchive,
  type ProjectArchive,
} from '@swiftbuild/canvas/workspace';
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api/v1/' + path, {
    credentials: 'same-origin',
    ...options,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error?.message ??
        'The server request failed. Preserve your work and retry.',
    );
  return result as T;
}
export function createProject(
  workspaceId: string,
  archive: ProjectArchive,
  operationId: string,
) {
  serializeArchive(archive);
  return api<{ id: string }>('projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId, archive, operationId }),
  });
}
export function downloadArchive(
  archive: ProjectArchive,
  name = 'swiftbuild-recovery.json',
) {
  const url = URL.createObjectURL(
    new Blob([serializeArchive(archive)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
