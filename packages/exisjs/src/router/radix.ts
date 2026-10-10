import type { Route, RouteMatch } from '../types'
import { HttpError } from '../error/errors'

// ─── Node Types ──────────────────────────────────────────────────────────────

const enum NodeKind {
  STATIC = 0,
  PARAM = 1,
  WILDCARD = 2,
}

// ─── Radix Node ──────────────────────────────────────────────────────────────
// Flat, cache-friendly structure. No Map, no Record — just plain properties.

class RadixNode {
  // Node identity
  kind: NodeKind = NodeKind.STATIC
  part = ''

  // ─── Method Store ──────────────────────────────────────────────────────────
  // Stores routes keyed by HTTP method. Uses a flat object for fastest property
  // lookup. For hot-path methods (GET/POST), we use dedicated slots to skip
  // the property lookup entirely.
  routeGET: Route | Route[] | null = null
  routePOST: Route | Route[] | null = null
  routeALL: Route | Route[] | null = null
  routeOther: Record<string, Route | Route[]> | null = null

  private _addRouteToArray(
    existing: Route | Route[] | null,
    route: Route
  ): Route | Route[] {
    if (!existing) return route
    if (Array.isArray(existing)) {
      if (route.host) existing.unshift(route)
      else existing.push(route)
      return existing
    }
    const arr = [existing]
    if (route.host) arr.unshift(route)
    else arr.push(route)
    return arr
  }

  // ─── Children ──────────────────────────────────────────────────────────────
  // Static children are stored as a direct-index array keyed by the first
  // character code of the segment. This avoids Map overhead entirely.
  // For segments sharing the same first char, we chain in a small array.
  staticChildren: RadixNode[] | null = null
  staticChildKeys: string[] | null = null

  // Param child — at most one per node level
  paramChild: RadixNode | null = null
  paramName = ''

  // Wildcard child — at most one per node level
  wildcardChild: RadixNode | null = null
  wildcardName = ''

  setRoute(method: string, route: Route): void {
    if (route.host && !(route as any)._hostRegexes) {
      const hostList = Array.isArray(route.host) ? route.host : [route.host]
      ;(route as any)._hostRegexes = {}
      for (const h of hostList) {
        if (h.includes(':')) {
          const regexStr = h.replace(/:([a-zA-Z0-9_]+)/g, '(?<$1>[^.]+)')
          ;(route as any)._hostRegexes[h] = new RegExp('^' + regexStr + '$')
        }
      }
    }
    switch (method) {
      case 'GET':
        this.routeGET = this._addRouteToArray(this.routeGET, route)
        return
      case 'POST':
        this.routePOST = this._addRouteToArray(this.routePOST, route)
        return
      case 'ALL':
        this.routeALL = this._addRouteToArray(this.routeALL, route)
        return
      default:
        if (!this.routeOther) this.routeOther = Object.create(null)
        this.routeOther![method] = this._addRouteToArray(
          this.routeOther![method] || null,
          route
        )
    }
  }

  getRoute(
    method: string,
    host?: string
  ): { route: Route; hostParams?: Record<string, string> } | null {
    let routes: Route | Route[] | null
    switch (method) {
      case 'GET':
        routes = this.routeGET || this.routeALL
        break
      case 'POST':
        routes = this.routePOST || this.routeALL
        break
      default:
        if (this.routeOther) {
          const r = this.routeOther[method]
          routes = r || this.routeALL
        } else {
          routes = this.routeALL
        }
    }
    if (!routes) return null

    if (!Array.isArray(routes)) {
      if (routes.host) {
        if (!host) return null
        const hostList = Array.isArray(routes.host)
          ? routes.host
          : [routes.host]
        let matched = false
        let hostParams = undefined
        for (const h of hostList) {
          if ((routes as any)._hostRegexes && (routes as any)._hostRegexes[h]) {
            const match = host.match((routes as any)._hostRegexes[h])
            if (match) {
              matched = true
              if (match.groups) hostParams = match.groups
              break
            }
          } else if (h === host) {
            matched = true
            break
          }
        }
        if (!matched) return null
        return hostParams ? { route: routes, hostParams } : { route: routes }
      }
      return { route: routes }
    }

    for (const route of routes) {
      if (!route.host) return { route } // fallback matches any host
      if (!host) continue

      const hostList = Array.isArray(route.host) ? route.host : [route.host]
      for (const h of hostList) {
        if ((route as any)._hostRegexes && (route as any)._hostRegexes[h]) {
          const match = host.match((route as any)._hostRegexes[h])
          if (match) return { route, hostParams: match.groups }
        } else if (h === host) {
          return { route }
        }
      }
    }
    return null
  }

