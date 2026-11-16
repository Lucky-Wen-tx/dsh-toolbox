/**
 * Route-level smoke test for the host row.
 *
 * The plugin normally runs inside a Host, so this mounts it on a small fake
 * context and a throwaway `DSH_HOME`: it drives the real HTTP handlers, reads
 * and writes real files, and asserts what the host row promises. No DSH import
 * and no third-party dependency — `node test/smoke.mjs`.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

const home = await mkdtemp(join(tmpdir(), 'dsh-toolbox-smoke-'))
process.env.DSH_HOME = home
const sessionsRoot = join(home, 'sessions')
const cacheRoot = join(home, 'storages', 'session_projcache', 'sessions')
const proj = join(sessionsRoot, '--D-proj--')

function logPath(dir) {
  return join(dir, 'session.v3.jsonl.zstd')
}

async function makeSession(projectDir, sessionId, text = 'log') {
  const dir = join(projectDir, sessionId)
  await mkdir(dir, { recursive: true })
  await writeFile(logPath(dir), `${text}\n`)
  return dir
}

async function makeCacheRecord(sessionId) {
  await mkdir(cacheRoot, { recursive: true })
  await writeFile(join(cacheRoot, `${sessionId}.json`), '{"ver":7}')
}

// ── fixtures ───────────────────────────────────────────────────────────────
const dirA = await makeSession(proj, 'session-a')
const dirChild = await makeSession(proj, 'child-1', 'child')
await makeSession(proj, 'session-b')
await makeSession(proj, 'session-d')
const dirE = await makeSession(proj, 'session-e')
await makeSession(join(sessionsRoot, '--other--'), 'session-f')
// `session-c` is a snapshot the backend knows about but whose log is gone.
for (const id of ['session-a', 'child-1', 'session-b', 'session-d', 'session-e', 'session-f', 'ghost']) {
  await makeCacheRecord(id)
}

const calls = []
const archived = new Set(['session-a', 'session-c', 'session-d', 'session-e', 'session-f'])
const detached = new Set()

const snapshots = new Map([
  ['session-a', { id: 'session-a', cwd: 'D:\\proj', createdAt: 1 }],
  ['child-1', { id: 'child-1', cwd: 'D:\\proj', createdAt: 2, parentSessionId: 'session-a' }],
  ['session-b', { id: 'session-b', cwd: 'D:\\proj', createdAt: 3 }],
  // A snapshot with no artifact directory on disk, and no cwd to derive one.
  ['session-c', { id: 'session-c', createdAt: 4 }],
  ['session-d', { id: 'session-d', cwd: 'D:\\proj', createdAt: 5 }],
  ['session-e', { id: 'session-e', cwd: 'D:\\proj', createdAt: 6 }],
  // Only `locate()` can find this one: the header carries no cwd.
  ['session-f', { id: 'session-f', createdAt: 7 }],
])

const located = new Map([
  ['session-f', logPath(join(sessionsRoot, '--other--', 'session-f'))],
])

const summaries = [
  { sessionId: 'session-a', cwd: 'D:\\proj', updatedAt: 10, running: false, agentAvailable: false, origin: 'web', projections: { values: { title: 'A' } } },
  { sessionId: 'child-1', cwd: 'D:\\proj', updatedAt: 9, running: false, agentAvailable: false, origin: 'subagent', parentSessionId: 'session-a' },
  { sessionId: 'session-b', cwd: 'D:\\proj', updatedAt: 8, running: false, agentAvailable: false, origin: 'web' },
  { sessionId: 'session-c', cwd: 'D:\\proj', updatedAt: 7, running: false, agentAvailable: false, origin: 'web' },
  { sessionId: 'session-d', cwd: 'D:\\proj', updatedAt: 6, running: false, agentAvailable: false, origin: 'web' },
  { sessionId: 'session-e', cwd: 'D:\\proj', updatedAt: 5, running: false, agentAvailable: false, origin: 'web' },
  { sessionId: 'session-f', updatedAt: 4, running: false, agentAvailable: false, origin: 'web' },
  { sessionId: 'session-running', cwd: 'D:\\proj', updatedAt: 3, running: true, agentAvailable: true, origin: 'web' },
]

class FakeCacheTable {
  constructor(ids) {
    this.ids = new Set(ids)
  }
  get size() {
    return this.ids.size
  }
  *keys() {
    for (const id of [...this.ids].sort()) yield id
  }
  async delete(id) {
    calls.push(['cache-delete', id])
    return this.ids.delete(id)
  }
  async deleteMany(ids) {
    let removed = 0
    for (const id of ids) {
      if (this.ids.delete(id)) {
        removed += 1
        calls.push(['cache-delete', id])
      }
    }
    return removed
  }
}
const cacheTable = new FakeCacheTable([...snapshots.keys(), 'ghost'])

const workspace = {
  id: 'ws-1',
  title: 'proj',
  path: 'D:\\proj',
  get sessionIds() {
    return ['session-a', 'session-b', 'session-c', 'session-d', 'session-e', 'session-f']
      .filter((id) => !detached.has(id))
  },
  async detachSession(id) {
    calls.push(['detach', id])
    detached.add(id)
  },
}

const scoped = {
  logger: { info() {}, warn() {}, debug() {} },
  get(name) {
    if (name === 'sessionController') {
      return {
        list: async () => ({ items: summaries }),
      }
    }
    if (name === 'sessionPersistence') {
      return {
        list: async () => [...snapshots.values()].map((header) => ({
          header,
          sizeBytes: 512,
          location: existsSync(join(proj, header.id))
            ? { kind: 'jsonl', path: logPath(join(proj, header.id)) }
            : undefined,
        })),
        locate: (header) => (located.has(header.id) ? { path: located.get(header.id) } : undefined),
      }
    }
    if (name === 'workspaceRegistry') {
      return {
        list: () => [workspace],
        async archiveSession(id) {
          calls.push(['archive', id])
          archived.add(id)
        },
        async unarchiveSession(id) {
          calls.push(['unarchive', id])
          archived.delete(id)
        },
        async unpinSession(id) {
          calls.push(['unpin', id])
        },
      }
    }
    if (name === 'storageDomain') {
      return {
        get(domainName) {
          if (domainName === 'workspace') {
            return { global: { get: () => ({ archivedSessionIds: [...archived] }) } }
          }
          if (domainName === 'session_projcache') {
            return { table: () => cacheTable }
          }
          return undefined
        },
      }
    }
    if (name === 'sessions') {
      return { get: () => undefined }
    }
    return undefined
  },
}

const routes = new Map()
const ctx = {
  inject(_names, callback) {
    callback(scoped)
  },
}
scoped.webServer = {
  register({ path, handler }) {
    routes.set(path, handler)
  },
}

function post(payload) {
  const req = Readable.from([Buffer.from(JSON.stringify(payload))])
  req.method = 'POST'
  return req
}

function makeRes() {
  return {
    status: 0,
    body: undefined,
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body === undefined ? undefined : JSON.parse(body)
    },
  }
}

async function call(path, payload) {
  const handler = routes.get(path)
  assert.ok(handler !== undefined, `route ${path} is registered`)
  const res = makeRes()
  await handler(post(payload), res)
  return res
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── mount ──────────────────────────────────────────────────────────────────
const host = await import('../src/host/index.js')
host.apply(ctx)

// The startup sweep runs once, off the request path.
await sleep(50)

// The orphan sweep drops a projection record no session answers for.
assert.equal(cacheTable.ids.has('ghost'), false, 'orphaned projection record is dropped')
assert.equal(cacheTable.ids.has('session-a'), true, 'a live session keeps its record')
assert.equal(existsSync(dirA), true, 'the sweep never deletes a session log')

// ── GET /state ─────────────────────────────────────────────────────────────
{
  const res = makeRes()
  await routes.get('/dsh-toolbox/state')({ method: 'GET' }, res)
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.sessionsRoot, sessionsRoot)
  const group = res.body.groups.find((entry) => entry.workspaceId === 'ws-1')
  assert.ok(group !== undefined, 'the workspace is grouped')
  const parent = group.sessions.find((row) => row.id === 'session-a')
  assert.ok(parent !== undefined, 'the parent is listed')
  assert.equal(parent.archived, true, 'the archive flag is reported')
  assert.equal(parent.subagents.length, 1, 'the child is nested under its parent')
  assert.equal(parent.subagents[0].id, 'child-1')
  assert.deepEqual(res.body.orphans, [], 'no orphan while the parent exists')
}

// ── purge: archived parent takes its subtree ───────────────────────────────
{
  const res = await call('/dsh-toolbox/purge', { sessionId: 'session-a' })
  assert.equal(res.status, 200)
  assert.equal(res.body.removed, 2)
  assert.equal(res.body.directories, 2)
  assert.equal(existsSync(dirA), false, 'the parent log directory is gone')
  assert.equal(existsSync(dirChild), false, 'the child log directory is gone')
  assert.equal(cacheTable.ids.has('session-a'), false, 'the projection record is gone')
  assert.equal(cacheTable.ids.has('child-1'), false, 'the child projection record is gone')
  for (const [step, id] of [['unpin', 'session-a'], ['unarchive', 'session-a'], ['detach', 'session-a'], ['unpin', 'child-1'], ['unarchive', 'child-1']]) {
    assert.ok(calls.some((call) => call[0] === step && call[1] === id), `${step} ran for ${id}`)
  }
}

// ── purge: refuse when the backend knows a log this build cannot find ──────
{
  const before = calls.length
  const res = await call('/dsh-toolbox/purge', { sessionId: 'session-c' })
  assert.equal(res.status, 409)
  assert.equal(res.body.error, 'artifact-not-located')
  const after = calls.slice(before).map((call) => call[0])
  for (const step of ['detach', 'unpin', 'unarchive', 'cache-delete']) {
    assert.equal(after.includes(step), false, `${step} must not run when the log is unlocatable`)
  }
  assert.equal(archived.has('session-c'), true, 'the archive flag is left alone')
}

// ── purge: refuse a session that was never archived ────────────────────────
{
  const res = await call('/dsh-toolbox/purge', { sessionId: 'session-b' })
  assert.equal(res.status, 409)
  assert.equal(res.body.error, 'session-not-archived')
  assert.equal(existsSync(join(proj, 'session-b')), true)
}

// ── purge: locate() finds a log the cwd cannot derive ─────────────────────
{
  const archivedFirst = await call('/dsh-toolbox/archive', { sessionId: 'session-b' })
  assert.equal(archivedFirst.status, 200)
  const purged = await call('/dsh-toolbox/purge', { sessionId: 'session-b' })
  assert.equal(purged.status, 200)
  assert.equal(existsSync(join(proj, 'session-b')), false, 'the archived session is destroyed')

  const res = await call('/dsh-toolbox/purge', { sessionId: 'session-f' })
  assert.equal(res.status, 200)
  assert.equal(existsSync(join(sessionsRoot, '--other--', 'session-f')), false, 'the located log is gone')
}

// ── archive: a running session is refused ─────────────────────────────────
{
  const res = await call('/dsh-toolbox/archive', { sessionId: 'session-running' })
  assert.equal(res.status, 409)
  assert.equal(res.body.error, 'session-running')
}

// ── serialisation: two destroys never interleave their steps ──────────────
{
  calls.length = 0
  const [first, second] = await Promise.all([
    call('/dsh-toolbox/purge', { sessionId: 'session-d' }),
    call('/dsh-toolbox/purge', { sessionId: 'session-e' }),
  ])
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(existsSync(join(proj, 'session-d')), false)
  assert.equal(existsSync(dirE), false)

  const order = calls.filter((call) => call[0] === 'detach').map((call) => call[1])
  assert.deepEqual(order, [...new Set(order)], 'each session is detached once')
  const firstBlock = calls.findIndex((call) => call[1] === order[0])
  const lastOfFirst = calls.map((call) => call[1]).lastIndexOf(order[0])
  const firstOfSecond = calls.findIndex((call) => call[1] === order[1])
  const lastOfSecond = calls.map((call) => call[1]).lastIndexOf(order[1])
  assert.ok(
    lastOfFirst < firstOfSecond || lastOfSecond < firstBlock,
    'the two mutations do not interleave',
  )
}

// ── malformed input ───────────────────────────────────────────────────────
{
  const res = await call('/dsh-toolbox/purge', { sessionId: '../escape' })
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'invalid-session-id')
}

await rm(home, { recursive: true, force: true })
console.log('smoke: all assertions passed')
