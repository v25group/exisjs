#[macro_use]
extern crate napi_derive;

pub mod types;
pub mod parser;
pub mod validators;
pub mod sanitizers;
pub mod radix;
pub mod json;
pub mod cookie;
pub mod jwt;
pub mod etag;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde_json::{Value, Map};
use std::collections::HashMap;

use crate::types::{TexField, TexType};
use crate::parser::parse_tex_rule;
use crate::validators::validate_field;

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
    pub fn validate_object(
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
            val = validate_field(self, &val, field, &field_path)?;
            
            result.insert(key.clone(), val);
        }

        Ok(result)
    }
}
