# Deployment Boundary

The TESSARYN Origin is a static, same-origin application built from
`apps/viewer-web`. GitHub Actions runs its contract tests and production build
before GitHub Pages can deploy it. The browser fetches only versioned application
assets and the bundled synthetic world fixture. A service worker retains those
assets for offline reconstruction after the first successful load.

## Custom Domain Gate

Do not configure `tessaryn.com` as the Pages custom domain until all of these
conditions hold:

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

This repository intentionally contains no `CNAME` file while the domain remains
parked. A working GitHub Pages origin is preferable to a custom-domain redirect
whose DNS or certificate has not passed verification.
