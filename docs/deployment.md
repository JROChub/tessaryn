# Deployment Boundary

The TESSARYN Origin is a static, same-origin application built from
`apps/viewer-web`. GitHub Actions runs its contract tests and production build
before GitHub Pages can deploy it. The browser fetches only versioned application
assets, the provenance-bound validation Origin, and the bundled protocol fixture. A service worker retains those
assets for offline reconstruction after the first successful load.

## Published Origin

- Canonical host: `https://tessaryn.com/`
- Canonical redirect: `https://www.tessaryn.com/` to the apex

The first-party path is deployed as an exact copy of the tested
`apps/viewer-web/dist` output. The release artifacts at both origins must hash to
the values recorded in `conformance/SHA256SUMS`. Neither distribution changes the
TESSARYN trust boundary or makes the MFENX website part of canonical Cell
identity.

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
