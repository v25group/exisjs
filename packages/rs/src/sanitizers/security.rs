use napi_derive::napi;

#[napi]
pub fn mask_email(s: String) -> String {
    let parts: Vec<&str> = s.split('@').collect();
    if parts.len() == 2 {
        let local = parts[0];
        let masked_local = if local.len() > 2 { format!("{}***", &local[0..2]) } else { "***".to_string() };
        format!("{}@{}", masked_local, parts[1])
    } else {
        s
    }
}

#[napi]
pub fn mask_string(s: String) -> String {
    if s.len() > 4 {
        format!("{}****{}", &s[0..2], &s[s.len()-2..])
    } else {
        "****".to_string()
    }
}

#[napi]
pub fn prevent_sql(s: String) -> napi::Result<String> {
    let lower = s.to_lowercase();
    let malicious_patterns = ["' or 1=1", ";--", "drop table", "union select"];
    for pattern in malicious_patterns {
        if lower.contains(pattern) {
            return Err(napi::Error::new(napi::Status::InvalidArg, "Potential SQL Injection detected".to_string()));
        }
    }
    Ok(s)
}

#[napi]
pub fn prevent_traversal(s: String) -> napi::Result<String> {
    if s.contains("../") || s.contains("..\\") || s.contains("/etc/passwd") {
        return Err(napi::Error::new(napi::Status::InvalidArg, "Path traversal attempt detected".to_string()));
    }
    Ok(s)
}
