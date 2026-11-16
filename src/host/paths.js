/**
 * Where a session's artifacts live, and how to tell one from something else.
 *
 * Everything here is pure filesystem knowledge: no DSH service is imported and
 * no file is ever written. The one exception is {@link locateSessionDir}, which
 * asks the persistence backend for its own answer and validates it, because the
 * backend is the only party that knows a persistence root this plugin did not
 * derive.
 *
 * The layout this module reproduces is `dsh-session-persistence-jsonl`'s:
 *
 * ```
 * <DSH_HOME>/sessions/--<normalized cwd>--/<encoded session id>/session[.vN].jsonl[.zstd]
 * ```
 *
 * `encodeSegment` and `projectKey` are copies of the backend's own rules, not
 * guesses: a near-miss would point a destroy at the wrong directory.
 */
import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function sessionsRoot() {
  return join(dshHome(), 'sessions')
}

/**
 * The projection cache keeps one record per session. Destroying a session
 * without it leaves an orphan record behind, so purge removes it too.
 *
 * The directory and the record's file name are the shipped json backend's
 * `per-record` layout; the supported way to remove a record is the storage
 * domain's table (see `dropProjectionRecord`). These paths are the fallback for
 * a build where that domain is not open, and for the `.bak` copies the cache
 * leaves behind when it refuses a stored record.
 */
export function projectionCacheDir() {
  return join(dshHome(), 'storages', 'session_projcache', 'sessions')
}

export function projectionCacheFile(sessionId) {
  return join(projectionCacheDir(), `${sessionId}.json`)
}

/**
 * The `<key>.json.bak.<stamp>` copies the cache moves a rejected record to.
 * The backend names a per-record document by its raw key, so the prefix is the
 * session id itself — no path encoding is involved.
 */
export function projectionCacheBackups(sessionId) {
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

/**
 * One path segment, encoded the way the jsonl backend encodes it:
 * `[A-Za-z0-9._-]` survives, everything else becomes `~XXXX` (uppercase, 4 hex
 * digits). `~` itself is escaped, so the mapping is injective.
 */
export function encodeSegment(raw) {
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
export function projectKey(cwd) {
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
 * The directory a session's log lives in, derived from its header alone.
 *
 * `undefined` when the header carries no cwd, because that layout puts the
 * session under `_no-cwd` and guessing another bucket is worse than reporting
 * that the path cannot be rebuilt.
 */
export function derivedSessionDir(cwd, sessionId) {
  if (typeof cwd !== 'string' || cwd === '') return undefined
  try {
    return join(sessionsRoot(), projectKey(cwd), encodeSegment(sessionId))
  } catch {
    return undefined
  }
}

/** Whether `candidate` is a real directory strictly inside the sessions root. */
export function isInsideSessionsRoot(candidate) {
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

/**
 * Whether `candidate` is one session's own log directory, judged by what it
 * contains rather than by where it sits.
 *
 * A backend-supplied path is authoritative about *its* persistence root, which
 * a profile may configure away from `<DSH_HOME>/sessions`; rejecting it for
 * living elsewhere made every destroy in such a profile fail. The path is
 * trusted only when the directory's own name is the injective encoding of this
 * exact id and it holds a session log generation, so an unrelated directory
 * cannot be named.
 */
export function isSessionDir(candidate, sessionId) {
  if (typeof candidate !== 'string' || candidate === '') return false
  const parent = dirname(candidate)
  // Never the filesystem or drive root, and never a path with no parent.
  if (parent === candidate) return false
  if (!existsSync(candidate)) return false
  let encoded
  try {
    encoded = encodeSegment(sessionId)
  } catch {
    return false
  }
  const fold = (value) => (process.platform === 'win32' ? value.toLowerCase() : value)
  if (fold(basename(candidate)) !== fold(encoded)) return false
  try {
    return readdirSync(candidate).some((name) => /^session(\.v\d+)?\.jsonl(\.zstd)?$/.test(name))
  } catch {
    return false
  }
}

/** `<…>/<id>/session.v3.jsonl.zstd` and the directory form both name a session dir. */
export function stripLogSuffix(path) {
  return path.endsWith('.jsonl') || path.endsWith('.zstd') ? dirname(path) : path
}

/**
 * The backend's own answer for where one session's log lives.
 *
 * `sessionPersistence.locate()` is `private` in the 0.2.x typings but present
 * at runtime, and it is the only source that knows a persistence root this
 * plugin did not derive. It is asked last and validated by content, so the
 * answer counts in a profile whose root is not `<DSH_HOME>/sessions`.
 */
export function backendLocation(persistence, header) {
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
  const dir = stripLogSuffix(path)
  return isSessionDir(dir, header.id) ? dir : undefined
}

/**
 * Locate one session's artifact directory.
 *
 * Preferred sources, in order: the snapshot's own `location.path` (free — the
 * panel resolves one per row on every poll), the backend's `locate()`, then the
 * documented layout `<sessions root>/<projectKey(cwd)>/<encoded id>/`.
 *
 * Backend-supplied paths are validated by content (`isSessionDir`), derived and
 * scanned ones by the sessions-root prefix: those are this plugin's own guess,
 * so they must stay inside the root it guessed.
 */
export function locateSessionDir(persistence, snapshot, sessionId, cwd) {
  const header = snapshot === undefined ? undefined : snapshot.header ?? snapshot
  if (snapshot !== undefined) {
    const location = snapshot.location
    if (location && typeof location.path === 'string') {
      const dir = stripLogSuffix(location.path)
      // Inside the documented root it is accepted on the backend's word; a
      // custom root has to prove itself by content.
      if (isInsideSessionsRoot(dir) && existsSync(dir)) return dir
      if (isSessionDir(dir, sessionId)) return dir
    }
  }

  const backend = backendLocation(persistence, header)
  if (backend !== undefined) return backend

  const root = sessionsRoot()
  if (!existsSync(root)) return undefined
  // The cwd-derived path first: it is the layout the backend writes, and unlike
  // the scan below it costs one stat instead of one per project.
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
