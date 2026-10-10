import { describe, it, expect } from 'vitest';
import {
  parseDocument,
  serializeDocument,
  migrateDocument,
  configurationErrors,
  ComponentDefinitionSchema,
} from './index';
const fixture = {
  schemaVersion: '1.0',
  project: { id: 'project', name: 'Test', description: '' },
  architecture: { id: 'architecture', name: 'Main', description: '' },
  components: [],
  nodes: [],
  edges: [],
  views: [{ id: 'view', name: 'System', nodeIds: [], layout: {} }],
  metadata: { extension: { safe: true } },
};
describe('native architecture contract', () => {
  it('round-trips safe metadata and default collections', () => {
    const doc = parseDocument(fixture);
    expect(parseDocument(JSON.parse(serializeDocument(doc)))).toEqual(doc);
    expect(doc.metadata).toEqual(fixture.metadata);
  });
  it('rejects unsupported versions without changing input', () => {
    const input = { ...fixture, schemaVersion: '2.0' };
    const original = JSON.stringify(input);
    expect(() => migrateDocument(input)).toThrow('Unsupported');
    expect(JSON.stringify(input)).toBe(original);
  });
  it('rejects missing IDs and invalid layouts', () => {
    expect(() =>
      parseDocument({ ...fixture, project: { ...fixture.project, id: '' } }),
    ).toThrow();
    expect(() =>
      parseDocument({
        ...fixture,
        views: [
          {
            id: 'v',
            name: 'x',
            nodeIds: [],
            layout: { n: { x: Infinity, y: 0 } },
          },
        ],
      }),
    ).toThrow();
  });
  it('validates configuration ranges and choices', () => {
    const def = ComponentDefinitionSchema.parse({
      id: 'db',
      name: 'Database',
      description: '',
      category: 'database',
      version: '1.0.0',
      schemaVersion: '1.0',
      capabilities: [],
      configurationSchema: [
        {
          key: 'replicas',
          label: 'Replicas',
          type: 'number',
          default: 1,
          min: 1,
        },
        {
          key: 'mode',
          label: 'Mode',
          type: 'select',
          default: 'strong',
          options: ['strong'],
        },
      ],
      ports: [],
      constraints: [],
      documentation: '',
      icon: 'database',
      tags: [],
    });
    expect(
      configurationErrors(def, { replicas: 0, mode: 'other' }),
    ).toHaveLength(2);
    expect(configurationErrors(def, { replicas: 2, mode: 'strong' })).toEqual(
      [],
    );
  });
});
