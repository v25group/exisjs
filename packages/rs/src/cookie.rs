use napi_derive::napi;
use std::collections::HashMap;

#[inline]
fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

pub fn percent_decode(input: &str) -> String {
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

#[napi]
pub fn parse_cookies(header: String) -> HashMap<String, String> {
    let mut cookies = HashMap::new();
    
    for pair in header.split(';') {
        let pair = pair.trim();
        if pair.is_empty() {
            continue;
        }
        
        if let Some(eq_idx) = pair.find('=') {
            let key = pair[..eq_idx].trim();
            let val = pair[eq_idx + 1..].trim();
            
            if !key.is_empty() && !cookies.contains_key(key) {
                let decoded_val = if val.contains('%') {
                    percent_decode(val)
                } else {
                    val.to_string()
                };
                cookies.insert(key.to_string(), decoded_val);
            }
        }
    }
    
    cookies
}
