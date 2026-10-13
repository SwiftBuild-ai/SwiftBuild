export const commandGroups = [
  'Actions',
  'Components',
  'Objects',
  'Engineering records',
] as const;
export type CommandGroup = (typeof commandGroups)[number];
export type WorkbenchCommand = {
  id: string;
  name: string;
  group: CommandGroup;
  hint?: string;
  detail?: string;
  run: () => void;
};

export function matchingCommands(commands: WorkbenchCommand[], query: string) {
  const search = query.trim().toLowerCase();
  const rank = (command: WorkbenchCommand) => {
    const name = command.name.toLowerCase();
    if (!search || name === search) return 0;
    if (name.startsWith(search)) return 1;
    if (name.includes(search) || command.detail?.toLowerCase().includes(search))
      return 2;
    return -1;
  };
  return commands
    .map((command, index) => ({ command, index, rank: rank(command) }))
    .filter((item) => item.rank >= 0)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        commandGroups.indexOf(a.command.group) -
          commandGroups.indexOf(b.command.group) ||
        a.index - b.index,
    )
    .map((item) => item.command);
}
