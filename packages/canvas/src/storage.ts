import type { ArchitectureDocument } from '@swiftbuild/architecture-schema';
import { validateDocument } from '@swiftbuild/graph-engine';
export const DRAFT_KEY = 'swiftbuild.draft.v1';
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
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
