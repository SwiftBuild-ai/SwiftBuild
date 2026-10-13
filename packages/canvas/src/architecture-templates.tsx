'use client';
import { useMemo } from 'react';
import { Network, ShieldCheck, Workflow } from 'lucide-react';
import { Button } from '@swiftbuild/ui';
import {
  sampleDocument,
  engineeringSampleDocument,
} from '@swiftbuild/components-core';
import { infrastructureSampleDocument } from '@swiftbuild/component-registry';
import type { ArchitectureDocument } from '@swiftbuild/architecture-schema';

export function ArchitectureTemplates({
  onChoose,
  onExport,
  server,
}: {
  onChoose: (
    document: ArchitectureDocument,
    destination: 'canvas' | 'capacity' | 'catalog',
  ) => void;
  onExport: () => void;
  server: boolean;
}) {
  const choices = useMemo(
    () => [
      {
        title: 'Commerce platform',
        description:
          'Start a service architecture with a web client, API, session cache and database. Includes compatible connections and editable configuration.',
        action: 'Use template',
        document: sampleDocument(),
        destination: 'canvas' as const,
        Icon: Network,
      },
      {
        title: 'Engineering example',
        description:
          'Explore workload scenarios, flow policies, linked requirements and capacity profiles. Values are illustrative, not measured performance.',
        action: 'Use engineering example',
        document: engineeringSampleDocument(),
        destination: 'capacity' as const,
        Icon: ShieldCheck,
      },
      {
        title: 'Infrastructure example',
        description:
          'Explore concrete infrastructure technologies, their configuration and directional connections. Technology names do not imply measured capacity.',
        action: 'Use infrastructure example',
        document: infrastructureSampleDocument(),
        destination: 'catalog' as const,
        Icon: Workflow,
      },
    ],
    [],
  );
  return (
    <>
      <p className="template-warning">
        Choosing an example replaces your current{' '}
        {server ? 'project' : 'browser draft'}. Export a copy first to keep it.
      </p>
      <div className="template-choices">
        {choices.map((choice) => (
          <article
            className="template-choice"
            key={choice.title}
            aria-label={choice.title}
          >
            <div className="template-choice-heading">
              <choice.Icon size={20} aria-hidden="true" />
              <h3>{choice.title}</h3>
            </div>
            <p>{choice.description}</p>
            <span className="template-counts">
              {choice.document.nodes.length} components ·{' '}
              {choice.document.edges.length} connections
            </span>
            <Button
              variant={
                choice.action === 'Use template' ? 'primary' : 'secondary'
              }
              onClick={() => onChoose(choice.document, choice.destination)}
            >
              {choice.action}
            </Button>
          </article>
        ))}
      </div>
      <div className="template-export">
        <Button onClick={onExport}>Export current architecture</Button>
      </div>
    </>
  );
}