  findStaticChild(segment: string): RadixNode | null {
    const keys = this.staticChildKeys
    if (keys === null) return null
    // Linear scan — number of children per node is small (< 20 typically)
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === segment) return this.staticChildren![i]
    }
    return null
  }

  // Same as findStaticChild(path.substring(start, end)) without allocating
  // the segment string
  findStaticChildAt(
    path: string,
    start: number,
    end: number
  ): RadixNode | null {
    const keys = this.staticChildKeys
    if (keys === null) return null
    const len = end - start
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      if (k.length === len && path.startsWith(k, start)) {
        return this.staticChildren![i]
      }
    }
    return null
  }

  addStaticChild(segment: string, child: RadixNode): void {
    if (this.staticChildKeys === null) {
      this.staticChildKeys = [segment]
      this.staticChildren = [child]
    } else {
      this.staticChildKeys.push(segment)
      this.staticChildren!.push(child)
    }
  }
}

// ─── JS Radix Tree (Fallback & Host Routing) ──────────────────────────────────

export class JSRadixTree {
  root: RadixNode = new RadixNode()
  hasHostRoutes = false
  // Exact-match table for purely static routes, filled at insert time.
  // Keyed by method, then by path. Matches are immutable and shared, which
  // is safe only because static matches carry the frozen emptyParams.
  private staticRoutes: Record<string, Map<string, RouteMatch>> =
    Object.create(null)

  // ─── Insert ──────────────────────────────────────────────────────────────────

  insert(method: string, path: string, route: Route): void {
    if (route.host) this.hasHostRoutes = true
    else if (path.indexOf(':') === -1 && path.indexOf('*') === -1) {
      const table =
        this.staticRoutes[method] || (this.staticRoutes[method] = new Map())
      if (!table.has(path)) table.set(path, { route, params: emptyParams })
    }
    let current = this.root
    const len = path.length
    // [name the tree uses, name this route declared] where they differ
    let aliases: [string, string][] | null = null

    // Fast segment iterator — avoids split() + filter() allocations
    let i = 0
    // Skip leading slash
    if (i < len && path.charCodeAt(i) === 47 /* / */) i++

    while (i < len) {
      // Find end of segment
      let j = i
      while (j < len && path.charCodeAt(j) !== 47 /* / */) j++
      const segment = path.substring(i, j)

      const firstChar = segment.charCodeAt(0)

      if (firstChar === 58 /* : */) {
        // ─── Param ─────────────────────────────────────────────────────
        const paramName = segment.substring(1)
        if (!current.paramChild) {
          const child = new RadixNode()
          child.kind = NodeKind.PARAM
          child.part = segment
          child.paramName = paramName
          current.paramChild = child
        }
        // A position shared by several routes keeps the first route's name
        // in the tree; remember what this route calls it
        if (current.paramChild.paramName !== paramName) {
          ;(aliases ||= []).push([current.paramChild.paramName, paramName])
        }
        current = current.paramChild
      } else if (firstChar === 42 /* * */) {
        // ─── Wildcard ──────────────────────────────────────────────────
        const wildcardName = segment.length > 1 ? segment.substring(1) : '*'
        if (!current.wildcardChild) {
          const child = new RadixNode()
          child.kind = NodeKind.WILDCARD
          child.part = segment
          child.wildcardName = wildcardName
          current.wildcardChild = child
        }
        if (
          current.wildcardChild.wildcardName !== wildcardName &&
          wildcardName !== '*'
        ) {
          ;(aliases ||= []).push([
            current.wildcardChild.wildcardName,
            wildcardName,
          ])
        }
        current = current.wildcardChild
        break // Wildcard eats the rest
      } else {
        // ─── Static ────────────────────────────────────────────────────
        let child = current.findStaticChild(segment)
        if (!child) {
          child = new RadixNode()
          child.part = segment
          current.addStaticChild(segment, child)
        }
        current = child
      }

      // Skip the slash separator
      i = j + 1
    }

    if (aliases) (route as any)._paramAliases = aliases
    current.setRoute(method, route)
  }

  // ─── Search ──────────────────────────────────────────────────────────────────
  // Zero-allocation fast path for the common case (static-only routes).
  // Falls back to backtracking only when param/wildcard children exist.

