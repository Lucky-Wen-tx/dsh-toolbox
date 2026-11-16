/**
 * The four mutations: archive, unarchive, preview, destroy.
 *
 * Every function writes its own HTTP answer, so the routes in `index.js` stay
 * three lines each and this module owns the status codes. The ordering rules it
 * implements are the product decisions of the plugin:
 *
 *   - archive is the reversible step, so an unarchived session is refused;
 *   - a session this process holds, or work the archive gate would name, is
 *     refused rather than half-destroyed;
 *   - every artifact is located before the first file is removed;
 *   - children are removed before their parent, and a removal that still fails
 *     is reported with the ids that survived, which keep their registry state
 *     so the action can be retried.
 */
import { rm } from 'node:fs/promises'
import { respond } from './http.js'
import { projectionCacheBackups, projectionCacheFile } from './paths.js'
import {
  archivedSet,
  headerOf,
  planLogDirectories,
  resolveTargets,
} from './view.js'

/** Which refusal, if any, the current listing gives for this subtree. */
export function findBusy(items, targets, liveStore) {
  for (const targetId of targets) {
    const item = items.find((entry) => entry.sessionId === targetId)
    if (item !== undefined) {
      if (item.running === true) return 'session-running'
      if (item.agentAvailable === true) return 'session-in-use'
    }
    // A live session can sit in the store without an agent (retained, or
    // prepared and not yet announced). The Host would keep listing it after the
    // files are gone, so it is refused the same way.
    let live
    try {
      live = liveStore === undefined ? undefined : liveStore.get(targetId)
    } catch {
      live = undefined
    }
    if (live !== undefined) return 'session-in-use'
  }
  return undefined
}

/**
 * What still counts as work on this session.
 *
 * The registry's archive gate asks the same waterfall, so a job or schedule
 * naming the session is exactly what would have refused an archive. Purge has
 * to ask it itself: it destroys a session that may have been archived before
 * that work appeared. A missing event or a failing listener leaves the answer
 * empty rather than blocking every destroy.
 */
export async function sessionActivity(deps, sessionId) {
  const waterfall = deps.ctx?.waterfall
  if (typeof waterfall !== 'function') return []
  try {
    const result = await waterfall.call(
      deps.ctx,
      'workspace/session-activity',
      { sessionId },
      () => Promise.resolve([]),
    )
    return Array.isArray(result) ? result : []
  } catch (error) {
    deps.logger.warn(`[dsh-toolbox] activity check failed for ${sessionId}:`, error)
    return []
  }
}

/** Activity entries small enough to send to the panel. */
export function describeActivity(activity) {
  return activity.map((entry) => ({
    kind: typeof entry?.kind === 'string' ? entry.kind : 'active',
    id: typeof entry?.id === 'string' ? entry.id : undefined,
    label: typeof entry?.label === 'string' ? entry.label : undefined,
  }))
}

/** The activity of every target, only for the targets that report some. */
export async function collectActivity(deps, targets) {
  const active = []
  for (const targetId of targets) {
    const activity = await sessionActivity(deps, targetId)
    if (activity.length > 0) active.push({ sessionId: targetId, activity: describeActivity(activity) })
  }
  return active
}

/**
 * Remove one session's projection-cache record.
 *
 * The record is derived data owned by the `session_projcache` domain, so the
 * domain's own table is the supported route: it updates the cache service's
 * in-memory state as well as the medium, and it works for a backend that does
 * not use the per-record file layout. The file is the fallback for a build
 * where that domain is not open, and the `.bak` copies are removed either way
 * because they are dead by definition.
 */
export async function dropProjectionRecord(deps, sessionId) {
  const cache = deps.storage()?.get('session_projcache')
  let dropped = false
  if (cache !== undefined) {
    try {
      await cache.table('sessions').delete(sessionId)
      dropped = true
    } catch (error) {
      deps.logger.warn(`[dsh-toolbox] could not drop the projection record ${sessionId}:`, error)
    }
  }
  if (!dropped) await rm(projectionCacheFile(sessionId), { force: true }).catch(() => {})
  for (const backup of projectionCacheBackups(sessionId)) {
    await rm(backup, { force: true }).catch(() => {})
  }
}

/** The current summary for one session, or `undefined` when nothing lists it. */
export async function findSummary(deps, sessionId) {
  const controller = deps.controller()
  if (controller === undefined) return undefined
  const result = await controller.list({}, new AbortController().signal)
  return result.items.find((item) => item.sessionId === sessionId)
}

/**
 * The reversible step, from the panel.
 *
 * The registry refuses a session with live work — a running turn, a job, a
 * schedule — and one that neither memory nor persistence knows; both become a
 * specific refusal here instead of a generic failure.
 */
