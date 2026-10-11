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
  PanelsTopLeft,
} from 'lucide-react';
import {
  Button,
  IconButton,
  Modal,
  ActionMenu,
  TechnologyIcon,
} from '@swiftbuild/ui';
import {
  defaultComponents,
  searchComponents,
  loadPack,
  infrastructureSampleDocument,
} from '@swiftbuild/component-registry';
import {
  coreComponents,
  sampleDocument,
  engineeringSampleDocument,
} from '@swiftbuild/components-core';
import { graphIssues } from '@swiftbuild/graph-engine';
import {
  serializeDocument,
  type ArchitectureDocument,
  type ComponentDefinition,
} from '@swiftbuild/architecture-schema';
import { createEditorStore } from './store';
import { ConnectionDialog } from './connection-dialog';
import {
  EngineeringWorkbench,
  engineeringSections,
  type EngineeringSection,
} from './engineering-workbench';
import {
  IndexedWorkspace,
  loadWorkspace,
  readLegacyDraft,
  workspaceFor,
  serializeArchive,
  importArchive,
  MAX_ARCHIVE_BYTES,
  type ProjectArchive,
  type WorkspaceAdapter,
} from './workspace';
import { inputFingerprint } from '@swiftbuild/architecture-model';
import { evaluateArchitecture } from '@swiftbuild/rule-engine';
import {
  ENGINE_VERSION,
  type CapacityReport,
} from '@swiftbuild/capacity-engine';
import { CatalogSidebar, ObjectSidebar } from './catalog';
import { recordCatalogUse } from './catalog-preferences';
import { StoreContext, useEditor, GraphCanvas, Inspector } from './graph';
import { importDocument, MAX_IMPORT_BYTES, DRAFT_KEY } from './storage';
export type WorkbenchStorage = {
  createAdapter: () => WorkspaceAdapter;
  savedLabel: string;
  description: string;
};
export type WorkbenchProps = {
  initialArchive?: ProjectArchive;
  storage?: WorkbenchStorage;
};
function Editor({ initialArchive, storage }: WorkbenchProps) {
  const savedLabel = storage?.savedLabel ?? 'Saved locally';
  const activityLabel = storage ? savedLabel : 'Saved draft';
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
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [themeReady, setThemeReady] = useState(false);
  const [componentDetails, setComponentDetails] =
    useState<ComponentDefinition | null>(null);
  const packInput = useRef<HTMLInputElement>(null);
  const definitions = [
    ...new Map(
      [...defaultComponents, ...document.components].map((c) => [c.id, c]),
    ).values(),
  ];
  const [query, setQuery] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [locked, setLocked] = useState(false);
  const [status, setStatus] = useState('Loading draft');
  const saveGeneration = useRef(0);
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
  const [section, setSection] = useState<EngineeringSection | null>(null);
  const [connectionDialog, setConnectionDialog] = useState(false);
  const [workspace, setWorkspace] = useState<ProjectArchive>(
    () => initialArchive ?? workspaceFor(document),
  );
  const [currentReport, setCurrentReport] = useState<CapacityReport | null>(
    null,
  );
  const [overlay, setOverlay] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<ProjectArchive | null>(
    null,
  );
  const workspaceAdapter = useRef<WorkspaceAdapter | null>(null);
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve());
  const archiveInput = useRef<HTMLInputElement>(null);
  const [events, setEvents] = useState<{ time: string; message: string }[]>([]);
  const catalogSearch = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setSidebar(window.innerWidth > 760);
    let active = true;
    const hydrate = async () => {
      try {
        if (!workspaceAdapter.current)
          workspaceAdapter.current = storage
            ? storage.createAdapter()
            : new IndexedWorkspace();
      } catch (error) {
        setLocked(true);
        setStatus('Storage unavailable');
        notify(
          error instanceof Error ? error.message : 'IndexedDB unavailable.',
        );
        setHydrated(true);
        return;
      }
      const result = await loadWorkspace(
        workspaceAdapter.current,
        storage ? () => null : readLegacyDraft,
      );
      if (!active) return;
      if (result.status === 'loaded') {
        replace(result.archive.document);
        setWorkspace(result.archive);
        setCurrentReport(result.archive.runs.at(-1) ?? null);
        setStatus(savedLabel);
      } else if (result.status === 'error') {
        setLocked(true);
        setStatus('Draft recovery needed');
        notify(`Your stored draft was left untouched. ${result.message}`);
      } else setStatus('Ready to save');
      setHydrated(true);
    };
    void hydrate();
    return () => {
      active = false;
    };
  }, [replace, notify, storage, savedLabel]);
  useEffect(() => {
    if (!hydrated || locked) return;
    const generation = ++saveGeneration.current;
    setStatus('Saving…');
    const timer = setTimeout(() => {
      const archive = {
        ...workspace,
        document,
        exportedAt: new Date().toISOString(),
      };
      persistenceQueue.current = persistenceQueue.current
        .catch(() => {})
        .then(async () => {
          if (!workspaceAdapter.current)
            throw new Error('IndexedDB unavailable.');
          await workspaceAdapter.current.write(archive);
          if (generation === saveGeneration.current) setStatus(savedLabel);
          setEvents((previous) => [
            ...previous.slice(-19),
            {
              time: new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }),
              message: `${activityLabel} · ${document.nodes.length} components · ${document.edges.length} connections`,
            },
          ]);
        })
        .catch((error) => {
          if (generation === saveGeneration.current) {
            setStatus('Save failed');
            notify(
              `Autosave failed. Export JSON to preserve your work. ${error instanceof Error ? error.message : ''}`,
            );
          }
        });
    }, 450);
    return () => clearTimeout(timer);
  }, [
    document,
    workspace,
    hydrated,
    locked,
    notify,
    savedLabel,
    activityLabel,
  ]);
  useEffect(() => {
    setTheme(
      window.document.documentElement.dataset.theme === 'light'
        ? 'light'
        : 'dark',
    );
    setThemeReady(true);
  }, []);
  useEffect(() => {
    if (!themeReady) return;
    window.document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('swiftbuild.theme', theme);
    } catch {
      /* Theme remains usable in memory. */
    }
  }, [theme, themeReady]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]'))
        return;
      if (target.closest('[role="dialog"]')) return;
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
      if (
        !mod &&
        e.key.toLowerCase() === 'c' &&
        !palette &&
        !browser &&
        !section
      ) {
        e.preventDefault();
        setConnectionDialog(true);
        return;
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebar((v) => !v);
        return;
      }
      if (
        browser ||
        connectionDialog ||
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
    connectionDialog,
    section,
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
  const exportJSON = () => {
    try {
      const raw = serializeDocument(document);
      if (new TextEncoder().encode(raw).length > MAX_IMPORT_BYTES)
        throw new Error(
          'Architecture exceeds the 5 MB native-file limit. Use a project archive to preserve the workspace.',
        );
      download(
        raw,
        `${document.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'architecture'}.swiftbuild.json`,
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'Architecture export failed.',
      );
    }
  };
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
    const saved = add(definition, {
      x: center.x - 120 + (document.nodes.length % 4) * 28,
      y: center.y - 70 + (document.nodes.length % 4) * 28,
      ...(definition.category === 'boundary'
        ? { width: 560, height: 360 }
        : {}),
    });
    if (!saved) return false;
    recordCatalogUse(definition.id);
    setBrowser(false);
    setInspector(true);
    return true;
  };
  const filtered = searchComponents(definitions, query);
  const issues = graphIssues(document);
  const engineeringValidation = evaluateArchitecture(document, {
    capacity: currentReport ?? undefined,
  });
  const openRecord = (destination: EngineeringSection, id: string) => {
    setSection(destination);
    setSidebar(false);
    setInspector(false);
    window.setTimeout(() => {
      const record = window.document.getElementById(id);
      record?.scrollIntoView({ block: 'center' });
      record?.focus();
    }, 100);
  };
  const commands = [
    {
      name: 'Connect architecture objects',
      hint: 'C',
      run: () => {
        setSection(null);
        setConnectionDialog(true);
      },
    },
    ...definitions.map((definition) => ({
      name: `Add ${definition.name}`,
      hint: '',
      run: () => {
        setSection(null);
        addComponent(definition);
      },
    })),
    ...engineeringSections.map((item) => ({
      name: `Open ${item.label}`,
      hint: '',
      run: () => {
        setSection(item.id);
        setSidebar(false);
        setInspector(false);
      },
    })),
    ...document.nodes.map((node) => ({
      name: `Object: ${node.name}`,
      hint: '',
      run: () => {
        setSection(null);
        select([node.id]);
        setInspector(true);
        void flow.fitView({
          nodes: [{ id: node.id }],
          padding: 0.6,
          maxZoom: 1,
        });
      },
    })),
    ...[...document.requirements, ...document.nonFunctionalRequirements].map(
      (r) => ({
        name: `Requirement: ${r.title}`,
        hint: '',
        run: () => {
          openRecord('requirements', `requirement-${r.id}`);
        },
      }),
    ),
    ...document.decisions.map((d) => ({
      name: `Decision: ${d.title}`,
      hint: '',
      run: () => {
        openRecord('decisions', `decision-${d.id}`);
      },
    })),
    ...engineeringValidation.findings.map((finding) => ({
      name: `Finding: ${finding.title}`,
      hint: finding.severity,
      run: () => openRecord('validation', `finding-${finding.id}`),
    })),
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
    {
      name: 'Validate architecture',
      hint: '',
      run: () => {
        setSection('validation');
        setSidebar(false);
      },
    },
  ];
  const reportStale =
    !!currentReport &&
    (currentReport.fingerprint !== inputFingerprint(document) ||
      currentReport.origin === 'imported' ||
      currentReport.engineVersion !== ENGINE_VERSION ||
      currentReport.modelVersion !== '1.0');
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
            label="Architecture canvas"
            aria-pressed={section === null}
            onClick={() => setSection(null)}
          >
            <PanelsTopLeft size={19} />
          </IconButton>
          {engineeringSections.map((item) => (
            <IconButton
              key={item.id}
              label={item.label}
              aria-pressed={section === item.id}
              onClick={() => {
                setSection(item.id);
                setSidebar(false);
                setInspector(false);
              }}
            >
              <item.icon size={18} />
            </IconButton>
          ))}
          <span className="rail-divider" />
          <IconButton
            label="Search components"
            onClick={() => {
              setSection(null);
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
              setSection(null);
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
              setSection(null);
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
          section === null &&
          (panel === 'components' ? (
            <CatalogSidebar
              definitions={definitions}
              onAdd={addComponent}
              onDetails={setComponentDetails}
              onPack={() => packInput.current?.click()}
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
          <div
            style={{
              height: '100%',
              visibility: section === null ? 'visible' : 'hidden',
            }}
            aria-hidden={section !== null}
            inert={section !== null}
          >
            <GraphCanvas
              engineering={engineering}
              report={
                overlay && !reportStale
                  ? (currentReport ?? undefined)
                  : undefined
              }
              onInspector={() => setInspector(true)}
              onHelp={() => setHelp(true)}
            />
          </div>
          <div className="editor-floating-actions" hidden={section !== null}>
            <Button
              className="validate-action"
              onClick={() => {
                setSection('validation');
                setSidebar(false);
                setInspector(false);
              }}
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
                  label: 'Export project archive',
                  icon: <Download size={16} />,
                  onSelect: () => {
                    try {
                      download(
                        serializeArchive({
                          ...workspace,
                          document,
                          exportedAt: new Date().toISOString(),
                        }),
                        'project.swiftbuild-project.json',
                      );
                    } catch (error) {
                      notify(
                        error instanceof Error
                          ? error.message
                          : 'Archive export failed.',
                      );
                    }
                  },
                },
                {
                  label: 'Import project archive',
                  icon: <Upload size={16} />,
                  onSelect: () => archiveInput.current?.click(),
                },
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
          {section === null &&
            currentReport &&
            document.scenarios.some(
              (s) => s.id === currentReport.scenarioId,
            ) && (
              <div className="canvas-result-toggle">
                <Button
                  aria-pressed={overlay}
                  onClick={() => setOverlay((value) => !value)}
                >
                  {overlay ? 'Hide' : 'Show'} capacity overlay
                </Button>
                <span>
                  {reportStale
                    ? 'Results stale · rerun needed'
                    : `${currentReport.kind} · ${currentReport.status}`}
                </span>
              </div>
            )}
          {section === null && document.nodes.length === 0 && (
            <div className="empty-canvas">
              <Network size={26} />
              <h2>Start a system architecture</h2>
              <p>
                Add components and semantic connections, then explore the
                requirements and capacity behind your design.
              </p>
              <div>
                <Button
                  variant="primary"
                  onClick={() => {
                    setQuery('');
                    setBrowser(true);
                  }}
                >
                  Choose a component
                </Button>
                <Button onClick={() => setTemplates(true)}>
                  Explore an example
                </Button>
              </div>
              <span className="field-hint">
                A · add component / C · connect objects / Ctrl K · commands
              </span>
            </div>
          )}
          {section === null && (
            <Button
              className="findings-strip"
              onClick={() => {
                setSection('validation');
                setSidebar(false);
                setInspector(false);
              }}
            >
              <ShieldCheck size={15} />
              {engineeringValidation.findings.length} findings{' '}
              <span className="save-state">{status}</span>
            </Button>
          )}
          <div className="editor-bottom-left" hidden={section !== null}>
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
              {status !== savedLabel && status !== 'Loading draft' && (
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
          {activity && section === null && (
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
          {selected.length > 0 && section === null && (
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
          {section !== null && (
            <EngineeringWorkbench
              section={section}
              onClose={() => setSection(null)}
              workspace={workspace}
              setWorkspace={setWorkspace}
              onReport={setCurrentReport}
              saveStatus={status}
              onFocus={(ids) => {
                setSection(null);
                select(ids);
                setInspector(true);
                void flow.fitView({
                  nodes: ids.map((id) => ({ id })),
                  padding: 0.6,
                  maxZoom: 1,
                });
              }}
            />
          )}
        </main>
        {inspector && section === null && (
          <Inspector
            report={!reportStale ? (currentReport ?? undefined) : undefined}
            onOpenRecord={(kind, id) => {
              setSection(kind);
              setSidebar(false);
              setInspector(false);
              setTimeout(() => {
                const target = window.document.getElementById(
                  `${kind === 'requirements' ? 'requirement' : 'decision'}-${id}`,
                );
                target?.scrollIntoView({ block: 'center' });
                target?.focus();
              }, 0);
            }}
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
            onClick={async () => {
              try {
                const current = await workspaceAdapter.current
                  ?.read()
                  .catch(() => null);
                const raw = current
                  ? JSON.stringify(current, null, 2)
                  : localStorage.getItem(DRAFT_KEY);
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
      <ConnectionDialog
        open={connectionDialog}
        onOpenChange={setConnectionDialog}
      />
      <input
        type="file"
        accept="application/json,.json"
        aria-label="Import project archive"
        className="file-input"
        ref={archiveInput}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          try {
            if (file.size > MAX_ARCHIVE_BYTES)
              throw new Error('Project archive exceeds 50 MB.');
            setPendingArchive(importArchive(await file.text(), file.size));
          } catch (error) {
            notify(
              `Archive rejected. ${error instanceof Error ? error.message : 'Invalid project.'}`,
            );
          }
        }}
      />
      <Modal
        open={pendingArchive !== null}
        onOpenChange={(open) => {
          if (!open) setPendingArchive(null);
        }}
        title="Import project archive"
        description="Replace the current architecture, checkpoints and engineering history after validating the entire archive."
      >
        <p>
          {pendingArchive?.document.project.name} ·{' '}
          {pendingArchive?.checkpoints.length} checkpoints ·{' '}
          {pendingArchive?.runs.length} runs
        </p>
        <Button
          variant="primary"
          onClick={async () => {
            if (!pendingArchive) return;
            try {
              await persistenceQueue.current.catch(() => {});
              if (!workspaceAdapter.current)
                throw new Error(
                  'Storage unavailable. The current workspace was preserved.',
                );
              await workspaceAdapter.current.write(pendingArchive);
              replace(pendingArchive.document);
              setWorkspace(pendingArchive);
              setCurrentReport(pendingArchive.runs.at(-1) ?? null);
              setPendingArchive(null);
              setLocked(false);
              setSection(null);
            } catch (error) {
              notify(
                `Archive replacement failed. ${error instanceof Error ? error.message : ''}`,
              );
            }
          }}
        >
          Replace workspace
        </Button>
      </Modal>
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
          <h3>{storage ? 'Project storage' : 'Local workspace'}</h3>
          <p>
            {storage?.description ??
              'Your draft stays in this browser. Export JSON to keep a portable backup.'}
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
              setSection(null);
              setLocked(false);
              setTemplates(false);
              setInspector(false);
              setTimeout(() => flow.fitView({ padding: 0.2 }), 100);
            }}
          >
            Use template
          </Button>
          <Button
            onClick={() => {
              replace(engineeringSampleDocument());
              setLocked(false);
              setTemplates(false);
              setInspector(false);
              setSection('capacity');
              setSidebar(false);
              setTimeout(() => flow.fitView({ padding: 0.2 }), 100);
            }}
          >
            Use engineering example
          </Button>
          <Button
            onClick={() => {
              replace(infrastructureSampleDocument());
              setLocked(false);
              setTemplates(false);
              setSidebar(true);
              setSection(null);
              setPanel('components');
              void flow.fitView({ padding: 0.2 });
            }}
          >
            Use infrastructure example
          </Button>

          <p className="field-hint">
            Includes a workload scenario, flow policies, linked requirements and
            illustrative capacity profiles. Example values are not measured
            performance.
          </p>
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
      <input
        type="file"
        accept="application/json,.json"
        className="file-input"
        aria-label="Import component pack"
        ref={packInput}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            if (file.size > 5 * 1024 * 1024)
              throw new Error('Component packs must be no larger than 5 MB.');
            const pack = loadPack(JSON.parse(await file.text()));
            for (const c of pack.components) {
              const existing = definitions.find((d) => d.id === c.id);
              if (existing && JSON.stringify(existing) !== JSON.stringify(c))
                throw new Error(
                  `${c.id} is already installed. A definition upgrade must be explicit.`,
                );
            }
            apply((d) => {
              for (const c of pack.components)
                if (!d.components.some((x) => x.id === c.id))
                  d.components.push(c);
              d.metadata.componentPacks = [
                ...(Array.isArray(d.metadata.componentPacks)
                  ? d.metadata.componentPacks
                  : []),
                {
                  id: pack.id,
                  name: pack.name,
                  version: pack.version,
                  license: pack.license,
                },
              ];
            });
            notify(
              `Installed ${pack.name}: ${pack.components.length} declarative components.`,
            );
          } catch (error) {
            notify(
              `Pack rejected. ${error instanceof Error ? error.message : 'Invalid pack.'}`,
            );
          }
        }}
      />
      <Modal
        open={componentDetails !== null}
        onOpenChange={(open) => {
          if (!open) setComponentDetails(null);
        }}
        title={componentDetails?.name ?? 'Component details'}
        description="Inspect the definition before adding it to your architecture."
      >
        {componentDetails && (
          <div className="component-details">
            <TechnologyIcon
              icon={componentDetails.icon}
              size={40}
              label={`${componentDetails.name} icon`}
            />
            <p>{componentDetails.description}</p>
            <p className="field-hint">
              {componentDetails.id} · version {componentDetails.version} ·{' '}
              {componentDetails.catalog?.subcategory ?? 'Generic primitive'}
            </p>
            <h3>Configuration</h3>
            <dl>
              {componentDetails.configurationSchema.map((f) => (
                <div key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>
                    {String(f.default)} {f.unit}{' '}
                    {f.description && <small>{f.description}</small>}
                  </dd>
                </div>
              ))}
            </dl>
            <h3>Connections</h3>
            <p>
              {componentDetails.ports
                .map(
                  (p) =>
                    `${p.label} (${p.direction}): ${p.relationships.join(', ')}`,
                )
                .join(' · ') || 'Containment only; no processing ports.'}
            </p>
            <h3>Capacity coverage</h3>
            <p>
              {componentDetails.catalog?.capacityModel ?? 'Primitive behavior'}{' '}
              · explicit performance profiles and flow policies required.
              Architectural declarations do not establish measured throughput.
            </p>
            <p>{componentDetails.documentation}</p>
            <Button
              variant="primary"
              onClick={() => {
                addComponent(componentDetails);
                setComponentDetails(null);
              }}
            >
              Add {componentDetails.name}
            </Button>
          </div>
        )}
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
            return (
              <button
                key={c.id}
                className="component-option"
                aria-label={`Add ${c.name}`}
                onClick={() => addComponent(c)}
              >
                <div className={`category-icon ${c.category}`}>
                  <TechnologyIcon
                    icon={c.icon}
                    size={22}
                    label={`${c.name} icon`}
                  />
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
          <span>{definitions.length} validated components</span>
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
export function Workbench(props: WorkbenchProps = {}) {
  const [store] = useState(() =>
    createEditorStore(props.initialArchive?.document),
  );
  return (
    <StoreContext.Provider value={store}>
      <ReactFlowProvider>
        <Editor {...props} />
      </ReactFlowProvider>
    </StoreContext.Provider>
  );
}
