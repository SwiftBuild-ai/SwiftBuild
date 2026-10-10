'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  memo,
} from 'react';

import { useStore } from 'zustand';

import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  NodeResizer,
  applyNodeChanges,
  applyEdgeChanges,
  type Edge,
  useReactFlow,
  useViewport,
  type Node,
  type NodeProps,
  type NodeChange,
  type Connection,
  type NodeTypes,
} from '@xyflow/react';

import {
  Layers,
  Maximize,
  MessageSquare,
  Minus,
  Monitor,
  Plus,
  X,
  Zap,
  Server,
  Database,
  MousePointer2,
  Check,
  ChevronDown,
  LockKeyhole,
  Unlock,
  CircleHelp,
} from 'lucide-react';

import { Button, IconButton } from '@swiftbuild/ui';

import { compatibleRelationships } from '@swiftbuild/graph-engine';

import {
  configurationErrors,
  type ArchitectureNode,
  type ComponentDefinition,
  type Layout,
} from '@swiftbuild/architecture-schema';

import { createEditorStore, type EditorState } from './store';

export const StoreContext = createContext<ReturnType<
  typeof createEditorStore
> | null>(null);

export function useEditor<T>(selector: (state: EditorState) => T): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error('Missing editor context.');
  return useStore(store, selector);
}

export const icons = {
  client: Monitor,
  compute: Server,
  database: Database,
  cache: Zap,
  messaging: MessageSquare,
  boundary: Layers,
};

export const categoryLabels = {
  client: 'Client',
  compute: 'Compute',
  database: 'Database',
  cache: 'Cache',
  messaging: 'Messaging',
  boundary: 'Boundary',
};

type SemanticNode = Node<{
  node: ArchitectureNode;
  definition: ComponentDefinition;
  engineering: boolean;
}>;

const ArchitectureCard = memo(function ArchitectureCard({
  id,
  data,
  selected,
}: NodeProps<SemanticNode>) {
  const apply = useEditor((s) => s.apply);
  const Icon = icons[data.definition.category];
  const boundary = data.definition.category === 'boundary';

  return (
    <div
      className={`architecture-card ${boundary ? 'boundary-card' : ''} ${selected ? 'is-selected' : ''}`}
      style={
        {
          '--category': `var(--${data.definition.category})`,
        } as React.CSSProperties
      }
    >
      {boundary && (
        <NodeResizer
          minWidth={300}
          minHeight={220}
          isVisible={selected}
          onResizeEnd={(_, params) =>
            apply((d) => {
              d.views[0]!.layout[id] = {
                ...d.views[0]!.layout[id]!,
                x: params.x,
                y: params.y,
                width: params.width,
                height: params.height,
              };
            })
          }
        />
      )}

      <div className="node-category">
        <span>
          <Icon size={14} />
          {categoryLabels[data.definition.category]}
        </span>
        <span className="node-dot" />
      </div>

      <div className="node-name">{data.node.name}</div>

      {!boundary && (
        <>
          <div className="node-description">{data.definition.description}</div>
          <div className="node-footer">
            <span>
              {String(
                data.node.configuration.engine ??
                  data.node.configuration.runtime ??
                  data.node.configuration.platform ??
                  data.node.configuration.eviction ??
                  data.node.configuration.delivery ??
                  'Generic',
              )}
            </span>
            <span className="mono">
              {data.definition.category === 'compute'
                ? `${data.node.configuration.replicas} replicas`
                : data.definition.category === 'database'
                  ? `${data.node.configuration.storageGB} GB`
                  : data.definition.category === 'cache'
                    ? `${data.node.configuration.ttlSeconds}s TTL`
                    : 'v1'}
            </span>
          </div>
          {data.engineering && (
            <div className="node-engineering">
              {data.definition.capabilities.join(' · ')}
            </div>
          )}
        </>
      )}

      {data.definition.ports.map((port, i) => (
        <Handle
          key={port.id}
          id={port.id}
          type={port.direction === 'input' ? 'target' : 'source'}
          position={port.direction === 'input' ? Position.Left : Position.Right}
          style={{ top: `${45 + i * 16}%` }}
          aria-label={`${data.node.name}: ${port.label}`}
        />
      ))}
    </div>
  );
});

const nodeTypes: NodeTypes = { semantic: ArchitectureCard };

function orderedNodes(nodes: ArchitectureNode[]): ArchitectureNode[] {
  const result: ArchitectureNode[] = [];
  const visited = new Set<string>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visit = (n: ArchitectureNode) => {
    if (visited.has(n.id)) return;
    visited.add(n.id);
    if (n.parentId) {
      const parent = byId.get(n.parentId);
      if (parent) visit(parent);
    }
    result.push(n);
  };
  nodes.forEach(visit);
  return result;
}

