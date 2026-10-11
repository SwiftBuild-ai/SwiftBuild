'use client';
import { useState, type FormEvent } from 'react';
import { Button } from '@swiftbuild/ui';
type Mode = 'login' | 'invite' | 'reset';
async function post(path: string, body: unknown, token?: string) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-swiftbuild-invitation': token } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (response.status === 429)
    throw new Error(
      'Too many attempts. Wait at least one minute before trying again.',
    );
  if (!response.ok)
    throw new Error(
      'The request was rejected. Check your details and invitation or recovery link, or contact your instance operator.',
    );
  return data as { url?: string };
}
export function AuthForm({
  mode,
  token,
  email,
  oidc,
  signedIn = false,
}: {
  mode: Mode;
  token?: string;
  email?: string;
  oidc: boolean;
  signedIn?: boolean;
}) {
  const [existing, setExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'The request failed. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    void run(async () => {
      if (mode === 'reset') {
        const password = String(values.get('password'));
        if (password !== values.get('confirmation'))
          throw new Error('The passwords do not match.');
        await post('/api/auth/reset-password', {
          token,
          newPassword: password,
        });
        setDone(true);
        return;
      }
      const credentials = {
        email: email ?? String(values.get('email')),
        password: String(values.get('password')),
      };
      if (mode === 'invite' && !existing) {
        await post(
          '/api/auth/sign-up/email',
          { ...credentials, name: String(values.get('name')) },
          token,
        );
        setExisting(true);
      }
      await post('/api/auth/sign-in/email', credentials, token);
      window.location.assign('/account');
    });
  }
  if (done)
    return (
      <p className="account-message" role="status">
        Password updated. <a href="/login">Sign in with your new password</a>.
      </p>
    );
  if (signedIn && mode === 'invite')
    return (
      <div className="account-actions">
        <p>
          Accept this invitation using your current account. The invited email
          must match your account.
        </p>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await post('/api/v1/invitations/accept', { token });
              window.location.assign('/account');
            })
          }
        >
          {busy ? 'Accepting…' : 'Accept invitation'}
        </Button>
        {error && (
          <p role="alert" className="account-error">
            {error}
          </p>
        )}
      </div>
    );
  return (
    <>
      <form className="account-form" onSubmit={submit} aria-busy={busy}>
        {mode === 'invite' && !existing && (
          <label>
            Name
            <input
              name="name"
              autoComplete="name"
              required
              maxLength={120}
              disabled={busy}
            />
          </label>
        )}
        {mode !== 'reset' && (
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              defaultValue={email}
              readOnly={!!email}
              disabled={busy}
            />
          </label>
        )}
        <label>
          {mode === 'reset' ? 'New password' : 'Password'}
          <input
            name="password"
            type="password"
            autoComplete={
              mode === 'login' || existing ? 'current-password' : 'new-password'
            }
            required
            minLength={mode === 'login' || existing ? undefined : 12}
            maxLength={128}
            disabled={busy}
            aria-describedby="password-help"
          />
        </label>
        <p id="password-help">
          {mode === 'login' || existing
            ? 'Need to recover access? Ask your instance operator for a one-time recovery link.'
            : 'Use 12–128 characters. A password manager can create and remember a strong password.'}
        </p>
        {mode === 'reset' && (
          <label>
            Confirm new password
            <input
              name="confirmation"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              disabled={busy}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="account-error">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy
            ? 'Please wait…'
            : mode === 'reset'
              ? 'Update password'
              : mode === 'invite' && !existing
                ? 'Create account'
                : 'Sign in'}
        </Button>
      </form>
      <div className="account-actions">
        {mode === 'invite' && (
          <Button
            disabled={busy}
            onClick={() => {
              setExisting(!existing);
              setError('');
            }}
          >
            {existing
              ? 'Create a new account instead'
              : 'Use an existing password account'}
          </Button>
        )}
        {oidc && mode !== 'reset' && (
          <>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await post('/api/auth/sign-in/social', {
                    provider: 'organization',
                    callbackURL: '/account',
                  });
                  if (!result.url)
                    throw new Error(
                      'Organizational sign-in is unavailable. Contact your instance operator.',
                    );
                  const target = new URL(result.url);
                  if (
                    target.protocol !== 'https:' &&
                    !(
                      target.protocol === 'http:' &&
                      ['localhost', '127.0.0.1'].includes(target.hostname)
                    )
                  )
                    throw new Error('The sign-in URL is invalid.');
                  window.location.assign(target.toString());
                })
              }
            >
              Sign in with your organization
            </Button>
            {mode === 'invite' && (
              <p>
                For an existing organizational account, sign in first, then
                reopen this invitation to accept it.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
export function SignOut() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="account-actions">
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await post('/api/auth/sign-out', {});
            window.location.assign('/login');
          } catch {
            setError('Sign-out failed. Try again.');
            setBusy(false);
          }
        }}
      >
        Sign out
      </Button>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
    </div>
  );
}
