/**
 * dsh-toolbox host entry — session cleanup for the Web UI.
 *
 * The plugin owns exactly one capability: list sessions with their real on-disk
 * footprint, archive one in place, and destroy it for good. It does not own the
 * archive flag's storage (`workspaceRegistry`), the session logs themselves
 * (`sessionPersistence`), workspace accounting (`Workspace.detachSession`), or
 * the meaning of "running" (`sessionController.list()`); it only calls their
 * public services.
 *
 * The two rules that shape every route:
 *
 *   - Archiving is the reversible step, so it comes first and an unarchived
 *     session is never destroyed.
 *   - Nothing this process can still write is destroyed: a running turn, a
 *     loaded agent, a session the in-memory store holds, or work the archive
 *     gate would name is refused instead of half-deleted.
 *
 * Module map:
 *
 *   paths.js      the on-disk layout, id encoding, and directory validation
 *   http.js       body reading, the id gate, the same-origin gate
 *   view.js       both listings, the subagent tree, the panel's rows
 *   mutations.js  archive, unarchive, preview, destroy
 *   startup.js    the two post-start sweeps of leftover state
 *   index.js      service wiring, the mutation queue, the routes
 *
 * Everything is plain ESM with no `@deepseek-ai/*` import, so the package
 * installs and loads without a build step.
 */
import { respond, readId } from './http.js'
import { sessionsRoot } from './paths.js'
import { buildView } from './view.js'
import { collectOrphanedArtifacts, dropStaleArchiveFlags } from './startup.js'
import { archiveSession, previewSession, purgeSession, unarchiveSession } from './mutations.js'

export const name = 'dsh-toolbox-sessions'
/** Services are resolved through a scoped `ctx.inject` below. */
export const inject = []

const ROUTE_PREFIX = '/dsh-toolbox'

export function apply(ctx) {
  ctx.inject(['webServer', 'sessionController', 'sessionPersistence'], (scoped) => {
    /**
     * The services every other module works against.
     *
     * Getter functions, not values: `workspaceRegistry`, `storageDomain` and
     * the session store activate late in some compositions, so a captured
     * `undefined` would silently disable a safety check for the whole life of
     * the process.
     */
    const deps = {
      ctx: scoped,
      controller: () => scoped.get('sessionController'),
      persistence: () => scoped.get('sessionPersistence'),
      registry: () => scoped.get('workspaceRegistry'),
      storage: () => scoped.get('storageDomain'),
      liveStore: () => scoped.get('sessions'),
      logger: scoped.logger,
    }

    /**
     * One mutation at a time.
     *
     * A destroy is several steps — the log directory, the projection record,
     * the workspace slot, the pin, the archive flag — and two destroys clicked
     * in quick succession would otherwise interleave them. Serialising them
     * also covers the archive toggle, so a destroy can never see a session that
     * a concurrent unarchive just made eligible again.
     */
    let mutationTail = Promise.resolve()
    const serialize = (run) => {
      const next = mutationTail.then(run, run)
      mutationTail = next.then(() => undefined, () => undefined)
      return next
    }

    /**
     * The orphan sweep waits for the services it inspects; a missing
     * projection-cache domain means it would only prune empty directories while
     * pretending the cache was clean, so it is retried by the next read.
     */
    let gcAttempted = false
    const runGcOnce = async () => {
      if (gcAttempted) return
      if (deps.controller() === undefined || deps.storage() === undefined) return
      if (deps.storage().get('session_projcache') === undefined) return
      gcAttempted = true
      await serialize(() => collectOrphanedArtifacts(deps))
    }

    const sweep = (label, run) => {
      run().catch((error) => {
        scoped.logger.warn(`[dsh-toolbox] ${label} failed:`, error)
      })
    }

    sweep('stale archive cleanup', () => dropStaleArchiveFlags(deps))
    sweep('orphan cleanup', runGcOnce)

    const route = (path, handler) => {
      scoped.webServer.register({ kind: 'exact', path: `${ROUTE_PREFIX}${path}`, handler })
    }

    /** A mutating route: validate the id, then run under the queue. */
    const mutation = (run) => async (req, res) => {
      const id = await readId(req, res)
      if (id === undefined) return
      await serialize(() => run(deps, id, res))
    }

    // GET /dsh-toolbox/state — grouped sessions and orphans in one read.
    route('/state', async (_req, res) => {
      sweep('orphan cleanup', runGcOnce)
      try {
        const view = await buildView(deps)
        respond(res, 200, {
          ok: true,
          groups: view.groups,
          orphans: view.orphans,
          totalBytes: view.totalBytes,
          sessionsRoot: view.sessionsRoot ?? sessionsRoot(),
        })
      } catch (error) {
        scoped.logger.warn('[dsh-toolbox] state failed:', error)
        respond(res, 500, { ok: false, error: 'state-failed' })
      }
    })

    // POST /dsh-toolbox/preview — what a destroy would remove, read-only.
    route('/preview', mutation(previewSession))

    // POST /dsh-toolbox/archive — hide a session in the sidebar, files intact.
    route('/archive', mutation(archiveSession))

    // POST /dsh-toolbox/unarchive — undo it.
    route('/unarchive', mutation(unarchiveSession))

    // POST /dsh-toolbox/purge — permanent removal of one archived session.
    route('/purge', mutation(purgeSession))
  })
}
