//! Authenticated restricted-Locus transport with explicit revocation.

#![forbid(unsafe_code)]

use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::collections::BTreeMap;
use tessaryn_schema::Digest;
use thiserror::Error;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

const ENCRYPTED_LOCUS_SCHEMA_V0: &str = "tessaryn/encrypted-locus/v0";
const CIPHER_SUITE_V0: &str = "X25519-HKDF-SHA256-XCHACHA20POLY1305";
const MAX_PLAINTEXT_BYTES: usize = 256 * 1024 * 1024;
const MAX_AAD_BYTES: usize = 1024 * 1024;
const MAX_RECIPIENTS: usize = 256;
const CONTENT_KEY_BYTES: usize = 32;
const NONCE_BYTES: usize = 24;

/// Public X25519 recipient key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RecipientPublicKey {
    /// Encoded Montgomery u-coordinate.
    pub bytes: [u8; 32],
}

impl RecipientPublicKey {
    /// Validates an encoded public key.
    pub fn from_bytes(bytes: [u8; 32]) -> Result<Self, PrivacyError> {
        if bytes.iter().all(|byte| *byte == 0) {
            return Err(PrivacyError::InvalidRecipientKey);
        }
        Ok(Self { bytes })
    }

    /// Returns the stable public recipient identifier.
    pub fn recipient_id(&self) -> Digest {
        domain_digest(b"TESSARYN-RECIPIENT-ID-v0", &[&self.bytes])
    }
}

/// Secret X25519 recipient key, zeroized on drop.
pub struct RecipientSecretKey(Zeroizing<[u8; 32]>);

impl RecipientSecretKey {
    /// Generates a fresh operating-system-random recipient key.
    pub fn generate() -> Result<Self, PrivacyError> {
        let mut bytes = Zeroizing::new([0_u8; 32]);
        getrandom::fill(bytes.as_mut()).map_err(|_| PrivacyError::RandomnessUnavailable)?;
        Ok(Self(bytes))
    }

    /// Imports a private key from an owned byte array.
    pub fn from_bytes(bytes: [u8; 32]) -> Result<Self, PrivacyError> {
        if bytes.iter().all(|byte| *byte == 0) {
            return Err(PrivacyError::InvalidRecipientKey);
        }
        Ok(Self(Zeroizing::new(bytes)))
    }

    /// Derives the corresponding public recipient key.
    pub fn public_key(&self) -> RecipientPublicKey {
        let secret = StaticSecret::from(*self.0);
        RecipientPublicKey {
            bytes: PublicKey::from(&secret).to_bytes(),
        }
    }

    /// Returns the stable public recipient identifier.
    pub fn recipient_id(&self) -> Digest {
        self.public_key().recipient_id()
    }
}

/// One recipient-specific authenticated content-key envelope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecipientEnvelopeV0 {
    /// Stable recipient identifier; no private key material is present.
    pub recipient_id: Digest,
    /// Random XChaCha20-Poly1305 nonce for the wrapped content key.
    pub nonce: [u8; NONCE_BYTES],
    /// Authenticated encrypted content key.
    #[serde(with = "tessaryn_transport::bytes_base64")]
    pub wrapped_key: Vec<u8>,
}

/// Randomized encrypted transport for an already identity-bound Locus.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EncryptedLocusV0 {
    /// Exact transport schema.
    pub schema: String,
    /// Exact cryptographic suite.
    pub cipher_suite: String,
    /// Ephemeral sender public key shared by recipient envelopes.
    pub ephemeral_public_key: [u8; 32],
    /// Digest of caller-provided associated data.
    pub associated_data_digest: Digest,
    /// Canonically recipient-ID-sorted key envelopes.
    pub recipients: Vec<RecipientEnvelopeV0>,
    /// Random content nonce.
    pub content_nonce: [u8; NONCE_BYTES],
    /// Authenticated encrypted Locus bytes.
    #[serde(with = "tessaryn_transport::bytes_base64")]
    pub ciphertext: Vec<u8>,
}

