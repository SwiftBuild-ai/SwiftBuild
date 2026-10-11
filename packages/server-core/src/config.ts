import type { IdentityConfig } from './identity';
export function identityConfig(
  env: NodeJS.ProcessEnv = process.env,
): IdentityConfig {
  const url = env.SWIFTBUILD_URL;
  const secret = env.SWIFTBUILD_AUTH_SECRET;
  if (!url || !secret)
    throw new Error('Configure SWIFTBUILD_URL and SWIFTBUILD_AUTH_SECRET.');
  const oidc = [
    env.SWIFTBUILD_OIDC_DISCOVERY_URL,
    env.SWIFTBUILD_OIDC_CLIENT_ID,
    env.SWIFTBUILD_OIDC_CLIENT_SECRET,
  ];
  if (oidc.some(Boolean) && !oidc.every(Boolean))
    throw new Error('Organizational sign-in requires all three OIDC settings.');
  return {
    url,
    secret,
    allowLocalHttp: env.SWIFTBUILD_ALLOW_LOCAL_HTTP === '1',
    oidc: oidc.every(Boolean)
      ? { discoveryUrl: oidc[0]!, clientId: oidc[1]!, clientSecret: oidc[2]! }
      : undefined,
  };
}
