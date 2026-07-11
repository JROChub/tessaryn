//! Canonical transport encodings that do not participate in Cell identity.

#![forbid(unsafe_code)]

/// Canonical unpadded Base64 serialization for binary vectors.
pub mod bytes_base64 {
    use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
    use serde::{Deserialize, Deserializer, Serializer};

    const MAX_TRANSPORT_BYTES: usize = 1024 * 1024 * 1024;

    /// Serializes bytes as canonical unpadded Base64.
    pub fn serialize<S>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&STANDARD_NO_PAD.encode(bytes))
    }

    /// Deserializes and rejects padded, noncanonical, or oversized Base64.
    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let encoded = String::deserialize(deserializer)?;
        if encoded.len() > MAX_TRANSPORT_BYTES.saturating_mul(4).div_ceil(3) {
            return Err(serde::de::Error::custom(
                "Base64 transport exceeds byte limit",
            ));
        }
        let decoded = STANDARD_NO_PAD
            .decode(encoded.as_bytes())
            .map_err(serde::de::Error::custom)?;
        if decoded.len() > MAX_TRANSPORT_BYTES || STANDARD_NO_PAD.encode(&decoded) != encoded {
            return Err(serde::de::Error::custom("noncanonical Base64 transport"));
        }
        Ok(decoded)
    }
}

#[cfg(test)]
mod tests {
    use super::bytes_base64;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
    struct Payload {
        #[serde(with = "bytes_base64")]
        bytes: Vec<u8>,
    }

    #[test]
    fn binary_transport_is_compact_canonical_and_round_trips() {
        let payload = Payload {
            bytes: (0_u8..=255).collect(),
        };
        let encoded = serde_json::to_string(&payload).unwrap();
        assert!(!encoded.contains('['));
        assert!(!encoded.contains('='));
        assert_eq!(serde_json::from_str::<Payload>(&encoded).unwrap(), payload);
        assert!(serde_json::from_str::<Payload>(r#"{"bytes":"YQ=="}"#).is_err());
    }
}
