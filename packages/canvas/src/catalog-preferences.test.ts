import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { recordCatalogUse } from './catalog-preferences';

const key = 'swiftbuild.catalog.preferences';
let stored: string | null;
let events: Event[];
const setItem = vi.fn((name: string, value: string) => {
  expect(name).toBe(key);
  stored = value;
});
beforeEach(() => {
  stored = null;
  events = [];
  setItem.mockClear();
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => {
      expect(name).toBe(key);
      return stored;
    },
    setItem,
  });
  vi.stubGlobal('window', {
    dispatchEvent: (event: Event) => {
      events.push(event);
      return true;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('moves repeated use to the front, caps recents and preserves favorites', () => {
  const favorites = ['core.queue', 'core.service'];
  stored = JSON.stringify({
    favorites,
    recent: Array.from({ length: 12 }, (_, i) => `component-${i}`),
  });
  recordCatalogUse('new');
  recordCatalogUse('component-3');
  recordCatalogUse('component-3');
  expect(JSON.parse(stored!)).toEqual({
    favorites,
    recent: [
      'component-3',
      'new',
      'component-0',
      'component-1',
      'component-2',
      'component-4',
      'component-5',
      'component-6',
      'component-7',
      'component-8',
      'component-9',
      'component-10',
    ],
  });
  expect(events).toHaveLength(3);
  expect(events.at(-1)).toMatchObject({
    type: 'swiftbuild:component-added',
    detail: 'component-3',
  });
});
it('filters non-string recents and older copies of the inserted ID', () => {
  stored = JSON.stringify({
    favorites: ['favorite'],
    recent: [null, 42, {}, 'keep', 'insert', 'insert'],
  });
  recordCatalogUse('insert');
  expect(JSON.parse(stored!)).toEqual({
    favorites: ['favorite'],
    recent: ['insert', 'keep'],
  });
});
it('still emits the insertion event when stored JSON is malformed', () => {
  stored = '{bad';
  expect(() => recordCatalogUse('core.service')).not.toThrow();
  expect(setItem).not.toHaveBeenCalled();
  expect(events[0]).toMatchObject({
    type: 'swiftbuild:component-added',
    detail: 'core.service',
  });
});
it('still emits the insertion event when a preference write fails', () => {
  setItem.mockImplementationOnce(() => {
    throw new Error('quota exceeded');
  });
  expect(() => recordCatalogUse('core.queue')).not.toThrow();
  expect(stored).toBeNull();
  expect(events[0]).toMatchObject({
    type: 'swiftbuild:component-added',
    detail: 'core.queue',
  });
});
