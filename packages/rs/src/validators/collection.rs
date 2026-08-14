use napi::bindgen_prelude::*;
use serde_json::Value;
use std::collections::HashMap;
use crate::types::TexField;
use crate::TexValidator;

pub fn validate_enum(val: &Value, values: &Vec<String>, path: &str) -> Result<Value> {
    let s = val.as_str().ok_or_else(|| {
        Error::new(Status::InvalidArg, format!("Field '{}' must be a string", path))
    })?;
    if !values.contains(&s.to_string()) {
        return Err(Error::new(Status::InvalidArg, format!("Field '{}' must be one of {:?}", path, values)));
    }
    Ok(val.clone())
}

pub fn validate_array(
    validator: &TexValidator,
    val: &Value, 
    inner_field: &TexField, 
    field: &TexField,
    path: &str
) -> Result<Value> {
    let arr = val.as_array().ok_or_else(|| {
        Error::new(Status::InvalidArg, format!("Field '{}' must be an array", path))
    })?;
    
    if let Some(min) = field.min {
        if arr.len() < min as usize {
            return Err(Error::new(Status::InvalidArg, format!("Field '{}' array must have at least {} items", path, min)));
        }
    }
    if let Some(max) = field.max {
        if arr.len() > max as usize {
            return Err(Error::new(Status::InvalidArg, format!("Field '{}' array exceeds maximum length of {}", path, max)));
        }
    }
    
    let mut new_arr = Vec::new();
    for (i, item) in arr.iter().enumerate() {
        let item_path = format!("{}[{}]", path, i);
        let validated_item = crate::validators::validate_field(validator, item, inner_field, &item_path)?;
        new_arr.push(validated_item);
    }
    
    Ok(Value::Array(new_arr))
}

pub fn validate_object(
    validator: &TexValidator,
    val: &Value, 
    schema_map: &HashMap<String, TexField>, 
    path: &str
) -> Result<Value> {
    let obj = val.as_object().ok_or_else(|| {
        Error::new(Status::InvalidArg, format!("Field '{}' must be an object", path))
    })?;
    
    let validated_obj = validator.validate_object(obj, schema_map, false, path)?; // Nested strict mode not fully propagated yet
    Ok(Value::Object(validated_obj))
}
