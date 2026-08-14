use napi::bindgen_prelude::*;
use serde_json::Value;
use crate::types::TexField;
use crate::sanitizers::{text, security};

pub fn validate_email(val: &Value, field: &TexField, path: &str) -> Result<Value> {
    let s_ref = val.as_str().ok_or_else(|| {
        Error::new(Status::InvalidArg, format!("Field '{}' must be a string", path))
    })?;
    
    if !s_ref.contains('@') {
        return Err(Error::new(Status::InvalidArg, format!("Field '{}' must be a valid email", path)));
    }
    
    let mut s = s_ref.to_string();
    text::apply_text_modifiers(&mut s, field);
    
    if field.mask { s = security::mask_email(s); }
    
    Ok(Value::String(s))
}

pub fn validate_password(val: &Value, field: &TexField, path: &str) -> Result<Value> {
    let s = val.as_str().ok_or_else(|| {
        Error::new(Status::InvalidArg, format!("Field '{}' must be a string", path))
    })?;
    
    if let Some(min) = field.min {
        if s.len() < min as usize {
            return Err(Error::new(Status::InvalidArg, format!("Field '{}' must be at least {} characters", path, min)));
        }
    }
    
    if field.require_numbers && !s.chars().any(|c| c.is_ascii_digit()) {
        return Err(Error::new(Status::InvalidArg, format!("Field '{}' must contain a number", path)));
    }
    if field.require_uppercase && !s.chars().any(|c| c.is_ascii_uppercase()) {
        return Err(Error::new(Status::InvalidArg, format!("Field '{}' must contain an uppercase letter", path)));
    }
    if field.require_lowercase && !s.chars().any(|c| c.is_ascii_lowercase()) {
        return Err(Error::new(Status::InvalidArg, format!("Field '{}' must contain a lowercase letter", path)));
    }
    if field.require_symbols && !s.chars().any(|c| !c.is_alphanumeric()) {
        return Err(Error::new(Status::InvalidArg, format!("Field '{}' must contain a symbol", path)));
    }
    
    Ok(Value::String(s.to_string()))
}
