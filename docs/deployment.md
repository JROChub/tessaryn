# Deployment Boundary

The TESSARYN Origin remains a static application built from
`apps/viewer-web`. GitHub Actions runs its contract tests and production build
before GitHub Pages can deploy it. A service worker retains versioned application
assets, the opt-in provenance-bound Validation Lab, and bundled protocol fixtures
for offline reconstruction after the first successful load.

User publication is a separate trust and deployment boundary. The browser talks
to one or more independently operated `tessaryn-weave-node` services only after
an explicit public-disclosure action. The node does not trust the browser's
verification result: it reconstructs the signed artifact, verifies every
admitted protocol and Power House layer, and commits content-addressed bytes
atomically before returning a public receipt.

## Published Origin

- Canonical host: `https://tessaryn.com/`
- Canonical redirect: `https://www.tessaryn.com/` to the apex

The first-party path is deployed as an exact copy of the tested
`apps/viewer-web/dist` output. The release artifacts at both origins must hash to
the values recorded in `conformance/SHA256SUMS`. Neither distribution changes the
TESSARYN trust boundary or makes the MFENX website part of canonical Cell
identity.

## Write-Capable Weave Node

The reference node binds to loopback on port `8790` behind Nginx. Production
state is stored under `/var/lib/tessaryn/weave` on the dedicated host's
persistent filesystem. The node advertises its finite capacity at `/v1/policy`; protocol
identity itself has no total-world size limit.

Installation assets:

```text
services/tessaryn-weave-node
infra/systemd/tessaryn-weave-node.service
infra/systemd/weave.env.example
infra/nginx/tessaryn-weave.conf
infra/nginx/tessaryn-weave-tls.conf
infra/nginx/tessaryn-weave-rate-limit.conf
scripts/deploy-weave-node.sh
```

Nginx streams request bodies without buffering, limits body size to one
publication chunk, applies separate admission/chunk request rates, and exposes
only the write-node API. Systemd isolates the service and grants write access
only to its content store. TLS is issued only after the selected host resolves
to the dedicated node.

GitHub deployment and Weave publication are intentionally independent. A GitHub
outage cannot invalidate or rename an accepted object, and user publication
never grants repository access.

The first-party node is `https://weave.rpc.mfenx.com`. Its production smoke on
2026-07-12 covered a browser-compatible Ed25519 publication intent, resumable
chunk admission, independent reconstruction-artifact verification, atomic
commit, complete retrieval, byte-range retrieval, catalog admission, and
publisher-signed discovery revocation. A publication receipt preserves identity;
it does not promise perpetual availability from one node. Replication and backup
policy remain operator concerns.

## Custom Domain State

The following gate passed on 2026-07-10:

1. The apex has the four current GitHub Pages `A` records.
2. `www` is a `CNAME` to `jrochub.github.io`.
3. Namecheap parking and conflicting apex or `www` records are removed.
4. DNS resolution is checked from more than one resolver.
5. GitHub reports the domain check successful.
6. The issued certificate covers the selected canonical host.
7. HTTPS enforcement is enabled and apex/`www` redirect behavior is tested.

As documented by GitHub on 2026-07-10, the apex records are:

```text
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

The apex also has the four GitHub Pages IPv6 records. GitHub Pages reports the
custom domain approved, the certificate covers both hosts, HTTPS enforcement is
enabled, HTTP redirects to HTTPS, and `www` redirects to the apex. The domain is
configured through the Pages API; the deployment artifact remains build output
from this repository.
