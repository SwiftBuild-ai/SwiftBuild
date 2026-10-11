import type { Meta, StoryObj } from '@storybook/react-vite';
import { TechnologyIcon } from './technology-icon';
const meta = {
  title: 'Infrastructure/Local technology icons',
  component: TechnologyIcon,
  args: { icon: 'postgresql', label: 'PostgreSQL icon', size: 32 },
} satisfies Meta<typeof TechnologyIcon>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Icon: Story = {};
export const NeutralDark: Story = {
  render: () => (
    <div
      data-theme="dark"
      style={{
        background: 'var(--panel)',
        color: 'var(--text)',
        padding: 24,
        display: 'flex',
        gap: 20,
      }}
    >
      {[
        'postgresql',
        'mysql',
        'mongodb',
        'redis',
        'kafka',
        'nginx',
        's3',
        'lambda',
        'kubernetes',
        'docker',
        'unknown',
      ].map((icon) => (
        <TechnologyIcon
          key={icon}
          icon={icon}
          label={`${icon} icon`}
          size={32}
        />
      ))}
    </div>
  ),
};
