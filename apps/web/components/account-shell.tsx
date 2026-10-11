import Link from 'next/link';
import type { ReactNode } from 'react';
import './account.css';
export function AccountShell({ children }: { children: ReactNode }) {
  return (
    <main className="account-shell">
      <header>
        <Link href="/" className="account-brand">
          SwiftBuild <span>Architecture workbench</span>
        </Link>
        <Link href="/">Open local draft</Link>
      </header>
      <section className="account-card">{children}</section>
      <footer>
        Server accounts are invitation-only. Your browser-local drafts stay on
        this device until you explicitly save them to a server.
      </footer>
    </main>
  );
}