/// Immutable disclosure revocation record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RevocationRecordV0 {
    /// Recipient whose future disclosure is denied.
    pub recipient_id: Digest,
    /// Inclusive revocation time.
    pub effective_unix_us: i64,
    /// Content address of an external reason or policy record.
    pub reason: Digest,
}

/// Monotonic local revocation index.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RevocationRegistry {
    records: BTreeMap<Digest, RevocationRecordV0>,
}

impl RevocationRegistry {
    /// Records the earliest revocation for a recipient.
    pub fn revoke(&mut self, record: RevocationRecordV0) {
        self.records
            .entry(record.recipient_id.clone())
            .and_modify(|current| {
                if record.effective_unix_us < current.effective_unix_us {
                    *current = record.clone();
                }
            })
            .or_insert(record);
    }

    /// Returns the effective revocation, if any.
    pub fn record(&self, recipient_id: &Digest) -> Option<&RevocationRecordV0> {
        self.records.get(recipient_id)
    }

    /// Tests whether disclosure is permitted at the requested time.
    pub fn permits(&self, recipient_id: &Digest, at_unix_us: i64) -> bool {
        self.record(recipient_id)
            .is_none_or(|record| at_unix_us < record.effective_unix_us)
    }
}

/// Encrypts bytes for one or more recipients.
///
/// Randomized ciphertext is transport state, never canonical Cell identity.
pub fn encrypt_locus(
    plaintext: &[u8],
    associated_data: &[u8],
    recipients: &[RecipientPublicKey],
) -> Result<EncryptedLocusV0, PrivacyError> {
    validate_sizes(plaintext.len(), associated_data.len(), recipients.len())?;
    let recipients = canonical_recipients(recipients)?;
    let associated_data_digest =
        domain_digest(b"TESSARYN-LOCUS-ASSOCIATED-DATA-v0", &[associated_data]);

    let mut content_key = Zeroizing::new([0_u8; CONTENT_KEY_BYTES]);
    getrandom::fill(content_key.as_mut()).map_err(|_| PrivacyError::RandomnessUnavailable)?;
    let mut ephemeral_bytes = Zeroizing::new([0_u8; 32]);
    getrandom::fill(ephemeral_bytes.as_mut()).map_err(|_| PrivacyError::RandomnessUnavailable)?;
    let ephemeral_secret = StaticSecret::from(*ephemeral_bytes);
    let ephemeral_public_key = PublicKey::from(&ephemeral_secret).to_bytes();
    let recipient_ids = recipients
        .iter()
        .map(RecipientPublicKey::recipient_id)
        .collect::<Vec<_>>();
    let header_digest = header_digest(
        &ephemeral_public_key,
        &associated_data_digest,
        &recipient_ids,
    );

    let mut envelopes = Vec::with_capacity(recipients.len());
    for (recipient, recipient_id) in recipients.iter().zip(&recipient_ids) {
        let shared = ephemeral_secret.diffie_hellman(&PublicKey::from(recipient.bytes));
        if shared.as_bytes().iter().all(|byte| *byte == 0) {
            return Err(PrivacyError::InvalidRecipientKey);
        }
        let wrapping_key = derive_wrapping_key(
            shared.as_bytes(),
            &ephemeral_public_key,
            &recipient.bytes,
            recipient_id,
            &header_digest,
        )?;
        let mut nonce = [0_u8; NONCE_BYTES];
        getrandom::fill(&mut nonce).map_err(|_| PrivacyError::RandomnessUnavailable)?;
        let envelope_aad = envelope_aad(&header_digest, recipient_id);
        let wrapped_key = encrypt_aead(
            wrapping_key.as_slice(),
            &nonce,
            content_key.as_slice(),
            &envelope_aad,
        )?;
        envelopes.push(RecipientEnvelopeV0 {
            recipient_id: recipient_id.clone(),
            nonce,
            wrapped_key,
        });
    }

    let mut content_nonce = [0_u8; NONCE_BYTES];
    getrandom::fill(&mut content_nonce).map_err(|_| PrivacyError::RandomnessUnavailable)?;
    let content_aad = content_aad(&header_digest, associated_data);
    let ciphertext = encrypt_aead(
        content_key.as_ref(),
        &content_nonce,
        plaintext,
        &content_aad,
    )?;
    Ok(EncryptedLocusV0 {
        schema: ENCRYPTED_LOCUS_SCHEMA_V0.to_string(),
        cipher_suite: CIPHER_SUITE_V0.to_string(),
        ephemeral_public_key,
        associated_data_digest,
        recipients: envelopes,
        content_nonce,
        ciphertext,
    })
}

