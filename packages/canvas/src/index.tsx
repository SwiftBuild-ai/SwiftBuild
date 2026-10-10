'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import {
  Braces,
  ChevronRight,
  Command,
  Copy,
  Download,
  Network,
  Moon,
  Plus,
  Search,
  ShieldCheck,
  Sun,
  Trash2,
  Undo2,
  Redo2,
  Upload,
  X,
  ArrowUpRight,
  ChevronDown,
  Bell,
  UserCircle,
  Shapes,
  Layers,
  LayoutTemplate,
  FileJson,
  Workflow,
  Check,
} from 'lucide-react';
import { Button, IconButton, Modal, ActionMenu } from '@swiftbuild/ui';
import { coreComponents, sampleDocument } from '@swiftbuild/components-core';
import { graphIssues } from '@swiftbuild/graph-engine';
import {
  serializeDocument,
  type ArchitectureDocument,
  type ComponentDefinition,
} from '@swiftbuild/architecture-schema';
import { createEditorStore } from './store';
import { CatalogSidebar, ObjectSidebar } from './catalog';
import {
  StoreContext,
  useEditor,
  icons,
  GraphCanvas,
  Inspector,
} from './graph';
import {
  browserStorage,
  loadDraft,
  saveDraft,
  importDocument,
  MAX_IMPORT_BYTES,
  DRAFT_KEY,
} from './storage';
function Editor() {
  const document = useEditor((s) => s.history.present);
  const selected = useEditor((s) => s.selected);
  const past = useEditor((s) => s.history.past.length);
  const future = useEditor((s) => s.history.future.length);
  const message = useEditor((s) => s.message);
  const select = useEditor((s) => s.select);
  const add = useEditor((s) => s.add);
  const replace = useEditor((s) => s.replace);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const remove = useEditor((s) => s.remove);
  const duplicate = useEditor((s) => s.duplicate);
  const blank = useEditor((s) => s.blank);
  const notify = useEditor((s) => s.notify);
  const apply = useEditor((s) => s.apply);
  const flow = useReactFlow();
  const [sidebar, setSidebar] = useState(true);
  const [inspector, setInspector] = useState(false);
  const [browser, setBrowser] = useState(false);
  const [palette, setPalette] = useState(false);
  const [validation, setValidation] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [engineering, setEngineering] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  const [query, setQuery] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [locked, setLocked] = useState(false);
  const [status, setStatus] = useState('Loading draft');
  const [pendingImport, setPendingImport] =
    useState<ArchitectureDocument | null>(null);
  const [panel, setPanel] = useState<'components' | 'objects'>('components');
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [custom, setCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customBase, setCustomBase] = useState('core.service');
  const [customError, setCustomError] = useState('');
  const [activity, setActivity] = useState(false);
  const [events, setEvents] = useState<{ time: string; message: string }[]>([]);
  const catalogSearch = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setSidebar(window.innerWidth > 760);
    const result = loadDraft(browserStorage());
    if (result.status === 'loaded') {
      replace(result.document);
      setStatus('Saved locally');
    } else if (result.status === 'error') {
      setLocked(true);
      setStatus('Draft recovery needed');
      notify(`Your stored draft was left untouched. ${result.message}`);
    } else setStatus('Ready to save');
    setHydrated(true);
  }, [replace, notify]);
  useEffect(() => {
    if (!hydrated || locked) return;
    setStatus('Saving…');
    const timer = setTimeout(() => {
      try {
        saveDraft(browserStorage(), document);
        setStatus('Saved locally');
        setEvents((previous) => [
          ...previous.slice(-19),
          {
            time: new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
            message: `Saved draft · ${document.nodes.length} components · ${document.edges.length} connections`,
          },
        ]);
      } catch (error) {
        setStatus('Save failed');
        notify(
          `Autosave failed. Export JSON to preserve your work. ${error instanceof Error ? error.message : ''}`,
        );
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [document, hydrated, locked, notify]);
  useEffect(() => {
    window.document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]'))
        return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuery('');
        setPalette((v) => !v);
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        setSidebar(true);
        setPanel('components');
        setTimeout(() => catalogSearch.current?.focus(), 0);
        return;
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebar((v) => !v);
        return;
      }
      if (
        browser ||
        palette ||
        newProject ||
        pendingImport ||
        validation ||
        settings ||
        help ||
        templates ||
        custom
      )
        return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        remove();
      } else if (e.key.toLowerCase() === 'a' && !mod) {
        setQuery('');
        setBrowser(true);
      } else if (e.key.toLowerCase() === 'f' && !mod)
        flow.fitView({ padding: 0.2 });
      else if (e.key === 'Escape') {
        select([]);
        setInspector(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    undo,
    redo,
    remove,
    duplicate,
    select,
    flow,
    browser,
    palette,
    newProject,
    pendingImport,
    validation,
    settings,
    help,
    templates,
    custom,
  ]);
  const download = (text: string, filename: string) => {
    const url = URL.createObjectURL(
      new Blob([text], { type: 'application/json' }),
    );
    const a = window.document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportJSON = () =>
    download(
      serializeDocument(document),
      `${document.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'architecture'}.swiftbuild.json`,
    );
  const importJSON = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES)
        throw new Error('Choose a JSON file no larger than 5 MB.');
      setPendingImport(importDocument(await file.text(), file.size));
      notify('');
    } catch (error) {
      notify(
        `Import rejected. ${error instanceof Error ? error.message : 'Invalid architecture.'}`,
      );
    }
  };
  const addComponent = (definition: ComponentDefinition) => {
    const center = flow.screenToFlowPosition({
      x: (window.innerWidth + (sidebar ? 320 : 42)) / 2,
      y: window.innerHeight / 2,
    });
    add(definition, {
      x: center.x - 120 + (document.nodes.length % 4) * 28,
      y: center.y - 70 + (document.nodes.length % 4) * 28,
      ...(definition.category === 'boundary'
        ? { width: 560, height: 360 }
        : {}),
    });
    setBrowser(false);
    setInspector(true);
  };
  const filtered = coreComponents.filter((c) =>
    `${c.name} ${c.category} ${c.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const issues = graphIssues(document);
  const commands = [
    {
      name: 'Add component',
      hint: 'A',
      run: () => {
        setQuery('');
        setBrowser(true);
      },
    },
    {
      name: 'Fit architecture',
      hint: 'F',
      run: () => flow.fitView({ padding: 0.2 }),
    },
    { name: 'Undo', hint: 'Ctrl Z', run: undo },
    { name: 'Redo', hint: 'Ctrl Shift Z', run: redo },
    { name: 'Duplicate selection', hint: 'Ctrl D', run: duplicate },
    { name: 'Delete selection', hint: 'Delete', run: remove },
    { name: 'Export JSON', hint: '', run: exportJSON },
    { name: 'Import JSON', hint: '', run: () => fileInput.current?.click() },
    { name: 'New architecture', hint: '', run: () => setNewProject(true) },
    {
      name: 'Toggle theme',
      hint: '',
      run: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    },
    { name: 'Check model integrity', hint: '', run: () => setValidation(true) },
  ];
  return (
    <div className="workbench">
      <a
        className="skip-link"
        href="#object-list"
        onClick={() => {
          setSidebar(true);
          setPanel('objects');
        }}
      >
        Skip to architecture objects
      </a>
      <header className="editor-header">
        <button
          className="editor-brand"
          aria-label="SwiftBuild workspace"
          onClick={() => setNewProject(true)}
        >
          <Network size={24} strokeWidth={2} />
        </button>
        <div className="editor-breadcrumb">
          <input
            className="breadcrumb-project"
            aria-label="Project name"
            key={document.project.name}
            defaultValue={document.project.name}
            maxLength={120}
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (value)
                apply((d) => {
                  d.project.name = value;
                });
              else e.target.value = document.project.name;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <span className="breadcrumb-slash">/</span>
          <span className="breadcrumb-icon">
            <Workflow size={17} />
          </span>
          <input
            className="breadcrumb-architecture"
            aria-label="Architecture name"
            key={document.architecture.name}
            defaultValue={document.architecture.name}
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (value)
                apply((d) => {
                  d.architecture.name = value;
                });
              else e.target.value = document.architecture.name;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </div>
        <div className="editor-header-right">
          <span className="header-stat" title="Architecture components">
            <Shapes size={16} />
            <span>
              {document.nodes.length}
              <span className="stat-unit"> components</span>
            </span>
          </span>
          <span className="header-stat" title="Semantic connections">
            <Workflow size={16} />
            <span>
              {document.edges.length}
              <span className="stat-unit"> connections</span>
            </span>
          </span>
          <IconButton label="Activity" onClick={() => setActivity((v) => !v)}>
            <Bell size={19} />
          </IconButton>
          <span className="header-divider" />
          <IconButton
            label="Workspace settings"
            onClick={() => setSettings(true)}
          >
            <UserCircle size={26} strokeWidth={1.4} />
          </IconButton>
        </div>
      </header>
      <div className="editor-body">
        <nav className="tool-rail" aria-label="Editor tools">
          <IconButton
            label="Search components"
            onClick={() => {
              setSidebar(true);
              setPanel('components');
              setTimeout(() => catalogSearch.current?.focus(), 0);
            }}
          >
            <Search size={19} />
          </IconButton>
          <IconButton
            label={
              sidebar && panel === 'components'
                ? 'Hide component catalog'
                : 'Show component catalog'
            }
            aria-pressed={sidebar && panel === 'components'}
            onClick={() => {
              if (sidebar && panel === 'components') setSidebar(false);
              else {
                setSidebar(true);
                setPanel('components');
              }
            }}
          >
            <Shapes size={19} />
          </IconButton>
          <IconButton
            label="Architecture objects"
            aria-pressed={sidebar && panel === 'objects'}
            onClick={() => {
              setSidebar(true);
              setPanel('objects');
            }}
          >
            <Layers size={19} />
          </IconButton>
          <IconButton
            label="Architecture templates"
            onClick={() => setTemplates(true)}
          >
            <LayoutTemplate size={18} />
          </IconButton>
          <span className="rail-divider" />
          <IconButton
            label="Import architecture"
            onClick={() => fileInput.current?.click()}
          >
            <FileJson size={18} />
          </IconButton>
          <div className="rail-spacer" />
          <IconButton
            label="Command palette"
            onClick={() => {
              setQuery('');
              setPalette(true);
            }}
          >
            <Command size={18} />
          </IconButton>
        </nav>
        {sidebar &&
          (panel === 'components' ? (
            <CatalogSidebar
              definitions={[
                ...new Map(
                  [...coreComponents, ...document.components].map((c) => [
                    c.id,
                    c,
                  ]),
                ).values(),
              ]}
              onAdd={addComponent}
              onBrowse={() => {
                setQuery('');
                setBrowser(true);
              }}
              onCustom={() => {
                setCustomName('');
                setCustomError('');
                setCustom(true);
              }}
              onTemplates={() => setTemplates(true)}
              onUtilities={() => {
                setQuery('');
                setPalette(true);
              }}
              inputRef={catalogSearch}
            />
          ) : (
            <ObjectSidebar onInspect={() => setInspector(true)} />
          ))}
        <main className="canvas-main" aria-label="System architecture">
          <GraphCanvas
            engineering={engineering}
            onInspector={() => setInspector(true)}
            onHelp={() => setHelp(true)}
          />
          <div className="editor-floating-actions">
            <Button
              className="validate-action"
              onClick={() => setValidation(true)}
            >
              <ShieldCheck size={17} />
              Validate
            </Button>
            <ActionMenu
              label="Export actions"
              trigger={
                <Button
                  className="export-action"
                  variant="primary"
                  aria-label="Export architecture"
                >
                  Export
                  <ChevronDown size={16} />
                </Button>
              }
              items={[
                {
                  label: 'Export JSON',
                  icon: <Download size={16} />,
                  onSelect: exportJSON,
                },
                {
                  label: 'Copy architecture JSON',
                  icon: <Copy size={16} />,
                  onSelect: () => {
                    navigator.clipboard
                      .writeText(serializeDocument(document))
                      .then(() => notify('Architecture JSON copied.'))
                      .catch(() =>
                        notify(
                          'Clipboard unavailable. Use Export JSON to download a copy.',
                        ),
                      );
                  },
                },
                {
                  label: 'Import JSON',
                  icon: <Upload size={16} />,
                  onSelect: () => fileInput.current?.click(),
                },
                {
                  label: 'New architecture',
                  icon: <Plus size={16} />,
                  onSelect: () => setNewProject(true),
                },
              ]}
            />
          </div>
          <div className="editor-bottom-left">
            <Button
              className="logs-trigger"
              aria-label="Logs"
              aria-expanded={activity}
              onClick={() => setActivity((v) => !v)}
            >
              {activity ? (
                <ChevronDown size={17} />
              ) : (
                <ChevronRight size={17} />
              )}
              Logs
              {status !== 'Saved locally' && status !== 'Loading draft' && (
                <span className="activity-save-state">{status}</span>
              )}
            </Button>
            {(past > 0 || future > 0) && (
              <div className="history-controls">
                <IconButton label="Undo" disabled={!past} onClick={undo}>
                  <Undo2 size={17} />
                </IconButton>
                <IconButton label="Redo" disabled={!future} onClick={redo}>
                  <Redo2 size={17} />
                </IconButton>
              </div>
            )}
          </div>
          {activity && (
            <section className="activity-panel" aria-label="Activity log">
              <div className="panel-heading">
                <h2>Activity</h2>
                <IconButton
                  label="Close activity"
                  onClick={() => setActivity(false)}
                >
                  <X size={16} />
                </IconButton>
              </div>
              <div className="activity-summary">
                <Check size={14} />
                <span>{status}</span>
                <span className="activity-schema">
                  Schema {document.schemaVersion}
                </span>
              </div>
              <div className="activity-events">
                {events.length ? (
                  events.map((event, i) => (
                    <div className="activity-event" key={i}>
                      <time>{event.time}</time>
                      <span>{event.message}</span>
                    </div>
                  ))
                ) : (
                  <p>
                    Your architecture changes will appear here as the draft is
                    saved.
                  </p>
                )}
              </div>
            </section>
          )}
          {selected.length > 0 && (
            <div className="selection-actions">
              <span>{selected.length} selected</span>
              <IconButton label="Duplicate selection" onClick={duplicate}>
                <Copy size={14} />
              </IconButton>
              <IconButton label="Delete selection" onClick={remove}>
                <Trash2 size={14} />
              </IconButton>
              <IconButton
                label="Inspect selection"
                onClick={() => setInspector(true)}
              >
                <Braces size={14} />
              </IconButton>
            </div>
          )}
        </main>
        {inspector && (
          <Inspector
            onClose={() => setInspector(false)}
            engineering={engineering}
          />
        )}
      </div>
      {message && (
        <div
          className={`notification ${locked ? 'recovery-notification' : ''}`}
          role="alert"
        >
          <span>{message}</span>
          <IconButton label="Dismiss notification" onClick={() => notify('')}>
            <X size={14} />
          </IconButton>
        </div>
      )}
      {locked && (
        <div className="recovery-bar" role="alert">
          <strong>Stored draft needs recovery.</strong>
          <Button
            onClick={() => {
              try {
                const raw = localStorage.getItem(DRAFT_KEY);
                if (raw) download(raw, 'swiftbuild-recovery.json');
              } catch {
                notify('Browser storage is unavailable.');
              }
            }}
          >
            Download stored draft
          </Button>
          <Button onClick={() => setNewProject(true)}>
            Replace with a new draft
          </Button>
        </div>
      )}
      <footer className="statusbar sr-only">
        <button onClick={() => setValidation(true)}>
          <ShieldCheck size={13} />
          {issues.length
            ? `${issues.length} model issues`
            : 'Model integrity verified'}
        </button>
        <span className="status-separator" />
        <span className="mono">schema {document.schemaVersion}</span>
        <div className="statusbar-right" aria-live="polite">
          <span
            className={`save-dot ${status === 'Save failed' || locked ? 'warning' : ''}`}
          />
          <span role="status">{status}</span>
          <span className="status-separator" />
          <span>Local workspace</span>
        </div>
      </footer>
      <input
        type="file"
        accept="application/json,.json"
        aria-label="Import architecture JSON"
        className="file-input"
        ref={fileInput}
        onChange={importJSON}
      />
      <Modal
        open={settings}
        onOpenChange={setSettings}
        title="Workspace settings"
        description="Make this workbench feel like your own."
      >
        <div className="settings-section">
          <h3>Appearance</h3>
          <p>Choose a light or dark workspace.</p>
          <Button
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            aria-label={
              theme === 'light'
                ? 'Switch to dark theme'
                : 'Switch to light theme'
            }
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}Use{' '}
            {theme === 'light' ? 'dark' : 'light'} theme
          </Button>
        </div>
        <div className="settings-section">
          <h3>Architecture detail</h3>
          <p>
            Design mode keeps the canvas clear. Engineering mode shows
            capabilities.
          </p>
          <div className="mode-switch" aria-label="Display mode">
            <button
              aria-pressed={!engineering}
              className={!engineering ? 'active' : ''}
              onClick={() => setEngineering(false)}
            >
              Design
            </button>
            <button
              aria-pressed={engineering}
              className={engineering ? 'active' : ''}
              onClick={() => setEngineering(true)}
            >
              Engineering
            </button>
          </div>
        </div>
        <div className="settings-section">
          <h3>Local workspace</h3>
          <p>
            Your draft stays in this browser. Export JSON to keep a portable
            backup.
          </p>
          <Button onClick={exportJSON}>
            <Download size={15} />
            Export JSON
          </Button>
        </div>
      </Modal>
      <Modal
        open={help}
        onOpenChange={setHelp}
        title="Make room for your architecture"
        description="Browse components, connect compatible ports, and inspect any object to configure it."
      >
        <div className="shortcut-list">
          {[
            ['Search components', '/'],
            ['Quick-add component', 'A'],
            ['Command palette', 'Ctrl / Cmd K'],
            ['Toggle sidebar', 'Ctrl / Cmd B'],
            ['Fit architecture', 'F'],
            ['Undo', 'Ctrl / Cmd Z'],
            ['Duplicate selection', 'Ctrl / Cmd D'],
            ['Delete selection', 'Delete'],
            ['Multi-select', 'Shift + click'],
          ].map(([label, key]) => (
            <div key={label}>
              <span>{label}</span>
              <kbd>{key}</kbd>
            </div>
          ))}
        </div>
      </Modal>
      <Modal
        open={templates}
        onOpenChange={setTemplates}
        title="Architecture templates"
        description="Start with a meaningful system, then make it yours."
      >
        <div className="template-preview">
          <Network size={30} />
          <h3>Commerce platform</h3>
          <p>
            A web client, stateless API, session cache, and durable database.
            Includes compatible semantic connections and editable configuration.
          </p>
          <span>4 components · 3 connections</span>
        </div>
        <p className="template-warning">
          Using this template replaces your current browser draft. Export a copy
          first to keep it.
        </p>
        <div className="confirm-actions">
          <Button onClick={exportJSON}>Export current architecture</Button>
          <Button
            variant="primary"
            onClick={() => {
              replace(sampleDocument());
              setLocked(false);
              setTemplates(false);
              setInspector(false);
              setTimeout(() => flow.fitView({ padding: 0.2 }), 100);
            }}
          >
            Use template
          </Button>
        </div>
      </Modal>
      <Modal
        open={custom}
        onOpenChange={setCustom}
        title="Create a custom component"
        description="Start from a semantic primitive and give it a purpose in your system."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = customName.trim();
            if (!name) {
              setCustomError('Give your component a name.');
              return;
            }
            const base = coreComponents.find((c) => c.id === customBase)!;
            const definition = {
              ...structuredClone(base),
              id: `custom.${crypto.randomUUID()}`,
              name,
              description: `${name}. Based on the ${base.name.toLowerCase()} primitive.`,
              tags: [...base.tags, 'custom'],
            };
            addComponent(definition);
            setCustom(false);
          }}
        >
          <label className="field">
            Component name
            <input
              aria-label="Custom component name"
              autoFocus
              value={customName}
              maxLength={120}
              placeholder="e.g. Payment service"
              onChange={(e) => setCustomName(e.target.value)}
            />
          </label>
          <label className="field">
            Base primitive
            <select
              aria-label="Base primitive"
              value={customBase}
              onChange={(e) => setCustomBase(e.target.value)}
            >
              {coreComponents.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {customError && (
            <p className="field-error" role="alert">
              {customError}
            </p>
          )}
          <p className="custom-note">
            Configuration, capabilities, and semantic ports are inherited from
            the base primitive. The definition travels with your exported
            architecture.
          </p>
          <div className="confirm-actions">
            <Button variant="primary" type="submit">
              <Plus size={16} />
              Create component
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={browser}
        onOpenChange={setBrowser}
        title="Build your architecture"
        description="Every component adds meaning to your system."
      >
        <div className="dialog-search">
          <Search size={18} />
          <input
            autoFocus
            placeholder="Search components…"
            aria-label="Search components"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="component-browser">
          {filtered.map((c) => {
            const Icon = icons[c.category];
            return (
              <button
                key={c.id}
                className="component-option"
                onClick={() => addComponent(c)}
              >
                <div className={`category-icon ${c.category}`}>
                  <Icon size={22} />
                </div>
                <div>
                  <strong>{c.name}</strong>
                  <p>{c.description}</p>
                </div>
                <Plus size={16} />
              </button>
            );
          })}
          {!filtered.length && (
            <p className="empty-list">No components match this search.</p>
          )}
        </div>
        <div className="dialog-footer">
          <span>6 generic primitives</span>
          <span>
            Declarative · versioned · extensible
            <ArrowUpRight size={12} />
          </span>
        </div>
      </Modal>
      <Modal
        open={palette}
        onOpenChange={setPalette}
        title="Command palette"
        description="Find an action or use its keyboard shortcut."
      >
        <div className="dialog-search">
          <Search size={17} />
          <input
            autoFocus
            aria-label="Search commands"
            placeholder="What would you like to do?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="command-list">
          {commands
            .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
            .map((c) => (
              <button
                key={c.name}
                onClick={() => {
                  setPalette(false);
                  c.run();
                }}
              >
                <span>{c.name}</span>
                <kbd>{c.hint}</kbd>
              </button>
            ))}
        </div>
      </Modal>
      <Modal
        open={validation}
        onOpenChange={setValidation}
        title="Model integrity"
        description="Checks document structure and semantic connections. Engineering policy rules are a future milestone."
      >
        <div className="validation-result">
          <ShieldCheck size={32} />
          <h3>
            {issues.length
              ? 'The model needs attention'
              : 'Your model is structurally valid'}
          </h3>
          <p>
            {document.nodes.length} components · {document.edges.length}{' '}
            connections · schema {document.schemaVersion}
          </p>
          {issues.length ? (
            issues.map((issue, i) => (
              <p key={i} role="alert">
                {issue.path}: {issue.message}
              </p>
            ))
          ) : (
            <ul>
              <li>All component configurations are valid</li>
              <li>Connections use compatible semantic ports</li>
              <li>Identifiers and references are consistent</li>
            </ul>
          )}
        </div>
      </Modal>
      <Modal
        open={newProject}
        onOpenChange={setNewProject}
        title="Start a new architecture?"
        description="This replaces the current browser draft. Export JSON first if you want to keep a copy."
      >
        <div className="confirm-actions">
          <Button onClick={exportJSON}>
            <Download size={14} />
            Export current architecture
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              blank();
              setLocked(false);
              setNewProject(false);
              setInspector(false);
              flow.setViewport({ x: 0, y: 0, zoom: 0.92 });
            }}
          >
            Start new architecture
          </Button>
        </div>
      </Modal>
      <Modal
        open={pendingImport !== null}
        onOpenChange={(open) => {
          if (!open) setPendingImport(null);
        }}
        title="Import architecture?"
        description="The file is valid. Importing replaces your current browser draft and clears undo history."
      >
        <p className="import-summary">
          {pendingImport?.project.name} · {pendingImport?.nodes.length}{' '}
          components
        </p>
        <div className="confirm-actions">
          <Button onClick={exportJSON}>Export current architecture</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (pendingImport) {
                replace(pendingImport);
                setLocked(false);
                setPendingImport(null);
                setInspector(false);
                setTimeout(() => flow.fitView({ padding: 0.2 }), 100);
              }
            }}
          >
            Import and replace draft
          </Button>
        </div>
      </Modal>
    </div>
  );
}
export function Workbench() {
  const [store] = useState(createEditorStore);
  return (
    <StoreContext.Provider value={store}>
      <ReactFlowProvider>
        <Editor />
      </ReactFlowProvider>
    </StoreContext.Provider>
  );
}
