use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi]
pub fn parse_json_body(input: String) -> Result<serde_json::Value> {
    let mut value: serde_json::Value = serde_json::from_str(&input)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid JSON: {}", e)))?;
    
    strip_prototype_impl(&mut value);
    Ok(value)
}

#[napi]
pub fn strip_prototype(mut data: serde_json::Value) -> Result<serde_json::Value> {
    strip_prototype_impl(&mut data);
    Ok(data)
}

fn strip_prototype_impl(val: &mut serde_json::Value) {
    match val {
        serde_json::Value::Object(map) => {
            map.remove("__proto__");
            map.remove("constructor");
            for (_, v) in map.iter_mut() {
                strip_prototype_impl(v);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr.iter_mut() {
                strip_prototype_impl(v);
            }
        }
        _ => {}
    }
}
