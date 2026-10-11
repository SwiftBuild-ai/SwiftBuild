import { redirect } from 'next/navigation';
import { AccountShell } from '../../components/account-shell';
import { AuthForm } from '../../components/auth-form';
import { accountContext } from '../../server/account';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Sign in — SwiftBuild',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function Login() {
  const context = await accountContext();
  if (context.state === 'ready' && context.session) redirect('/account');
  return (
    <AccountShell>
      <div className="eyebrow">SERVER WORKSPACE</div>
      <h1>Sign in to SwiftBuild</h1>
      {context.state === 'ready' ? (
        <>
          <p>
            Open your account with a password or your configured organization.
            New accounts require an invitation from your instance operator.
          </p>
          <AuthForm mode="login" oidc={context.oidc} />
        </>
      ) : (
        <p role="status">
          {context.state === 'local'
            ? 'This instance uses browser-local drafts. Server accounts have not been configured.'
            : 'Server accounts are temporarily unavailable. Try again later or contact your instance operator.'}
        </p>
      )}
    </AccountShell>
  );
}
