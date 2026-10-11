# Self-hosting SwiftBuild

Install Docker with a running Linux container engine, then run `docker compose up --build`. Open http://localhost:3000. Stop with `docker compose down`.

This image serves the standalone Next.js application and browser simulation worker. It runs as a non-root user and does not need an API, PostgreSQL, or a managed cloud service. Workspaces and checkpoints live in browser IndexedDB; there is no server project volume. Export project archives before changing origins or clearing browser data.

Use a reverse proxy and HTTPS for access beyond a local machine. There are no accounts or server authorization. Configure a private security reporting channel before publication. Future server persistence adds PostgreSQL migrations and persistent volumes. Offline browser storage availability and quotas vary by browser; failures are surfaced and in-memory work remains exportable.
