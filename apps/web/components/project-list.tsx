'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@swiftbuild/ui';
import { blankDocument } from '@swiftbuild/components-core';
import {
  IndexedWorkspace,
  readLegacyDraft,
  validateArchive,
  workspaceFor,
  importArchive,
  MAX_ARCHIVE_BYTES,
  type ProjectArchive,
} from '@swiftbuild/canvas/workspace';
import { api, createProject } from '../client/project-api';
export type Workspace = {
  id: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
};
type Project = {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
};
type Cursor = { id: string; updatedAt: string };
export function ProjectList({
  initialWorkspaces,
}: {
  initialWorkspaces: Workspace[];
}) {
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const [workspaces, setWorkspaces] = useState(initialWorkspaces),
    [workspaceCursor, setWorkspaceCursor] = useState(
      initialWorkspaces.length === 100 ? initialWorkspaces.at(-1)!.id : null,
    );
  const [selected, setSelected] = useState(initialWorkspaces[0]?.id ?? ''),
    [projects, setProjects] = useState<Project[]>([]),
    [cursor, setCursor] = useState<Cursor | null>(null);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [name, setName] = useState('');
  const [pending, setPending] = useState<{
    archive: ProjectArchive;
    operationId: string;
    workspaceId: string;
  } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const canWrite = workspaces.find((w) => w.id === selected)?.role !== 'viewer';
  useEffect(() => {
    const current = ++generation.current;
    setProjects([]);
    setCursor(null);
    if (!selected) return;
    setLoading(true);
    setError('');
    void api<{ items: Project[]; nextCursor: Cursor | null }>(
      'projects?workspaceId=' + encodeURIComponent(selected),
    )
      .then((result) => {
        if (generation.current === current) {
          setProjects(result.items);
          setCursor(result.nextCursor);
        }
      })
      .catch((failure) => {
        if (generation.current === current) setError(failure.message);
      })
      .finally(() => {
        if (generation.current === current) setLoading(false);
      });
    return () => {
      generation.current = current + 1;
    };
  }, [selected]);
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
  async function submitArchive(archive: ProjectArchive) {
    const candidate = {
      archive,
      operationId: crypto.randomUUID(),
      workspaceId: selected,
    };
    setPending(candidate);
    const result = await createProject(
      candidate.workspaceId,
      candidate.archive,
      candidate.operationId,
    );
    window.location.assign('/projects/' + result.id);
  }
  return (
    <fieldset
      className="project-fields"
      disabled={!interactive}
      aria-label="Project actions"
    >
      <div className="project-tools">
        <label>
          Workspace
          <select
            value={selected}
            disabled={busy || !!pending}
            onChange={(event) => setSelected(event.target.value)}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} · {w.role}
              </option>
            ))}
          </select>
        </label>
        {workspaceCursor && (
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await api<{
                  items: Workspace[];
                  nextCursor: string | null;
                }>('workspaces?after=' + workspaceCursor);
                setWorkspaces((previous) => [...previous, ...result.items]);
                setWorkspaceCursor(result.nextCursor);
              })
            }
          >
            More workspaces
          </Button>
        )}
      </div>
      {!selected && (
        <p>
          No workspace memberships are available. Ask your instance operator for
          an invitation.
        </p>
      )}
      {selected && canWrite && (
        <form
          className="project-create"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const document = blankDocument();
              document.project.name = name.trim();
              await submitArchive(workspaceFor(document));
            });
          }}
        >
          <label>
            New project name
            <input
              required
              maxLength={120}
              value={name}
              disabled={busy || !!pending}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !!pending || !name.trim()}
          >
            Create project
          </Button>
        </form>
      )}
      {selected && canWrite && (
        <div className="project-actions">
          <Button
            disabled={busy || !!pending}
            onClick={() => file.current?.click()}
          >
            Import project archive
          </Button>
          <Button
            disabled={busy || !!pending}
            onClick={() =>
              void run(async () => {
                const stored = await new IndexedWorkspace().read();
                let archive: ProjectArchive;
                if (stored !== null) archive = validateArchive(stored);
                else {
                  const legacy = readLegacyDraft();
                  if (legacy === null)
                    throw new Error(
                      'No saved local draft is available. Save your local work first.',
                    );
                  if (new TextEncoder().encode(legacy).length > 5 * 1024 * 1024)
                    throw new Error(
                      'The legacy draft exceeds its import limit.',
                    );
                  archive = validateArchive({
                    ...workspaceFor(blankDocument()),
                    document: JSON.parse(legacy),
                  });
                }
                await submitArchive(archive);
              })
            }
          >
            Copy saved local draft to server
          </Button>
          <input
            hidden
            ref={file}
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              const input = event.currentTarget;
              const selectedFile = input.files?.[0];
              input.value = '';
              if (selectedFile)
                void run(async () => {
                  if (selectedFile.size > MAX_ARCHIVE_BYTES)
                    throw new Error('Project archives must be at most 50 MiB.');
                  await submitArchive(
                    importArchive(await selectedFile.text(), Date.now()),
                  );
                });
            }}
          />
        </div>
      )}
      {selected && (
        <p className="project-note">
          {canWrite
            ? 'Import and copy actions upload a complete archive only when selected. The saved browser draft stays intact; unsaved edits in another tab are not included.'
            : 'Viewer access: open projects for inspection and local previews. Server saves are disabled.'}
        </p>
      )}
      {pending && (
        <div className="project-actions">
          <p>
            The create response is unconfirmed. Retry with the same operation to
            avoid duplicate projects.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await createProject(
                  pending.workspaceId,
                  pending.archive,
                  pending.operationId,
                );
                window.location.assign('/projects/' + result.id);
              })
            }
          >
            Retry project creation
          </Button>
          <Button disabled={busy} onClick={() => setPending(null)}>
            Cancel retry
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      <div role="status" className="project-note">
        {loading ? 'Loading projects…' : `${projects.length} projects loaded`}
      </div>
      <ul className="project-list">
        {projects.map((project) => (
          <li key={project.id}>
            <a href={'/projects/' + project.id}>{project.name}</a>
            <span>
              Revision {project.revision} ·{' '}
              {new Date(project.updatedAt).toLocaleString()}
            </span>
            <a href={`/api/v1/projects/${project.id}/export`}>Export archive</a>
          </li>
        ))}
      </ul>
      {cursor && (
        <Button
          disabled={busy || loading}
          onClick={() =>
            void run(async () => {
              const current = generation.current;
              const result = await api<{
                items: Project[];
                nextCursor: Cursor | null;
              }>(
                `projects?workspaceId=${selected}&afterId=${cursor.id}&beforeUpdatedAt=${encodeURIComponent(cursor.updatedAt)}`,
              );
              if (generation.current === current) {
                setProjects((previous) => [...previous, ...result.items]);
                setCursor(result.nextCursor);
              }
            })
          }
        >
          More projects
        </Button>
      )}
    </fieldset>
  );
}
