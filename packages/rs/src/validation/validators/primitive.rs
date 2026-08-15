use napi::bindgen_prelude::*;
use serde_json::Value;
use crate::core::types::TexField;
use crate::validation::sanitizers::{text, security, coercion};

pub fn validate_string(val: &Value, field: &TexField, path: &str) -> Result<Value> {
    let mut result_val = val.clone();
    
    if field.coerce { coercion::coerce_to_string(&mut result_val); }
    
    let s_ref = result_val.as_str().ok_or_else(|| {
        Error::new(Status::InvalidArg, format!("Field '{}' must be a string", path))
    })?;
    
    let mut s = s_ref.to_string();
    text::apply_text_modifiers(&mut s, field);
    
    if field.prevent_sql {
        s = security::prevent_sql(s)?;
    }
    
    if field.prevent_traversal {
        s = security::prevent_traversal(s)?;
    }
    
    if field.mask { s = security::mask_string(s); }

    if let Some(min) = field.min {
        if s.len() < min as usize {
            return Err(Error::new(Status::InvalidArg, format!("Field '{}' must be at least {} characters", path, min)));
        }
    }
    if let Some(max) = field.max {
        if s.len() > max as usize {
            return Err(Error::new(Status::InvalidArg, format!("Field '{}' must be at most {} characters", path, max)));
        }
    }
    
    Ok(Value::String(s))
}

pub fn validate_number(val: &Value, field: &TexField, path: &str) -> Result<Value> {
    let mut result_val = val.clone();
    
    if field.coerce { coercion::coerce_to_number(&mut result_val); }
    
    let n = result_val.as_f64().ok_or_else(|| {
        Error::new(Status::InvalidArg, format!("Field '{}' must be a number", path))
    })?;
    
    if let Some(min) = field.min {
        if n < min { return Err(Error::new(Status::InvalidArg, format!("Field '{}' must be >= {}", path, min))); }
    }
    if let Some(max) = field.max {
        if n > max { return Err(Error::new(Status::InvalidArg, format!("Field '{}' must be <= {}", path, max))); }
    }
    
    Ok(result_val)
}

pub fn validate_boolean(val: &Value, field: &TexField, path: &str) -> Result<Value> {
    let mut result_val = val.clone();
    
    if field.coerce { coercion::coerce_to_boolean(&mut result_val); }
    
    if !result_val.is_boolean() {
        return Err(Error::new(Status::InvalidArg, format!("Field '{}' must be a boolean", path)));
    }
    
    Ok(result_val)
}
