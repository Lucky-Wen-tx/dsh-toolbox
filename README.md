# dsh-toolbox

A small toolbox for the DeepSeek-Harness Web UI. One package, one row per
feature, so a broken or disabled feature never takes the others down.

Currently shipped:

| Row | Feature |
|---|---|
| `dsh-toolbox-sessions` | Session cleanup: list sessions with their real on-disk size, archive one in place, and destroy it for good. |

## What the session row does

- **Settings → 会话管理 / Sessions** — a page listing sessions grouped by
  workspace: title, working directory, log size, `running` / `blank` / `archived`
  tags, nested subagent children, and any orphaned child whose parent is gone.
- Each card carries two actions: **归档 / Archive** on the left and
  **彻底删除 / Destroy** on the right.
  - **Archive** is the reversible step: it calls
    `workspaceRegistry.archiveSession`, the same state the sidebar's own menu
    uses, so the session disappears from the sidebar's default view without its
    log moving anywhere. The button becomes **取消归档 / Unarchive** once the
    card is archived.
  - **Destroy** stays disabled until the card is archived. Clicking it asks for
    confirmation, then removes the session's log directory, its projection cache
    and every registry entry that names it — together with its whole subagent
    subtree, which could never be opened once the parent is gone.
- An **orphaned subagent** (its parent is gone) can be destroyed directly: it has
  no sidebar row and therefore no archive flag, so nothing else could ever clean
  it up.

### Deliberate boundaries

- **Archive first, then destroy.** An unarchived session is refused
  (`409 session-not-archived`), so the irreversible click is never the first one.
- **A session this process still holds is refused** — `409 session-running` while
  a turn runs, `409 session-in-use` while an agent is loaded or the in-memory
  session store still holds the session. Its agent may still be writing the log,
  and the Host keeps listing a live session from memory after the files are gone.
- **Destroy leaves nothing behind:** the log directory with everything inside it,
  the session's record in the `session_projcache` storage domain (removed through
  the domain's own table, so a non-file backend is covered too, with the
  `sessions/<id>.json` and `<id>.json.bak.*` files as fallback), the workspace
  membership slot, the pin and the archive flag — for the session and for every
  subagent session below it. A child log is a sibling directory, invisible in the
  sidebar, and unopenable once its parent is gone, so it goes with the parent.
  Two things are deliberately untouched: `storages/workspace.json.bak`, which
  belongs to the storage backend, and the content-addressed attachment blobs
  under `<DSH_HOME>/attachments/v1`, which are shared by hash and cannot be
  attributed to a single session.
- **Nothing is deleted before it is found.** Destroy resolves every artifact
  directory first — the backend's own `sessionPersistence.locate()`, then the
  snapshot's `location`, then the documented layout — and refuses the whole
  subtree with `409 artifact-not-located` when a session the backend knows has no
  directory this build can reach. Clearing the registry while the log survives
  would hide the session from every list while leaving its bytes on disk.
- **One mutation at a time.** Archive, unarchive and destroy run through a
  per-plugin queue: two cards clicked in quick succession complete in order, so a
  destroy can never interleave its steps with another one and leave half the
  registry cleaned.
- **Leftovers are swept once.** On first read after start the row drops
  projection records no session answers for, project directories a destroy left
  empty, and archive flags whose session no longer exists. All three are derived
  or dangling state; an empty or failed session listing leaves everything alone.
- **No trash any more.** Earlier versions deleted a session by moving its log into
  `<DSH_HOME>/dsh-toolbox/trash/`; that model is gone. Logs still parked there are
  put back into the sessions root on first start — they keep their archive flag,
  so they appear as archived cards and the user decides whether to destroy them.
- Only public services are used: `sessionController.list()` for the rows,
  `sessionPersistence.list()` for sizes and paths, and
  `workspaceRegistry.archiveSession` / `unarchiveSession` / `unpinSession` plus
  `Workspace.detachSession` for the registry. `sessionPersistence.locate()` is
  read with an optional call because it is private in the typings but present at
  runtime. No private fields, no YAML surgery, no DOM scraping.
- After a destroy the client also asks the official session list to forget the
  id (`sessions.handleSessionRemoved`, then `refresh`) when this build exposes
  it, so the sidebar row disappears immediately instead of at the next refresh.
  Both calls are feature-detected; a build without them only means the row
  lingers.
- The package imports **no** `@deepseek-ai/*` module at runtime, so it installs
  and loads without a build step.

## Install

From a local checkout:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-toolbox
```

Or install the directory through the plugin manager, then restart `dsh web`.

## Layout

```
src/host/index.js     the host row: session view, archive toggle, destroy route
src/client/index.js   the client bundle: the settings page with its cards
cordis.patch.yml      one `insert` row per feature
test/smoke.mjs        route-level assertions on a fake context and temp DSH_HOME
test/client.mjs       loads the client bundle and renders the page with stub React
```

`npm test` runs both; neither needs a dependency, a build step, or a Host.

Adding a feature means: a new `src/host/<feature>.js` exporting
`name`/`inject`/`apply`, an `exports` entry in `package.json`, and one more row
in `cordis.patch.yml`.

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/dsh-toolbox/state` | grouped sessions and orphans in one read |
| POST | `/dsh-toolbox/archive` | archive one session (reversible) |
| POST | `/dsh-toolbox/unarchive` | undo that archive |
| POST | `/dsh-toolbox/purge` | permanent removal of one archived session |

`archive` answers `409 session-running` for a session executing a turn. `purge`
answers `409 session-not-archived`, `409 session-running`, `409 session-in-use`
when the Host still holds the session, and `409 artifact-not-located` when the
backend knows a log this build cannot resolve — in every case nothing is removed.

## License

MIT
