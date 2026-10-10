import type { Metadata } from 'next';
import localFont from 'next/font/local';
import '@fontsource/ibm-plex-mono/400.css';
import '@swiftbuild/design-tokens';
import '@swiftbuild/ui/styles.css';
import '@swiftbuild/canvas/styles.css';
const inter = localFont({
  src: [
    {
      path: '../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2',
      weight: '400',
    },
    {
      path: '../node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2',
      weight: '500',
    },
    {
      path: '../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2',
      weight: '600',
    },
  ],
  variable: '--font-inter',
  display: 'swap',
});
export const metadata: Metadata = {
  title: 'SwiftBuild — Architecture workbench',
  description:
    'Design systems with a semantic architecture model. Open-source and self-hostable.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="light" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
