# Encrypted Locus v0

`tessaryn/encrypted-locus/v0` is randomized transport for an already
identity-bound portable Locus. Ciphertext is never Cell identity.

The fixed suite is:

```text
X25519-HKDF-SHA256-XCHACHA20POLY1305
```

One operating-system-random 256-bit content key encrypts the Locus with
XChaCha20-Poly1305. An ephemeral X25519 secret derives a distinct HKDF-SHA256
wrapping key for every canonical recipient. Recipient identity, complete
recipient set, ephemeral key, caller associated data, and nonces are bound by
domain-separated authenticated data.

The profile admits 1 to 256 unique recipients, at most 256 MiB plaintext, and
at most 1 MiB caller associated data. Duplicate recipients, low-order shared
secrets, unknown suites, malformed envelopes, associated-data substitution,
recipient substitution, and any ciphertext mutation reject.

Recipient secrets and transient content keys are zeroized. Revocation rejects a
new decrypt operation at or after the earliest recorded effective time; it does
not revoke plaintext already disclosed to an endpoint.
