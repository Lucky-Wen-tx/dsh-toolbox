/**
 * dsh-toolbox — session cleanup (host row `dsh-toolbox-sessions`).
 *
 * What this row owns:
 *   - the trash on disk (`<DSH_HOME>/dsh-toolbox/trash/<sessionId>/`)
 *   - the trash index (`<DSH_HOME>/dsh-toolbox/trash.json`)
 *   - the HTTP routes the client half calls
 *
 * What it deliberately does NOT own:
 *   - session logs themselves (they belong to `sessionPersistence`)
 *   - the archive flag (that belongs to `workspaceRegistry`; we call its
 *     public `archiveSession` / `unarchiveSession`)
 *   - workspace accounting (we call `Workspace.detachSession` on purge)
 *   - the meaning of "running" (we read `sessionController.list()`, the same
 *     source the sidebar uses: `running`, `blank`, `agentAvailable`, `origin`)
 *
 * Grouping follows the official rule (ui-workspace `groupByWorkspace`):
 * a session belongs to the workspace whose `sessionIds` lists it; anything
 * unlisted falls into the Ungrouped bucket. Subagent children never render as
 * ordinary rows — they nest under their parent, and a child whose parent is
 * gone is reported separately so it can be cleaned up.
 *
 * Everything here is plain ESM with zero `@deepseek-ai/*` imports, so the
 * package installs and loads without a build step.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-toolbox-sessions'
/** Services are resolved through a scoped `ctx.inject` in `apply`. */
export const inject = []

const ROUTE_PREFIX = '/dsh-toolbox'
const MAX_BODY_BYTES = 64 * 1024
const TRASH_LIMIT = 20
/** Session ids are joined into a path, so keep the charset tight. */
const SESSION_ID_RE = /^[A-Za-z0-9_.:-]+$/

// ── paths ──────────────────────────────────────────────────────────────────

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}
function toolboxRoot() {
  return join(dshHome(), 'dsh-toolbox')
}
function trashRoot() {
  return join(toolboxRoot(), 'trash')
}
function trashDir(sessionId) {
  return join(trashRoot(), sessionId)
}
function indexFile() {
  return join(toolboxRoot(), 'trash.json')
}
function sessionsRoot() {
  return join(dshHome(), 'sessions')
}
/**
 * The projection cache keeps one small JSON file per session. Purging a
 * session without it leaves an orphan record behind (a real complaint against
 * comparable plugins), so purge removes it too.
 */
function projectionCacheFile(sessionId) {
  return join(dshHome(), 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
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
  return value
}

/** The `header` of a persistence snapshot, tolerating a bare header. */
function headerOf(item) {
  return item && item.header ? item.header : item
}

/**
 * Locate one session's artifact directory.
 *
 * Preferred source is the snapshot's own `location.path`; otherwise fall back
 * to the on-disk layout `<DSH_HOME>/sessions/<encoded-cwd>/<sessionId>/`.
 */
function locateSessionDir(location, sessionId) {
  if (location && typeof location.path === 'string') {
    const candidate = location.path
    const dir = candidate.endsWith('.jsonl') || candidate.endsWith('.zstd') ? dirname(candidate) : candidate
    if (existsSync(dir)) return dir
  }
  const root = sessionsRoot()
  if (!existsSync(root)) return undefined
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name, sessionId)
      if (existsSync(dir)) return dir
    }
  } catch {
    return undefined
  }
  return undefined
}

// ── trash index ────────────────────────────────────────────────────────────

async function readIndex() {
  try {
    const raw = await readFile(indexFile(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.entries)) return parsed.entries
  } catch {
    // Missing or unreadable index is an empty trash, never a hard failure.
  }
  return []
}

async function writeIndex(entries) {
  await mkdir(toolboxRoot(), { recursive: true })
  const tmp = `${indexFile()}.tmp`
  await writeFile(tmp, JSON.stringify({ version: 1, entries }, null, 2), 'utf8')
  await rename(tmp, indexFile())
}

// ── the row ────────────────────────────────────────────────────────────────

