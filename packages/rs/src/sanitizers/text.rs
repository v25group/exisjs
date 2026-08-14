use crate::types::TexField;
use napi_derive::napi;

#[napi]
pub fn escape_html(mut s: String) -> String {
    s = s.replace("&", "&amp;");
    s = s.replace("<", "&lt;");
    s = s.replace(">", "&gt;");
    s = s.replace("\"", "&quot;");
    s = s.replace("'", "&#39;");
    s
}

#[napi]
pub fn strip_html(s: String) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        if c == '<' { in_tag = true; }
        else if c == '>' { in_tag = false; }
        else if !in_tag { result.push(c); }
    }
    result
}

pub fn apply_text_modifiers(s: &mut String, field: &TexField) {
    if field.trim { *s = s.trim().to_string(); }
    if field.lowercase { *s = s.to_lowercase(); }
    if field.uppercase { *s = s.to_uppercase(); }
    
    if field.escape_html { *s = escape_html(s.clone()); }
    if field.strip_html { *s = strip_html(s.clone()); }
}
