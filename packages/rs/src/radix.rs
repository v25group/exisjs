use napi_derive::napi;
use std::collections::HashMap;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct RouteLookupResult {
    pub route_id: u32,
    pub params: HashMap<String, String>,
}

#[inline]
fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h1), Some(h2)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                decoded.push((h1 << 4) | h2);
                i += 3;
                continue;
            }
        }
        decoded.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(decoded).unwrap_or_else(|_| input.to_string())
}

#[derive(Default, Clone, Debug)]
struct MethodRoutes {
    get: Option<u32>,
    post: Option<u32>,
    put: Option<u32>,
    delete: Option<u32>,
    patch: Option<u32>,
    options: Option<u32>,
    head: Option<u32>,
    all: Option<u32>,
    other: HashMap<String, u32>,
}

impl MethodRoutes {
    fn set(&mut self, method: &str, route_id: u32) {
        match method {
            "GET" => self.get = Some(route_id),
            "POST" => self.post = Some(route_id),
            "PUT" => self.put = Some(route_id),
            "DELETE" => self.delete = Some(route_id),
            "PATCH" => self.patch = Some(route_id),
            "OPTIONS" => self.options = Some(route_id),
            "HEAD" => self.head = Some(route_id),
            "ALL" => self.all = Some(route_id),
            _ => {
                self.other.insert(method.to_string(), route_id);
            }
        }
    }

    fn get(&self, method: &str) -> Option<u32> {
        let route = match method {
            "GET" => self.get,
            "POST" => self.post,
            "PUT" => self.put,
            "DELETE" => self.delete,
            "PATCH" => self.patch,
            "OPTIONS" => self.options,
            "HEAD" => self.head,
            "ALL" => self.all,
            _ => self.other.get(method).copied(),
        };
        route.or(self.all)
    }
}

#[derive(Default, Debug)]
struct RadixNode {
    part: String,
    routes: MethodRoutes,
    static_children: Vec<RadixNode>,
    param_child: Option<Box<RadixNode>>,
    param_name: String,
    wildcard_child: Option<Box<RadixNode>>,
    wildcard_name: String,
}

impl RadixNode {
    fn find_static_child(&self, segment: &str) -> Option<&RadixNode> {
        self.static_children.iter().find(|c| c.part == segment)
    }

    fn find_static_child_mut(&mut self, segment: &str) -> Option<&mut RadixNode> {
        self.static_children.iter_mut().find(|c| c.part == segment)
    }

    fn insert(&mut self, method: &str, path: &str, route_id: u32) {
        let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        let mut current = self;

        for segment in segments {
            if segment.starts_with(':') {
                let param_name = segment[1..].to_string();
                if current.param_child.is_none() {
                    let mut child = Box::new(RadixNode::default());
                    child.part = segment.to_string();
                    child.param_name = param_name;
                    current.param_child = Some(child);
                }
                current = current.param_child.as_mut().unwrap();
            } else if segment.starts_with('*') {
                let wildcard_name = if segment.len() > 1 {
                    segment[1..].to_string()
                } else {
                    "*".to_string()
                };
                if current.wildcard_child.is_none() {
                    let mut child = Box::new(RadixNode::default());
                    child.part = segment.to_string();
                    child.wildcard_name = wildcard_name;
                    current.wildcard_child = Some(child);
                }
                current = current.wildcard_child.as_mut().unwrap();
                break; // Wildcard matches the remainder
            } else {
                if current.find_static_child(segment).is_none() {
                    let mut child = RadixNode::default();
                    child.part = segment.to_string();
                    current.static_children.push(child);
                }
                current = current.find_static_child_mut(segment).unwrap();
            }
        }

        current.routes.set(method, route_id);
    }
}

struct SearchFrame<'a> {
    node: &'a RadixNode,
    segment_idx: usize,
    params: Vec<(String, String)>,
}

fn search_tree(
    root: &RadixNode,
    method: &str,
    path: &str,
) -> Option<RouteLookupResult> {
    let mut clean_path = path;
    if clean_path.len() > 1 && clean_path.ends_with('/') {
        clean_path = &clean_path[..clean_path.len() - 1];
    }
    let segments: Vec<&str> = clean_path.split('/').filter(|s| !s.is_empty()).collect();

    let mut stack: Vec<SearchFrame> = Vec::with_capacity(16);
    stack.push(SearchFrame {
        node: root,
        segment_idx: 0,
        params: Vec::new(),
    });

    while let Some(frame) = stack.pop() {
        let node = frame.node;
        let idx = frame.segment_idx;

        // End of path segments reached
        if idx >= segments.len() {
            if let Some(route_id) = node.routes.get(method) {
                let mut params_map = HashMap::with_capacity(frame.params.len());
                for (k, v) in frame.params {
                    params_map.insert(k, percent_decode(&v));
                }
                return Some(RouteLookupResult {
                    route_id,
                    params: params_map,
                });
            }

            // Check if node has a wildcard child matching empty remainder
            if let Some(ref wc) = node.wildcard_child {
                if let Some(route_id) = wc.routes.get(method) {
                    let mut params_map = HashMap::with_capacity(frame.params.len() + 1);
                    for (k, v) in frame.params {
                        params_map.insert(k, percent_decode(&v));
                    }
                    if wc.wildcard_name != "*" {
                        params_map.insert(wc.wildcard_name.clone(), String::new());
                    }
                    return Some(RouteLookupResult {
                        route_id,
                        params: params_map,
                    });
                }
            }

            continue;
        }

        let segment = segments[idx];

        // Push children in reverse order so highest priority pops first:
        // 1. Wildcard (lowest priority)
        if let Some(ref wc) = node.wildcard_child {
            if let Some(_route_id) = wc.routes.get(method) {
                let mut params = frame.params.clone();
                if wc.wildcard_name != "*" {
                    let remainder = segments[idx..].join("/");
                    params.push((wc.wildcard_name.clone(), remainder));
                }
                stack.push(SearchFrame {
                    node: wc.as_ref(),
                    segment_idx: segments.len(),
                    params,
                });
            }
        }

        // 2. Param (medium priority)
        if let Some(ref pc) = node.param_child {
            let mut params = frame.params.clone();
            params.push((pc.param_name.clone(), segment.to_string()));
            stack.push(SearchFrame {
                node: pc.as_ref(),
                segment_idx: idx + 1,
                params,
            });
        }

        // 3. Static (highest priority)
        if let Some(sc) = node.find_static_child(segment) {
            stack.push(SearchFrame {
                node: sc,
                segment_idx: idx + 1,
                params: frame.params,
            });
        }
    }

    None
}

#[napi]
pub struct RadixRouter {
    root: RadixNode,
    cache: HashMap<String, Option<RouteLookupResult>>,
    max_cache_size: usize,
}

#[napi]
impl RadixRouter {
    #[napi(constructor)]
    pub fn new() -> Self {
        RadixRouter {
            root: RadixNode::default(),
            cache: HashMap::with_capacity(128),
            max_cache_size: 1000,
        }
    }

    #[napi]
    pub fn insert(&mut self, method: String, path: String, route_id: u32) {
        self.root.insert(&method, &path, route_id);
        self.cache.clear();
    }

    #[napi]
    pub fn search(&mut self, method: String, path: String) -> Option<RouteLookupResult> {
        let cache_key = format!("{}:{}", method, path);
        if let Some(cached) = self.cache.get(&cache_key) {
            return cached.clone();
        }

        let result = search_tree(&self.root, &method, &path);
        if self.cache.len() >= self.max_cache_size {
            self.cache.clear();
        }
        self.cache.insert(cache_key, result.clone());
        result
    }
}