  search(method: string, path: string, host?: string): RouteMatch | null {
    // No result cache on purpose: param matches must get a fresh params
    // object per request (handlers and validators mutate req.params), and
    // caching attacker-chosen paths only invites churn.
    if (!this.hasHostRoutes) {
      const table = this.staticRoutes[method]
      const hit =
        (table !== undefined && table.get(path)) ||
        (this.staticRoutes.ALL !== undefined && this.staticRoutes.ALL.get(path))
      if (hit) return hit
    }

    const len = path.length

    // Without host routes every purely static match was already answered by
    // the table above, so the static walk could only fail; skip it
    if (this.hasHostRoutes) {
      const staticMatch = this._staticWalk(method, path, len, host)
      if (staticMatch) return staticMatch
    }

    // The linear walk only gives up (undefined) where static, param and
    // wildcard branches compete; a null from it is already a definite miss
    let result = this._linearWalk(method, path, len, host)
    if (result === AMBIGUOUS) {
      result = this._backtrackSearch(method, path, len, host)
    }
    if (result && (result.route as any)._paramAliases) {
      result.params = renameParams(
        result.params,
        (result.route as any)._paramAliases
      )
    }
    return result
  }

  // ─── Static Walk (Zero Allocation) ─────────────────────────────────────────
  // Walks the tree following only static children. If the route is purely
  // static (no :params or *wildcards involved), this returns in a single
  // straight-line walk with ZERO heap allocations.

  private _staticWalk(
    method: string,
    path: string,
    len: number,
    host?: string
  ): RouteMatch | null {
    let current = this.root
    let i = 0
    if (i < len && path.charCodeAt(i) === 47) i++ // skip leading /

    while (i < len) {
      let j = i
      while (j < len && path.charCodeAt(j) !== 47) j++
      const segment = path.substring(i, j)

      const child = current.findStaticChild(segment)
      if (!child) return null

      current = child
      i = j + 1
    }

    const res = current.getRoute(method, host)
    if (!res) return null

    // Static match → empty params or host params
    return { route: res.route, params: res.hostParams || emptyParams }
  }

  // ─── Linear Walk (Minimal Allocation) ───────────────────────────────────────
  // For routes like /api/users/:id — walks linearly through the tree
  // trying static → param → wildcard at each level. If at any point
  // there are multiple possible children (needing backtracking), bail out
  // and let _backtrackSearch handle it.
  //
  // Key optimization: stores raw segments and defers decodeURIComponent
  // until a match is confirmed. Most URLs contain no %-encoding at all,
  // so we skip it entirely in the common case.

  private _linearWalk(
    method: string,
    path: string,
    len: number,
    host?: string
  ): RouteMatch | null | undefined {
    let current = this.root
    let i = 0
    if (i < len && path.charCodeAt(i) === 47) i++

    // Params are written straight into the result object; percent-decoding
    // happens once at the end and only if a value contained '%'
    let params: Record<string, string> | null = null
    let needsDecode = false

    while (i < len) {
      let j = path.indexOf('/', i)
      if (j === -1) j = len

      // Try static first
      const staticChild = current.findStaticChildAt(path, i, j)
      if (staticChild) {
        if (current.paramChild || current.wildcardChild) return AMBIGUOUS
        current = staticChild
        i = j + 1
        continue
      }

      // Try param
      if (current.paramChild) {
        if (current.wildcardChild) return AMBIGUOUS
        const segment = path.substring(i, j)
        if (params === null) params = {}
        params[current.paramChild.paramName] = segment
        if (!needsDecode && segment.indexOf('%') !== -1) needsDecode = true
        current = current.paramChild
        i = j + 1
        continue
      }

      // Try wildcard
      if (current.wildcardChild) {
        const wName = current.wildcardChild.wildcardName
        if (wName !== '*') {
          const rest = path.substring(i)
          if (params === null) params = {}
          params[wName] = rest
          if (!needsDecode && rest.indexOf('%') !== -1) needsDecode = true
        }
        current = current.wildcardChild
        break
      }

      // No match at all
      return null
    }

    let res = current.getRoute(method, host)
    if (!res) {
      // A wildcard may also match an empty remainder
      const wild = current.wildcardChild
      if (!wild) return null
      res = wild.getRoute(method, host)
      if (!res) return null
      if (wild.wildcardName !== '*') {
        if (params === null) params = {}
        params[wild.wildcardName] = ''
      }
    }

    if (params === null) {
      return res.hostParams
        ? { route: res.route, params: { ...res.hostParams } }
        : { route: res.route, params: emptyParams }
    }
    if (needsDecode) {
      for (const k in params) {
        if (params[k].indexOf('%') !== -1) params[k] = decodeParam(params[k])
      }
    }
    if (res.hostParams) Object.assign(params, res.hostParams)
    return { route: res.route, params }
  }