export async function archiveSession(deps, sessionId, res) {
  try {
    const summary = await findSummary(deps, sessionId)
    if (summary !== undefined && summary.running === true) {
      return respond(res, 409, { ok: false, error: 'session-running' })
    }
    const registry = deps.registry()
    if (registry === undefined) return respond(res, 503, { ok: false, error: 'registry-unavailable' })
    await registry.archiveSession(sessionId)
    respond(res, 200, { ok: true })
  } catch (error) {
    if (error?.name === 'WorkspaceActiveSessionError') {
      return respond(res, 409, {
        ok: false,
        error: 'session-active',
        activity: describeActivity(Array.isArray(error.activity) ? error.activity : []),
      })
    }
    if (error?.name === 'WorkspaceUnknownSessionError') {
      return respond(res, 404, { ok: false, error: 'session-not-found' })
    }
    deps.logger.warn('[dsh-toolbox] archive failed:', error)
    respond(res, 500, { ok: false, error: 'archive-failed' })
  }
}

export async function unarchiveSession(deps, sessionId, res) {
  try {
    const registry = deps.registry()
    if (registry === undefined) return respond(res, 503, { ok: false, error: 'registry-unavailable' })
    await registry.unarchiveSession(sessionId)
    respond(res, 200, { ok: true })
  } catch (error) {
    deps.logger.warn('[dsh-toolbox] unarchive failed:', error)
    respond(res, 500, { ok: false, error: 'unarchive-failed' })
  }
}

/**
 * What a destroy would remove, without removing anything.
 *
 * The panel reads this before it asks, so the confirmation names the subtree,
 * the bytes, the cache records and the workspaces instead of a bare title. It
 * applies the same gates as the real route — archived, not busy — so a preview
 * that says yes is not followed by a destroy that says no for another reason.
 */
export async function previewSession(deps, sessionId, res) {
  try {
    if (deps.persistence() === undefined) {
      return respond(res, 503, { ok: false, error: 'persistence-unavailable' })
    }
    if (deps.controller() === undefined) {
      return respond(res, 503, { ok: false, error: 'controller-unavailable' })
    }
    const { items, snapshotById, summary, snapshot, header, targets, isSubagent } = await resolveTargets(deps, sessionId)
    if (summary === undefined && snapshot === undefined) {
      return respond(res, 404, { ok: false, error: 'session-not-found' })
    }
    const archived = archivedSet(deps).has(sessionId)
    if (!isSubagent && !archived) {
      return respond(res, 409, { ok: false, error: 'session-not-archived' })
    }

    const { plans } = planLogDirectories(deps, { snapshotById, summary, header, targets })
    const planned = new Map(plans.map((plan) => [plan.id, plan.dir]))
    const rows = targets.map((targetId) => {
      const targetSnapshot = snapshotById.get(targetId)
      const targetHeader = targetSnapshot === undefined ? undefined : headerOf(targetSnapshot)
      const item = items.find((entry) => entry.sessionId === targetId)
      const title = item?.projections?.values?.title
      return {
        id: targetId,
        title: typeof title === 'string' && title.trim() !== '' ? title : undefined,
        isSubagent: (item?.origin ?? targetHeader?.origin) === 'subagent',
        sizeBytes: typeof targetSnapshot?.sizeBytes === 'number' ? targetSnapshot.sizeBytes : undefined,
        hasLog: planned.has(targetId),
        running: item?.running === true,
        agentAvailable: item?.agentAvailable === true,
      }
    })

    const cache = deps.storage()?.get('session_projcache')
    const cacheTable = cache === undefined ? undefined : cache.table('sessions')
    const registry = deps.registry()
    const workspaces = (registry?.list() ?? [])
      .filter((workspace) => targets.some((id) => workspace.sessionIds.includes(id)))
    const pinnedIds = registry?.pinnedSessionIds

    respond(res, 200, {
      ok: true,
      sessionId,
      archived,
      busy: findBusy(items, targets, deps.liveStore()) ?? null,
      sessions: rows,
      directories: rows.filter((row) => row.hasLog).length,
      bytes: rows.reduce((sum, row) => sum + (row.sizeBytes ?? 0), 0),
      workspaces: workspaces.map((workspace) => workspace.id),
      pinned: Array.isArray(pinnedIds) ? pinnedIds.filter((id) => targets.includes(id)) : [],
      projectionRecords: cacheTable === undefined
        ? 0
        : targets.filter((id) => cacheTable.get(id) !== undefined).length,
      activity: await collectActivity(deps, targets),
    })
  } catch (error) {
    deps.logger.warn('[dsh-toolbox] preview failed:', error)
    respond(res, 500, { ok: false, error: 'preview-failed' })
  }
}

/**
 * Permanent removal of one archived session and its subagent subtree.
 *
 * Only an archived session may be destroyed: archiving is the reversible step,
 * so the irreversible click can never be the first one. Subagent children are
 * exempt — they never appear in the sidebar, so they can never be archived, and
 * they are exactly what the orphan bucket is for.
 *
 * A child log is a sibling directory, it can never be opened without its
 * parent, and the sidebar never shows subagent-origin rows — so leaving it
 * behind would be a trace nobody could reach. Destroying a session therefore
 * takes its whole subtree, and refuses the whole subtree when any part of it is
 * busy or cannot be located.
 */
