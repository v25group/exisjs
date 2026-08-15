use napi_derive::napi;

struct CidrRule {
    network: u32,
    mask: u32,
}

#[napi]
pub struct NativeIpFilter {
    allow_rules: Option<Vec<CidrRule>>,
    deny_rules: Option<Vec<CidrRule>>,
}

fn parse_cidr(rule: &str) -> Option<CidrRule> {
    if rule.contains('/') {
        let parts: Vec<&str> = rule.split('/').collect();
        if parts.len() != 2 {
            return None;
        }
        let ip = parts[0];
        let prefix: u32 = parts[1].parse().unwrap_or(33);
        if prefix > 32 {
            return None;
        }
        
        let network = ip_to_int(ip)?;
        let mask = if prefix == 0 { 0 } else { !0u32 << (32 - prefix) };
        
        Some(CidrRule {
            network: network & mask,
            mask,
        })
    } else {
        // Exact IP
        let network = ip_to_int(rule)?;
        Some(CidrRule {
            network,
            mask: !0u32, // /32 mask
        })
    }
}

fn ip_to_int(ip: &str) -> Option<u32> {
    let parts: Vec<&str> = ip.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    
    let mut val: u32 = 0;
    for part in parts {
        let n: u32 = part.parse().ok()?;
        if n > 255 {
            return None;
        }
        val = (val << 8) | n;
    }
    Some(val)
}

#[napi]
impl NativeIpFilter {
    #[napi(constructor)]
    pub fn new(allow: Option<Vec<String>>, deny: Option<Vec<String>>) -> Self {
        let allow_rules = allow.map(|rules| {
            rules.iter().filter_map(|r| parse_cidr(r)).collect()
        });
        
        let deny_rules = deny.map(|rules| {
            rules.iter().filter_map(|r| parse_cidr(r)).collect()
        });

        NativeIpFilter {
            allow_rules,
            deny_rules,
        }
    }

    /// Returns true if the IP is allowed, false if blocked
    #[napi]
    pub fn check(&self, ip: String) -> bool {
        let ip_int = match ip_to_int(&ip) {
            Some(v) => v,
            None => return true, // Invalid IP format, default to allow or handled elsewhere
        };

        if let Some(allow) = &self.allow_rules {
            let mut allowed = false;
            for rule in allow {
                if (ip_int & rule.mask) == rule.network {
                    allowed = true;
                    break;
                }
            }
            if !allowed {
                return false;
            }
        }

        if let Some(deny) = &self.deny_rules {
            for rule in deny {
                if (ip_int & rule.mask) == rule.network {
                    return false;
                }
            }
        }

        true
    }
}
