'use client';
import { useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Modal } from '@swiftbuild/ui';
import { matchingCommands, type WorkbenchCommand } from './commands';

export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: WorkbenchCommand[];
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Find an action or use its keyboard shortcut."
      initialFocusRef={input}
    >
      {open && (
        <PaletteResults
          commands={commands}
          input={input}
          run={(command) => {
            onOpenChange(false);
            command.run();
          }}
        />
      )}
    </Modal>
  );
}

function PaletteResults({
  commands,
  input,
  run,
}: {
  commands: WorkbenchCommand[];
  input: React.RefObject<HTMLInputElement | null>;
  run: (command: WorkbenchCommand) => void;
}) {
  const prefix = useId();
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const results = useMemo(
    () => matchingCommands(commands, query),
    [commands, query],
  );
  const active = results.findIndex((command) => command.id === activeId);
  const optionId = (command: WorkbenchCommand) =>
    `${prefix}-${encodeURIComponent(command.id)}`;
  const move = (direction: number) => {
    if (!results.length) return;
    const next =
      active < 0
        ? direction > 0
          ? 0
          : results.length - 1
        : (active + direction + results.length) % results.length;
    const command = results[next]!;
    setActiveId(command.id);
    document
      .getElementById(optionId(command))
      ?.scrollIntoView({ block: 'nearest' });
  };
  return (
    <>
      <div className="dialog-search">
        <Search size={17} />
        <input
          ref={input}
          role="combobox"
          aria-label="Search commands"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={`${prefix}-results`}
          aria-activedescendant={
            active >= 0 ? optionId(results[active]!) : undefined
          }
          placeholder="What would you like to do?"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveId(null);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              move(event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'Enter' && active >= 0) {
              event.preventDefault();
              run(results[active]!);
            }
          }}
        />
      </div>
      <div
        className="command-list"
        role="listbox"
        aria-label="Commands"
        id={`${prefix}-results`}
      >
        {results.map((command, index) => (
          <div key={command.id} role="presentation">
            {(index === 0 || results[index - 1]!.group !== command.group) && (
              <h3 className="command-group" role="presentation">
                {command.group}
              </h3>
            )}
            <button
              type="button"
              role="option"
              tabIndex={-1}
              id={optionId(command)}
              aria-selected={index === active}
              onFocus={() => setActiveId(command.id)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run(command)}
            >
              <span>
                {command.name}
                {command.detail && <small>{command.detail}</small>}
              </span>
              {command.hint && <kbd>{command.hint}</kbd>}
            </button>
          </div>
        ))}
      </div>
      {!results.length && (
        <p className="empty-list" role="status">
          No commands match “{query}”. Try another search.
        </p>
      )}
    </>
  );
}
