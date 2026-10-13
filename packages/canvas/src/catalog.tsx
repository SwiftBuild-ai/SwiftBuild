'use client';
import { useEffect, useState, useMemo, memo, type RefObject } from 'react';
import {
  Search,
  ChevronRight,
  ChevronDown,
  Shapes,
  Plus,
  Network,
  Layers,
  LayoutTemplate,
  Command,
  Info,
  Star,
  Upload,
  X,
} from 'lucide-react';
import { TechnologyIcon } from '@swiftbuild/ui';
import type { ComponentDefinition } from '@swiftbuild/architecture-schema';
import {
  catalogCategories,
  categoryOf,
  searchComponents,
} from '@swiftbuild/component-registry';
import { useEditor } from './editor-context';
export function CatalogSidebar({
  definitions,
  onAdd,
  onBrowse,
  onCustom,
  onTemplates,
  onUtilities,
  onDetails,
  onPack,
  inputRef,
  onDismiss,
}: {
  definitions: ComponentDefinition[];
  onAdd: (c: ComponentDefinition) => void;
  onBrowse: () => void;
  onCustom: () => void;
  onTemplates: () => void;
  onUtilities: () => void;
  onDetails: (c: ComponentDefinition) => void;
  onPack: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onDismiss: () => void;
}) {
  const [query, setQuery] = useState(''),
    [expanded, setExpanded] = useState<string[]>([]),
    [scope, setScope] = useState('all');
  const [favorites, setFavorites] = useState<string[]>([]),
    [recent, setRecent] = useState<string[]>([]),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = JSON.parse(
        localStorage.getItem('swiftbuild.catalog.preferences') ?? '{}',
      );
      if (Array.isArray(raw.favorites))
        setFavorites(
          raw.favorites.filter((v: unknown) => typeof v === 'string'),
        );
      if (Array.isArray(raw.recent))
        setRecent(raw.recent.filter((v: unknown) => typeof v === 'string'));
    } catch {
      /* Preferences are optional; the catalog remains usable in memory. */
    }
    setLoaded(true);
    const added = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id === 'string')
        setRecent((ids) => [id, ...ids.filter((v) => v !== id)].slice(0, 12));
    };
    window.addEventListener('swiftbuild:component-added', added);
    return () =>
      window.removeEventListener('swiftbuild:component-added', added);
  }, []);
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(
          'swiftbuild.catalog.preferences',
          JSON.stringify({ favorites, recent }),
        );
      } catch {
        /* Preferences are optional; the catalog remains usable in memory. */
      }
  }, [favorites, recent, loaded]);
  const filtered = searchComponents(definitions, query).filter(
    (c) =>
      scope === 'all' ||
      (scope === 'favorites' && favorites.includes(c.id)) ||
      (scope === 'recent' && recent.includes(c.id)) ||
      (scope === 'generic' &&
        (c.catalog?.identity.kind === 'generic' || !c.catalog)) ||
      (scope === 'technology' &&
        c.catalog?.identity.kind !== 'generic' &&
        !!c.catalog),
  );
  const insert = (c: ComponentDefinition) => {
    onAdd(c);
  };
  const row = (c: ComponentDefinition) => (
    <div className="registry-row" key={c.id}>
      <button
        className="catalog-component"
        aria-label={`Add ${c.name}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/swiftbuild-component', c.id);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => insert(c)}
      >
        <TechnologyIcon icon={c.icon} size={24} label={`${c.name} icon`} />
        <span>
          <strong>{c.name}</strong>
          <small>{c.description}</small>
        </span>
      </button>
      <div className="registry-row-actions">
        <button
          aria-label={`Details for ${c.name}`}
          onClick={() => onDetails(c)}
        >
          <Info size={14} />
        </button>
        <button
          aria-label={`Favorite ${c.name}`}
          aria-pressed={favorites.includes(c.id)}
          onClick={() =>
            setFavorites((ids) =>
              ids.includes(c.id)
                ? ids.filter((id) => id !== c.id)
                : [...ids, c.id],
            )
          }
        >
          <Star
            size={14}
            fill={favorites.includes(c.id) ? 'currentColor' : 'none'}
          />
        </button>
      </div>
    </div>
  );
  return (
    <aside
      className="catalog-sidebar"
      aria-label="Component catalog"
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          window.matchMedia('(max-width: 760px)').matches
        ) {
          event.stopPropagation();
          onDismiss();
        }
      }}
    >
      <button
        className="catalog-dismiss"
        aria-label="Dismiss component catalog"
        onClick={onDismiss}
      >
        <X size={16} /> Close catalog
      </button>
      <div className="catalog-search">
        <Search size={18} />
        <input
          ref={inputRef}
          aria-label="Search component catalog"
          placeholder="Search technologies"
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
          <Shapes size={16} />
        </button>
      </div>
      <div
        className="registry-filters"
        role="group"
        aria-label="Component library filters"
      >
        {[
          ['all', 'All'],
          ['technology', 'Technologies'],
          ['generic', 'Generic'],
          ['favorites', 'Favorites'],
          ['recent', 'Recent'],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={scope === id}
            onClick={() => setScope(id!)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="catalog-content">
        {catalogCategories
          .filter((g) => filtered.some((c) => categoryOf(c) === g.id))
          .map((g) => {
            const open =
              !!query ||
              scope === 'favorites' ||
              scope === 'recent' ||
              expanded.includes(g.id);
            const children = filtered.filter((c) => categoryOf(c) === g.id);
            return (
              <div className="catalog-group" key={g.id}>
                <button
                  className="catalog-category"
                  aria-expanded={open}
                  onClick={() =>
                    setExpanded((ids) =>
                      ids.includes(g.id)
                        ? ids.filter((id) => id !== g.id)
                        : [...ids, g.id],
                    )
                  }
                >
                  <Layers size={16} />
                  <span>{g.label}</span>
                  {open ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
                {open && (
                  <div className="catalog-children">
                    {scope === 'all' ? (
                      <>
                        {children.some(
                          (c) =>
                            c.catalog && c.catalog.identity.kind !== 'generic',
                        ) && (
                          <span className="registry-subheading">
                            Technologies
                          </span>
                        )}
                        {children
                          .filter(
                            (c) =>
                              c.catalog &&
                              c.catalog.identity.kind !== 'generic',
                          )
                          .map(row)}
                        {children.some(
                          (c) =>
                            !c.catalog || c.catalog.identity.kind === 'generic',
                        ) && (
                          <span className="registry-subheading">
                            Generic primitives
                          </span>
                        )}
                        {children
                          .filter(
                            (c) =>
                              !c.catalog ||
                              c.catalog.identity.kind === 'generic',
                          )
                          .map(row)}
                      </>
                    ) : (
                      children.map(row)
                    )}
                  </div>
                )}
              </div>
            );
          })}
        {!filtered.length && (
          <p className="catalog-no-results">
            No components found. Change the search or library filter.
          </p>
        )}
        {!query && (
          <>
            <button className="catalog-category" onClick={onTemplates}>
              <LayoutTemplate size={17} />
              <span>Architecture templates</span>
              <ChevronRight size={14} />
            </button>
            <button className="catalog-category" onClick={onUtilities}>
              <Command size={17} />
              <span>Utilities</span>
              <ChevronRight size={14} />
            </button>
          </>
        )}
        <button
          className="catalog-discover"
          aria-label="Add component A"
          onClick={onBrowse}
        >
          <Plus size={16} />
          Browse all components
        </button>
      </div>
      <button className="catalog-create" onClick={onPack}>
        <Upload size={16} />
        Import component pack
      </button>
      <button className="catalog-create" onClick={onCustom}>
        <Plus size={16} />
        New custom component
      </button>
    </aside>
  );
}
export const ObjectSidebar = memo(function ObjectSidebar({
  onInspect,
}: {
  onInspect: () => void;
}) {
  const document = useEditor((s) => s.history.present);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  const [query, setQuery] = useState('');
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const definitions = useMemo(
    () => new Map(document.components.map((c) => [c.id, c])),
    [document.components],
  );
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
            const definition = definitions.get(node.componentId)!;

            return (
              <button
                key={node.id}
                className={`object-item ${selectedIds.has(node.id) ? 'active' : ''}`}
                onClick={() => {
                  select([node.id]);
                  onInspect();
                }}
              >
                <TechnologyIcon icon={definition.icon} size={17} />
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
});