export function GraphCanvas({
  engineering,
  onInspector,
  onHelp,
}: {
  engineering: boolean;
  onInspector: () => void;
  onHelp: () => void;
}) {
  const document = useEditor((s) => s.history.present);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  const apply = useEditor((s) => s.apply);
  const notify = useEditor((s) => s.notify);
  const flow = useReactFlow();
  const { zoom } = useViewport();
  const [canvasLocked, setCanvasLocked] = useState(false);
  const [zoomMenu, setZoomMenu] = useState(false);
  const selectionChange = useCallback(
    ({
      nodes: chosen,
      edges: chosenEdges,
    }: {
      nodes: SemanticNode[];
      edges: { id: string }[];
    }) => select([...chosen.map((n) => n.id), ...chosenEdges.map((e) => e.id)]),
    [select],
  );

  const definitions = useMemo(
    () => new Map(document.components.map((c) => [c.id, c])),
    [document.components],
  );

  const projected = useMemo(
    () =>
      orderedNodes(document.nodes).map((node) => {
        const definition = definitions.get(node.componentId)!;
        const layout = document.views[0]!.layout[node.id] ?? { x: 0, y: 0 };
        return {
          id: node.id,
          type: 'semantic',
          position: { x: layout.x, y: layout.y },
          parentId: node.parentId,
          extent: node.parentId ? ('parent' as const) : undefined,
          selected: selected.includes(node.id),
          style:
            definition.category === 'boundary'
              ? { width: layout.width ?? 560, height: layout.height ?? 360 }
              : undefined,
          data: { node, definition, engineering },
        };
      }),
    [document, definitions, selected, engineering],
  );

  const [nodes, setNodes] = useState<SemanticNode[]>(projected);

  useEffect(() => setNodes(projected), [projected]);

  const projectedEdges = useMemo(
    () =>
      document.edges.map((e) => ({
        id: e.id,
        source: e.source.nodeId,
        target: e.target.nodeId,
        sourceHandle: e.source.portId,
        targetHandle: e.target.portId,
        label: e.label || e.relationship.replaceAll('-', ' '),
        type: 'smoothstep',
        selected: selected.includes(e.id),
        style: { stroke: 'var(--subtle)', strokeWidth: 1.5 },
        labelStyle: {
          fill: 'var(--muted)',
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
        },
        labelBgStyle: { fill: 'var(--canvas)' },
        labelBgPadding: [8, 5] as [number, number],
        labelBgBorderRadius: 4,
      })),
    [document.edges, selected],
  );

  const [edges, setEdges] = useState<Edge[]>(projectedEdges);
  useEffect(() => setEdges(projectedEdges), [projectedEdges]);
  const connect = (connection: Connection) => {
    const source = {
      nodeId: connection.source,
      portId: connection.sourceHandle ?? '',
    };
    const target = {
      nodeId: connection.target,
      portId: connection.targetHandle ?? '',
    };
    const kinds = compatibleRelationships(document, source, target);
    if (!kinds.length) {
      notify(
        'These ports are incompatible. Connect an output to an input that accepts the same relationship.',
      );
      return;
    }
    if (
      document.edges.some(
        (e) =>
          e.source.nodeId === source.nodeId &&
          e.source.portId === source.portId &&
          e.target.nodeId === target.nodeId &&
          e.target.portId === target.portId,
      )
    ) {
      notify('This connection already exists.');
      return;
    }
    apply((d) => {
      d.edges.push({
        id: crypto.randomUUID(),
        source,
        target,
        relationship: kinds[0]!,
        label: '',
        metadata: {},
      });
    });
  };

  return (
    <div className="graph-area">
      <ReactFlow<SemanticNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView={document.nodes.length > 0}
        defaultViewport={{ x: 0, y: 0, zoom: 0.92 }}
        onInit={(instance) => {
          if (!document.nodes.length)
            instance.setViewport({ x: 0, y: 0, zoom: 0.92 });
        }}
        nodesDraggable={!canvasLocked}
        nodesConnectable={!canvasLocked}
        fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        snapToGrid
        snapGrid={[16, 16]}
        onNodesChange={(changes: NodeChange<SemanticNode>[]) =>
          setNodes((current) => applyNodeChanges(changes, current))
        }
        onEdgesChange={(changes) =>
          setEdges((current) => applyEdgeChanges(changes, current))
        }
        onSelectionChange={selectionChange}
        onNodeClick={onInspector}
        onEdgeClick={onInspector}
        onNodeDragStop={(_, node, dragged) => {
          apply((d) => {
            for (const item of dragged.length ? dragged : [node])
              d.views[0]!.layout[item.id] = {
                ...d.views[0]!.layout[item.id]!,
                x: item.position.x,
                y: item.position.y,
              };
          });
        }}
        onConnect={connect}
        onConnectEnd={(_, state) => {
          if (!state.isValid && state.toNode)
            notify('Connection not created. Use compatible directional ports.');
        }}
        deleteKeyCode={null}
        selectionOnDrag
        panOnScroll
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        aria-label="Architecture canvas"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={2}
          color="var(--grid)"
        />
      </ReactFlow>

      {document.nodes.length === 0 && (
        <p className="sr-only">
          Use the component catalog to start a new architecture.
        </p>
      )}
      <div className="canvas-controls">
        <IconButton
          label={canvasLocked ? 'Unlock canvas' : 'Lock canvas'}
          aria-pressed={canvasLocked}
          onClick={() => setCanvasLocked((v) => !v)}
        >
          {canvasLocked ? <LockKeyhole size={19} /> : <Unlock size={19} />}
        </IconButton>
        <span className="control-divider" />
        <button
          className="zoom-trigger"
          aria-label="Zoom controls"
          aria-expanded={zoomMenu}
          onClick={() => setZoomMenu((v) => !v)}
        >
          <span>{Math.round(zoom * 100)}%</span>
          <ChevronDown size={16} />
        </button>
        <span className="control-divider" />
        <IconButton label="Editor help" onClick={onHelp}>
          <CircleHelp size={19} />
        </IconButton>
        {zoomMenu && (
          <div className="zoom-popover" role="group" aria-label="Canvas zoom">
            <Button onClick={() => flow.zoomIn()}>
              <Plus size={16} />
              Zoom in
            </Button>
            <Button onClick={() => flow.zoomOut()}>
              <Minus size={16} />
              Zoom out
            </Button>
            <Button
              onClick={() => {
                flow.fitView({ padding: 0.2, duration: 150 });
                setZoomMenu(false);
              }}
            >
              <Maximize size={16} />
              Fit architecture
            </Button>
            <Button
              onClick={() => {
                flow.zoomTo(1);
                setZoomMenu(false);
              }}
            >
              Reset to 100%
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Inspector({
  onClose,
  engineering,
}: {
  onClose: () => void;
  engineering: boolean;
}) {
  const document = useEditor((s) => s.history.present);
  const selected = useEditor((s) => s.selected);
  const apply = useEditor((s) => s.apply);
  const node = document.nodes.find((n) => n.id === selected[0]);
  const edge = document.edges.find((e) => e.id === selected[0]);
  const remove = useEditor((s) => s.remove);

  const [name, setName] = useState(node?.name ?? edge?.label ?? '');
  const [values, setValues] = useState<ArchitectureNode['configuration']>(
    node?.configuration ?? {},
  );
  const [error, setError] = useState('');

  useEffect(() => {
    setName(node?.name ?? edge?.label ?? '');
    setValues(node?.configuration ?? {});
    setError('');
  }, [node, edge]);

  if (!node && edge)
    return (
      <aside className="inspector" aria-label="Connection inspector">
        <div className="panel-heading">
          <h2>Connection details</h2>
          <IconButton label="Close inspector" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="inspector-body">
          <span className="eyebrow">SEMANTIC CONNECTION</span>
          <h3>
            {document.nodes.find((n) => n.id === edge.source.nodeId)?.name} to{' '}
            {document.nodes.find((n) => n.id === edge.target.nodeId)?.name}
          </h3>
          <label className="field">
            Connection label
            <input
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <Button
            variant="primary"
            onClick={() =>
              apply((d) => {
                d.edges.find((e) => e.id === edge.id)!.label = name;
              })
            }
          >
            Apply label
          </Button>
          <label className="field group-field">
            Relationship
            <select
              value={edge.relationship}
              onChange={(e) =>
                apply((d) => {
                  const current = d.edges.find((x) => x.id === edge.id)!;
                  const relationship = compatibleRelationships(
                    d,
                    current.source,
                    current.target,
                  ).find((r) => r === e.target.value);
                  if (relationship) current.relationship = relationship;
                })
              }
            >
              {compatibleRelationships(document, edge.source, edge.target).map(
                (r) => (
                  <option key={r} value={r}>
                    {r.replaceAll('-', ' ')}
                  </option>
                ),
              )}
            </select>
          </label>
          <p className="muted">
            Output: {edge.source.portId}
            <br />
            Input: {edge.target.portId}
          </p>
          <Button onClick={remove}>Delete connection</Button>
        </div>
      </aside>
    );
  if (!node)
    return (
      <aside className="inspector">
        <div className="panel-heading">
          <h2>Inspector</h2>
          <IconButton label="Close inspector" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="inspector-empty">
          <MousePointer2 size={24} />
          <p>Select a component to inspect its architecture.</p>
        </div>
      </aside>
    );

  const definition = document.components.find(
    (c) => c.id === node.componentId,
  )!;
  const Icon = icons[definition.category];

  const save = () => {
    const errors = configurationErrors(definition, values);
    if (!name.trim()) errors.unshift('Name is required.');
    if (errors.length) {
      setError(errors.join(' '));
      return;
    }
    apply((d) => {
      const target = d.nodes.find((n) => n.id === node.id)!;
      target.name = name.trim();
      target.configuration = values;
    });
    setError('');
  };

  const group = (parentId: string) =>
    apply((d) => {
      const target = d.nodes.find((n) => n.id === node.id)!;
      const layout = d.views[0]!.layout[node.id]!;
      const absolute = (id: string): Layout => {
        const n = d.nodes.find((x) => x.id === id)!;
        const p = d.views[0]!.layout[id]!;
        if (!n.parentId) return p;
        const parent = absolute(n.parentId);
        return { ...p, x: p.x + parent.x, y: p.y + parent.y };
      };
      const current = absolute(node.id);
      const next = parentId ? absolute(parentId) : { x: 0, y: 0 };
      target.parentId = parentId || undefined;
      layout.x = Math.max(parentId ? 24 : -Infinity, current.x - next.x);
      layout.y = Math.max(parentId ? 72 : -Infinity, current.y - next.y);
      if (parentId) {
        const boundary = d.views[0]!.layout[parentId]!;
        boundary.width = Math.max(boundary.width ?? 560, layout.x + 280);
        boundary.height = Math.max(boundary.height ?? 360, layout.y + 220);
      }
    });

  return (
    <aside className="inspector" aria-label="Component inspector">
      <div className="panel-heading">
        <h2>Component details</h2>
        <IconButton label="Close inspector" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="inspector-body">
        <div className="inspector-identity">
          <div className={`category-icon ${definition.category}`}>
            <Icon size={23} />
          </div>
          <div>
            <span className="eyebrow">
              {categoryLabels[definition.category]}
            </span>
            <h3>{node.name}</h3>
          </div>
        </div>
        <p className="inspector-description">{definition.description}</p>
        <div className="inspector-tabs">
          <span className="active">Configuration</span>
          <span className="mono">{definition.version}</span>
        </div>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="field">
            Name
            <input
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {definition.configurationSchema.map((field) => (
            <label
              className={`field ${field.type === 'boolean' ? 'toggle-field' : ''}`}
              key={field.key}
            >
              {field.label}
              {field.type === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={values[field.key] === true}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.key]: e.target.checked }))
                  }
                />
              ) : field.type === 'select' ? (
                <select
                  value={String(values[field.key] ?? '')}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                >
                  {field.options?.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  step={field.type === 'number' ? 'any' : undefined}
                  min={field.min}
                  max={field.max}
                  value={String(values[field.key] ?? '')}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      [field.key]:
                        field.type === 'number'
                          ? e.target.value === ''
                            ? ''
                            : Number(e.target.value)
                          : e.target.value,
                    }))
                  }
                />
              )}
            </label>
          ))}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <Button variant="primary" type="submit" className="apply-button">
            <Check size={14} />
            Apply changes
          </Button>
        </form>
        <label className="field group-field">
          Boundary
          <select
            aria-label="Boundary"
            value={node.parentId ?? ''}
            onChange={(e) => group(e.target.value)}
          >
            <option value="">Outside a boundary</option>
            {document.nodes
              .filter(
                (n) =>
                  n.id !== node.id &&
                  document.components.find((c) => c.id === n.componentId)
                    ?.category === 'boundary',
              )
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
          </select>
        </label>
        {engineering && (
          <div className="capabilities">
            <span className="eyebrow">CAPABILITIES</span>
            {definition.capabilities.map((c) => (
              <span key={c}>
                <Check size={12} />
                {c.replaceAll('-', ' ')}
              </span>
            ))}
          </div>
        )}
        <div className="port-summary">
          <span className="eyebrow">SEMANTIC PORTS</span>
          {definition.ports.map((p) => (
            <div key={p.id}>
              <span className="port-dot" />
              <span>{p.label}</span>
              <span className="mono">{p.direction}</span>
            </div>
          ))}
          {!definition.ports.length && (
            <p>Contains components; no connections.</p>
          )}
        </div>
        <div className="component-id mono">
          {definition.id} · {node.id.slice(0, 8)}
        </div>
      </div>
    </aside>
  );
}
