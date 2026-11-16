/**
 * The HTTP surface shared by the route handlers.
 *
 * Three rules live here: a body is bounded and parsed as JSON, an id is
 * validated before it is ever joined into a path, and a mutating request has to
 * prove it came from this origin.
 */

const MAX_BODY_BYTES = 64 * 1024

/**
 * Session ids are joined into a path, so keep the charset tight. A bare `.` or
 * `..` is rejected separately: both match this charset but resolve to a parent
 * directory, so a delete would target the wrong directory.
 */
const SESSION_ID_RE = /^[A-Za-z0-9_.:-]+$/
const DOT_SEGMENT_RE = /^\.+$/

export function readJsonBody(req) {
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

export function respond(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export function parseSessionId(body) {
  const value = body && typeof body === 'object' ? body.sessionId : undefined
  if (typeof value !== 'string' || !SESSION_ID_RE.test(value)) return undefined
  // `.` and `..` pass the charset but name a directory, not a session.
  if (DOT_SEGMENT_RE.test(value)) return undefined
  return value
}

/**
 * Whether one mutating request may act.
 *
 * These routes destroy files, and a cross-origin page can send a `text/plain`
 * "simple" POST to loopback without a preflight — the body is JSON either way,
 * so the content-type buys nothing. A browser request therefore has to prove it
 * is same-origin; a non-browser client (no `Sec-Fetch-Site` and no `Origin`) is
 * left alone, because it is not the browser threat this guards against.
 */
export function sameOrigin(req) {
  const headers = req.headers ?? {}
  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site !== '') return site === 'same-origin' || site === 'none'
  const origin = headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    const host = headers.host
    return typeof host === 'string' && host !== '' && new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * Read one body and hand back a validated id.
 *
 * Answers the request itself and returns `undefined` when the method, origin,
 * body or id is wrong, so every route can start with the same three lines and
 * never see an unvalidated id.
 */
export async function readId(req, res) {
  if (req.method !== 'POST') {
    respond(res, 405, { ok: false, error: 'method-not-allowed' })
    return undefined
  }
  if (!sameOrigin(req)) {
    respond(res, 403, { ok: false, error: 'forbidden-origin' })
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
