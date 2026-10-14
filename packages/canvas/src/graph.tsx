'use client';

import { useCallback, useEffect, useMemo, useState, useId, memo } from 'react';

import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
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
  Maximize,
  Minus,
  Plus,
  X,
  MousePointer2,
  Check,
  ChevronDown,
  LockKeyhole,
  Unlock,
  CircleHelp,
} from 'lucide-react';

import { Button, IconButton, Tabs, TechnologyIcon } from '@swiftbuild/ui';
import {
  defaultComponents,
  legacyMapping,
  upgradeLegacyNode,
} from '@swiftbuild/component-registry';
import { configureNode } from '@swiftbuild/architecture-model';
import { recordCatalogUse } from './catalog-preferences';
import { MetricGrid, MetricExplanation } from './metric-widgets';
import { ProfileEditor, FlowEditor, NotesEditor } from './engineering-forms';
import type {
  CapacityReport,
  Metric,
  NodeResult,
} from '@swiftbuild/capacity-engine';

import { compatibleRelationships } from '@swiftbuild/graph-engine';

import {
  configurationErrors,
  type ArchitectureNode,
  type ComponentDefinition,
  type Layout,
  type ConfigurationField,
} from '@swiftbuild/architecture-schema';

export { StoreContext, useEditor } from './editor-context';
import { useEditor } from './editor-context';
import { projectSelection } from './graph-selection';
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
  capacity?: NodeResult;
  explainMetric?: (metric: Metric) => void;
}>;