export function apply(ctx) {
  ctx.inject(['webServer', 'sessionController', 'sessionPersistence'], (scoped) => {
    const controller = () => scoped.get('sessionController')
    const persistence = () => scoped.get('sessionPersistence')
    const registry = () => scoped.get('workspaceRegistry')
    const storage = () => scoped.get('storageDomain')

    const archivedSet = () => {
      const domain = storage()
      if (domain === undefined) return new Set()
      const workspace = domain.get('workspace')
      if (workspace === undefined) return new Set()
      const state = workspace.global.get()
      return new Set(Array.isArray(state.archivedSessionIds) ? state.archivedSessionIds : [])
    }

    /**
     * Build the full session view.
     *
     * `sessionController.list()` is the authoritative row source: it reports
     * `running`, `blank`, `agentAvailable` and `origin` without resuming an
     * agent. `sessionPersistence.list()` adds on-disk size and the location
     * the trash needs. Neither is used for grouping — that comes from
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
      const rows = listResult.items.map((summary) => {
        const id = summary.sessionId
        const snapshot = disk.get(id)
        const header = snapshot === undefined ? undefined : headerOf(snapshot)
        const title = summary.projections?.values?.title
        return {
          id,
          title: typeof title === 'string' && title.trim() !== '' ? title : undefined,
          cwd: summary.cwd ?? header?.cwd,
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
          eventCount: snapshot?.eventCount,
          dir: locateSessionDir(snapshot?.location, id),
          subagents: [],
        }
      })

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
      // over becomes the Ungrouped bucket.
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

    // GET /dsh-toolbox/state — grouped sessions + trash, one round trip.
    scoped.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/state`,
      handler: async (_req, res) => {
        try {
          const view = await buildView()
          respond(res, 200, {
            ok: true,
            groups: view.groups,
            orphans: view.orphans,
            totalBytes: view.totalBytes,
            entries: await readIndex(),
            limit: TRASH_LIMIT,
            sessionsRoot: sessionsRoot(),
          })
        } catch (error) {
          scoped.logger.warn('[dsh-toolbox] state failed:', error)
          respond(res, 500, { ok: false, error: 'state-failed' })
        }
      },
    })

    // GET /dsh-toolbox/trash
    scoped.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/trash`,
      handler: async (_req, res) => {
        try {
          respond(res, 200, { ok: true, entries: await readIndex(), limit: TRASH_LIMIT })
        } catch (error) {
          scoped.logger.warn('[dsh-toolbox] trash read failed:', error)
          respond(res, 500, { ok: false, error: 'trash-read-failed' })
        }
      },
    })

    // POST /dsh-toolbox/delete — archive + move the artifact into the trash.
    scoped.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/delete`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' })
        let body
        try {
          body = await readJsonBody(req)
        } catch {
          return respond(res, 400, { ok: false, error: 'bad-request' })
        }
        const id = parseSessionId(body)
        if (id === undefined) return respond(res, 400, { ok: false, error: 'invalid-session-id' })

        try {
          // Only a session actually executing a turn is refused. An idle agent
          // that merely lives in memory is fine to delete; its in-memory entry
          // is dropped when the process restarts.
          const summary = await findSummary(id)
          if (summary !== undefined && summary.running === true) {
            return respond(res, 409, { ok: false, error: 'session-running' })
          }

          const entries = await readIndex()
          const existing = entries.find((entry) => entry.sessionId === id)
          const snapshot = persistence() === undefined
            ? undefined
            : (await persistence().list()).find((item) => headerOf(item).id === id)
          const header = snapshot === undefined ? undefined : headerOf(snapshot)
          if (summary === undefined && snapshot === undefined) {
            return respond(res, 404, { ok: false, error: 'session-not-found' })
          }

          const dir = locateSessionDir(snapshot?.location, id)

          // 1) Hide it from every client first: the official archive call is
          //    public, reversible, and independent of the file move. Subagent
          //    children have no workspace accounting, so archiving is skipped
          //    for them rather than throwing.
          if (summary === undefined || summary.origin !== 'subagent') {
            await registry()?.archiveSession(id)
          }

          // 2) Move the artifact. A session with no directory (already gone,
          //    or never materialized) still gets an index entry so Restore can
          //    undo the archive.
          let moved = false
          if (dir !== undefined) {
            await mkdir(trashRoot(), { recursive: true })
            await rm(trashDir(id), { recursive: true, force: true })
            await rename(dir, trashDir(id))
            moved = true
          }

          // 3) Record it, evicting the oldest entries past the cap.
          const next = existing !== undefined
            ? entries.map((entry) => (entry.sessionId === id ? { ...entry, deletedAt: Date.now() } : entry))
            : [...entries, {
                sessionId: id,
                title: typeof body.title === 'string' ? body.title : undefined,
                cwd: summary?.cwd ?? header?.cwd,
                originalPath: dir,
                isSubagent: summary?.origin === 'subagent',
                moved,
                deletedAt: Date.now(),
              }]
          const overflow = next.length > TRASH_LIMIT ? next.slice(0, next.length - TRASH_LIMIT) : []
          await writeIndex(next.slice(-TRASH_LIMIT))
          for (const entry of overflow) {
            await rm(trashDir(entry.sessionId), { recursive: true, force: true }).catch(() => {})
          }

          respond(res, 200, { ok: true })
        } catch (error) {
          scoped.logger.warn('[dsh-toolbox] delete failed:', error)
          respond(res, 500, { ok: false, error: 'delete-failed' })
        }
      },
    })

    // POST /dsh-toolbox/restore — put the artifact back and un-archive.
    scoped.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/restore`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' })
        let body
        try {
          body = await readJsonBody(req)
        } catch {
          return respond(res, 400, { ok: false, error: 'bad-request' })
        }
        const id = parseSessionId(body)
        if (id === undefined) return respond(res, 400, { ok: false, error: 'invalid-session-id' })

        try {
          const entries = await readIndex()
          const entry = entries.find((candidate) => candidate.sessionId === id)
          if (entry === undefined) return respond(res, 404, { ok: false, error: 'trash-entry-not-found' })

          const from = trashDir(id)
          if (existsSync(from) && typeof entry.originalPath === 'string') {
            if (existsSync(entry.originalPath)) {
              // Something recreated the original location: the newer copy wins.
              await rm(from, { recursive: true, force: true })
            } else {
              await mkdir(dirname(entry.originalPath), { recursive: true })
              await rename(from, entry.originalPath)
            }
          }

          if (entry.isSubagent !== true) {
            await registry()?.unarchiveSession(id)
          }
          await writeIndex(entries.filter((candidate) => candidate.sessionId !== id))
          respond(res, 200, { ok: true })
        } catch (error) {
          scoped.logger.warn('[dsh-toolbox] restore failed:', error)
          respond(res, 500, { ok: false, error: 'restore-failed' })
        }
      },
    })

    // POST /dsh-toolbox/purge — permanent: trash copy, log, cache, accounting.
    scoped.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/purge`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' })
        let body
        try {
          body = await readJsonBody(req)
        } catch {
          return respond(res, 400, { ok: false, error: 'bad-request' })
        }
        const id = parseSessionId(body)
        if (id === undefined) return respond(res, 400, { ok: false, error: 'invalid-session-id' })

        try {
          const entries = await readIndex()
          const entry = entries.find((candidate) => candidate.sessionId === id)
          if (entry === undefined) return respond(res, 404, { ok: false, error: 'trash-entry-not-found' })

          const summary = await findSummary(id)
          if (summary !== undefined && summary.running === true) {
            return respond(res, 409, { ok: false, error: 'session-running' })
          }

          await rm(trashDir(id), { recursive: true, force: true })
          if (typeof entry.originalPath === 'string') {
            await rm(entry.originalPath, { recursive: true, force: true })
          }
          // The projection cache holds a per-session record outside the log
          // directory; leaving it behind is the usual "still not clean" report.
          await rm(projectionCacheFile(id), { force: true }).catch(() => {})

          // Drop the workspace accounting slot too, so the id does not linger
          // in `sessionIds` forever. `detachSession` is the public API for it.
          try {
            for (const workspace of registry()?.list() ?? []) {
              if (workspace.sessionIds.includes(id)) await workspace.detachSession(id)
            }
          } catch (error) {
            scoped.logger.warn('[dsh-toolbox] detach failed (harmless):', error)
          }
          try {
            await registry()?.unarchiveSession(id)
          } catch {
            // Not archived is already the desired state.
          }

          await writeIndex(entries.filter((candidate) => candidate.sessionId !== id))
          respond(res, 200, { ok: true })
        } catch (error) {
          scoped.logger.warn('[dsh-toolbox] purge failed:', error)
          respond(res, 500, { ok: false, error: 'purge-failed' })
        }
      },
    })
  })
}
