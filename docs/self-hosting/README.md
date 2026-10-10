# Self-hosting the bootstrap

Install Docker with a running Linux container engine, then run `docker compose up --build`. Open http://localhost:3000. Stop with `docker compose down`.

This image serves the standalone Next.js application. It runs as a non-root user and does not need an API, PostgreSQL, or a managed cloud service. Drafts live in browser storage; there is no server project volume. Export JSON backups before changing origins or clearing browser data.

Use a reverse proxy and HTTPS for access beyond a local machine. This bootstrap has no accounts or server authorization. Configure a private security reporting channel before publication. Future server persistence adds PostgreSQL migrations and persistent volumes.
