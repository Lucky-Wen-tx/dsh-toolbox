/**
 * Reading the session corpus, and turning it into the rows the panel shows.
 *
 * The two listings are the only sources here: `sessionController.list()` is the
 * authoritative row source (it reports running/blank/agentAvailable/origin
 * without resuming an agent), and `sessionPersistence.list()` adds the on-disk
 * size and the location a destroy needs. Grouping comes from the workspace
 * registry, not from either listing.
 *
 * Every function takes a `deps` object of service getters instead of closing
 * over a Cordis context, so the module can be tested with plain fakes.
 */
import { locateSessionDir, sessionsRoot } from './paths.js'

/** The `header` of a persistence snapshot, tolerating a bare header. */
export function headerOf(item) {
  return item && item.header ? item.header : item
}

/** Index snapshots by session id. */
export function indexByHeader(snapshots) {
  const byId = new Map()
  for (const snapshot of snapshots) byId.set(headerOf(snapshot).id, snapshot)
  return byId
}

/**
 * Read both listings in one go.
 *
 * Throws when the controller is missing, because a view without rows is not a
 * view; a missing persistence service is tolerated here (the panel still shows
 * what memory knows), while the mutating routes check it themselves.
 */
export async function readCorpus(deps) {
  const controller = deps.controller()
  if (controller === undefined) throw new Error('session-controller-unavailable')
  const persistence = deps.persistence()
  const signal = new AbortController().signal
  const [listResult, snapshots] = await Promise.all([
    controller.list({}, signal),
    persistence === undefined ? Promise.resolve([]) : persistence.list(),
  ])
  return { items: listResult.items, snapshots, snapshotById: indexByHeader(snapshots) }
}

/**
 * The id set carrying an archive flag, read from the workspace domain.
 *
 * `undefined` storage means no flags are knowable; returning an empty set keeps
 * every caller's semantics ("not archived") safe rather than optimistic.
 */
export function archivedSet(deps) {
  const domain = deps.storage()
  const workspace = domain === undefined ? undefined : domain.get('workspace')
  if (workspace === undefined) return new Set()
  const state = workspace.global.get()
  return new Set(Array.isArray(state.archivedSessionIds) ? state.archivedSessionIds : [])
}

/**
 * Every session below `sessionId` in the subagent tree, parents before children.
 *
 * A child carries `parentSessionId`, so the tree is rebuilt from the same list
 * the panel renders. The backend's own listing is folded in as well: a child the
 * controller did not report (an unreadable or newer-format header) is still a
 * log on disk, and leaving it behind would be a trace nobody can reach. The
 * visited set keeps a malformed or self-referencing header from turning a
 * destroy into an endless walk.
 */
export function collectDescendants(items, headers, sessionId) {
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

/**
 * One session, its subtree, and the listing rows on both sides.
 *
 * Shared by the preview and the destroy so the two always name the same set:
 * a confirmation built from one set and applied to another is exactly the kind
 * of gap that makes an irreversible action feel arbitrary.
 */
export async function resolveTargets(deps, sessionId) {
  const corpus = await readCorpus(deps)
  const summary = corpus.items.find((item) => item.sessionId === sessionId)
  const snapshot = corpus.snapshotById.get(sessionId)
  const header = snapshot === undefined ? undefined : headerOf(snapshot)
  const targets = [sessionId, ...collectDescendants(corpus.items, corpus.snapshots.map(headerOf), sessionId)]
  const isSubagent = summary?.origin === 'subagent' || header?.origin === 'subagent'
  return { ...corpus, summary, snapshot, header, targets, isSubagent }
}

/**
 * Resolve every target's log directory before anything is deleted.
 *
 * `missing` names targets the backend knows but this build cannot find; the
 * caller refuses the whole subtree rather than clearing a registry entry for a
 * log that would survive, unreachable. A target with no snapshot has no log at
 * all (a blank session, or the residue of an earlier destroy) and is simply
 * left out of `plans`.
 */
export function planLogDirectories(deps, { snapshotById, summary, header, targets }) {
  const plans = []
  const missing = []
  for (const targetId of targets) {
    const targetSnapshot = snapshotById.get(targetId)
    const targetHeader = targetSnapshot === undefined ? undefined : headerOf(targetSnapshot)
    const dir = locateSessionDir(
      deps.persistence(),
      targetSnapshot,
      targetId,
      targetHeader?.cwd ?? summary?.cwd ?? header?.cwd,
    )
    if (dir === undefined) {
      if (targetSnapshot !== undefined) missing.push(targetId)
      continue
    }
    plans.push({ id: targetId, dir })
  }
  return { plans, missing }
}

/**
 * Build the full session view.
 *
 * Rows with neither a persistence snapshot nor a locateable directory are
 * dropped: every artifact of such a session is already gone, and only an
 * in-memory agent still remembers it. A row without a size and a path can only
 * be noise in a list meant for deciding what to clean up.
 *
 * Grouping follows the official rule: a session belongs to the workspace whose
 * `sessionIds` lists it; anything unlisted falls into the Ungrouped bucket.
 * Archived sessions keep their slot — the panel shows them in place, with the
 * archive toggle and the destroy button.
 */
export async function buildView(deps) {
  const corpus = await readCorpus(deps)
  const archived = archivedSet(deps)
  const persistence = deps.persistence()

  const rows = []
  for (const summary of corpus.items) {
    const id = summary.sessionId
    const snapshot = corpus.snapshotById.get(id)
    const header = snapshot === undefined ? undefined : headerOf(snapshot)
    const cwd = summary.cwd ?? header?.cwd
    const dir = locateSessionDir(persistence, snapshot, id, cwd)
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

  // Subagent children nest under their parent; a child whose parent is gone is
  // an orphan (the case a plain session list silently hides).
  const orphans = []
  for (const row of rows) {
    if (!row.isSubagent) continue
    const parent = row.parentSessionId === undefined ? undefined : byId.get(row.parentSessionId)
    if (parent === undefined) orphans.push(row)
    else parent.subagents.push(row)
  }

  const ordinary = rows.filter((row) => !row.isSubagent)
  const registry = deps.registry()
  const workspaces = registry === undefined ? [] : registry.list()
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
  return { groups, orphans, totalBytes, sessionsRoot: sessionsRoot() }
}
