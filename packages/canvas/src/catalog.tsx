'use client';
import { useState, type RefObject } from 'react';
import {
  Search,
  ChevronRight,
  ChevronDown,
  SlidersHorizontal,
  Shapes,
  Plus,
  Network,
  Layers,
  LayoutTemplate,
  Command,
  ArrowUpRight,
} from 'lucide-react';
import type { ComponentDefinition } from '@swiftbuild/architecture-schema';
import { icons, useEditor } from './graph';
const groups = [
  { id: 'client', label: 'Clients & interfaces' },
  { id: 'compute', label: 'Compute & services' },
  { id: 'database', label: 'Databases & storage' },
  { id: 'cache', label: 'Caching' },
  { id: 'messaging', label: 'Messaging' },
  { id: 'boundary', label: 'Boundaries' },
] as const;
export function CatalogSidebar({
  definitions,
  onAdd,
  onBrowse,
  onCustom,
  onTemplates,
  onUtilities,
  inputRef,
}: {
  definitions: ComponentDefinition[];
  onAdd: (component: ComponentDefinition) => void;
  onBrowse: () => void;
  onCustom: () => void;
  onTemplates: () => void;
  onUtilities: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const filtered = definitions.filter((c) =>
    `${c.name} ${c.category} ${c.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <aside className="catalog-sidebar" aria-label="Component catalog">
      <div className="catalog-search">
        <Search size={19} />
        <input
          ref={inputRef}
          aria-label="Search component catalog"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd>/</kbd>
      </div>
      <div className="catalog-heading">
        <h2>Components</h2>
        <button
          className="catalog-filter"
          aria-label="Browse all components"
          onClick={onBrowse}
        >
          <SlidersHorizontal size={16} />
        </button>
      </div>
      <div className="catalog-content">
        {groups
          .filter(
            (group) =>
              !query ||
              filtered.some((c) => c.category === group.id) ||
              group.label.toLowerCase().includes(query.toLowerCase()),
          )
          .map((group) => {
            const Icon = icons[group.id];
            const open = query !== '' || expanded.includes(group.id);
            const children = (query ? filtered : definitions).filter(
              (c) => c.category === group.id,
            );
            return (
              <div className="catalog-group" key={group.id}>
                <button
                  className="catalog-category"
                  aria-expanded={open}
                  onClick={() =>
                    setExpanded((list) =>
                      list.includes(group.id)
                        ? list.filter((id) => id !== group.id)
                        : [...list, group.id],
                    )
                  }
                >
                  <Icon size={18} strokeWidth={1.65} />
                  <span>{group.label}</span>
                  {open ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                </button>
                {open && (
                  <div className="catalog-children">
                    {children.map((component) => (
                      <button
                        key={component.id}
                        className="catalog-component"
                        onClick={() => onAdd(component)}
                        aria-label={`Add ${component.name}`}
                      >
                        <span>
                          <strong>{component.name}</strong>
                          <small>{component.description}</small>
                        </span>
                        <Plus size={15} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        {!query && (
          <>
            <button className="catalog-category" onClick={onTemplates}>
              <LayoutTemplate size={18} strokeWidth={1.65} />
              <span>Architecture templates</span>
              <ChevronRight size={16} />
            </button>
            <button className="catalog-category" onClick={onUtilities}>
              <Command size={18} strokeWidth={1.65} />
              <span>Utilities</span>
              <ChevronRight size={16} />
            </button>
          </>
        )}
        {query && !filtered.length && (
          <p className="catalog-no-results">
            No components found. Try a different search.
          </p>
        )}
        <button
          className="catalog-discover"
          aria-label="Add component A"
          onClick={onBrowse}
        >
          <Shapes size={17} />
          <span>Browse all components</span>
          <ArrowUpRight size={14} />
        </button>
      </div>
      <button className="catalog-create" onClick={onCustom}>
        <Plus size={18} />
        <span>New custom component</span>
      </button>
    </aside>
  );
}
export function ObjectSidebar({ onInspect }: { onInspect: () => void }) {
  const document = useEditor((s) => s.history.present);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  const [query, setQuery] = useState('');
  return (
    <aside
      className="catalog-sidebar objects-sidebar"
      aria-label="Architecture objects"
    >
      <div className="catalog-search">
        <Search size={18} />
        <input
          aria-label="Search objects"
          placeholder="Search objects"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="catalog-heading">
        <h2>Architecture objects</h2>
        <span>{document.nodes.length}</span>
      </div>
      <div id="object-list" className="object-list" tabIndex={-1}>
        {document.nodes
          .filter((n) => n.name.toLowerCase().includes(query.toLowerCase()))
          .map((node) => {
            const definition = document.components.find(
              (c) => c.id === node.componentId,
            )!;
            const Icon = icons[definition.category];
            return (
              <button
                key={node.id}
                className={`object-item ${selected.includes(node.id) ? 'active' : ''}`}
                onClick={() => {
                  select([node.id]);
                  onInspect();
                }}
              >
                <Icon size={17} />
                <span>{node.name}</span>
                <ChevronRight size={14} />
              </button>
            );
          })}
        {!document.nodes.length && (
          <div className="catalog-empty">
            <Layers size={26} />
            <strong>No components yet</strong>
            <p>Add a component from the catalog to start your architecture.</p>
          </div>
        )}
      </div>
      <div className="object-summary">
        <Network size={15} />
        {document.edges.length} semantic connections
      </div>
    </aside>
  );
}