/// Decrypts a Locus after recipient and revocation checks.
pub fn decrypt_locus(
    encrypted: &EncryptedLocusV0,
    associated_data: &[u8],
    recipient: &RecipientSecretKey,
    registry: &RevocationRegistry,
    at_unix_us: i64,
) -> Result<Zeroizing<Vec<u8>>, PrivacyError> {
    validate_encrypted(encrypted, associated_data)?;
    let recipient_public = recipient.public_key();
    let recipient_id = recipient_public.recipient_id();
    if !registry.permits(&recipient_id, at_unix_us) {
        return Err(PrivacyError::RecipientRevoked);
    }
    let envelope = encrypted
        .recipients
        .binary_search_by(|candidate| candidate.recipient_id.cmp(&recipient_id))
        .ok()
        .and_then(|index| encrypted.recipients.get(index))
        .ok_or(PrivacyError::RecipientNotAuthorized)?;
    let recipient_ids = encrypted
        .recipients
        .iter()
        .map(|candidate| candidate.recipient_id.clone())
        .collect::<Vec<_>>();
    let header_digest = header_digest(
        &encrypted.ephemeral_public_key,
        &encrypted.associated_data_digest,
        &recipient_ids,
    );
    let secret = StaticSecret::from(*recipient.0);
    let shared = secret.diffie_hellman(&PublicKey::from(encrypted.ephemeral_public_key));
    if shared.as_bytes().iter().all(|byte| *byte == 0) {
        return Err(PrivacyError::MalformedTransport);
    }
    let wrapping_key = derive_wrapping_key(
        shared.as_bytes(),
        &encrypted.ephemeral_public_key,
        &recipient_public.bytes,
        &recipient_id,
        &header_digest,
    )?;
    let envelope_aad = envelope_aad(&header_digest, &recipient_id);
    let content_key = Zeroizing::new(decrypt_aead(
        wrapping_key.as_slice(),
        &envelope.nonce,
        &envelope.wrapped_key,
        &envelope_aad,
    )?);
    if content_key.len() != CONTENT_KEY_BYTES {
        return Err(PrivacyError::MalformedTransport);
    }
    let content_aad = content_aad(&header_digest, associated_data);
    Ok(Zeroizing::new(decrypt_aead(
        content_key.as_slice(),
        &encrypted.content_nonce,
        &encrypted.ciphertext,
        &content_aad,
    )?))
}

fn validate_sizes(
    plaintext_bytes: usize,
    associated_data_bytes: usize,
    recipient_count: usize,
) -> Result<(), PrivacyError> {
    if plaintext_bytes > MAX_PLAINTEXT_BYTES || associated_data_bytes > MAX_AAD_BYTES {
        return Err(PrivacyError::SizeLimit);
    }
    if recipient_count == 0 || recipient_count > MAX_RECIPIENTS {
        return Err(PrivacyError::RecipientLimit);
    }
    Ok(())
}

fn canonical_recipients(
    recipients: &[RecipientPublicKey],
) -> Result<Vec<RecipientPublicKey>, PrivacyError> {
    let mut output = recipients.to_vec();
    output.sort_by_key(RecipientPublicKey::recipient_id);
    if output
        .iter()
        .any(|recipient| recipient.bytes.iter().all(|byte| *byte == 0))
        || output
            .windows(2)
            .any(|pair| pair[0].recipient_id() == pair[1].recipient_id())
    {
        return Err(PrivacyError::InvalidRecipientKey);
    }
    Ok(output)
}

