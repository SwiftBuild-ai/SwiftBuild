'use client';
import { useState } from 'react';
import { Modal, Button } from '@swiftbuild/ui';
import { compatibleRelationships } from '@swiftbuild/graph-engine';
import { useEditor } from './editor-context';
export function ConnectionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const document = useEditor((s) => s.history.present),
    apply = useEditor((s) => s.apply),
    notify = useEditor((s) => s.notify);
  const [sourceId, setSourceId] = useState(''),
    [targetId, setTargetId] = useState(''),
    [output, setOutput] = useState(''),
    [input, setInput] = useState(''),
    [relationship, setRelationship] = useState(''),
    [error, setError] = useState('');
  const source = document.nodes.find((n) => n.id === sourceId),
    target = document.nodes.find((n) => n.id === targetId);
  const outputPorts =
    document.components
      .find((c) => c.id === source?.componentId)
      ?.ports.filter((p) => p.direction === 'output') ?? [];
  const inputPorts =
    document.components
      .find((c) => c.id === target?.componentId)
      ?.ports.filter((p) => p.direction === 'input') ?? [];
  const sourceRef = { nodeId: sourceId, portId: output },
    targetRef = { nodeId: targetId, portId: input };
  const relationships = compatibleRelationships(document, sourceRef, targetRef);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Connect architecture objects"
      description="Create a semantic connection with keyboard-accessible port selection."
    >
      <form
        className="engineering-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!relationships.length) {
            setError(
              'These ports do not accept a compatible relationship. Choose an output and input that share a semantic relationship.',
            );
            return;
          }
          if (
            document.edges.some(
              (e) =>
                e.source.nodeId === sourceId &&
                e.source.portId === output &&
                e.target.nodeId === targetId &&
                e.target.portId === input,
            )
          ) {
            setError('This connection already exists.');
            return;
          }
          const saved = apply((d) => {
            d.edges.push({
              id: crypto.randomUUID(),
              source: sourceRef,
              target: targetRef,
              relationship:
                relationships.find((r) => r === relationship) ??
                relationships[0]!,
              label: '',
              metadata: {},
            });
          });
          if (saved) {
            setError('');
            onOpenChange(false);
            notify(
              'Connection created. Declare its traffic behavior in Capacity when preparing a simulation.',
            );
          }
        }}
      >
        <div className="engineering-field-grid">
          <label className="engineering-field">
            Source object
            <select
              required
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setOutput(
                  document.components
                    .find(
                      (c) =>
                        c.id ===
                        document.nodes.find((n) => n.id === e.target.value)
                          ?.componentId,
                    )
                    ?.ports.find((p) => p.direction === 'output')?.id ?? '',
                );
              }}
            >
              <option value="">Choose source</option>
              {document.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <label className="engineering-field">
            Output port
            <select
              required
              value={output}
              onChange={(e) => setOutput(e.target.value)}
            >
              <option value="">Choose output</option>
              {outputPorts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="engineering-field">
            Target object
            <select
              required
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value);
                setInput(
                  document.components
                    .find(
                      (c) =>
                        c.id ===
                        document.nodes.find((n) => n.id === e.target.value)
                          ?.componentId,
                    )
                    ?.ports.find((p) => p.direction === 'input')?.id ?? '',
                );
              }}
            >
              <option value="">Choose target</option>
              {document.nodes
                .filter((n) => n.id !== sourceId)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="engineering-field">
            Input port
            <select
              required
              value={input}
              onChange={(e) => setInput(e.target.value)}
            >
              <option value="">Choose input</option>
              {inputPorts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="engineering-field">
          Relationship
          <select
            value={
              relationships.includes(
                relationship as (typeof relationships)[number],
              )
                ? relationship
                : (relationships[0] ?? '')
            }
            onChange={(e) => setRelationship(e.target.value)}
          >
            {relationships.length ? (
              relationships.map((r) => (
                <option key={r} value={r}>
                  {r.replaceAll('-', ' ')}
                </option>
              ))
            ) : (
              <option value="">No compatible relationship</option>
            )}
          </select>
        </label>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary">
          Create connection
        </Button>
      </form>
    </Modal>
  );
}
