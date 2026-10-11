import { AccountShell } from '../../components/account-shell';
import { AuthForm } from '../../components/auth-form';
import { accountContext } from '../../server/account';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Recover access — SwiftBuild',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function ResetPassword({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const token =
    typeof query.token === 'string' &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(query.token)
      ? query.token
      : undefined;
  const context = await accountContext();
  return (
    <AccountShell>
      <div className="eyebrow">ACCOUNT RECOVERY</div>
      <h1>Choose a new password</h1>
      {!token ? (
        <p role="alert">
          Ask your instance operator for a one-time recovery link. Email
          delivery is not required.
        </p>
      ) : context.state !== 'ready' ? (
        <p role="status">
          Server accounts are unavailable. Contact your instance operator.
        </p>
      ) : (
        <>
          <p>Updating your password will revoke your existing sessions.</p>
          <AuthForm mode="reset" token={token} oidc={false} />
        </>
      )}
    </AccountShell>
  );
}
