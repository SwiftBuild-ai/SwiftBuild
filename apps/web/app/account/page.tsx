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
            Your server account is ready. Project-list and editor integration
            are planned in the next delivery slice. You can continue working in
            your local draft.
          </p>
          <SignOut />
        </>
      ) : (
        <p role="status">
          Server accounts are unavailable. Local drafts remain accessible.
        </p>
      )}
    </AccountShell>
  );
}