  // ─── Backtrack Search ──────────────────────────────────────────────────────
  // Uses an iterative approach with minimal allocations. Builds params
  // only when a match is confirmed (lazy param construction).

  private _backtrackSearch(
    method: string,
    path: string,
    len: number,
    host?: string
  ): RouteMatch | null {
    // Stack frames: [node, pathIdx, paramKeysSnapshot, paramValsSnapshot]
    const sNodes: RadixNode[] = [this.root]

    let startIdx = 0
    if (startIdx < len && path.charCodeAt(startIdx) === 47) startIdx++
    const sIdxs: number[] = [startIdx]

    const sParamKeys: string[][] = [[]]
    const sParamVals: string[][] = [[]]
    let stackLen = 1

    while (stackLen > 0) {
      stackLen--
      const node = sNodes[stackLen]
      const idx = sIdxs[stackLen]
      const pKeys = sParamKeys[stackLen]
      const pVals = sParamVals[stackLen]

      // ─── End of path ──────────────────────────────────────────────────
      if (idx >= len) {
        const res = node.getRoute(method, host)
        if (res) {
          const params = buildParams(pKeys, pVals)
          if (res.hostParams) Object.assign(params, res.hostParams)
          return { route: res.route, params }
        }
        // Check wildcard matching empty remainder
        if (node.wildcardChild) {
          const wRes = node.wildcardChild.getRoute(method, host)
          if (wRes) {
            const wRoute = wRes.route
            const wName = node.wildcardChild.wildcardName
            let wParams
            if (wName !== '*') {
              wParams = buildParams([...pKeys, wName], [...pVals, ''])
            } else {
              wParams = buildParams(pKeys, pVals)
            }
            if (wRes.hostParams) Object.assign(wParams, wRes.hostParams)
            return { route: wRoute, params: wParams }
          }
        }
        continue
      }

      let nextSlash = path.indexOf('/', idx)
      if (nextSlash === -1) nextSlash = len
      const segment = path.substring(idx, nextSlash)

      // Push in priority order: wildcard (lowest) → param → static (highest)

      // 1. Wildcard
      if (node.wildcardChild) {
        const wRes = node.wildcardChild.getRoute(method, host)
        if (wRes) {
          const wName = node.wildcardChild.wildcardName
          const rawRemainder = path.substring(idx)
          const wKeys = wName !== '*' ? [...pKeys, wName] : pKeys.slice()
          const wVals = wName !== '*' ? [...pVals, rawRemainder] : pVals.slice()
          sNodes[stackLen] = node.wildcardChild
          sIdxs[stackLen] = len
          sParamKeys[stackLen] = wKeys
          sParamVals[stackLen] = wVals
          stackLen++
        }
      }

      // 2. Param
      if (node.paramChild) {
        sNodes[stackLen] = node.paramChild
        sIdxs[stackLen] = nextSlash + 1
        sParamKeys[stackLen] = [...pKeys, node.paramChild.paramName]
        sParamVals[stackLen] = [...pVals, segment]
        stackLen++
      }

      // 3. Static
      const staticChild = node.findStaticChild(segment)
      if (staticChild) {
        sNodes[stackLen] = staticChild
        sIdxs[stackLen] = nextSlash + 1
        sParamKeys[stackLen] = pKeys
        sParamVals[stackLen] = pVals
        stackLen++
      }
    }

    return null
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Gives a route the param names it declared when the tree stored the names
// of an earlier route sharing the same positions
function renameParams(
  params: Record<string, string>,
  aliases: [string, string][]
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key in params) {
    let name = key
    for (const [from, to] of aliases) {
      if (from === key) {
        name = to
        break
      }
    }
    out[name] = params[key]
  }
  return out
}

// Returned by _linearWalk when only a backtracking search can decide
const AMBIGUOUS = undefined

// Frozen empty params object — reused across all pure-static matches
const emptyParams: Record<string, string> = Object.freeze(
  Object.create(null) as Record<string, string>
)

// Malformed escapes like "%E0%A4%A" are a client error, not a server crash
function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw HttpError.badRequest('Malformed URI component in path')
  }
}

// Build a params object from parallel key/value arrays
function buildParams(
  keys: string[],
  vals: string[],
  count?: number
): Record<string, string> {
  const len = count !== undefined ? count : keys.length
  if (len === 0) return emptyParams
  const params: Record<string, string> = {}
  for (let i = 0; i < len; i++) {
    const v = vals[i]
    params[keys[i]] = v.indexOf('%') !== -1 ? decodeParam(v) : v
  }
  return params
}

export { JSRadixTree as RadixTree, RadixNode }
