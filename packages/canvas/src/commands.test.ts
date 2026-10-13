import { describe, expect, it } from 'vitest';
import { matchingCommands, type WorkbenchCommand } from './commands';
const command = (
  id: string,
  name: string,
  group: WorkbenchCommand['group'] = 'Actions',
): WorkbenchCommand => ({ id, name, group, run: () => {} });
describe('command discovery', () => {
  it('prioritizes exact, prefix, substring and group order without changing input', () => {
    const commands = [
      command('object', 'Object: Undo', 'Objects'),
      command('long', 'Undo selection'),
      command('exact', 'Undo', 'Components'),
    ];
    expect(matchingCommands(commands, ' UNDO ').map((c) => c.id)).toEqual([
      'exact',
      'long',
      'object',
    ]);
    expect(matchingCommands(commands, '').map((c) => c.id)).toEqual([
      'long',
      'exact',
      'object',
    ]);
    expect(commands.map((c) => c.id)).toEqual(['object', 'long', 'exact']);
  });
  it('retains duplicate names, searches their identities and returns no matches safely', () => {
    const commands = [
      {
        ...command('first', 'Add Load balancer', 'Components'),
        detail: 'generic.load-balancer',
      },
      {
        ...command('second', 'Add Load balancer', 'Components'),
        detail: 'core.load-balancer',
      },
    ];
    expect(
      matchingCommands(commands, 'Add Load balancer').map((c) => c.id),
    ).toEqual(['first', 'second']);
    expect(
      matchingCommands(commands, 'core.load-balancer').map((c) => c.id),
    ).toEqual(['second']);
    expect(matchingCommands(commands, 'missing')).toEqual([]);
  });
});
