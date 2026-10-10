import type { StorybookConfig } from '@storybook/react-vite';
const config: StorybookConfig = {
  core: { disableTelemetry: true },
  stories: ['../src/**/*.stories.tsx'],
  framework: '@storybook/react-vite',
};
export default config;
