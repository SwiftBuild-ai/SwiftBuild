import { redirect } from 'next/navigation';
import { AccountShell } from '../../components/account-shell';
import { SignOut } from '../../components/auth-form';
import { accountContext } from '../../server/account';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Your account — SwiftBuild',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function Account() {
  const context = await accountContext();
  if (context.state === 'ready' && !context.session) redirect('/login');
  return (
    <AccountShell>
      <div className="eyebrow">SWIFTBUILD ACCOUNT</div>
      <h1>
        {context.state === 'ready' && context.session
          ? `Welcome, ${context.session.user.name}`
          : 'Account unavailable'}
      </h1>
      {context.state === 'ready' && context.session ? (
        <>
          <p>Signed in as {context.session.user.email}.</p>
          <p>
            Open your server projects or continue working in your independent
            local draft.
          </p>
          <a href="/projects">Open server projects</a>
          <SignOut userId={context.session.user.id} />
        </>
      ) : (
        <p role="status">
          Server accounts are unavailable. Local drafts remain accessible.
        </p>
      )}
    </AccountShell>
  );
}
