// Keep disposable schema lifecycles sequential: identity initialization introspects database schemas.
// Concurrent writes and migration races are exercised explicitly inside these suites.
import './projects.integration.test.suite';
import './identity.integration.test.suite';
import './identity-oidc.integration.test.suite';
