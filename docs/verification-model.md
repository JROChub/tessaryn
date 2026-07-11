# Verification Model

TESSARYN keeps every verifiable dimension independently inspectable.

## Cell identity

- canonical manifest bytes resolve to the declared Cell ID;
- chunks resolve to their content addresses and Merkle roots;
- the `.pha` artifact binds the declared Cell inputs;
- Rootprint lineage and replay resolve to the committed branch state;
- the Memory Capsule preserves its packaged verification state.

## Observation and time

Source attribution, witness statements, freshness, validity intervals,
supersession, branch disagreement, and disclosure policy travel with the Cell
as explicit dimensions. Moment materialization preserves those dimensions in
its receipt.

## SLBIT meaning

SLBIT packets are independently digest-bound to their target state. Meaning can
reorganize, be removed, or be replaced without changing Cell or `.pha`
identity. A packet mutation is rejected at semantic integrity while the bound
Cell remains byte-identical.

## Witnesses

Witness receipts bind signer, attestation class, subject digests, validity,
independence group, and signature. Verification reports the exact attestation
that each signer made.
