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
import { api, createProject, downloadArchive } from '../client/project-api';
import { AccountShell } from './account-shell';
type Revision = { revision: number; createdAt: string; actorId: string };
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
      ),
  );
  const [ready, setReady] = useState(false),
    [recovery, setRecovery] = useState<Recovery | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [revision, setRevision] = useState(project.revision);
  const latest = useRef(project.archive),
    confirmed = useRef(project.archive),
    copyOperation = useRef(crypto.randomUUID());
  const [history, setHistory] = useState<Revision[] | null>(null),
    [before, setBefore] = useState<number | null>(null);
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
              {project.role !== 'viewer' && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await createProject(
                        project.workspaceId,
                        recovery.archive,
                        copyOperation.current,
                      );
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
                    setReady(true);
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
      <Workbench
        initialArchive={project.archive}
        storage={storage}
        onArchiveChange={onArchiveChange}
      />
      {history && (
        <Modal
          open={true}
          onOpenChange={(open) => {
            if (!open) setHistory(null);
          }}
          title="Saved revisions"
          description="Each revision is immutable. Export a prior archive without replacing your current work."
        >
          <ul className="project-list">
            {history.map((item) => (
              <li key={item.revision}>
                <span>
                  Revision {item.revision} ·{' '}
                  {new Date(item.createdAt).toLocaleString()}
                </span>
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
          <Button onClick={() => setHistory(null)}>
            Close revision history
          </Button>
        </Modal>
      )}
    </div>
  );
}
