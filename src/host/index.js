/**
 * dsh-toolbox — session cleanup (host row `dsh-toolbox-sessions`).
 *
 * What this row owns:
 *   - the archive toggle the panel offers (`workspaceRegistry.archiveSession` /
 *     `unarchiveSession` — the same public calls the sidebar's own menu uses)
 *   - permanent destruction: a session's log directory, its projection cache,
 *     and every registry entry that still names it
 *   - the one-time retirement of the `delete → trash → restore` model of
 *     earlier versions, and of the dead archive flags that model left behind
 *
 * What it deliberately does NOT own:
 *   - the archive flag's storage (that belongs to `workspaceRegistry`; this row
 *     only calls its public methods)
 *   - session logs themselves (they belong to `sessionPersistence`; this row
 *     deletes them on request and never stages a copy)
 *   - workspace accounting (we call `Workspace.detachSession`)
 *   - the meaning of "running" or "held open" (we read `sessionController.list()`,
 *     the same source the sidebar uses)
 *
 * Archiving is required before destruction: it is the reversible step, so the
 * irreversible click is never the first one. A session this process still holds
 * open is refused as well — its agent may still be writing the log, and the
 * Host keeps listing a live session from memory after the files are gone, which
 * would make "destroyed" mean anything but gone.
 *
 * Destruction is meant to leave nothing behind. It removes the log directory
 * (with everything inside it), the projection-cache record, the workspace
 * membership slot, the pin and the archive flag, so neither the panel, the
 * sidebar, nor `storages/workspace.json` can be made to name the session again.
 *
 * Grouping follows the official rule (ui-workspace `groupByWorkspace`): a
 * session belongs to the workspace whose `sessionIds` lists it; anything
 * unlisted falls into the Ungrouped bucket. Subagent children never render as
 * ordinary rows — they nest under their parent, and a child whose parent is
 * gone is reported separately so it can be cleaned up.
 *
 * Everything here is plain ESM with zero `@deepseek-ai/*` imports, so the
 * package installs and loads without a build step.
 */
import { mkdir, readFile, rename, rm, rmdir } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-toolbox-sessions'
/** Services are resolved through a scoped `ctx.inject` in `apply`. */
export const inject = []

const ROUTE_PREFIX = '/dsh-toolbox'
const MAX_BODY_BYTES = 64 * 1024
/**
 * Session ids are joined into a path, so keep the charset tight. A bare `.`
 * or `..` is rejected separately: both match this charset but resolve to a
 * parent directory, so a delete would target the wrong directory.
 */
const SESSION_ID_RE = /^[A-Za-z0-9_.:-]+$/
const DOT_SEGMENT_RE = /^\.+$/

// ── paths ──────────────────────────────────────────────────────────────────

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}
function sessionsRoot() {
  return join(dshHome(), 'sessions')
}
/**
 * The projection cache keeps one record per session. Destroying a session
 * without it leaves an orphan record behind (a real complaint against
 * comparable plugins), so purge removes it too.
 *
 * The directory and the record's file name are the shipped json backend's
 * `per-record` layout; the supported way to remove a record is the storage
 * domain's table (see `dropProjectionRecord`). These paths are the fallback
 * for a build where that domain is not open, and for the `.bak` copies the
 * cache leaves behind when it refuses a stored record.
 */
function projectionCacheDir() {
  return join(dshHome(), 'storages', 'session_projcache', 'sessions')
}
function projectionCacheFile(sessionId) {
  return join(projectionCacheDir(), `${sessionId}.json`)
}
/**
 * The `<key>.json.bak.<stamp>` copies the cache moves a rejected record to.
 * The backend names a per-record document by its raw key, so the prefix is the
 * session id itself — no path encoding is involved.
 */
function projectionCacheBackups(sessionId) {
  const dir = projectionCacheDir()
  if (!existsSync(dir)) return []
  const prefix = `${sessionId}.json.bak.`
  try {
    return readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .map((name) => join(dir, name))
  } catch {
    return []
  }
}
/** Where versions before 0.2 kept deleted logs, until the upgrade retires it. */
function legacyTrashRoot() {
  return join(dshHome(), 'dsh-toolbox', 'trash')
}
function legacyTrashIndex() {
  return join(dshHome(), 'dsh-toolbox', 'trash.json')
}

