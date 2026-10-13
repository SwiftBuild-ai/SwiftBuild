import { redirect } from 'next/navigation';
import { AccountShell } from '../../components/account-shell';
import { ProjectList } from '../../components/project-list';
import { accountContext } from '../../server/account';
import { backend } from '../../server/backend';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Projects — SwiftBuild',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function Projects() {
  const context = await accountContext();
  if (context.state === 'ready' && !context.session) redirect('/login');
  let items;
  if (context.state === 'ready' && context.session) {
    try {
      items = await backend().projects.listWorkspaces(context.session.user.id);
    } catch {
      /* Render a recoverable unavailable state. */
    }
  }
  return (
    <AccountShell wide>
      <div className="eyebrow">SERVER WORKSPACES</div>
      <h1>Your projects</h1>
      {items ? (
        <ProjectList
          initialWorkspaces={items}
          userId={context.state === 'ready' ? context.session!.user.id : ''}
        />
      ) : (
        <p role="status">
          Server projects are unavailable. Your local draft remains accessible.
        </p>
      )}
      <p>
        <a href="/account">Your account</a>
      </p>
    </AccountShell>
  );
}
