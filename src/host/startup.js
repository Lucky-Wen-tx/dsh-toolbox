/**
 * Two sweeps that run once, after start, off the request path.
 *
 * Both only ever remove leftovers: an archive flag whose session no longer
 * exists, a projection record no session answers for, and a project directory a
 * destroy left empty. Each is derived or dangling state, and each sweep is
 * deliberately conservative — an empty or failed listing proves nothing, so
 * everything is left alone in that case.
 *
 * These do not retire the old `delete → trash` layout: that migration was
 * removed once its last release stopped writing there. A log still parked in
 * `<DSH_HOME>/dsh-toolbox/trash/` has to be moved back by hand.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { rmdir } from 'node:fs/promises'
import { sessionsRoot } from './paths.js'
import { headerOf } from './view.js'

/**
 * An archive flag only ever gets set by archiving a session, so a flag whose
 * session has no log and no live agent is the residue of a session destroyed by
 * an earlier build — one that kept the flag on purpose. Drop those, so
 * `storages/workspace.json` cannot name a session that is gone.
 */
export async function dropStaleArchiveFlags(deps) {
  const domain = deps.storage()
  const workspace = domain === undefined ? undefined : domain.get('workspace')
  if (workspace === undefined) return
  const flags = workspace.global.get().archivedSessionIds
  if (!Array.isArray(flags) || flags.length === 0) return
  const controller = deps.controller()
  if (controller === undefined) return

  const known = new Set()
  try {
    const result = await controller.list({}, new AbortController().signal)
    for (const item of result.items) known.add(item.sessionId)
  } catch {
    return
  }
  if (known.size === 0) return

  for (const id of flags) {
    if (known.has(id)) continue
    try {
      await deps.registry()?.unarchiveSession(id)
    } catch (error) {
      deps.logger.warn(`[dsh-toolbox] could not drop the stale archive flag ${id}:`, error)
    }
  }
}

/**
 * Remove projection records whose session is gone, and project directories a
 * destroy left empty.
 *
 * Both are reconstructible — a cache is rebuilt from the log, a project
 * directory is recreated on the next materialisation — so this only ever
 * removes leftovers. It waits for a controller answer and a non-empty corpus,
 * because "no sessions" and "cannot look" are indistinguishable otherwise.
 */
export async function collectOrphanedArtifacts(deps) {
  const cache = deps.storage()?.get('session_projcache')
  const table = cache === undefined ? undefined : cache.table('sessions')
  if (table !== undefined && table.size > 0) {
    const known = new Set()
    const controller = deps.controller()
    try {
      const result = await controller.list({}, new AbortController().signal)
      for (const item of result.items) known.add(item.sessionId)
    } catch {
      return
    }
    if (known.size === 0) return
    try {
      for (const snapshot of await deps.persistence().list()) known.add(headerOf(snapshot).id)
    } catch {
      return
    }
    const orphans = []
    for (const id of table.keys()) {
      if (!known.has(id)) orphans.push(id)
    }
    if (orphans.length > 0) {
      const removed = await table.deleteMany(orphans)
      deps.logger.info(`[dsh-toolbox] dropped ${removed} orphaned projection record(s)`)
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
