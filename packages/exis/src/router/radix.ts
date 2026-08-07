import type { Route, RouteMatch } from '../types'

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

// ─── Radix Tree ──────────────────────────────────────────────────────────────

export class RadixTree {
  root: RadixNode = new RadixNode()
  hasHostRoutes = false
  private cache: Record<string, Record<string, RouteMatch | null>> = {
    GET: Object.create(null),
    POST: Object.create(null),
    PUT: Object.create(null),
    DELETE: Object.create(null),
    PATCH: Object.create(null),
    OPTIONS: Object.create(null),
    HEAD: Object.create(null),
  }
  private cacheSize = 0
  private maxCacheSize = 1000

  // ─── Insert ──────────────────────────────────────────────────────────────────

  insert(method: string, path: string, route: Route): void {
    if (route.host) this.hasHostRoutes = true
    let current = this.root
    const len = path.length

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

    current.setRoute(method, route)
    // Clear cache when new routes are inserted
    this._clearCache()
  }

  private _clearCache() {
    this.cache = {
      GET: Object.create(null),
      POST: Object.create(null),
      PUT: Object.create(null),
      DELETE: Object.create(null),
      PATCH: Object.create(null),
      OPTIONS: Object.create(null),
      HEAD: Object.create(null),
    }
    this.cacheSize = 0
  }

  // ─── Search ──────────────────────────────────────────────────────────────────
  // Zero-allocation fast path for the common case (static-only routes).
  // Falls back to backtracking only when param/wildcard children exist.

  search(method: string, path: string, host?: string): RouteMatch | null {
    const cachePath = host ? host + path : path
    const methodCache =
      this.cache[method] || (this.cache[method] = Object.create(null))

    if (methodCache[cachePath] !== undefined) {
      return methodCache[cachePath]
    }

    const len = path.length

    // Fast-path 1: try the direct static walk first (zero allocations)
    let result = this._staticWalk(method, path, len, host)
    if (result) {
      this._addToCache(methodCache, cachePath, result)
      return result
    }

    // Fast-path 2: linear walk for simple param/wildcard routes
    result = this._linearWalk(method, path, len, host)
    if (result) {
      this._addToCache(methodCache, cachePath, result)
      return result
    }

    // Slow-path: full backtracking search
    result = this._backtrackSearch(method, path, len, host)
    this._addToCache(methodCache, cachePath, result)
    return result
  }

  private _addToCache(
    methodCache: Record<string, RouteMatch | null>,
    path: string,
    result: RouteMatch | null
  ): void {
    if (this.cacheSize >= this.maxCacheSize) {
      this._clearCache()
      // If we cleared, we must re-assign methodCache as the old one was tossed
      const newCache = this.cache
      for (const m in newCache) {
        if (newCache[m]) methodCache = newCache[m]
      }
    }
    methodCache[path] = result
    this.cacheSize++
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
  ): RouteMatch | null {
    let current = this.root
    let i = 0
    if (i < len && path.charCodeAt(i) === 47) i++

    let paramCount = 0
    let paramKeys: string[] | null = null
    let paramVals: string[] | null = null
    let needsDecode = false

    while (i < len) {
      let j = path.indexOf('/', i)
      if (j === -1) j = len
      const segment = path.substring(i, j)

      // Try static first
      const staticChild = current.findStaticChild(segment)
      if (staticChild) {
        if (current.paramChild || current.wildcardChild) return null
        current = staticChild
        i = j + 1
        continue
      }

      // Try param
      if (current.paramChild) {
        if (current.wildcardChild) return null
        if (!paramKeys) {
          paramKeys = []
          paramVals = []
        }
        paramKeys[paramCount] = current.paramChild.paramName
        paramVals![paramCount] = segment
        if (!needsDecode && segment.indexOf('%') !== -1) needsDecode = true
        paramCount++
        current = current.paramChild
        i = j + 1
        continue
      }

      // Try wildcard
      if (current.wildcardChild) {
        const wName = current.wildcardChild.wildcardName
        if (wName !== '*') {
          if (!paramKeys) {
            paramKeys = []
            paramVals = []
          }
          const rawRemainder = path.substring(i)
          paramKeys[paramCount] = wName
          paramVals![paramCount] = rawRemainder
          if (!needsDecode && rawRemainder.indexOf('%') !== -1)
            needsDecode = true
          paramCount++
        }
        current = current.wildcardChild
        break
      }

      // No match at all
      return null
    }

    const res = current.getRoute(method, host)
    if (!res) {
      // Check wildcard matching empty remainder
      if (current.wildcardChild) {
        const wRes = current.wildcardChild.getRoute(method, host)
        if (wRes) {
          const wRoute = wRes.route
          const wName = current.wildcardChild.wildcardName
          if (wName !== '*') {
            if (!paramKeys) {
              paramKeys = []
              paramVals = []
            }
            paramKeys[paramCount] = wName
            paramVals![paramCount] = ''
            paramCount++
          }
          const wParams = buildParamsLazy(
            paramKeys,
            paramVals,
            paramCount,
            needsDecode
          )
          if (wRes.hostParams) Object.assign(wParams, wRes.hostParams)
          return {
            route: wRoute,
            params: wParams,
          }
        }
      }
      return null
    }

    if (paramCount === 0 && !res.hostParams)
      return { route: res.route, params: emptyParams }
    const params = buildParamsLazy(
      paramKeys,
      paramVals,
      paramCount,
      needsDecode
    )
    if (res.hostParams) Object.assign(params, res.hostParams)
    return {
      route: res.route,
      params,
    }
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

// Frozen empty params object — reused across all pure-static matches
const emptyParams: Record<string, string> = Object.freeze(
  Object.create(null) as Record<string, string>
)

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
    params[keys[i]] = v.indexOf('%') !== -1 ? decodeURIComponent(v) : v
  }
  return params
}

// Build params, lazily decoding only if %-encoded chars were found
function buildParamsLazy(
  keys: string[] | null,
  vals: string[] | null,
  count: number,
  needsDecode: boolean
): Record<string, string> {
  if (count === 0 || !keys || !vals) return emptyParams
  const params: Record<string, string> = {}
  if (needsDecode) {
    for (let i = 0; i < count; i++) {
      params[keys[i]] = decodeURIComponent(vals[i])
    }
  } else {
    for (let i = 0; i < count; i++) {
      params[keys[i]] = vals[i]
    }
  }
  return params
}

// Re-export for type compatibility
export { RadixNode }
