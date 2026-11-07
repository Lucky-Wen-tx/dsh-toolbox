# dsh-toolbox

A small toolbox for the DeepSeek-Harness Web UI. One package, one row per
feature, so a broken or disabled feature never takes the others down.

Currently shipped:

| Row | Feature |
|---|---|
| `dsh-toolbox-sessions` | Session cleanup: list sessions with their real on-disk size, soft-delete into a recoverable trash, restore, purge. |

## What the session row does

- **Settings → 会话管理 / Sessions** — a page listing every stored session:
  title, working directory, log size, message count, `running` / `archived` /
  orphan-child tags, plus a trash section.
- **Session row "…" menu → 删除会话 / Delete session** — the same delete, one
  click from the sidebar.
- **Delete** archives the session (it disappears from the sidebar immediately)
  and moves its log directory into the trash. **Restore** puts both back.
  **Purge** deletes the log directory, the trash copy and the session's
  projection-cache record.

### Deliberate boundaries

- A **running** session is refused (`409 session-live`). A live agent cannot be
  disposed from outside its creator, so the plugin refuses instead of leaving a
  half-deleted session behind.
- Only public services are used: `sessionPersistence.list()` to read the
  corpus, `workspaceRegistry.archiveSession` / `unarchiveSession` for the
  archive flag. No private fields, no YAML surgery, no DOM scraping.
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
src/host/index.js     the host row: trash on disk + six HTTP routes
src/client/index.js   the client bundle: settings section + row menu item
cordis.patch.yml      one `insert` row per feature
```

Adding a feature means: a new `src/host/<feature>.js` exporting
`name`/`inject`/`apply`, an `exports` entry in `package.json`, and one more row
in `cordis.patch.yml`.

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/dsh-toolbox/state` | sessions + trash in one round trip |
| GET | `/dsh-toolbox/trash` | trash entries only |
| POST | `/dsh-toolbox/delete` | archive + move to trash |
| POST | `/dsh-toolbox/restore` | move back + un-archive |
| POST | `/dsh-toolbox/purge` | permanent removal |

## License

MIT
