/**
 * dsh-toolbox — session cleanup (host row `dsh-toolbox-sessions`).
 *
 * What this row owns:
 *   - the trash on disk (`<DSH_HOME>/dsh-toolbox/trash/<sessionId>/`)
 *   - the trash index (`<DSH_HOME>/dsh-toolbox/trash.json`)
 *   - six HTTP routes the client half calls
 *
 * What it deliberately does NOT own:
 *   - session logs themselves (they belong to `sessionPersistence`)
 *   - the archive flag (that belongs to `workspaceRegistry`; we call its
 *     public `archiveSession` / `unarchiveSession`, never its private state)
 *   - whether a session is "running" (we only ask whether a live agent
 *     exists — a conservative read that needs no private field)
 *
 * Everything here is plain ESM with zero `@deepseek-ai/*` imports, so the
 * package installs and loads without a build step and without depending on
 * harness internals that move between releases.
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

/** The `header` of a list() snapshot, tolerating a bare header from older builds. */
function headerOf(item) {
  return item && item.header ? item.header : item
}

/**
 * Locate one session's artifact directory.
 *
 * Preferred source is the snapshot's own `location.path`; when a build omits
 * it we fall back to the documented on-disk layout
 * `<DSH_HOME>/sessions/<encoded-cwd>/<sessionId>/`, which is what the log
 * store actually writes. Returns undefined when neither exists.
 */
function locateSessionDir(snapshot, sessionId) {
  const location = snapshot && snapshot.location
  if (location && typeof location.path === 'string') {
    const candidate = location.path
    const dir = candidate.endsWith('.jsonl') || candidate.endsWith('.zstd') ? dirname(candidate) : candidate
    if (existsSync(dir)) return dir
  }
  const root = sessionsRoot()
  if (!existsSync(root)) return undefined
  // Two levels at most: sessions/<workspace>/<sessionId>
  const guessed = []
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      guessed.push(join(root, entry.name, sessionId))
    }
  } catch {
    return undefined
  }
  return guessed.find((dir) => existsSync(dir))
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
  ctx.inject(['webServer', 'sessionPersistence'], (scoped) => {
    const persistence = () => scoped.get('sessionPersistence')
    const registry = () => scoped.get('workspaceRegistry')
    const agents = () => scoped.get('agents')

    /** One session's on-disk facts, merged into the client's own session list. */
    const describe = (snapshot) => {
      const header = headerOf(snapshot)
      const id = header.id
      const sizeBytes = typeof snapshot.sizeBytes === 'number' ? snapshot.sizeBytes : undefined
      const eventCount = typeof snapshot.eventCount === 'number' ? snapshot.eventCount : undefined
      const live = agents()?.get(id) !== undefined
      const dir = locateSessionDir(snapshot, id)
      return {
        id,
        cwd: header.cwd,
        createdAt: header.createdAt,
        parentSession: header.parentSession,
        origin: header.origin,
        sizeBytes,
        eventCount,
        live,
        dir,
      }
    }

    const listSnapshots = async () => {
      const service = persistence()
      if (service === undefined) throw new Error('session-persistence-unavailable')
      return service.list()
    }

    const isArchived = (sessionId) => {
      const storage = scoped.get('storageDomain')
      if (storage === undefined) return undefined
      const workspace = storage.get('workspace')
      if (workspace === undefined) return undefined
      const state = workspace.global.get()
      return Array.isArray(state.archivedSessionIds) && state.archivedSessionIds.includes(sessionId)
    }

    // GET /dsh-toolbox/sessions — on-disk facts for every stored session.
    scoped.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/sessions`,
      handler: async (_req, res) => {
        try {
          const rows = (await listSnapshots()).map(describe)
          respond(res, 200, { ok: true, sessions: rows })
        } catch (error) {
          scoped.logger.warn('[dsh-toolbox] list failed:', error)
          respond(res, 500, { ok: false, error: 'list-failed' })
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
          // A live agent cannot be destroyed from outside; refusing here keeps
          // the invariant honest instead of leaving a half-deleted session.
          if (agents()?.get(id) !== undefined) {
            return respond(res, 409, { ok: false, error: 'session-live' })
          }

          const snapshots = await listSnapshots()
          const snapshot = snapshots.find((item) => headerOf(item).id === id)
          if (snapshot === undefined) return respond(res, 404, { ok: false, error: 'session-not-found' })

          const dir = locateSessionDir(snapshot, id)
          const entries = await readIndex()
          const existing = entries.find((entry) => entry.sessionId === id)
          const header = headerOf(snapshot)

          // 1) Hide it from every client first: the official archive call is
          //    public, reversible, and independent of the file move.
          await registry()?.archiveSession(id)

          // 2) Move the artifact. A session with no directory (already gone,
          //    or never materialized) still gets an index entry so Restore can
          //    un-archive it.
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
                cwd: header.cwd,
                originalPath: dir,
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

          await registry()?.unarchiveSession(id)
          await writeIndex(entries.filter((candidate) => candidate.sessionId !== id))
          respond(res, 200, { ok: true })
        } catch (error) {
          scoped.logger.warn('[dsh-toolbox] restore failed:', error)
          respond(res, 500, { ok: false, error: 'restore-failed' })
        }
      },
    })

    // POST /dsh-toolbox/purge — permanent: trash copy plus any leftover.
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
          if (agents()?.get(id) !== undefined) {
            return respond(res, 409, { ok: false, error: 'session-live' })
          }

          await rm(trashDir(id), { recursive: true, force: true })
          if (typeof entry.originalPath === 'string') {
            await rm(entry.originalPath, { recursive: true, force: true })
          }
          // The projection cache holds a per-session record outside the log
          // directory; leaving it behind is the usual "still not clean" report.
          await rm(projectionCacheFile(id), { force: true }).catch(() => {})
          await writeIndex(entries.filter((candidate) => candidate.sessionId !== id))
          respond(res, 200, { ok: true })
        } catch (error) {
          scoped.logger.warn('[dsh-toolbox] purge failed:', error)
          respond(res, 500, { ok: false, error: 'purge-failed' })
        }
      },
    })

    // GET /dsh-toolbox/state — one round trip for the panel's first paint.
    scoped.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/state`,
      handler: async (_req, res) => {
        try {
          const sessions = (await listSnapshots()).map((snapshot) => {
            const row = describe(snapshot)
            const archived = isArchived(row.id)
            return { ...row, archived: archived === true }
          })
          respond(res, 200, {
            ok: true,
            sessions,
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
  })
}
