'use client';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { createEditorStore, type EditorState } from './store';
export const StoreContext = createContext<ReturnType<
  typeof createEditorStore
> | null>(null);

export function useEditor<T>(selector: (state: EditorState) => T): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error('Missing editor context.');
  return useStore(store, selector);
}
