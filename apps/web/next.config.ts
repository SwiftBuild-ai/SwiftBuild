import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['127.0.0.1'],
  transpilePackages: [
    '@swiftbuild/canvas',
    '@swiftbuild/project-format',
    '@swiftbuild/server-core',
    '@swiftbuild/ui',
    '@swiftbuild/design-tokens',
    '@swiftbuild/architecture-schema',
    '@swiftbuild/architecture-model',
    '@swiftbuild/graph-engine',
    '@swiftbuild/components-core',
    '@swiftbuild/component-registry',
    '@swiftbuild/capacity-engine',
    '@swiftbuild/rule-engine',
  ],
};
export default config;
