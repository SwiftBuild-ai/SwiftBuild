import { notFound, redirect } from 'next/navigation';
import { ProjectError } from '@swiftbuild/server-core';
import { AccountShell } from '../../../components/account-shell';
import { ServerEditor } from '../../../components/server-editor';
import { accountContext } from '../../../server/account';
import { backend } from '../../../server/backend';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Server project — SwiftBuild',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function Project({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const context = await accountContext();
  if (context.state === 'ready' && !context.session) redirect('/login');
  let project;
  if (context.state === 'ready' && context.session) {
    try {
      project = await backend().projects.readProject(
        context.session.user.id,
        id,
      );
    } catch (failure) {
      if (failure instanceof ProjectError && failure.status === 404) notFound();
    }
  }
  if (project && context.state === 'ready' && context.session)
    return (
      <ServerEditor
        key={context.session.user.id + ':' + id}
        project={project}
        userId={context.session.user.id}
      />
    );
  return (
    <AccountShell>
      <h1>Project unavailable</h1>
      <p role="status">
        The project could not be opened. Preserve your local recovery and try
        again.
      </p>
      <a href="/projects">Back to projects</a>
    </AccountShell>
  );
}
