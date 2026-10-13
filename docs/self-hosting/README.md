# Self-hosting SwiftBuild

## Run the current application

Use a container engine supporting Linux containers and run:

```sh
docker compose up --build
```

Open http://localhost:3000. Stop with `docker compose down`. The `PORT` variable in `.env.example` controls the published host port; the container serves port 3000.

The image serves the standalone web application and browser simulation worker as a non-root user. The image has an HTTP health check, and the verification workflow defines a container startup smoke check. A configured check is not evidence that deployment has passed on a particular host; see [current verification](../status.md).

## Storage and recovery

The default compose configuration runs browser-local mode. Each browser and origin has its own workspace, checkpoints and run summaries in transactional IndexedDB. Restarting or replacing a container does not back up that browser data. Serving the same application to multiple people does not share their architectures.

Export a project archive before changing hostname, scheme or port, moving browsers, or clearing site data. Native architecture JSON preserves the current model; project archives also preserve checkpoint bodies and saved engineering evidence. Test recovery by importing an archive into a separate browser profile and inspecting its model and checkpoints. Imported runs remain historical until recomputed. See [file formats and limits](../architecture/native-format.md).

Storage quotas, eviction and private-browsing behavior vary. Failed writes are surfaced and in-memory work remains exportable. After a stale-tab conflict, export the unsaved model before reloading. There is no automatic upload of local drafts. Optional server database backup/restore is described in the [computation deployment guide](computation.md).

## Optional server accounts and API

The web host implements server identity and project APIs backed by an operator-provided relational database. It does not apply migrations automatically. Account screens are available at `/login`, `/invite`, `/reset-password` and `/account`. `/projects` lists authorized workspaces/projects and creates/imports archives; `/projects/PROJECT_ID` opens the authorized server editor. The native document/archive contracts are unchanged. See [HTTP contracts](../server-api.md) and [server package](../../packages/server-core/README.md).

Server saves first retain a separate browser recovery record, then submit the expected revision and a retained operation ID. Stale writes preserve work and stop network saves. Reopening offers export, a separately authorized project copy, or explicit discard of the local recovery. Revision history previews and exports immutable saved archives. Owners/editors may explicitly restore a prior archive into a new attributed revision after resolving unsaved work. Lost restore responses retain an explicit retry across reload. Viewers can inspect and edit local previews but cannot save server revisions. Copying a saved local draft uploads its complete archive only after an explicit action, leaving local storage intact; unsaved edits in another tab are excluded.

Recovery remains browser/origin-specific. Sign-out retains it, and the account screen can clear confirmed copies while preserving unsaved and other-user records. These keys are not encryption or shared-device access control. Export unsaved recovery before replacing the browser or its site data. An offline open editor can preserve/export in-memory work; reopening its server page needs a reachable server and authorized session. Creation/copy intents persist before submission and survive reload. Open projects in the original workspace to explicitly retry or export an unresolved creation. The original payload and operation ID are retained; failed storage prevents upload. Pending workspaces remain listed locally for the signed-in actor even after membership revocation, so export remains available; retries still require server authorization.

For loopback development, first provision a dedicated database and install the repository dependencies. Set configuration in the shell used for both operator commands and the application. A PowerShell example follows; replace the connection placeholder with your private database connection:

```powershell
$env:DATABASE_URL = 'DATABASE_CONNECTION'
$env:SWIFTBUILD_URL = 'http://localhost:3000'
$env:SWIFTBUILD_AUTH_SECRET = node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))"
$env:SWIFTBUILD_ALLOW_LOCAL_HTTP = '1'
pnpm server:operator migrate
pnpm server:operator bootstrap --email owner@example.test
pnpm dev
```

Keep the generated secret stable across application restarts and store it privately. Bootstrap prints a one-time invitation link for the first administrator; deliver it privately and open it to create the account. Additional members use `pnpm server:operator invite --email member@example.test --workspace WORKSPACE_ID --role editor`. Recovery uses `pnpm server:operator recover --email owner@example.test`; opening the printed recovery link permits a new password and revokes old sessions. No SMTP or mandatory email service is required. Links are secrets and belong outside public logs/issues. If the initial bootstrap link is lost or expired before admission, run `pnpm server:operator bootstrap-rotate --email owner@example.test`. Rotation revokes every unused bootstrap link and prints one replacement valid for 24 hours. It refuses after bootstrap admission, including disabled administrators; use existing-account recovery then. If rotation interrupts account creation after credentials were recorded but before admission, open the replacement invitation and choose the existing-account sign-in action.

Configure all three `SWIFTBUILD_OIDC_*` variables from `.env.example` together to enable organizational sign-in. The configured discovery endpoint and application origin require HTTPS beyond explicit loopback development. A signed local protocol fixture is verified; each deployed organization still needs its own end-to-end check. Existing accounts require explicit identity linking rather than automatic same-email linking.

Use a separate migration connection with schema-change permission; the application runtime should use a role without schema ownership. The operator currently reads `DATABASE_URL` from its process environment, so select the appropriate connection for each process. The optional [full-server configuration](computation.md) adds database/runtime-role provisioning, isolated engineering workers and a backup/restore smoke workflow. The default Compose configuration remains browser-local.

`/api/health` checks web process liveness. `/api/v1/ready` checks database connectivity and exact migration checksums. Neither is a backup recovery or security guarantee. Source-based production startup uses `pnpm build` followed by `pnpm --filter @swiftbuild/web start` with the configured environment; stop it before rebuilding on Windows.

## Operating boundaries

Use a reverse proxy and HTTPS beyond a local machine. Optional server APIs enforce session admission and workspace roles; the browser-local workbench remains accessible independently. Operators must configure any required network restriction and verify their deployment. Do not store credentials in architecture documents. Configure a verified private reporting channel before inviting sensitive reports; see [security](../../SECURITY.md).

The complete operational backend and production recovery validation remain mandatory target capabilities in the [roadmap](../roadmap.md). Storage, identity, HTTP and server editing workflows are implemented; creation recovery, revision restoration and bootstrap rotation are now implemented and tested. Production operational recovery remains a separate completion gate.
