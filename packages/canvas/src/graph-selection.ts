// Selection belongs to the graph adapter, not the persisted semantic data.
export function projectSelection<T extends { id: string; selected?: boolean }>(
  items: T[],
  selected: ReadonlySet<string>,
): T[] {
  return items.map((item) => {
    const chosen = selected.has(item.id);
    return item.selected === chosen ? item : { ...item, selected: chosen };
  });
}
