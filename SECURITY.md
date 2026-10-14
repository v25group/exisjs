# Security Policy

## Supported Versions

Security fixes are released for the latest minor version. Before 1.0, upgrade to the newest `0.x` release to receive them.

| Version | Supported          |
| ------- | ------------------ |
| 0.9.x   | :white_check_mark: |
| < 0.9   | :x:                |

## Reporting a Vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. We aim to answer within 48 hours, agree on a fix and a disclosure date with you, and credit you in the release notes unless you prefer otherwise.

Please include:

- What is affected (package, version, configuration)
- Steps to reproduce, ideally a minimal proof of concept
- The impact: what an attacker can do

## Release Integrity

- Packages are published from GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements), so each release on npm links to the commit and workflow that built it. Verify with `npm audit signatures`.
- Every change runs `npm audit` for production dependencies in CI; a high or critical advisory fails the build.

Thank you for helping keep ExisJS safe.
