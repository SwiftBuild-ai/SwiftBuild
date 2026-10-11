import { AccountShell } from '../../components/account-shell';
import { AuthForm } from '../../components/auth-form';
import { accountContext } from '../../server/account';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Accept invitation — SwiftBuild',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function Invite({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const token =
    typeof query.token === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(query.token)
      ? query.token
      : undefined;
  const email =
    typeof query.email === 'string' && query.email.length <= 254
      ? query.email
      : undefined;
  const context = await accountContext();
  return (
    <AccountShell>
      <div className="eyebrow">PRIVATE INVITATION</div>
      <h1>Your workspace awaits</h1>
      {!token || !email ? (
        <p role="alert">
          This invitation link is incomplete. Ask your instance operator for a
          new link.
        </p>
      ) : context.state !== 'ready' ? (
        <p role="status">
          Server accounts are unavailable. Contact your instance operator.
        </p>
      ) : (
        <>
          <p>
            Join SwiftBuild with the invited email address. Invitations expire
            after 24 hours and can be accepted once.
          </p>
          <AuthForm
            mode="invite"
            token={token}
            email={email}
            oidc={context.oidc}
            signedIn={!!context.session}
          />
        </>
      )}
    </AccountShell>
  );
}
