import {
  validateArchive,
  serializeArchive,
  type ProjectArchive,
} from '@swiftbuild/canvas/workspace';
import { sameArchive } from './server-workspace';
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
export async function createProject(
  workspaceId: string,
  archive: ProjectArchive,
  operationId: string,
  expectedActorId?: string,
) {
  serializeArchive(archive);
  const result = await api<{
    id: string;
    workspaceId: string;
    revision: number;
    archive: ProjectArchive;
  }>('projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workspaceId,
      archive,
      operationId,
      expectedActorId,
    }),
  });
  if (
    !/^[0-9a-f-]{36}$/i.test(result.id) ||
    result.workspaceId !== workspaceId ||
    result.revision !== 1 ||
    !sameArchive(validateArchive(result.archive), archive)
  )
    throw new Error(
      'Creation could not be confirmed. The original retry is preserved.',
    );
  return result;
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
