# Self-hosting SwiftBuild

## Run the current application

Use a container engine supporting Linux containers and run:

```sh
docker compose up --build
```

Open http://localhost:3000. Stop with `docker compose down`. The `PORT` variable in `.env.example` controls the published host port; the container serves port 3000.

The image serves the standalone web application and browser simulation worker as a non-root user. The image has an HTTP health check, and the verification workflow defines a container startup smoke check. A configured check is not evidence that deployment has passed on a particular host; see [current verification](../status.md).

## Storage and recovery

The current application has no server document API, database, accounts, team permissions or server project volume. Each browser and origin has its own workspace, checkpoints and run summaries in transactional IndexedDB. Restarting or replacing a container does not back up that browser data. Serving the same application to multiple people does not share their architectures.

Export a project archive before changing hostname, scheme or port, moving browsers, or clearing site data. Native architecture JSON preserves the current model; project archives also preserve checkpoint bodies and saved engineering evidence. Test recovery by importing an archive into a separate browser profile and inspecting its model and checkpoints. Imported runs remain historical until recomputed. See [file formats and limits](../architecture/native-format.md).

Storage quotas, eviction and private-browsing behavior vary. Failed writes are surfaced and in-memory work remains exportable. After a stale-tab conflict, export the unsaved model before reloading. There is no automatic cross-device synchronization or server backup.

## Operating boundaries

Use a reverse proxy and HTTPS beyond a local machine. The current application does not provide user authentication or server authorization; operators must provide any required network access restriction. Do not store credentials in architecture documents. Configure a verified private reporting channel before inviting sensitive reports; see [security](../../SECURITY.md).

Durable project storage, database migrations, authorization, backup/restore procedures, audit events and job processing are mandatory target capabilities in the [roadmap](../roadmap.md), not current deployment instructions.