/**
 * One path segment, encoded the way `dsh-session-persistence-jsonl` encodes
 * it: `[A-Za-z0-9._-]` survives, everything else becomes `~XXXX` (uppercase,
 * 4 hex digits). `~` itself is escaped, so the mapping is injective.
 *
 * This is a copy of the backend's own rule, not a guess: a session whose
 * snapshot is unreadable still has to be located by id alone, and a near-miss
 * here would point a delete at the wrong directory.
 */
function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/**
 * The project directory key for one working directory: separators and drive
 * colons collapse to a single `-`, other unsafe code units use the same
 * `~XXXX` escape, and the result is wrapped in `--…--`.
 *
 * `D:\Code\Personal\dsh-toolbox` becomes `--D-Code-Personal-dsh-toolbox--`,
 * which is the layout on disk.
 */
function projectKey(cwd) {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/**
 * The directory a session's log lives in, derived from its header alone:
 * `<DSH_HOME>/sessions/<projectKey(cwd)>/<encodeSegment(id)>`.
 *
 * `undefined` when the header carries no cwd, because that layout puts the
 * session under `_no-cwd` and guessing another bucket is worse than reporting
 * that the path cannot be rebuilt.
 */
function derivedSessionDir(cwd, sessionId) {
  if (typeof cwd !== 'string' || cwd === '') return undefined
  try {
    return join(sessionsRoot(), projectKey(cwd), encodeSegment(sessionId))
  } catch {
    return undefined
  }
}

/** Whether `candidate` is a real directory strictly inside the sessions root. */
function isInsideSessionsRoot(candidate) {
  if (typeof candidate !== 'string' || candidate === '') return false
  const root = resolve(sessionsRoot())
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`
  const resolved = resolve(candidate)
  // Case-insensitive on Windows, where `D:\` and `d:\` name one directory.
  const comparable = process.platform === 'win32'
    ? [resolved.toLowerCase(), normalizedRoot.toLowerCase()]
    : [resolved, normalizedRoot]
  if (!comparable[0].startsWith(comparable[1])) return false
  // A bare `sessions` root or one of its project directories is not a session
  // directory, so the segment below the root must be two levels deep.
  return relative(root, resolved).split(sep).filter(Boolean).length >= 2
}

// ── small helpers ──────────────────────────────────────────────────────────

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('body-too-large'))
      }
    })
    req.on('end', () => {
      if (data === '') return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

function respond(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function parseSessionId(body) {
  const value = body && typeof body === 'object' ? body.sessionId : undefined
  if (typeof value !== 'string' || !SESSION_ID_RE.test(value)) return undefined
  // `.` and `..` pass the charset but name a directory, not a session.
  if (DOT_SEGMENT_RE.test(value)) return undefined
  return value
}

/** The `header` of a persistence snapshot, tolerating a bare header. */
function headerOf(item) {
  return item && item.header ? item.header : item
}

/**
 * The backend's own answer for where one session's log lives.
 *
 * `sessionPersistence.locate()` is `private` in the 0.2.x typings but present
 * at runtime, and it is the only source that knows a persistence root this
 * plugin did not derive. It is asked first and validated exactly like every
 * other candidate: a path outside the sessions root is ignored, never deleted.
 */
function backendLocation(persistence, header) {
  if (persistence === undefined || header === undefined) return undefined
  let found
  try {
    found = persistence.locate?.(header)
  } catch {
    return undefined
  }
  if (found === null || typeof found !== 'object') return undefined
  const path = found.path
  if (typeof path !== 'string') return undefined
  const dir = path.endsWith('.jsonl') || path.endsWith('.zstd') ? dirname(path) : path
  return existsSync(dir) && isInsideSessionsRoot(dir) ? dir : undefined
}

/**
 * Locate one session's artifact directory.
 *
 * Preferred sources, in order: the backend's `locate()`, the snapshot's own
 * `location.path`, then the on-disk layout
 * `<DSH_HOME>/sessions/<projectKey(cwd)>/<encoded id>/`.
 *
 * Every candidate must resolve inside the sessions root, so a snapshot that
 * points somewhere else cannot make a destroy delete an unrelated directory.
 */
function locateSessionDir(persistence, snapshot, sessionId, cwd) {
  const header = snapshot === undefined ? undefined : headerOf(snapshot)
  const backend = backendLocation(persistence, header)
  if (backend !== undefined) return backend

  const location = snapshot === undefined ? undefined : snapshot.location
  if (location && typeof location.path === 'string') {
    const candidate = location.path
    const dir = candidate.endsWith('.jsonl') || candidate.endsWith('.zstd') ? dirname(candidate) : candidate
    if (existsSync(dir) && isInsideSessionsRoot(dir)) return dir
  }
  const root = sessionsRoot()
  if (!existsSync(root)) return undefined
  // The cwd-derived path first: it is the layout the backend writes, and
  // unlike the scan below it costs one stat instead of one per project.
  const derived = derivedSessionDir(cwd, sessionId)
  if (derived !== undefined && existsSync(derived) && isInsideSessionsRoot(derived)) return derived
  let encoded
  try {
    encoded = encodeSegment(sessionId)
  } catch {
    return undefined
  }
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name, encoded)
      if (existsSync(dir) && isInsideSessionsRoot(dir)) return dir
    }
  } catch {
    return undefined
  }
  return undefined
}

/**
 * Every session below `sessionId` in the subagent tree, parents before children.
 *
 * A child carries `parentSessionId`, so the tree is rebuilt from the same list
 * the panel renders. The backend's own listing is folded in as well: a child
 * the controller did not report (an unreadable or newer-format header) is
 * still a log on disk, and leaving it behind would be a trace nobody can
 * reach. The visited set keeps a malformed or self-referencing header from
 * turning a destroy into an endless walk.
 */
function collectDescendants(items, headers, sessionId) {
  const childrenOf = new Map()
  const link = (id, parent) => {
    if (parent === undefined || parent === id) return
    const bucket = childrenOf.get(parent)
    if (bucket === undefined) childrenOf.set(parent, [id])
    else if (!bucket.includes(id)) bucket.push(id)
  }
  for (const item of items) link(item.sessionId, item.parentSessionId)
  for (const header of headers) link(header.id, header.parentSessionId)
  const out = []
  const seen = new Set([sessionId])
  const queue = [sessionId]
  while (queue.length > 0) {
    const current = queue.shift()
    for (const childId of childrenOf.get(current) ?? []) {
      if (seen.has(childId)) continue
      seen.add(childId)
      out.push(childId)
      queue.push(childId)
    }
  }
  return out
}

// ── upgrades from 0.1 ──────────────────────────────────────────────────────

/**
 * Versions before 0.2 deleted a session by moving its log out of the sessions
 * root into `<DSH_HOME>/dsh-toolbox/trash/<id>/` and recording the original
 * path in `trash.json`. That model is gone: archiving is the reversible step
 * and this row only destroys, so a log parked in that trash can neither be
 * opened from the sidebar nor destroyed from the panel.
 *
 * The upgrade therefore puts every entry back where it came from. The session
 * keeps its archive flag when it still has one, so it shows up in the panel as
 * an archived card and the user decides whether to destroy it.
 *
 * This runs once, at apply time. It never deletes a log: when an entry has no
 * usable original path, or a newer copy already exists there, the whole old
 * trash tree is left untouched and reported instead.
 */
async function retireLegacyTrash(logger) {
  const index = legacyTrashIndex()
  if (!existsSync(index)) return

  let entries = []
  try {
    const parsed = JSON.parse(await readFile(index, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.entries)) entries = parsed.entries
  } catch (error) {
    logger.warn('[dsh-toolbox] unusable legacy trash index left in place:', error)
    return
  }

  let stranded = 0
  for (const entry of entries) {
    const id = entry !== null && typeof entry === 'object' ? entry.sessionId : undefined
    if (typeof id !== 'string' || !SESSION_ID_RE.test(id) || DOT_SEGMENT_RE.test(id)) continue
    const from = join(legacyTrashRoot(), id)
    if (!existsSync(from)) continue
    const recorded = typeof entry.originalPath === 'string' && isInsideSessionsRoot(entry.originalPath)
      ? entry.originalPath
      : undefined
    const target = recorded ?? derivedSessionDir(entry.cwd, id)
    if (target === undefined) {
      stranded += 1
      logger.warn(`[dsh-toolbox] legacy trash entry ${id} has no usable original path; left in place`)
      continue
    }
    if (existsSync(target)) continue
    try {
      await mkdir(dirname(target), { recursive: true })
      await rename(from, target)
    } catch (error) {
      stranded += 1
      logger.warn(`[dsh-toolbox] could not put ${id} back into the sessions root:`, error)
    }
  }

  if (stranded > 0) {
    logger.warn(`[dsh-toolbox] legacy trash left at ${legacyTrashRoot()} (${stranded} stranded)`)
    return
  }
  try {
    await rm(index, { force: true })
    await rm(legacyTrashRoot(), { recursive: true, force: true })
  } catch (error) {
    logger.warn('[dsh-toolbox] could not remove the retired trash:', error)
  }
}

// ── the row ────────────────────────────────────────────────────────────────

export function apply(ctx) {
  ctx.inject(['webServer', 'sessionController', 'sessionPersistence'], (scoped) => {
    const controller = () => scoped.get('sessionController')
    const persistence = () => scoped.get('sessionPersistence')
    const registry = () => scoped.get('workspaceRegistry')
    const storage = () => scoped.get('storageDomain')

    /**
     * One mutation at a time.
     *
     * A destroy is several steps — the log directory, the projection record,
     * the workspace slot, the pin, the archive flag — and two destroys clicked
     * in quick succession would otherwise interleave them. Serialising them
     * also covers the archive toggle, so a destroy can never see a session
     * that a concurrent unarchive just made eligible again.
     */
    let mutationTail = Promise.resolve()
    const serialize = (run) => {
      const next = mutationTail.then(run, run)
      mutationTail = next.then(() => undefined, () => undefined)
      return next
    }

    /**
     * Remove one session's projection-cache record.
     *
     * The record is derived data owned by the `session_projcache` domain, so
     * the domain's own table is the supported route: it updates the cache
     * service's in-memory state as well as the medium, and it works for a
     * backend that does not use the per-record file layout. The file is the
     * fallback for a build where that domain is not open, and the `.bak`
     * copies are removed either way because they are dead by definition.
     */
    const dropProjectionRecord = async (sessionId) => {
      const cache = storage()?.get('session_projcache')
      let dropped = false
      if (cache !== undefined) {
        try {
          await cache.table('sessions').delete(sessionId)
          dropped = true
        } catch (error) {
          scoped.logger.warn(`[dsh-toolbox] could not drop the projection record ${sessionId}:`, error)
        }
      }
      if (!dropped) await rm(projectionCacheFile(sessionId), { force: true }).catch(() => {})
      for (const backup of projectionCacheBackups(sessionId)) {
        await rm(backup, { force: true }).catch(() => {})
      }
    }

    const archivedSet = () => {
      const domain = storage()
      const workspace = domain === undefined ? undefined : domain.get('workspace')
      if (workspace === undefined) return new Set()
      const state = workspace.global.get()
      return new Set(Array.isArray(state.archivedSessionIds) ? state.archivedSessionIds : [])
    }

    /**
     * An archive flag only ever gets set by archiving a session, so a flag
     * whose session has no log and no live agent is the residue of a session
     * destroyed by an earlier build — one that kept the flag on purpose. Drop
     * those, so `storages/workspace.json` cannot name a session that is gone.
     *
     * Nothing that still exists is touched: the id set is read from the same
     * session list the sidebar uses, and an unreadable or empty corpus leaves
     * every flag alone.
     */
    const dropStaleArchiveFlags = async () => {
      const domain = storage()
      const workspace = domain === undefined ? undefined : domain.get('workspace')
      if (workspace === undefined) return
      const flags = workspace.global.get().archivedSessionIds
      if (!Array.isArray(flags) || flags.length === 0) return
      const control = controller()
      if (control === undefined) return
      const known = new Set()
      try {
        const result = await control.list({}, new AbortController().signal)
        for (const item of result.items) known.add(item.sessionId)
      } catch {
        return
      }
      if (known.size === 0) return
      for (const id of flags) {
        if (known.has(id)) continue
        try {
          await registry()?.unarchiveSession(id)
        } catch (error) {
          scoped.logger.warn(`[dsh-toolbox] could not drop the stale archive flag ${id}:`, error)
        }
      }
    }

    /**
     * Remove derived artifacts no session can reach any more: projection
     * records whose session is gone, and project directories a destroy left
     * empty.
     *
     * Both are reconstructible — a cache is rebuilt from the log, a project
     * directory is recreated on the next materialisation — so this only ever
     * removes leftovers. It is deliberately conservative: it runs only once
     * the controller has answered, and an empty or failed listing proves
     * nothing, so everything is left alone in that case.
     */
    const collectOrphanedArtifacts = async () => {
      const cache = storage()?.get('session_projcache')
      const table = cache === undefined ? undefined : cache.table('sessions')
      if (table !== undefined && table.size > 0) {
        const known = new Set()
        try {
          const result = await controller().list({}, new AbortController().signal)
          for (const item of result.items) known.add(item.sessionId)
        } catch {
          return
        }
        if (known.size === 0) return
        try {
          for (const snapshot of await persistence().list()) known.add(headerOf(snapshot).id)
        } catch {
          return
        }
        const orphans = []
        for (const id of table.keys()) {
          if (!known.has(id)) orphans.push(id)
        }
        if (orphans.length > 0) {
          const removed = await table.deleteMany(orphans)
          scoped.logger.info(`[dsh-toolbox] dropped ${removed} orphaned projection record(s)`)
        }
      }

      const root = sessionsRoot()
      if (!existsSync(root)) return
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        // `_no-cwd` is a shared bucket, not one project's directory.
        if (!entry.isDirectory() || entry.name === '_no-cwd') continue
        const dir = join(root, entry.name)
        try {
          if (readdirSync(dir).length === 0) await rmdir(dir)
        } catch {
          // Not empty, already gone, or in use: leave it for the next start.
        }
      }
    }

    let gcAttempted = false
    const runGcOnce = async () => {
      if (gcAttempted) return
      // Wait for everything the sweep inspects. A missing projection-cache
      // domain means the sweep would only prune empty directories while
      // pretending the cache was clean, so it is retried by the next read.
      if (controller() === undefined || storage() === undefined) return
      if (storage().get('session_projcache') === undefined) return
      gcAttempted = true
      await serialize(collectOrphanedArtifacts)
    }

    // The upgrades and the orphan sweep run once, off the request path.
    void retireLegacyTrash(scoped.logger).catch((error) => {
      scoped.logger.warn('[dsh-toolbox] legacy trash retirement failed:', error)
    })
    void dropStaleArchiveFlags().catch((error) => {
      scoped.logger.warn('[dsh-toolbox] stale archive cleanup failed:', error)
    })
    void runGcOnce().catch((error) => {
      scoped.logger.warn('[dsh-toolbox] orphan cleanup failed:', error)
    })

    /**
     * Build the full session view.
     *
     * `sessionController.list()` is the authoritative row source: it reports
     * `running`, `blank`, `agentAvailable` and `origin` without resuming an
     * agent. `sessionPersistence.list()` adds on-disk size and the location a
     * destroy needs. Neither is used for grouping — that comes from
     * `workspaceRegistry.list()`.
     */
    const buildView = async () => {
      const control = controller()
      if (control === undefined) throw new Error('session-controller-unavailable')

      const signal = new AbortController().signal
      const [listResult, snapshots] = await Promise.all([
        control.list({}, signal),
        persistence() === undefined ? Promise.resolve([]) : persistence().list(),
      ])

      const disk = new Map()
      for (const snapshot of snapshots) {
        const header = headerOf(snapshot)
        disk.set(header.id, snapshot)
      }

      const archived = archivedSet()
      const rows = []
      for (const summary of listResult.items) {
        const id = summary.sessionId
        const snapshot = disk.get(id)
        const header = snapshot === undefined ? undefined : headerOf(snapshot)
        const cwd = summary.cwd ?? header?.cwd
        const dir = locateSessionDir(persistence(), snapshot, id, cwd)
        // Neither a persistence snapshot nor a locateable directory: every
        // artifact of this session is already gone, and only an in-memory agent
        // still remembers it — the leftover of a destroy, for one. Such a row
        // has no size and no path, so it can only be noise in a list meant for
        // deciding what to clean up.
        if (snapshot === undefined && dir === undefined) continue
        const title = summary.projections?.values?.title
        rows.push({
          id,
          title: typeof title === 'string' && title.trim() !== '' ? title : undefined,
          cwd,
          createdAt: header?.createdAt,
          updatedAt: summary.updatedAt,
          parentSessionId: summary.parentSessionId,
          origin: summary.origin,
          isSubagent: summary.origin === 'subagent',
          running: summary.running === true,
          blank: summary.blank === true,
          agentAvailable: summary.agentAvailable === true,
          formatStatus: summary.formatStatus,
          archived: archived.has(id),
          sizeBytes: snapshot?.sizeBytes,
          dir,
          subagents: [],
        })
      }

      const byId = new Map(rows.map((row) => [row.id, row]))

      // Subagent children nest under their parent; a child whose parent is
      // gone is an orphan (the case a plain session list silently hides).
      const orphans = []
      for (const row of rows) {
        if (!row.isSubagent) continue
        const parent = row.parentSessionId === undefined ? undefined : byId.get(row.parentSessionId)
        if (parent === undefined) orphans.push(row)
        else parent.subagents.push(row)
      }

      const ordinary = rows.filter((row) => !row.isSubagent)

      // Official grouping: workspace.sessionIds first, then everything left
      // over becomes the Ungrouped bucket. Archived sessions keep their slot —
      // the panel shows them in place, with the archive toggle and the destroy
      // button.
      const workspaces = registry() === undefined ? [] : registry().list()
      const accounted = new Set()
      const groups = []
      for (const workspace of workspaces) {
        const members = []
        for (const sessionId of workspace.sessionIds) {
          accounted.add(sessionId)
          const row = byId.get(sessionId)
          if (row === undefined || row.isSubagent) continue
          members.push(row)
        }
        groups.push({
          workspaceId: workspace.id,
          title: workspace.title || workspace.path,
          path: workspace.path,
          sessions: members.sort((a, b) => b.updatedAt - a.updatedAt),
        })
      }
      const ungrouped = ordinary
        .filter((row) => !accounted.has(row.id))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      if (ungrouped.length > 0) {
        groups.push({ workspaceId: '', title: null, path: null, sessions: ungrouped })
      }

      const totalBytes = ordinary.reduce((sum, row) => sum + (row.sizeBytes || 0), 0)
      return { groups, orphans, totalBytes }
    }

    /** Refuse anything that is genuinely executing a turn. */
    const findSummary = async (sessionId) => {
      const control = controller()
      if (control === undefined) return undefined
      const result = await control.list({}, new AbortController().signal)
      return result.items.find((item) => item.sessionId === sessionId)
    }

    /** Read one body and hand back a validated id, or answer the error itself. */
    const readId = async (req, res) => {
      if (req.method !== 'POST') {
        respond(res, 405, { ok: false, error: 'method-not-allowed' })
        return undefined
      }
      let body
      try {
        body = await readJsonBody(req)
      } catch {
        respond(res, 400, { ok: false, error: 'bad-request' })
        return undefined
      }
      const id = parseSessionId(body)
      if (id === undefined) respond(res, 400, { ok: false, error: 'invalid-session-id' })
      return id
    }

    // GET /dsh-toolbox/state — grouped sessions + orphans, one round trip.
    scoped.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/state`,
      handler: async (_req, res) => {
        // The orphan sweep is deferred to the first read when the services
        // were not ready at apply time; it is idempotent and runs once.
        void runGcOnce().catch((error) => {
          scoped.logger.warn('[dsh-toolbox] orphan cleanup failed:', error)
        })
        try {
          const view = await buildView()
          respond(res, 200, {
            ok: true,
            groups: view.groups,
            orphans: view.orphans,
            totalBytes: view.totalBytes,
            sessionsRoot: sessionsRoot(),
          })
        } catch (error) {
          scoped.logger.warn('[dsh-toolbox] state failed:', error)
          respond(res, 500, { ok: false, error: 'state-failed' })
        }
      },
    })

    // ── mutations ──────────────────────────────────────────────────────────
    //
    // Every route below runs through `serialize`, so two clicks land one after
    // the other instead of interleaving their steps.

    // The reversible step, from the panel.
    const archiveSession = async (sessionId, res) => {
      try {
        const summary = await findSummary(sessionId)
        if (summary !== undefined && summary.running === true) {
          return respond(res, 409, { ok: false, error: 'session-running' })
        }
        if (registry() === undefined) return respond(res, 503, { ok: false, error: 'registry-unavailable' })
        await registry().archiveSession(sessionId)
        respond(res, 200, { ok: true })
      } catch (error) {
        scoped.logger.warn('[dsh-toolbox] archive failed:', error)
        respond(res, 500, { ok: false, error: 'archive-failed' })
      }
    }

    // Undo it.
    const unarchiveSession = async (sessionId, res) => {
      try {
        if (registry() === undefined) return respond(res, 503, { ok: false, error: 'registry-unavailable' })
        await registry().unarchiveSession(sessionId)
        respond(res, 200, { ok: true })
      } catch (error) {
        scoped.logger.warn('[dsh-toolbox] unarchive failed:', error)
        respond(res, 500, { ok: false, error: 'unarchive-failed' })
      }
    }

    // Permanent, and meant to leave nothing behind.
    //
    // Only an archived session may be destroyed: archiving is the reversible
    // step, so the irreversible click can never be the first one. Subagent
    // children are exempt — they never appear in the sidebar, so they can never
    // be archived, and they are exactly what the orphan bucket is for.
    //
    // Destroying a session takes its whole subagent subtree with it. A child log
    // is a sibling directory, it can never be opened without its parent, and
    // the sidebar never shows subagent-origin rows — so leaving it behind would
    // be a trace nobody could reach, only one the orphan bucket could find.
    const purgeSession = async (sessionId, res) => {
      try {
        const control = controller()
        const items = control === undefined
          ? []
          : (await control.list({}, new AbortController().signal)).items
        const summary = items.find((item) => item.sessionId === sessionId)

        const snapshots = persistence() === undefined ? [] : await persistence().list()
        const snapshotById = new Map()
        for (const snapshot of snapshots) snapshotById.set(headerOf(snapshot).id, snapshot)

        const targets = [sessionId, ...collectDescendants(items, snapshots.map(headerOf), sessionId)]

        // Refuse the whole subtree when any part of it is busy: a destroy that
        // half-completes would leave exactly the kind of trace this route is
        // supposed to avoid.
        const liveStore = scoped.get('sessions')
        for (const targetId of targets) {
          const item = items.find((entry) => entry.sessionId === targetId)
          if (item === undefined) continue
          if (item.running === true) return respond(res, 409, { ok: false, error: 'session-running' })
          if (item.agentAvailable === true) return respond(res, 409, { ok: false, error: 'session-in-use' })
          // A live session can sit in the store without an agent (retained, or
          // prepared and not yet announced). The Host would keep listing it
          // after the files are gone, so it is refused the same way.
          let live
          try {
            live = liveStore === undefined ? undefined : liveStore.get(targetId)
          } catch {
            live = undefined
          }
          if (live !== undefined) return respond(res, 409, { ok: false, error: 'session-in-use' })
        }

        const snapshot = snapshotById.get(sessionId)
        const header = snapshot === undefined ? undefined : headerOf(snapshot)
        if (summary === undefined && snapshot === undefined) {
          return respond(res, 404, { ok: false, error: 'session-not-found' })
        }

        const isSubagent = summary?.origin === 'subagent' || header?.origin === 'subagent'
        if (!isSubagent && !archivedSet().has(sessionId)) {
          return respond(res, 409, { ok: false, error: 'session-not-archived' })
        }

        // 0) Preflight. Resolve every artifact directory before deleting
        //    anything. A snapshot without a locatable directory means the
        //    backend knows a log this build cannot find — a moved root, a newer
        //    layout. Reporting success there would clear the registry while
        //    leaving the log on disk for nobody to reach, so it refuses the
        //    whole subtree instead. A target with no snapshot has no log at all
        //    (a blank session, or the residue of an earlier destroy).
        const plans = []
        for (const targetId of targets) {
          const targetSnapshot = snapshotById.get(targetId)
          const targetHeader = targetSnapshot === undefined ? undefined : headerOf(targetSnapshot)
          const dir = locateSessionDir(
            persistence(),
            targetSnapshot,
            targetId,
            targetHeader?.cwd ?? summary?.cwd ?? header?.cwd,
          )
          if (dir === undefined) {
            if (targetSnapshot !== undefined) {
              scoped.logger.warn(`[dsh-toolbox] ${targetId}: no locatable log directory; refusing the destroy`)
              return respond(res, 409, { ok: false, error: 'artifact-not-located' })
            }
            continue
          }
          plans.push({ id: targetId, dir })
        }

        // 1) The log directories, with everything inside them.
        for (const plan of plans) await rm(plan.dir, { recursive: true, force: true })

        // 2) The projection-cache records that live outside the log directories.
        for (const targetId of targets) await dropProjectionRecord(targetId)

        // 3) Every registry entry that names the session. Removing these is
        //    what keeps the sidebar's pin/archive sets and the Ungrouped
        //    bucket from remembering it, and it is what makes the archive
        //    flag itself disappear.
        let detached = true
        try {
          for (const workspace of registry()?.list() ?? []) {
            for (const targetId of targets) {
              if (workspace.sessionIds.includes(targetId)) await workspace.detachSession(targetId)
            }
          }
        } catch (error) {
          detached = false
          scoped.logger.warn('[dsh-toolbox] detach failed:', error)
        }
        try {
          for (const targetId of targets) await registry()?.unpinSession(targetId)
          // Unarchiving is only safe once the session has no workspace slot:
          // otherwise it would come back as an empty "Ungrouped" row.
          if (detached) {
            for (const targetId of targets) await registry()?.unarchiveSession(targetId)
          }
        } catch (error) {
          scoped.logger.warn('[dsh-toolbox] registry cleanup failed:', error)
        }

        respond(res, 200, { ok: true, removed: targets.length, directories: plans.length })
      } catch (error) {
        scoped.logger.warn('[dsh-toolbox] purge failed:', error)
        respond(res, 500, { ok: false, error: 'purge-failed' })
      }
    }

    // POST /dsh-toolbox/archive — hide a session in the sidebar, files intact.
    scoped.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/archive`,
      handler: async (req, res) => {
        const id = await readId(req, res)
        if (id === undefined) return
        await serialize(() => archiveSession(id, res))
      },
    })

    // POST /dsh-toolbox/unarchive — undo it.
    scoped.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/unarchive`,
      handler: async (req, res) => {
        const id = await readId(req, res)
        if (id === undefined) return
        await serialize(() => unarchiveSession(id, res))
      },
    })

    // POST /dsh-toolbox/purge — permanent removal of one archived session.
    scoped.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/purge`,
      handler: async (req, res) => {
        const id = await readId(req, res)
        if (id === undefined) return
        await serialize(() => purgeSession(id, res))
      },
    })
  })
}
