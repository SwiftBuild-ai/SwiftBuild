import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { ActionMenu, Button, IconButton, Modal } from './index';
const meta = {
  title: 'Foundation/Button',
  component: Button,
  args: { children: 'Add component' },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Primary: Story = { args: { variant: 'primary' } };
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Disabled: Story = { args: { disabled: true } };
export const ExportMenu: Story = {
  render: () => (
    <ActionMenu
      label="Export architecture"
      trigger={<Button variant="primary">Export</Button>}
      items={[
        { label: 'Export JSON', onSelect: () => {} },
        { label: 'Copy architecture JSON', onSelect: () => {} },
        { label: 'Import JSON', onSelect: () => {} },
        { label: 'Unavailable action', disabled: true, onSelect: () => {} },
      ]}
    />
  ),
};
export const LabeledIcon: Story = {
  render: () => <IconButton label="Add component">+</IconButton>,
};
function DialogExample() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open import dialog</Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Import architecture"
        description="Choose a native JSON architecture."
      >
        <p>All documents are validated before replacing your draft.</p>
      </Modal>
    </>
  );
}
export const Dialog: Story = {
  render: () => <DialogExample />,
};
