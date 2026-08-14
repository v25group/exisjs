use napi_derive::napi;
use napi::{Error, Status, Result};
use serde_json::{Value, json};
use std::time::{SystemTime, UNIX_EPOCH};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

fn encode_base64url(input: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(input)
}

fn decode_base64url(input: &str) -> Result<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(input).map_err(|e| Error::new(Status::InvalidArg, format!("Invalid base64url: {}", e)))
}

#[napi]
pub fn sign_jwt(payload: Value, secret: String, expires_in: Option<i64>) -> Result<String> {
    let mut exp_payload = payload.clone();
    
    if let Some(exp) = expires_in {
        if let Value::Object(ref mut map) = exp_payload {
            let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
            map.insert("exp".to_string(), json!(now + exp));
        } else {
            return Err(Error::new(Status::InvalidArg, "Payload must be an object".to_string()));
        }
    }

    let header = json!({ "alg": "HS256", "typ": "JWT" });
    
    let encoded_header = encode_base64url(serde_json::to_string(&header).unwrap().as_bytes());
    let encoded_payload = encode_base64url(serde_json::to_string(&exp_payload).unwrap().as_bytes());
    
    let message = format!("{}.{}", encoded_header, encoded_payload);
    
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|e| Error::new(Status::GenericFailure, format!("HMAC error: {}", e)))?;
    mac.update(message.as_bytes());
    let signature = mac.finalize().into_bytes();
    
    Ok(format!("{}.{}", message, encode_base64url(&signature)))
}

#[napi]
pub fn verify_jwt(token: String, secrets: Vec<String>) -> Result<Value> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Err(Error::new(Status::InvalidArg, "Invalid token format".to_string()));
    }
    
    let encoded_header = parts[0];
    let encoded_payload = parts[1];
    let encoded_signature = parts[2];
    
    let actual_signature = decode_base64url(encoded_signature)?;
    let message = format!("{}.{}", encoded_header, encoded_payload);
    
    let mut is_valid = false;
    
    for secret in secrets {
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
            .map_err(|e| Error::new(Status::GenericFailure, format!("HMAC error: {}", e)))?;
        mac.update(message.as_bytes());
        let expected_signature = mac.finalize().into_bytes();
        
        // Use constant time equality to prevent timing attacks
        if expected_signature.ct_eq(&actual_signature).into() {
            is_valid = true;
            break;
        }
    }
    
    if !is_valid {
        return Err(Error::new(Status::InvalidArg, "Invalid token signature".to_string()));
    }
    
    let payload_bytes = decode_base64url(encoded_payload)?;
    let payload: Value = serde_json::from_slice(&payload_bytes)
        .map_err(|_| Error::new(Status::InvalidArg, "Malformed token payload".to_string()))?;
        
    if let Some(exp) = payload.get("exp") {
        if let Some(exp_val) = exp.as_u64() {
            let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
            if now > exp_val {
                return Err(Error::new(Status::GenericFailure, "TokenExpiredError".to_string()));
            }
        }
    }
    
    Ok(payload)
}
