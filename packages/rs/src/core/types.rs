use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub enum TexType {
    String,
    Number,
    Boolean,
    Email,
    Uuid(u8),
    Cuid,
    CreditCard,
    Password,
    Date,
    File,
    Any,
    Enum(Vec<String>),
    Literal(String),
    Array(Box<TexField>),
    Record(Box<TexField>),
    Object(HashMap<String, TexField>),
    Union(Vec<TexField>),
    Unknown,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TexField {
    pub field_type: TexType,
    pub is_optional: bool,
    
    // Constraints
    pub min: Option<f64>,
    pub max: Option<f64>,
    
    // Sanitizers & Modifiers
    pub trim: bool,
    pub collapse_whitespace: bool,
    pub lowercase: bool,
    pub uppercase: bool,
    pub escape_html: bool,
    pub strip_html: bool,
    pub slugify: bool,
    pub mask: bool,
    pub coerce: bool,
    pub dedupe: bool,
    pub prevent_sql: bool,
    pub prevent_traversal: bool,
    
    // Password modifiers
    pub require_numbers: bool,
    pub require_symbols: bool,
    pub require_uppercase: bool,
    pub require_lowercase: bool,
    
    // Enum/Date limits
    pub default_val: Option<String>,
    pub min_date: Option<String>,
    pub max_date: Option<String>,
    
    // File modifiers
    pub max_size: Option<f64>,
    pub mime_types: Vec<String>,
}

impl Default for TexField {
    fn default() -> Self {
        TexField {
            field_type: TexType::Unknown,
            is_optional: false,
            min: None,
            max: None,
            trim: false,
            collapse_whitespace: false,
            lowercase: false,
            uppercase: false,
            escape_html: false,
            strip_html: false,
            slugify: false,
            mask: false,
            coerce: false,
            dedupe: false,
            prevent_sql: false,
            prevent_traversal: false,
            require_numbers: false,
            require_symbols: false,
            require_uppercase: false,
            require_lowercase: false,
            default_val: None,
            min_date: None,
            max_date: None,
            max_size: None,
            mime_types: vec![],
        }
    }
}
