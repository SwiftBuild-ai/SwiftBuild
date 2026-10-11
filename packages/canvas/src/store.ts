import { createStore } from 'zustand/vanilla';
import {
  commit,
  undo,
  redo,
  editDocument,
  deleteNodes,
  duplicateNodes,
  type History,
} from '@swiftbuild/architecture-model';
import { validateDocument } from '@swiftbuild/graph-engine';
import { blankDocument } from '@swiftbuild/components-core';
import type {
  ArchitectureDocument,
  ComponentDefinition,
  Layout,
} from '@swiftbuild/architecture-schema';
export type EditorState = {
  history: History;
  selected: string[];
  message: string;
  apply: (edit: (draft: ArchitectureDocument) => void) => boolean;
  replace: (document: ArchitectureDocument) => void;
  select: (ids: string[]) => void;
  add: (definition: ComponentDefinition, position?: Layout) => boolean;
  remove: () => void;
  duplicate: () => void;
  undo: () => void;
  redo: () => void;
  blank: () => void;
  notify: (message: string) => void;
};
export function createEditorStore(
  initialDocument: ArchitectureDocument = blankDocument(),
) {
  return createStore<EditorState>((set, get) => ({
    history: { past: [], present: initialDocument, future: [] },
    selected: [],
    message: '',
    apply: (edit) => {
      try {
        const next = validateDocument(
          editDocument(get().history.present, edit),
        );
        set({ history: commit(get().history, next), message: '' });
        return true;
      } catch (error) {
        set({
          message:
            error instanceof Error ? error.message : 'Unable to apply change.',
        });
        return false;
      }
    },
    replace: (document) => {
      const valid = validateDocument(document);
      set({
        history: { past: [], present: valid, future: [] },
        selected: [],
        message: '',
      });
    },
    select: (selected) => {
      if (selected.join() !== get().selected.join()) set({ selected });
    },
    add: (definition, position) => {
      const id = crypto.randomUUID();
      const doc = get().history.present;
      const count = doc.nodes.length;
      const saved = get().apply((draft) => {
        if (!draft.components.some((c) => c.id === definition.id))
          draft.components.push(definition);
        draft.nodes.push({
          id,
          name: definition.name,
          componentId: definition.id,
          componentVersion: definition.version,
          configuration: Object.fromEntries(
            definition.configurationSchema.map((f) => [f.key, f.default]),
          ),
          metadata: {},
        });
        const view = draft.views[0]!;
        view.nodeIds.push(id);
        view.layout[id] = position ?? {
          x: 100 + (count % 3) * 290,
          y: 100 + Math.floor(count / 3) * 190,
          ...(definition.category === 'boundary'
            ? { width: 560, height: 360 }
            : {}),
        };
      });
      if (saved) get().select([id]);
      return saved;
    },
    remove: () => {
      const state = get();
      const next = validateDocument(
        deleteNodes(state.history.present, state.selected),
      );
      set({ history: commit(state.history, next), selected: [] });
    },
    duplicate: () => {
      const result = duplicateNodes(get().history.present, get().selected, () =>
        crypto.randomUUID(),
      );
      set({
        history: commit(get().history, validateDocument(result.document)),
        selected: result.ids,
      });
    },
    undo: () => set({ history: undo(get().history), selected: [] }),
    redo: () => set({ history: redo(get().history), selected: [] }),
    blank: () => get().replace(blankDocument()),
    notify: (message) => set({ message }),
  }));
}
