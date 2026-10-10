import {
  serializeDocument,
  type ArchitectureDocument,
} from '@swiftbuild/architecture-schema';
import { validateDocument } from '@swiftbuild/graph-engine';
export const DRAFT_KEY = 'swiftbuild.draft.v1';
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export interface StorageAdapter {
  read(): string | null;
  write(value: string): void;
}
export type DraftResult =
  | { status: 'empty' }
  | { status: 'loaded'; document: ArchitectureDocument }
  | { status: 'error'; message: string };
export function loadDraft(storage: StorageAdapter): DraftResult {
  try {
    const raw = storage.read();
    if (raw === null) return { status: 'empty' };
    if (new TextEncoder().encode(raw).length > MAX_IMPORT_BYTES)
      throw new Error('Stored draft exceeds the supported size.');
    return { status: 'loaded', document: validateDocument(JSON.parse(raw)) };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Browser storage unavailable.',
    };
  }
}
export function saveDraft(
  storage: StorageAdapter,
  document: ArchitectureDocument,
): void {
  const serialized = serializeDocument(validateDocument(document));
  if (new TextEncoder().encode(serialized).length > MAX_IMPORT_BYTES)
    throw new Error(
      'Draft exceeds 5 MB. Export your work; autosave could not complete.',
    );
  storage.write(serialized);
}
export function importDocument(
  raw: string,
  size: number,
): ArchitectureDocument {
  if (
    size > MAX_IMPORT_BYTES ||
    new TextEncoder().encode(raw).length > MAX_IMPORT_BYTES
  )
    throw new Error('Choose a JSON file no larger than 5 MB.');
  return validateDocument(JSON.parse(raw));
}
export function browserStorage(): StorageAdapter {
  return {
    read: () => window.localStorage.getItem(DRAFT_KEY),
    write: (value) => window.localStorage.setItem(DRAFT_KEY, value),
  };
}