fn validate_encrypted(
    encrypted: &EncryptedLocusV0,
    associated_data: &[u8],
) -> Result<(), PrivacyError> {
    validate_sizes(
        encrypted.ciphertext.len().saturating_sub(16),
        associated_data.len(),
        encrypted.recipients.len(),
    )?;
    if encrypted.schema != ENCRYPTED_LOCUS_SCHEMA_V0
        || encrypted.cipher_suite != CIPHER_SUITE_V0
        || encrypted.ephemeral_public_key.iter().all(|byte| *byte == 0)
        || encrypted
            .recipients
            .iter()
            .any(|recipient| recipient.wrapped_key.len() != CONTENT_KEY_BYTES + 16)
        || !encrypted
            .recipients
            .windows(2)
            .all(|pair| pair[0].recipient_id < pair[1].recipient_id)
    {
        return Err(PrivacyError::MalformedTransport);
    }
    let expected = domain_digest(b"TESSARYN-LOCUS-ASSOCIATED-DATA-v0", &[associated_data]);
    if encrypted.associated_data_digest != expected {
        return Err(PrivacyError::AssociatedDataMismatch);
    }
    Ok(())
}

fn derive_wrapping_key(
    shared_secret: &[u8; 32],
    ephemeral_public: &[u8; 32],
    recipient_public: &[u8; 32],
    recipient_id: &Digest,
    header_digest: &Digest,
) -> Result<Zeroizing<[u8; CONTENT_KEY_BYTES]>, PrivacyError> {
    let salt = domain_hash(
        b"TESSARYN-LOCUS-WRAP-SALT-v0",
        &[ephemeral_public, recipient_public],
    );
    let info = encode_parts(
        b"TESSARYN-LOCUS-WRAP-KEY-v0",
        &[
            recipient_id.as_str().as_bytes(),
            header_digest.as_str().as_bytes(),
        ],
    );
    let hkdf = Hkdf::<Sha256>::new(Some(&salt), shared_secret);
    let mut output = Zeroizing::new([0_u8; CONTENT_KEY_BYTES]);
    hkdf.expand(&info, output.as_mut())
        .map_err(|_| PrivacyError::KeyDerivation)?;
    Ok(output)
}

fn header_digest(
    ephemeral_public: &[u8; 32],
    associated_data_digest: &Digest,
    recipient_ids: &[Digest],
) -> Digest {
    let mut parts = Vec::with_capacity(recipient_ids.len() + 2);
    parts.push(ephemeral_public.as_slice());
    parts.push(associated_data_digest.as_str().as_bytes());
    parts.extend(recipient_ids.iter().map(|id| id.as_str().as_bytes()));
    domain_digest(b"TESSARYN-ENCRYPTED-LOCUS-HEADER-v0", &parts)
}

fn envelope_aad(header_digest: &Digest, recipient_id: &Digest) -> Vec<u8> {
    encode_parts(
        b"TESSARYN-LOCUS-ENVELOPE-AAD-v0",
        &[
            header_digest.as_str().as_bytes(),
            recipient_id.as_str().as_bytes(),
        ],
    )
}

fn content_aad(header_digest: &Digest, associated_data: &[u8]) -> Vec<u8> {
    encode_parts(
        b"TESSARYN-LOCUS-CONTENT-AAD-v0",
        &[header_digest.as_str().as_bytes(), associated_data],
    )
}

fn encrypt_aead(
    key: &[u8],
    nonce: &[u8; NONCE_BYTES],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, PrivacyError> {
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| PrivacyError::KeyDerivation)?;
    cipher
        .encrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| PrivacyError::AuthenticationFailed)
}

