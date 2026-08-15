use serde_json::Value;

pub fn coerce_to_string(val: &mut Value) {
    if val.is_number() {
        *val = Value::String(val.as_f64().unwrap().to_string());
    } else if val.is_boolean() {
        *val = Value::String(val.as_bool().unwrap().to_string());
    }
}

pub fn coerce_to_number(val: &mut Value) {
    if val.is_string() {
        if let Ok(n) = val.as_str().unwrap().parse::<f64>() {
            *val = Value::Number(serde_json::Number::from_f64(n).unwrap());
        }
    }
}

pub fn coerce_to_boolean(val: &mut Value) {
    if val.is_string() {
        let s = val.as_str().unwrap();
        if s == "true" || s == "1" { *val = Value::Bool(true); }
        else if s == "false" || s == "0" { *val = Value::Bool(false); }
    } else if val.is_number() {
        let n = val.as_f64().unwrap();
        if n == 1.0 { *val = Value::Bool(true); }
        else if n == 0.0 { *val = Value::Bool(false); }
    }
}
