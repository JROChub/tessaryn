# TESSARYN Origin Deployment

[![conformance](https://github.com/JROChub/tessaryn/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/JROChub/tessaryn/actions/workflows/ci.yml)
[![deploy-origin](https://github.com/JROChub/tessaryn/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/JROChub/tessaryn/actions/workflows/pages.yml)

The production Origin is published at [tessaryn.com](https://tessaryn.com/).
Its machine-verifiable [deployment attestation](https://tessaryn.com/release.json)
binds the live distribution to the qualified source commit, conformance run, and
deployment run.

`deploy-origin` is triggered only when the `conformance` workflow completes on
`main`. Publication proceeds only when that upstream run concluded successfully,
and the workflow rejects a qualified commit if `main` advances before build or
publication completes.

Pull-request conformance runs do not create Pages deployment runs. This avoids
misleading skipped `deploy-origin` runs while preserving the successful-main-only
release gate.
