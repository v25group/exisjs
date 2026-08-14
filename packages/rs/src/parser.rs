use std::collections::HashMap;
use crate::types::{TexField, TexType};

pub fn parse_tex_rule(rule: &str) -> TexField {
    let mut field = TexField::default();
    
    let parts: Vec<&str> = rule.split('|').map(|s| s.trim()).collect();
    if parts.is_empty() {
        return field;
    }
    
    let mut base_type_str = parts[0];
    
    // First, check if it's an optional union like "(string || number)?"
    if base_type_str.ends_with("?") {
        field.is_optional = true;
        base_type_str = &base_type_str[..base_type_str.len() - 1].trim();
    }
    
    if base_type_str.starts_with("(") && base_type_str.ends_with(")") {
        base_type_str = &base_type_str[1..base_type_str.len()-1];
    }
    
    // Check for || unions
    if base_type_str.contains("||") {
        let union_parts: Vec<&str> = base_type_str.split("||").map(|s| s.trim()).collect();
        let mut schemas = Vec::new();
        for p in union_parts {
            schemas.push(parse_tex_rule(p));
        }
        field.field_type = TexType::Union(schemas);
    } 
    else if base_type_str.starts_with("object<") && base_type_str.ends_with(">") {
        let inner_json = &base_type_str[7..base_type_str.len()-1];
        if let Ok(parsed_map) = serde_json::from_str::<HashMap<String, String>>(inner_json) {
            let mut obj_map = HashMap::new();
            for (k, v) in parsed_map {
                obj_map.insert(k, parse_tex_rule(&v));
            }
            field.field_type = TexType::Object(obj_map);
        } else {
            field.field_type = TexType::Unknown;
        }
    }
    else if base_type_str.starts_with("array<") && base_type_str.ends_with(">") {
        let inner = &base_type_str[6..base_type_str.len()-1];
        field.field_type = TexType::Array(Box::new(parse_tex_rule(inner)));
    }
    else if base_type_str.starts_with("record<") && base_type_str.ends_with(">") {
        let inner = &base_type_str[7..base_type_str.len()-1];
        field.field_type = TexType::Record(Box::new(parse_tex_rule(inner)));
    }
    else if base_type_str.starts_with("enum:") {
        let values_str = &base_type_str[5..];
        let values: Vec<String> = values_str.split(',').map(|s| s.trim().to_string()).collect();
        field.field_type = TexType::Enum(values);
    }
    else if base_type_str.starts_with("literal:") {
        let val = base_type_str[8..].to_string();
        field.field_type = TexType::Literal(val);
    }
    else {
        field.field_type = match base_type_str {
            "string" => TexType::String,
            "number" => TexType::Number,
            "boolean" => TexType::Boolean,
            "email" => TexType::Email,
            "uuid" => TexType::Uuid(4), // default v4, can be overridden by modifier
            "cuid" => TexType::Cuid,
            "creditcard" => TexType::CreditCard,
            "password" => TexType::Password,
            "date" => TexType::Date,
            "file" => TexType::File,
            "any" => TexType::Any,
            _ => TexType::Unknown,
        };
    }

    // Apply modifiers from pipes
    for i in 1..parts.len() {
        let modifier = parts[i];
        if modifier.starts_with("min:") {
            if let Ok(v) = modifier[4..].parse::<f64>() { field.min = Some(v); }
        } else if modifier.starts_with("max:") {
            if let Ok(v) = modifier[4..].parse::<f64>() { field.max = Some(v); }
        } else if modifier.starts_with("default:") {
            field.default_val = Some(modifier[8..].to_string());
        } else if modifier.starts_with("version:") {
            if let Ok(v) = modifier[8..].parse::<u8>() {
                if let TexType::Uuid(_) = field.field_type {
                    field.field_type = TexType::Uuid(v);
                }
            }
        } else if modifier.starts_with("minDate:") {
            field.min_date = Some(modifier[8..].to_string());
        } else if modifier.starts_with("maxDate:") {
            field.max_date = Some(modifier[8..].to_string());
        } else if modifier.starts_with("maxSize:") {
            if let Ok(v) = modifier[8..].parse::<f64>() { field.max_size = Some(v); }
        } else if modifier.starts_with("mimeTypes:") {
            let mimes = modifier[10..].split(',').map(|s| s.trim().to_string()).collect();
            field.mime_types = mimes;
        } else {
            match modifier {
                "trim" => field.trim = true,
                "collapseWhitespace" => field.collapse_whitespace = true,
                "lowercase" => field.lowercase = true,
                "uppercase" => field.uppercase = true,
                "escapeHtml" => field.escape_html = true,
                "stripHtml" => field.strip_html = true,
                "slugify" => field.slugify = true,
                "mask" => field.mask = true,
                "coerce" => field.coerce = true,
                "dedupe" => field.dedupe = true,
                "preventSql" => field.prevent_sql = true,
                "preventTraversal" => field.prevent_traversal = true,
                "requireNumbers" => field.require_numbers = true,
                "requireSymbols" => field.require_symbols = true,
                "requireUppercase" => field.require_uppercase = true,
                "requireLowercase" => field.require_lowercase = true,
                _ => {}
            }
        }
    }

    field
}
