# dsh-toolbox

Session cleanup for the DeepSeek-Harness Web UI: list sessions with their real
on-disk footprint, archive one in place, and destroy it for good.

The package does one thing. It used to be a toolbox with one row per feature;
that scaffolding is gone, so the name is now historical and no second feature is
planned.

## What it does

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
  - **Destroy** stays disabled until the card is archived. Clicking it asks the
    Host what would be removed, confirms the subtree, bytes and registry entries
    with you, then removes the session's log directory, its projection cache and
    every registry entry that names it — together with its whole subagent
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
- **Work the archive gate would name is refused too.** Destroy asks the same
  `workspace/session-activity` waterfall the registry asks on archive, so a job or
  a schedule that still names the session blocks it with `409 session-active`
  instead of being left pointing at nothing.
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
  snapshot's `location`, then the documented layout. Backend-supplied paths are
  validated by content: the directory's name must be this id's injective encoding
  and it must hold a session log generation, which is what makes a profile with
  its own persistence root work without trusting an arbitrary path. Derived and
  scanned paths must still sit inside `<DSH_HOME>/sessions`. A session the
  backend knows but this build cannot resolve is refused with
  `409 artifact-not-located` instead of having its registry entry cleared while
  the log survives.
- **Deletion is retried, ordered, and reported.** Children are removed before
  their parent, a busy file is retried three times, and a directory that still
  cannot be removed is reported as `500 purge-partial` with the surviving ids;
  those keep their archive flag and workspace slot so the action can be retried.
- **One mutation at a time.** Archive, unarchive and destroy run through a
  per-plugin queue: two cards clicked in quick succession complete in order, so a
  destroy can never interleave its steps with another one and leave half the
  registry cleaned.
- **Mutating routes are same-origin only.** A browser request must arrive with
  `Sec-Fetch-Site: same-origin` (or an `Origin` that matches `Host`); anything
  else is `403 forbidden-origin`. A cross-origin page can send a `text/plain`
  "simple" POST to loopback without a preflight, and the body is JSON either way.
- **The confirmation is computed, not guessed.** The panel asks
  `POST /dsh-toolbox/preview` first and names the subtree, the bytes, the cache
  records, the workspaces and the pins that the destroy would remove.
- **Leftovers are swept once.** On first read after start the row drops
  projection records no session answers for, project directories a destroy left
  empty, and archive flags whose session no longer exists. All three are derived
  or dangling state; an empty or failed session listing leaves everything alone.
- **No trash.** Earlier versions moved a deleted log into
  `<DSH_HOME>/dsh-toolbox/trash/` and put it back on the next start; that
  migration is gone with its last release. A log still parked there is not
  touched any more — move the directory back under the sessions root yourself,
  then archive or destroy it from the panel as usual.
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
src/host/index.js      service wiring, the mutation queue, the routes
src/host/paths.js      on-disk layout, id encoding, directory validation
src/host/http.js       body reading, the id gate, the same-origin gate
src/host/view.js       both listings, the subagent tree, the panel's rows
src/host/mutations.js  archive, unarchive, preview, destroy
src/host/startup.js    the two post-start sweeps of leftover state
src/client/index.js    the client bundle: the settings page with its cards
cordis.patch.yml       the one `insert` row that mounts the host plugin
test/smoke.mjs         route-level assertions on a fake context and temp DSH_HOME
test/client.mjs        loads the client bundle and renders the page with stub React
```

`npm test` runs both; neither needs a dependency, a build step, or a Host.
The client stays one file on purpose: the Web loader executes the bundle as a
single module, so a local `import` there is not an option.

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/dsh-toolbox/state` | grouped sessions and orphans in one read |
| POST | `/dsh-toolbox/preview` | what destroying one session would remove, read-only |
| POST | `/dsh-toolbox/archive` | archive one session (reversible) |
| POST | `/dsh-toolbox/unarchive` | undo that archive |
| POST | `/dsh-toolbox/purge` | permanent removal of one archived session |

`archive` answers `409 session-running` for a session executing a turn,
`409 session-active` when a job or schedule still names it, and
`404 session-not-found` when neither memory nor persistence knows it. `purge`
answers `409 session-not-archived`, `409 session-running`, `409 session-in-use`
when the Host still holds the session, `409 session-active`, `409
artifact-not-located` when the backend knows a log this build cannot resolve, and
`500 purge-partial` with the surviving ids. Every mutating route answers
`403 forbidden-origin` for a cross-origin browser request. In every refusal case
nothing is removed.

## License

MIT