const ArchitectureCard = memo(function ArchitectureCard({
  id,
  data,
  selected,
}: NodeProps<SemanticNode>) {
  const apply = useEditor((s) => s.apply);
  const select = useEditor((s) => s.select);
  const duplicate = useEditor((s) => s.duplicate);
  const remove = useEditor((s) => s.remove);
  const boundary = data.definition.category === 'boundary';
  const config = data.node.configuration;
  const resources: string[] = [];
  if (typeof config.replicas === 'number')
    resources.push(`${config.replicas} replicas`);
  if (
    data.definition.category === 'compute' &&
    typeof config.cpuCores === 'number'
  )
    resources.push(`${config.cpuCores} cores`);
  if (typeof config.storageGB === 'number')
    resources.push(`${config.storageGB} GB`);
  if (
    data.definition.category === 'cache' &&
    typeof config.memoryGB === 'number'
  )
    resources.push(`${config.memoryGB} GB`);
  if (typeof config.memoryMB === 'number')
    resources.push(`${config.memoryMB} MB`);
  if (typeof config.brokers === 'number')
    resources.push(`${config.brokers} brokers`);
  if (!resources.length && typeof config.retentionHours === 'number')
    resources.push(`${config.retentionHours} h retention`);

  return (
    <div
      className={`architecture-card ${!boundary ? 'technology-card' : ''} ${boundary ? 'boundary-card' : ''} ${selected ? 'is-selected' : ''}`}
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

      {!boundary ? (
        <div className="technology-node-heading">
          <TechnologyIcon
            icon={data.definition.icon}
            size={30}
            label={`${data.definition.name} icon`}
          />
          <div>
            <div className="node-name">{data.node.name}</div>
            <span>
              {data.node.name === data.definition.name
                ? categoryLabels[data.definition.category]
                : data.definition.name}
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="node-category">
            <span>
              <TechnologyIcon
                icon={data.definition.icon}
                size={14}
                label={`${data.definition.name} icon`}
              />
              {categoryLabels[data.definition.category]}
            </span>
            <span className="node-dot" />
          </div>
          <div className="node-name">{data.node.name}</div>
        </>
      )}
      <div className="node-hover-actions nodrag">
        <button
          aria-label={`Duplicate ${data.node.name}`}
          onClick={() => {
            select([id]);
            duplicate();
          }}
        >
          Duplicate
        </button>
        <button
          aria-label={`Delete ${data.node.name}`}
          onClick={() => {
            select([id]);
            remove();
          }}
        >
          Delete
        </button>
      </div>

      {!boundary && (
        <>
          <div className="node-footer">
            <span>
              {String(
                data.node.configuration.queueType ??
                  data.node.configuration.protocol ??
                  data.node.configuration.engine ??
                  data.node.configuration.runtime ??
                  data.node.configuration.platform ??
                  data.node.configuration.eviction ??
                  data.node.configuration.delivery ??
                  categoryLabels[data.definition.category],
              )}
            </span>
            <span
              className="mono"
              aria-label={`Resource declarations for ${data.node.name}`}
            >
              {resources.join(' / ')}
            </span>
          </div>
          {data.engineering && (
            <div className="node-engineering">
              {data.definition.capabilities.join(' · ')}
            </div>
          )}
          {data.capacity && (
            <div className="node-capacity">
              {data.capacity.bottleneck && <strong>Capacity constraint</strong>}
              {data.capacity.metrics
                .filter((m) =>
                  [
                    'arrival',
                    'utilization',
                    'queue-depth',
                    'backlog-growth',
                  ].includes(m.id),
                )
                .map((m) => (
                  <button
                    key={m.id}
                    className="nodrag nopan"
                    onClick={() => data.explainMetric?.(m)}
                  >
                    {m.name}:{' '}
                    {m.value === undefined ? 'Unknown' : m.value.toFixed(2)}{' '}
                    {m.unit}
                  </button>
                ))}
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

const canvasProOptions = { hideAttribution: true };
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

export const GraphCanvas = memo(function GraphCanvas({
  engineering,
  onInspector,
  onHelp,
  report,
}: {
  engineering: boolean;
  onInspector: () => void;
  onHelp: () => void;
  report?: CapacityReport;
}) {
  const document = useEditor((s) => s.history.present);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  const apply = useEditor((s) => s.apply);
  const notify = useEditor((s) => s.notify);
  const addDefinition = useEditor((s) => s.add);
  const flow = useReactFlow();
  const [canvasLocked, setCanvasLocked] = useState(false);
  const [minimap, setMinimap] = useState(false);
  const [explanation, setExplanation] = useState<Metric | null>(null);
  const [dragging, setDragging] = useState(false);
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

  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const reportNodes = useMemo(
    () => new Map(report?.nodes.map((node) => [node.nodeId, node])),
    [report],
  );
  const baseProjected = useMemo(
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
          selected: false,
          style:
            definition.category === 'boundary'
              ? { width: layout.width ?? 560, height: layout.height ?? 360 }
              : undefined,
          data: {
            node,
            definition,
            engineering,
            capacity: reportNodes.get(node.id),
            explainMetric: setExplanation,
          },
        };
      }),
    [document, definitions, engineering, reportNodes],
  );

  const projected = useMemo(
    () => projectSelection(baseProjected, selectedIds),
    [baseProjected, selectedIds],
  );

  const [nodes, setNodes] = useState<SemanticNode[]>(projected);

  useEffect(() => setNodes(projected), [projected]);

  const baseEdges = useMemo(
    () =>
      document.edges.map((e) => ({
        id: e.id,
        source: e.source.nodeId,
        target: e.target.nodeId,
        sourceHandle: e.source.portId,
        targetHandle: e.target.portId,
        label: e.label || e.relationship.replaceAll('-', ' '),
        type: 'smoothstep',
        selected: false,
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
    [document.edges],
  );

  const projectedEdges = useMemo(
    () => projectSelection(baseEdges, selectedIds),
    [baseEdges, selectedIds],
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
    <div
      className="graph-area"
      onDragOver={(event) => {
        if (!canvasLocked) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (canvasLocked) {
          notify('Unlock the canvas to add components.');
          return;
        }
        const id = event.dataTransfer.getData(
          'application/swiftbuild-component',
        );
        const definition = [...document.components, ...defaultComponents].find(
          (c) => c.id === id,
        );
        if (!definition) {
          notify(
            'Component definition is unavailable. Install its pack first.',
          );
          return;
        }
        const position = flow.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
        const saved = addDefinition(definition, {
          ...position,
          ...(definition.category === 'boundary'
            ? { width: 560, height: 360 }
            : {}),
        });
        if (saved) recordCatalogUse(definition.id);
      }}
    >
      <ReactFlow<SemanticNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        proOptions={canvasProOptions}
        fitView={document.nodes.length > 0}
        defaultViewport={{ x: 0, y: 0, zoom: 0.92 }}
        onInit={(instance) => {
          if (!document.nodes.length)
            instance.setViewport({ x: 0, y: 0, zoom: 0.92 });
        }}
        nodesDraggable={!canvasLocked}
        nodesConnectable={!canvasLocked}
        nodesFocusable
        edgesFocusable
        autoPanOnNodeFocus
        fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        snapToGrid
        snapGrid={[16, 16]}
        onNodesChange={(changes: NodeChange<SemanticNode>[]) => {
          setNodes((current) => applyNodeChanges(changes, current));
          const positions = changes.filter(
            (c) => c.type === 'position' && c.position && c.dragging === false,
          );
          if (!dragging && positions.length)
            apply((d) => {
              for (const change of positions)
                if (change.type === 'position' && change.position)
                  d.views[0]!.layout[change.id] = {
                    ...d.views[0]!.layout[change.id]!,
                    ...change.position,
                  };
            });
        }}
        onEdgesChange={(changes) =>
          setEdges((current) => applyEdgeChanges(changes, current))
        }
        onSelectionChange={selectionChange}
        onNodeClick={onInspector}
        onEdgeClick={onInspector}
        onNodeDragStart={() => setDragging(true)}
        onNodeDragStop={(_, node, dragged) => {
          setDragging(false);
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
        {minimap && (
          <MiniMap
            pannable
            zoomable
            ariaLabel="Architecture overview. Use the object list for keyboard navigation."
            nodeColor="var(--accent)"
            maskColor="var(--canvas)"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              bottom: 60,
            }}
          />
        )}
      </ReactFlow>

      {document.nodes.length === 0 && (
        <p className="sr-only">
          Use the component catalog to start a new architecture.
        </p>
      )}
      <CanvasControls
        minimap={minimap}
        onMinimap={() => setMinimap((v) => !v)}
        canvasLocked={canvasLocked}
        onLock={() => setCanvasLocked((v) => !v)}
        onHelp={onHelp}
      />
      <MetricExplanation
        metric={explanation}
        onClose={() => setExplanation(null)}
      />
    </div>
  );
});

function CanvasControls({
  minimap,
  onMinimap,
  canvasLocked,
  onLock,
  onHelp,
}: {
  minimap: boolean;
  onMinimap: () => void;
  canvasLocked: boolean;
  onLock: () => void;
  onHelp: () => void;
}) {
  const flow = useReactFlow();
  const { zoom } = useViewport();
  const [zoomMenu, setZoomMenu] = useState(false);
  return (
    <div className="canvas-controls">
      <Button aria-pressed={minimap} onClick={onMinimap}>
        Overview
      </Button>
      <IconButton
        label={canvasLocked ? 'Unlock canvas' : 'Lock canvas'}
        aria-pressed={canvasLocked}
        onClick={onLock}
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
              flow.fitView({
                padding: 0.2,
                duration: window.matchMedia('(prefers-reduced-motion: reduce)')
                  .matches
                  ? 0
                  : 150,
              });
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
  );
}

export function Inspector({
  onClose,
  engineering,
  report,
  onOpenRecord,
}: {
  onClose: () => void;
  engineering: boolean;
  report?: CapacityReport;
  onOpenRecord?: (kind: 'requirements' | 'decisions', id: string) => void;
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
  const validationId = useId();
  const [tab, setTab] = useState('configuration');
  const [metric, setMetric] = useState<Metric | null>(null);

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
          <details className="flow-policy-inspector">
            <summary>Capacity flow policy</summary>
            <FlowEditor key={edge.id} edgeId={edge.id} />
          </details>
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
  const mapped = legacyMapping(document, node.id);

  const renderField = (field: ConfigurationField) => {
    const index = definition.configurationSchema.indexOf(field);
    const invalid = !!error && error.includes(field.label);
    const describedBy = [
      field.description ? `${validationId}-field-${index}` : '',
      invalid ? `${validationId}-error` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const accessibility = {
      'aria-label': field.label,
      'aria-invalid': invalid,
      'aria-describedby': describedBy || undefined,
    };
    return (
      <label
        className={`field ${field.type === 'boolean' ? 'toggle-field' : ''}`}
        key={field.key}
      >
        {field.label}
        {field.unit && <span className="field-hint"> ({field.unit})</span>}
        {field.type === 'boolean' ? (
          <input
            {...accessibility}
            type="checkbox"
            checked={values[field.key] === true}
            onChange={(e) =>
              setValues((v) => ({ ...v, [field.key]: e.target.checked }))
            }
          />
        ) : field.type === 'select' ? (
          <select
            {...accessibility}
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
            {...accessibility}
            type={field.type === 'number' ? 'number' : 'text'}
            step={
              field.type === 'number'
                ? field.integer
                  ? '1'
                  : 'any'
                : undefined
            }
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
        {field.description && (
          <small className="field-hint" id={`${validationId}-field-${index}`}>
            {field.description}
          </small>
        )}
      </label>
    );
  };
  const save = () => {
    const errors = configurationErrors(definition, values);
    if (!name.trim()) errors.unshift('Name is required.');
    if (errors.length) {
      setError(errors.join(' '));
      return;
    }
    const saved = apply((d) =>
      Object.assign(d, configureNode(d, node.id, name, values)),
    );
    setError(
      saved
        ? ''
        : 'Configuration was not saved. Resolve document validation errors.',
    );
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
            <TechnologyIcon
              icon={definition.icon}
              size={28}
              label={`${definition.name} icon`}
            />
          </div>
          <div>
            <span className="eyebrow">
              {categoryLabels[definition.category]}
            </span>
            <h3>{node.name}</h3>
          </div>
        </div>
        <p className="inspector-description">{definition.description}</p>
        {mapped && (
          <Button
            onClick={() =>
              apply((d) => Object.assign(d, upgradeLegacyNode(d, node.id)))
            }
          >
            Convert to {mapped.name}
          </Button>
        )}
        {!mapped && definition.id === 'core.database' && (
          <details className="legacy-mapping">
            <summary>Review legacy technology mapping</summary>
            <p className="field-hint">
              This embedded definition remains supported. Its engine,
              configuration or ports do not have an unambiguous lossless
              conversion. Inspect a technology in the library and migrate
              connections explicitly; the original node is retained.
            </p>
          </details>
        )}
        <Tabs
          value={tab}
          onChange={setTab}
          label="Component details"
          items={[
            {
              id: 'configuration',
              label: 'Configuration',
              content: (
                <>
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
                    {definition.configurationSchema
                      .filter((f) => !f.advanced)
                      .map(renderField)}
                    {definition.configurationSchema.some((f) => f.advanced) && (
                      <details className="configuration-advanced">
                        <summary>Advanced configuration</summary>
                        {definition.configurationSchema
                          .filter((f) => f.advanced)
                          .map(renderField)}
                      </details>
                    )}
                    {error && (
                      <p
                        role="alert"
                        className="field-error"
                        id={`${validationId}-error`}
                      >
                        {error}
                      </p>
                    )}
                    <Button
                      variant="primary"
                      type="submit"
                      className="apply-button"
                    >
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
                            document.components.find(
                              (c) => c.id === n.componentId,
                            )?.category === 'boundary',
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
                </>
              ),
            },
            {
              id: 'capacity',
              label: 'Capacity',
              content: (
                <>
                  {report?.nodes.find(
                    (result) => result.nodeId === node.id,
                  ) && (
                    <>
                      <MetricGrid
                        compact
                        metrics={report.nodes
                          .find((result) => result.nodeId === node.id)!
                          .metrics.filter((m) =>
                            [
                              'arrival',
                              'throughput',
                              'utilization',
                              'p95-latency',
                              'queue-depth',
                              'cpu',
                              'memory',
                            ].includes(m.id),
                          )}
                        onExplain={setMetric}
                      />
                      <details>
                        <summary>Edit capacity profile</summary>
                        <ProfileEditor key={node.id} node={node} />
                      </details>
                    </>
                  )}
                  {!report?.nodes.some(
                    (result) => result.nodeId === node.id,
                  ) && <ProfileEditor key={node.id} node={node} />}
                  <MetricExplanation
                    metric={metric}
                    onClose={() => setMetric(null)}
                  />
                </>
              ),
            },
            {
              id: 'notes',
              label: 'Notes',
              content: (
                <NotesEditor
                  key={node.id}
                  node={node}
                  onOpenRecord={onOpenRecord}
                />
              ),
            },
          ]}
        />
      </div>
    </aside>
  );
}
