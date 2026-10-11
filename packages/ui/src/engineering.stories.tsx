import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Tabs, StatusBadge, Button } from './index';
const meta = {
  title: 'Engineering/Interaction states',
  component: StatusBadge,
  args: { status: 'unknown' },
} satisfies Meta<typeof StatusBadge>;
export default meta;
type Story = StoryObj<typeof meta>;
export const EvidenceStates: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: 20 }}>
      {[
        'known',
        'unknown',
        'illustrative',
        'assumed',
        'stale',
        'partial',
        'unstable',
        'complete',
        'cancelled',
      ].map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};
export const AssessmentStates: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, padding: 20 }}>
      {[
        'met',
        'violated',
        'unknown',
        'manually-reviewed',
        'not-applicable',
        'insufficient-information',
      ].map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};
function InspectorTabsExample() {
  const [value, setValue] = useState('configuration');
  return (
    <div style={{ maxWidth: 420, padding: 20 }}>
      <Tabs
        value={value}
        onChange={setValue}
        label="Component inspector"
        items={[
          {
            id: 'configuration',
            label: 'Configuration',
            content: <p>Component configuration and inline errors.</p>,
          },
          {
            id: 'capacity',
            label: 'Capacity',
            content: (
              <>
                <StatusBadge status="unknown" />
                <p>Supply a measured profile or declared assumptions.</p>
              </>
            ),
          },
          {
            id: 'notes',
            label: 'Notes',
            content: (
              <p>Architecture notes, linked requirements and decisions.</p>
            ),
          },
        ]}
      />
    </div>
  );
}
export const KeyboardTabs: Story = { render: () => <InspectorTabsExample /> };
export const RunningAndUnavailable: Story = {
  render: () => (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 20 }}
    >
      <Button disabled>Simulation running…</Button>
      <Button>Cancel simulation</Button>
      <StatusBadge status="partial" />
      <p role="status">
        Execution budget reached; this assessment is incomplete.
      </p>
    </div>
  ),
};