export async function purgeSession(deps, sessionId, res) {
  try {
    // Without these services the listings cannot tell "no log" from "cannot
    // look": both would come back empty, and the registry would be cleared for
    // a log that is still on disk.
    if (deps.persistence() === undefined) {
      return respond(res, 503, { ok: false, error: 'persistence-unavailable' })
    }
    if (deps.controller() === undefined) {
      return respond(res, 503, { ok: false, error: 'controller-unavailable' })
    }

    const { items, snapshotById, summary, snapshot, header, targets, isSubagent } = await resolveTargets(deps, sessionId)

    const initialBusy = findBusy(items, targets, deps.liveStore())
    if (initialBusy !== undefined) return respond(res, 409, { ok: false, error: initialBusy })

    if (summary === undefined && snapshot === undefined) {
      return respond(res, 404, { ok: false, error: 'session-not-found' })
    }
    if (!isSubagent && !archivedSet(deps).has(sessionId)) {
      return respond(res, 409, { ok: false, error: 'session-not-archived' })
    }

    // Work the archive gate would name: a job or a schedule can appear after
    // the session was archived, and destroying the session under it would leave
    // that work pointing at nothing.
    const active = await collectActivity(deps, targets)
    if (active.length > 0) {
      return respond(res, 409, { ok: false, error: 'session-active', activity: active })
    }

    // Preflight: resolve every artifact directory before deleting anything.
    const { plans, missing } = planLogDirectories(deps, { snapshotById, summary, header, targets })
    if (missing.length > 0) {
      deps.logger.warn(`[dsh-toolbox] ${missing.join(', ')}: no locatable log directory; refusing the destroy`)
      return respond(res, 409, { ok: false, error: 'artifact-not-located' })
    }

    // The checks above ran while two listings were read; re-read the live state
    // here, immediately before the first irreversible step, so a session resumed
    // in that window is still refused.
    const late = await deps.controller().list({}, new AbortController().signal)
    const lateBusy = findBusy(late.items, targets, deps.liveStore())
    if (lateBusy !== undefined) return respond(res, 409, { ok: false, error: lateBusy })

    // 1) The log directories, children first: if one fails, the parent row (with
    //    its retry button) survives instead of every child becoming an orphan. A
    //    busy file is retried a few times before it is reported.
    const failures = []
    for (const plan of [...plans].reverse()) {
      try {
        await rm(plan.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      } catch (error) {
        failures.push({ sessionId: plan.id, code: typeof error?.code === 'string' ? error.code : 'rm-failed' })
        deps.logger.warn(`[dsh-toolbox] could not remove ${plan.dir}:`, error)
      }
    }
    const failed = new Set(failures.map((entry) => entry.sessionId))
    const cleaned = targets.filter((id) => !failed.has(id))

    // 2) The projection-cache records that live outside the log directories.
    for (const targetId of cleaned) await dropProjectionRecord(deps, targetId)

    // 3) Every registry entry that names the session. Cleanup is per target: one
    //    workspace failure must not keep another session's archive flag alive.
    //    Removing these is what keeps the sidebar's pin/archive sets and the
    //    Ungrouped bucket from remembering it.
    const notDetached = new Set()
    let workspaces
    try {
      workspaces = deps.registry()?.list() ?? []
    } catch (error) {
      deps.logger.warn('[dsh-toolbox] workspace listing failed:', error)
      workspaces = []
      for (const targetId of cleaned) notDetached.add(targetId)
    }
    for (const targetId of cleaned) {
      for (const workspace of workspaces) {
        if (!workspace.sessionIds.includes(targetId)) continue
        try {
          await workspace.detachSession(targetId)
        } catch (error) {
          notDetached.add(targetId)
          deps.logger.warn(`[dsh-toolbox] could not detach ${targetId}:`, error)
        }
      }
    }
    for (const targetId of cleaned) {
      try {
        await deps.registry()?.unpinSession(targetId)
      } catch (error) {
        deps.logger.warn(`[dsh-toolbox] could not unpin ${targetId}:`, error)
      }
    }
    for (const targetId of cleaned) {
      // Unarchiving is only safe once the session has no workspace slot:
      // otherwise it would come back as an empty "Ungrouped" row.
      if (notDetached.has(targetId)) continue
      try {
        await deps.registry()?.unarchiveSession(targetId)
      } catch (error) {
        deps.logger.warn(`[dsh-toolbox] could not unarchive ${targetId}:`, error)
      }
    }

    if (failures.length > 0) {
      return respond(res, 500, {
        ok: false,
        error: 'purge-partial',
        removed: cleaned.length,
        failed: failures.map((entry) => entry.sessionId),
      })
    }

    respond(res, 200, { ok: true, removed: targets.length, directories: plans.length })
  } catch (error) {
    deps.logger.warn('[dsh-toolbox] purge failed:', error)
    respond(res, 500, { ok: false, error: 'purge-failed' })
  }
}