fn decrypt_aead(
    key: &[u8],
    nonce: &[u8; NONCE_BYTES],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, PrivacyError> {
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| PrivacyError::KeyDerivation)?;
    cipher
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| PrivacyError::AuthenticationFailed)
}

fn domain_digest(domain: &[u8], parts: &[&[u8]]) -> Digest {
    Digest::new(format!(
        "sha256:{}",
        hex::encode(domain_hash(domain, parts))
    ))
    .expect("SHA-256 always produces a valid digest")
}

fn domain_hash(domain: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let encoded = encode_parts(domain, parts);
    Sha256::digest(encoded).into()
}

fn encode_parts(domain: &[u8], parts: &[&[u8]]) -> Vec<u8> {
    let capacity = domain.len()
        + 8
        + parts
            .iter()
            .map(|part| 8_usize.saturating_add(part.len()))
            .sum::<usize>();
    let mut encoded = Vec::with_capacity(capacity);
    encoded.extend_from_slice(&(domain.len() as u64).to_be_bytes());
    encoded.extend_from_slice(domain);
    for part in parts {
        encoded.extend_from_slice(&(part.len() as u64).to_be_bytes());
        encoded.extend_from_slice(part);
    }
    encoded
}

/// Restricted transport failure.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum PrivacyError {
    /// Operating-system randomness was unavailable.
    #[error("operating-system randomness unavailable")]
    RandomnessUnavailable,
    /// Recipient key was invalid or duplicated.
    #[error("invalid or duplicate recipient key")]
    InvalidRecipientKey,
    /// Recipient count exceeded the bounded profile.
    #[error("recipient count is outside the bounded profile")]
    RecipientLimit,
    /// Payload or associated data exceeded the bounded profile.
    #[error("restricted Locus transport size limit exceeded")]
    SizeLimit,
    /// Transport schema, ordering, or dimensions were malformed.
    #[error("malformed encrypted Locus transport")]
    MalformedTransport,
    /// Associated data did not match the encrypted transport.
    #[error("associated data does not match encrypted Locus")]
    AssociatedDataMismatch,
    /// Recipient did not have an envelope.
    #[error("recipient is not authorized for this Locus")]
    RecipientNotAuthorized,
    /// Recipient disclosure was revoked.
    #[error("recipient disclosure has been revoked")]
    RecipientRevoked,
    /// HKDF could not produce the requested key.
    #[error("restricted Locus key derivation failed")]
    KeyDerivation,
    /// Authenticated encryption or decryption failed.
    #[error("encrypted Locus authentication failed")]
    AuthenticationFailed,
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn reason(value: u8) -> Digest {
        Digest::new(format!("sha256:{}", format!("{value:02x}").repeat(32))).unwrap()
    }

    #[test]
    fn authorized_recipients_decrypt_and_unauthorized_recipient_fails() {
        let first = RecipientSecretKey::generate().unwrap();
        let second = RecipientSecretKey::generate().unwrap();
        let denied = RecipientSecretKey::generate().unwrap();
        let plaintext = b"private bounded Locus with protected geometry";
        let aad = b"sha256:materialization-receipt";
        let encrypted =
            encrypt_locus(plaintext, aad, &[second.public_key(), first.public_key()]).unwrap();
        let registry = RevocationRegistry::default();
        assert_eq!(
            decrypt_locus(&encrypted, aad, &first, &registry, 100)
                .unwrap()
                .as_slice(),
            plaintext
        );
        assert_eq!(
            decrypt_locus(&encrypted, aad, &second, &registry, 100)
                .unwrap()
                .as_slice(),
            plaintext
        );
        assert_eq!(
            decrypt_locus(&encrypted, aad, &denied, &registry, 100),
            Err(PrivacyError::RecipientNotAuthorized)
        );
        assert!(!encrypted
            .ciphertext
            .windows(plaintext.len())
            .any(|window| window == plaintext));
    }

    #[test]
    fn transport_is_randomized_and_recipient_order_is_canonical() {
        let first = RecipientSecretKey::generate().unwrap();
        let second = RecipientSecretKey::generate().unwrap();
        let left = encrypt_locus(
            b"same",
            b"context",
            &[first.public_key(), second.public_key()],
        )
        .unwrap();
        let right = encrypt_locus(
            b"same",
            b"context",
            &[second.public_key(), first.public_key()],
        )
        .unwrap();
        assert_ne!(left.ciphertext, right.ciphertext);
        assert!(left
            .recipients
            .windows(2)
            .all(|pair| pair[0].recipient_id < pair[1].recipient_id));
    }

    #[test]
    fn tampering_and_wrong_associated_data_are_rejected() {
        let recipient = RecipientSecretKey::generate().unwrap();
        let encrypted = encrypt_locus(b"secret", b"correct", &[recipient.public_key()]).unwrap();
        let registry = RevocationRegistry::default();

        let mut content_tamper = encrypted.clone();
        content_tamper.ciphertext[0] ^= 1;
        assert_eq!(
            decrypt_locus(&content_tamper, b"correct", &recipient, &registry, 100),
            Err(PrivacyError::AuthenticationFailed)
        );

        let mut envelope_tamper = encrypted.clone();
        envelope_tamper.recipients[0].wrapped_key[0] ^= 1;
        assert_eq!(
            decrypt_locus(&envelope_tamper, b"correct", &recipient, &registry, 100),
            Err(PrivacyError::AuthenticationFailed)
        );
        assert_eq!(
            decrypt_locus(&encrypted, b"wrong", &recipient, &registry, 100),
            Err(PrivacyError::AssociatedDataMismatch)
        );
    }

    #[test]
    fn revocation_is_monotonic_and_time_bounded() {
        let recipient = RecipientSecretKey::generate().unwrap();
        let encrypted = encrypt_locus(b"secret", b"context", &[recipient.public_key()]).unwrap();
        let mut registry = RevocationRegistry::default();
        registry.revoke(RevocationRecordV0 {
            recipient_id: recipient.recipient_id(),
            effective_unix_us: 200,
            reason: reason(1),
        });
        assert!(decrypt_locus(&encrypted, b"context", &recipient, &registry, 199).is_ok());
        assert_eq!(
            decrypt_locus(&encrypted, b"context", &recipient, &registry, 200),
            Err(PrivacyError::RecipientRevoked)
        );
        registry.revoke(RevocationRecordV0 {
            recipient_id: recipient.recipient_id(),
            effective_unix_us: 300,
            reason: reason(2),
        });
        assert_eq!(
            registry
                .record(&recipient.recipient_id())
                .unwrap()
                .effective_unix_us,
            200
        );
    }

    #[test]
    fn duplicate_and_low_order_recipient_keys_are_rejected() {
        let recipient = RecipientSecretKey::generate().unwrap();
        assert_eq!(
            encrypt_locus(
                b"secret",
                b"context",
                &[recipient.public_key(), recipient.public_key()]
            ),
            Err(PrivacyError::InvalidRecipientKey)
        );
        assert_eq!(
            RecipientPublicKey::from_bytes([0; 32]),
            Err(PrivacyError::InvalidRecipientKey)
        );
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(48))]

        #[test]
        fn every_ciphertext_bit_mutation_is_rejected(
            plaintext in prop::collection::vec(any::<u8>(), 0..4096),
            mutation_selector in any::<u16>(),
            mutation_bit in 0_u8..8,
        ) {
            let recipient = RecipientSecretKey::generate().unwrap();
            let mut encrypted = encrypt_locus(&plaintext, b"property-context", &[recipient.public_key()]).unwrap();
            let index = usize::from(mutation_selector) % encrypted.ciphertext.len();
            encrypted.ciphertext[index] ^= 1 << mutation_bit;
            let result = decrypt_locus(
                &encrypted,
                b"property-context",
                &recipient,
                &RevocationRegistry::default(),
                100,
            );
            prop_assert!(matches!(result, Err(PrivacyError::AuthenticationFailed)));
        }
    }
}
