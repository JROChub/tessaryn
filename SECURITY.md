# Security And Privacy

Do not submit sensitive world captures in public issues.

Report vulnerabilities privately to `security@mfenx.com` with the affected
version, reproduction steps, impact, and any proof-of-concept artifact. Do not
include private location data unless it is essential and explicitly authorized.

## Verification Surface

TESSARYN accepts untrusted manifests, chunks, codecs, semantic packets, and
network frames. Every accepted layer is checked against its declared identity,
replay, authorization, and integrity rules. Semantic text is independently
bound and must never be rendered as HTML.

## Required Controls

- Reject duplicate JSON keys, floating-point identity values, oversized input,
  inverted extents, invalid Q30 orientations, and unknown critical formats.
- Verify content digests before decode where practical and again on store read.
- Keep capture local and upload disabled by default.
- Never include protected geometry in a public derivative.
- Use explicit capabilities for restricted Cells.
- Preserve disputes and stale state instead of silently averaging or replacing.
- Keep browser verifier-critical code same-origin and free of remote scripts.
- Run decoders for untrusted rich formats in a sandbox before production use.

A production deployment that enables real-world capture or peer synchronization
records its device, operator, privacy, and retention controls with that
deployment.
