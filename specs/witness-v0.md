# Witness Receipt v0

`tessaryn/witness-statement/v0` carries a signed non-core attestation with one
explicit class:

- `bytes_observed`
- `device_present`
- `physical_scene_observed`
- `operator_review`

The canonical statement binds sorted subject digests, observation time,
optional expiry, independence group, and optional qualification record. Ed25519
signatures authenticate the domain-separated statement identity.

A witness receipt must set `core_proof_claimed` to `false`. It cannot alter Cell,
PHA, Rootprint, replay, or Memory Capsule validity. Set verification reports
valid receipt count, distinct signing keys, declared independence groups, and
attestation-class counts separately; there is no aggregate truth score.

Strict transport rejects duplicate JSON keys, floats, unsafe integers, alternate
whitespace forms, stale statements, changed subjects, malformed signatures, and
duplicate receipts.
