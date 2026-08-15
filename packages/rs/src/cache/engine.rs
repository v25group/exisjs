use napi::bindgen_prelude::*;
use napi_derive::napi;
use lru::LruCache;
use std::sync::Mutex;
use std::num::NonZeroUsize;
use std::time::{SystemTime, UNIX_EPOCH};
use std::collections::HashMap;

#[derive(Clone)]
pub struct CacheItem {
    pub data: String,
    pub tags: Vec<String>,
    pub created_at: u64,
}

#[napi]
pub struct NativeCache {
    cache: Mutex<LruCache<String, CacheItem>>,
    tags: Mutex<HashMap<String, u64>>,
}

#[napi]
impl NativeCache {
    #[napi(constructor)]
    pub fn new(capacity: u32) -> Self {
        let cap = NonZeroUsize::new(capacity as usize).unwrap_or(NonZeroUsize::new(10000).unwrap());
        NativeCache {
            cache: Mutex::new(LruCache::new(cap)),
            tags: Mutex::new(HashMap::new()),
        }
    }

    #[napi]
    pub fn set(&self, key: String, data_json: String, tags: Vec<String>) -> Result<()> {
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let item = CacheItem {
            data: data_json,
            tags,
            created_at,
        };

        let mut cache = self.cache.lock().unwrap();
        cache.put(key, item);
        Ok(())
    }

    #[napi]
    pub fn get(&self, key: String) -> Result<Option<String>> {
        let mut cache = self.cache.lock().unwrap();
        
        if let Some(item) = cache.get(&key) {
            let tags_map = self.tags.lock().unwrap();
            
            // Check if any tag is stale
            for tag in &item.tags {
                if let Some(tag_time) = tags_map.get(tag) {
                    if *tag_time > item.created_at {
                        return Ok(None); // Stale
                    }
                }
            }
            
            // We return a JSON string combining data, tags, and createdAt to match TS
            let json_resp = serde_json::json!({
                "data": serde_json::from_str::<serde_json::Value>(&item.data).unwrap_or(serde_json::Value::Null),
                "tags": item.tags,
                "createdAt": item.created_at,
            });
            return Ok(Some(json_resp.to_string()));
        }
        
        Ok(None)
    }

    #[napi]
    pub fn revalidate_tag(&self, tag: String) -> Result<()> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
            
        let mut tags_map = self.tags.lock().unwrap();
        tags_map.insert(tag, timestamp);
        Ok(())
    }

    // Since N-API doesn't allow returning HashMap<String, u64> natively via the basic wrapper easily in some configs,
    // we return a JSON string and parse it in JS.
    #[napi]
    pub fn get_tags(&self) -> Result<String> {
        let tags_map = self.tags.lock().unwrap();
        let json_str = serde_json::to_string(&*tags_map).map_err(|e| {
            Error::new(Status::GenericFailure, e.to_string())
        })?;
        Ok(json_str)
    }
}
