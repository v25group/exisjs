use napi_derive::napi;
use std::sync::Mutex;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
pub struct RateLimitRecord {
    pub count: u32,
    pub reset_time: u64,
}

#[napi]
pub struct NativeRateLimiter {
    hits: Mutex<HashMap<String, RateLimitRecord>>,
    window_ms: u64,
}

#[napi]
impl NativeRateLimiter {
    #[napi(constructor)]
    pub fn new(window_ms: u32) -> Self {
        NativeRateLimiter {
            hits: Mutex::new(HashMap::new()),
            window_ms: window_ms as u64,
        }
    }

    #[napi]
    pub fn hit(&self, key: String) -> u32 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let mut hits_map = self.hits.lock().unwrap();
        
        let record = hits_map.entry(key).or_insert(RateLimitRecord {
            count: 0,
            reset_time: now + self.window_ms,
        });

        if record.reset_time <= now {
            record.count = 1;
            record.reset_time = now + self.window_ms;
        } else {
            record.count += 1;
        }

        record.count
    }

    #[napi]
    pub fn sweep(&self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let mut hits_map = self.hits.lock().unwrap();
        hits_map.retain(|_, record| record.reset_time > now);
    }
}
