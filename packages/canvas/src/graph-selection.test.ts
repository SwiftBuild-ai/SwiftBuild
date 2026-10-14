import { expect, it } from 'vitest';
import { projectSelection } from './graph-selection';

it('changes selection without replacing semantic data or unaffected graph objects', () => {
  const items = [
    { id: 'a', selected: false, data: { name: 'A', report: { value: 10 } } },
    { id: 'b', selected: false, data: { name: 'B' } },
  ];
  const selected = projectSelection(items, new Set(['a', 'missing']));
  expect(selected[0]).not.toBe(items[0]);
  expect(selected[0]!.data).toBe(items[0]!.data);
  expect(selected[0]!.selected).toBe(true);
  expect(selected[1]).toBe(items[1]);
  const cleared = projectSelection(selected, new Set());
  expect(cleared[0]!.data).toBe(items[0]!.data);
  expect(cleared[0]!.selected).toBe(false);
  expect(cleared[1]).toBe(items[1]);
  expect(items[0]!.selected).toBe(false);
});
