use napi_derive::napi;
use napi::bindgen_prelude::Buffer;
use sha1::{Sha1, Digest};
use base64::{engine::general_purpose::STANDARD, Engine as _};

#[napi]
pub fn generate_etag(content: Buffer) -> String {
    let len = content.len();
    if len == 0 {
        return "W/\"0-2jmj7l5rsw0yVb/vlWAYkK/YBwk\"".to_string();
    }
    
    let mut hasher = Sha1::new();
    hasher.update(content.as_ref());
    let result = hasher.finalize();
    
    let mut base64_hash = STANDARD.encode(result);
    base64_hash.truncate(27);
    
    format!("W/\"{:x}-{:}\"", len, base64_hash)
}
