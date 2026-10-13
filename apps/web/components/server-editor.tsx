'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Workbench, type WorkbenchStorage } from '@swiftbuild/canvas';
import { Button, Modal } from '@swiftbuild/ui';
import {
  validateArchive,
  type ProjectArchive,
} from '@swiftbuild/canvas/workspace';
import {
  BrowserProjectRecovery,
  type Recovery,
} from '../client/project-recovery';
import {
  ServerWorkspace,
  sameArchive,
  type ServerProject,
} from '../client/server-workspace';
import { api, downloadArchive } from '../client/project-api';
import { AccountShell } from './account-shell';
import { ProjectCreation } from '../client/project-creation';
import { analysisAdapter } from '../client/analysis-api';
type Revision = {
  revision: number;
  createdAt: string;
  actorId: string;
  sourceRevision?: number | null;
};
export function ServerEditor({
  project,
  userId,
}: {
  project: ServerProject;
  userId: string;
}) {
  const [adapter] = useState(
    () =>
      new ServerWorkspace(
        project,
        new BrowserProjectRecovery(userId + ':' + project.id),
        undefined,
        userId,
      ),
  );
  const [ready, setReady] = useState(false),
    [recovery, setRecovery] = useState<Recovery | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [revision, setRevision] = useState(project.revision);
  const [analysis] = useState(() =>
    analysisAdapter(
      project.id,
      () => adapter.confirmedRevision,
      project.role !== 'viewer',
      userId,
    ),
  );
  const latest = useRef(project.archive),
    confirmed = useRef(project.archive);
  const [creation] = useState(() => new ProjectCreation(userId));
  const [history, setHistory] = useState<Revision[] | null>(null),
    [before, setBefore] = useState<number | null>(null);
  const [preview, setPreview] = useState<ServerProject | null>(null);
  const [restoring, setRestoring] = useState(false);
  const onArchiveChange = useCallback((archive: ProjectArchive) => {
    latest.current = archive;
    setDirty(!sameArchive(archive, confirmed.current));
  }, []);
  const [storage] = useState<WorkbenchStorage>(() => ({
    locationLabel:
      project.role === 'viewer' ? 'Local preview' : 'Server workspace',
    savedLabel:
      project.role === 'viewer' ? 'Preview saved locally' : 'Saved to server',
    description:
      project.role === 'viewer'
        ? 'Viewer access: edits are local previews. They never change this server project. Export a project archive to keep your preview.'
        : 'Server saves are revision checked. A separate local recovery copy is retained before each save. Browser-local drafts are independent.',
    createAdapter: () => ({
      read: () => adapter.read(),
      write: async (archive) => {
        try {
          await adapter.write(archive);
          confirmed.current = archive;
          setDirty(!sameArchive(latest.current, archive));
          setRevision(adapter.confirmedRevision);
          setError('');
        } catch (failure) {
          setDirty(true);
          setError(
            failure instanceof Error
              ? failure.message
              : 'Save failed. Export your work.',
          );
          throw failure;
        }
      },
    }),
  }));
  useEffect(() => {
    let active = true;
    void adapter
      .inspectRecovery()
      .then((value) => {
        if (active) {
          setRecovery(value);
          if (!value) setReady(true);
        }
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [adapter]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'The request failed.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (!ready)
    return (
      <AccountShell>
        <div className="eyebrow">PROJECT RECOVERY</div>
        <h1>{recovery ? 'Preserve your recovery copy' : 'Opening project…'}</h1>
        {recovery && (
          <>
            <p>
              This browser has unsaved work or an unconfirmed operation for this
              project. It has not replaced the server revision. Export it, save
              a separate project, or explicitly open the server copy.
            </p>
            <div className="account-actions">
              <Button onClick={() => downloadArchive(recovery.archive)}>
                Export recovery archive
              </Button>
              {project.role !== 'viewer' &&
                recovery.pending?.kind === 'restore' && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await adapter.retryRestore();
                        window.location.reload();
                      })
                    }
                  >
                    Retry restoration of revision{' '}
                    {recovery.pending.sourceRevision}
                  </Button>
                )}
              {project.role !== 'viewer' && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (await creation.read(project.workspaceId))
                        throw new Error(
                          'An unconfirmed creation already exists. Open projects to retry or export it.',
                        );
                      const intent = await creation.prepare(
                        project.workspaceId,
                        recovery.archive,
                      );
                      const result = await creation.submit(intent);
                      window.location.assign('/projects/' + result.id);
                    })
                  }
                >
                  Save recovery as separate project
                </Button>
              )}
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await adapter.openServerRevision();
                    setRecovery(null);
                    window.location.reload();
                  })
                }
              >
                Discard local recovery and open server revision
              </Button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="account-error">
            {error}
          </p>
        )}
        <p>
          <a href="/projects">Back to projects</a>
        </p>
      </AccountShell>
    );
  return (
    <div className="server-editor">
      <header className="server-project-bar">
        <a href="/projects" target="_blank" rel="noopener">
          Projects (new tab)
        </a>
        <span>
          {project.role === 'viewer'
            ? 'Read-only server · editable local preview'
            : `Server project · revision ${revision}`}
        </span>
        <Button onClick={() => downloadArchive(latest.current)}>
          Export current archive
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await api<{
                items: Revision[];
                nextCursor: number | null;
              }>(`projects/${project.id}/revisions`);
              setHistory(result.items);
              setBefore(result.nextCursor);
            })
          }
        >
          Revision history
        </Button>
      </header>
      {error && (
        <div role="alert" className="server-project-error">
          {error}{' '}
          <Button onClick={() => downloadArchive(latest.current)}>
            Export preserved work
          </Button>
        </div>
      )}
      {!restoring && (
        <Workbench
          analysis={analysis}
          analysisDirty={dirty}
          initialArchive={project.archive}
          storage={storage}
          onArchiveChange={onArchiveChange}
        />
      )}
      {history && (
        <Modal
          open={true}
          onOpenChange={(open) => {
            if (!open && !busy) {
              setHistory(null);
              setPreview(null);
            }
          }}
          title="Saved revisions"
          description="Inspect or export an immutable archive. Restoration creates a new attributed revision."
        >
          <ul className="project-list revision-history-list">
            {history.map((item) => (
              <li key={item.revision}>
                <span>
                  Revision {item.revision} ·{' '}
                  {new Date(item.createdAt).toLocaleString()}
                  {item.sourceRevision
                    ? ` · restored from revision ${item.sourceRevision}`
                    : ''}
                </span>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const snapshot = await api<ServerProject>(
                        `projects/${project.id}?revision=${item.revision}`,
                      );
                      setPreview({
                        ...snapshot,
                        archive: validateArchive(snapshot.archive),
                      });
                    })
                  }
                >
                  Preview revision {item.revision}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const snapshot = await api<ServerProject>(
                        `projects/${project.id}?revision=${item.revision}`,
                      );
                      downloadArchive(
                        validateArchive(snapshot.archive),
                        `swiftbuild-revision-${item.revision}.json`,
                      );
                    })
                  }
                >
                  Export revision {item.revision}
                </Button>
              </li>
            ))}
          </ul>
          {preview && (
            <section aria-label={`Preview of revision ${preview.revision}`}>
              <h3>
                Revision {preview.revision}:{' '}
                {preview.archive.document.project.name}
              </h3>
              <p>
                {preview.archive.document.architecture.name} ·{' '}
                {preview.archive.document.nodes.length} components ·{' '}
                {preview.archive.document.edges.length} connections ·{' '}
                {preview.archive.checkpoints.length} checkpoints
              </p>
              <ul>
                {preview.archive.document.nodes.map((node) => (
                  <li key={node.id}>{node.name || node.id}</li>
                ))}
              </ul>
              <p>
                Restore revision {preview.revision} as a new revision after
                current revision {revision}. Earlier history and analysis
                reports remain attached to their original revisions.
              </p>
              {dirty && (
                <p role="status">
                  Preserve unsaved work and resolve pending saves before
                  restoring. Export current work or complete its save first.
                </p>
              )}
              {project.role !== 'viewer' && (
                <Button
                  disabled={busy || dirty}
                  onClick={() =>
                    void run(async () => {
                      if (!sameArchive(latest.current, confirmed.current))
                        throw new Error(
                          'Preserve unsaved work before restoring.',
                        );
                      setRestoring(true);
                      try {
                        await adapter.restore(
                          preview.revision,
                          preview.archive,
                        );
                        window.location.reload();
                      } catch (failure) {
                        setRestoring(false);
                        const retained = await adapter.inspectRecovery();
                        setRecovery(retained);
                        if (retained) setReady(false);
                        throw failure;
                      }
                    })
                  }
                >
                  Restore revision {preview.revision} as a new revision
                </Button>
              )}
            </section>
          )}
          {before && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api<{
                    items: Revision[];
                    nextCursor: number | null;
                  }>(`projects/${project.id}/revisions?before=${before}`);
                  setHistory((previous) => [
                    ...(previous ?? []),
                    ...result.items,
                  ]);
                  setBefore(result.nextCursor);
                })
              }
            >
              Older revisions
            </Button>
          )}
          <Button
            disabled={busy}
            onClick={() => {
              setHistory(null);
              setPreview(null);
            }}
          >
            Close revision history
          </Button>
        </Modal>
      )}
    </div>
  );
}
