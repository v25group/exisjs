pub mod primitive;
pub mod collection;
pub mod advanced;

use napi::bindgen_prelude::*;
use serde_json::Value;
use crate::core::types::{TexField, TexType};
use crate::TexValidator;

pub fn validate_field(
    validator: &TexValidator,
    val: &Value, 
    field: &TexField, 
    path: &str
) -> Result<Value> {
    match &field.field_type {
        TexType::String => primitive::validate_string(val, field, path),
        TexType::Number => primitive::validate_number(val, field, path),
        TexType::Boolean => primitive::validate_boolean(val, field, path),
        
        TexType::Email => advanced::validate_email(val, field, path),
        TexType::Password => advanced::validate_password(val, field, path),
        
        TexType::Enum(values) => collection::validate_enum(val, values, path),
        TexType::Array(inner) => collection::validate_array(validator, val, inner, field, path),
        TexType::Object(schema) => collection::validate_object(validator, val, schema, path),
        
        TexType::Any => Ok(val.clone()),
        _ => Ok(val.clone()), // Fallback
    }
}
