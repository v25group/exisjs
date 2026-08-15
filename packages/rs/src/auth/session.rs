
use napi_derive::napi;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct SessionNode {
    pub data: String,
    pub expires_at: f64,
}

#[napi]
pub struct NativeSessionStore {
    store: Mutex<HashMap<String, SessionNode>>,
}

#[napi]
impl NativeSessionStore {
    #[napi(constructor)]
    pub fn new() -> Self {
        NativeSessionStore {
            store: Mutex::new(HashMap::new()),
        }
    }

    #[napi]
    pub fn get(&self, session_id: String) -> Option<String> {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as f64;
        let mut store = self.store.lock().unwrap();
        
        if let Some(session) = store.get(&session_id) {
            if session.expires_at < now {
                store.remove(&session_id);
                return None;
            }
            return Some(session.data.clone());
        }
        
        None
    }

    #[napi]
    pub fn set(&self, session_id: String, data: String, ttl: f64) {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as f64;
        let mut store = self.store.lock().unwrap();
        
        store.insert(session_id, SessionNode {
            data,
            expires_at: now + ttl,
        });
    }

    #[napi]
    pub fn destroy(&self, session_id: String) {
        let mut store = self.store.lock().unwrap();
        store.remove(&session_id);
    }

    #[napi]
    pub fn sweep(&self) {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as f64;
        let mut store = self.store.lock().unwrap();
        
        store.retain(|_, session| session.expires_at >= now);
    }
}
