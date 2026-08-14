use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde_json::{Value, Map};
use std::collections::HashMap;

use crate::parser::{parse_tex_rule, TexField, TexType};

#[napi]
pub struct TexValidator {
    schema: HashMap<String, TexField>,
    strict: bool,
}

#[napi]
impl TexValidator {
    #[napi(constructor)]
    pub fn new(schema_definition: HashMap<String, String>, strict: Option<bool>) -> Self {
        let mut schema = HashMap::new();
        for (key, rule) in schema_definition {
            schema.insert(key, parse_tex_rule(&rule));
        }
        TexValidator { 
            schema,
            strict: strict.unwrap_or(false)
        }
    }

    #[napi]
    pub fn parse(&self, data: serde_json::Value) -> Result<serde_json::Value> {
        let obj = data.as_object().ok_or_else(|| {
            Error::new(Status::InvalidArg, "Input must be a JSON object".to_string())
        })?;

        let result_obj = self.validate_object(obj, &self.schema, self.strict, "")?;
        Ok(Value::Object(result_obj))
    }
}

impl TexValidator {
    fn validate_object(
        &self, 
        obj: &Map<String, Value>, 
        schema: &HashMap<String, TexField>, 
        strict: bool, 
        path: &str
    ) -> Result<Map<String, Value>> {
        let mut result = Map::new();

        if strict {
            for key in obj.keys() {
                if !schema.contains_key(key) {
                    return Err(Error::new(
                        Status::InvalidArg,
                        format!("Strict mode error: Unknown field '{}' at path '{}'", key, path),
                    ));
                }
            }
        }

        for (key, field) in schema {
            let field_path = if path.is_empty() { key.clone() } else { format!("{}.{}", path, key) };
            
            let mut val = obj.get(key).cloned();

            if val.is_none() || val.as_ref().unwrap().is_null() {
                if let Some(ref def) = field.default_val {
                    val = Some(Value::String(def.clone()));
                    if field.coerce {
                        // Attempt coercion for default if needed (handled in field validation)
                    }
                } else if !field.is_optional {
                    return Err(Error::new(
                        Status::InvalidArg,
                        format!("Missing required field: {}", field_path),
                    ));
                } else {
                    continue;
                }
            }

            let mut val = val.unwrap();

            // Validate based on type
            val = self.validate_field(&val, field, &field_path)?;
            
            result.insert(key.clone(), val);
        }

        Ok(result)
    }

    fn validate_field(&self, val: &Value, field: &TexField, path: &str) -> Result<Value> {
        let mut result_val = val.clone();

        match &field.field_type {
            TexType::String => {
                if field.coerce && result_val.is_number() {
                    result_val = Value::String(result_val.as_f64().unwrap().to_string());
                }
                if field.coerce && result_val.is_boolean() {
                    result_val = Value::String(result_val.as_bool().unwrap().to_string());
                }
                
                let s = result_val.as_str().ok_or_else(|| {
                    Error::new(Status::InvalidArg, format!("Field '{}' must be a string", path))
                })?;
                
                let mut s = s.to_string();
                if field.trim { s = s.trim().to_string(); }
                if field.lowercase { s = s.to_lowercase(); }
                if field.uppercase { s = s.to_uppercase(); }
                if field.mask {
                    if s.len() > 4 {
                        s = format!("{}****{}", &s[0..2], &s[s.len()-2..]);
                    } else {
                        s = "****".to_string();
                    }
                }

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
                
                result_val = Value::String(s);
            }
            TexType::Number => {
                if field.coerce && result_val.is_string() {
                    if let Ok(n) = result_val.as_str().unwrap().parse::<f64>() {
                        result_val = Value::Number(serde_json::Number::from_f64(n).unwrap());
                    }
                }
                
                let n = result_val.as_f64().ok_or_else(|| {
                    Error::new(Status::InvalidArg, format!("Field '{}' must be a number", path))
                })?;
                
                if let Some(min) = field.min {
                    if n < min {
                        return Err(Error::new(Status::InvalidArg, format!("Field '{}' must be >= {}", path, min)));
                    }
                }
                if let Some(max) = field.max {
                    if n > max {
                        return Err(Error::new(Status::InvalidArg, format!("Field '{}' must be <= {}", path, max)));
                    }
                }
            }
            TexType::Boolean => {
                if field.coerce && result_val.is_string() {
                    let s = result_val.as_str().unwrap();
                    if s == "true" || s == "1" { result_val = Value::Bool(true); }
                    else if s == "false" || s == "0" { result_val = Value::Bool(false); }
                } else if field.coerce && result_val.is_number() {
                    let n = result_val.as_f64().unwrap();
                    if n == 1.0 { result_val = Value::Bool(true); }
                    else if n == 0.0 { result_val = Value::Bool(false); }
                }
                
                if !result_val.is_boolean() {
                    return Err(Error::new(Status::InvalidArg, format!("Field '{}' must be a boolean", path)));
                }
            }
            TexType::Email => {
                let s = result_val.as_str().ok_or_else(|| {
                    Error::new(Status::InvalidArg, format!("Field '{}' must be a string", path))
                })?;
                
                if !s.contains('@') {
                    return Err(Error::new(Status::InvalidArg, format!("Field '{}' must be a valid email", path)));
                }
                
                let mut s = s.to_string();
                if field.trim { s = s.trim().to_string(); }
                if field.lowercase { s = s.to_lowercase(); }
                if field.mask {
                    let parts: Vec<&str> = s.split('@').collect();
                    if parts.len() == 2 {
                        let local = parts[0];
                        let masked_local = if local.len() > 2 { format!("{}***", &local[0..2]) } else { "***".to_string() };
                        s = format!("{}@{}", masked_local, parts[1]);
                    }
                }
                result_val = Value::String(s);
            }
            TexType::Password => {
                let s = result_val.as_str().ok_or_else(|| {
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
            }
            TexType::Enum(values) => {
                let s = result_val.as_str().ok_or_else(|| {
                    Error::new(Status::InvalidArg, format!("Field '{}' must be a string", path))
                })?;
                if !values.contains(&s.to_string()) {
                    return Err(Error::new(Status::InvalidArg, format!("Field '{}' must be one of {:?}", path, values)));
                }
            }
            TexType::Array(inner_field) => {
                let arr = result_val.as_array().ok_or_else(|| {
                    Error::new(Status::InvalidArg, format!("Field '{}' must be an array", path))
                })?;
                
                if let Some(min) = field.min {
                    if arr.len() < min as usize {
                        return Err(Error::new(Status::InvalidArg, format!("Field '{}' array must have at least {} items", path, min)));
                    }
                }
                
                let mut new_arr = Vec::new();
                for (i, item) in arr.iter().enumerate() {
                    let item_path = format!("{}[{}]", path, i);
                    let validated_item = self.validate_field(item, inner_field, &item_path)?;
                    new_arr.push(validated_item);
                }
                
                result_val = Value::Array(new_arr);
            }
            TexType::Object(schema_map) => {
                let obj = result_val.as_object().ok_or_else(|| {
                    Error::new(Status::InvalidArg, format!("Field '{}' must be an object", path))
                })?;
                
                let validated_obj = self.validate_object(obj, schema_map, false, path)?; // Nested strict mode not fully propagated yet
                result_val = Value::Object(validated_obj);
            }
            TexType::Any => {
                // Accepts anything
            }
            _ => {
                // Fallback for others for now
            }
        }

        Ok(result_val)
    }
}
