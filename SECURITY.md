# Security Policy

## Supported Versions

This repo does not currently publish versioned releases. Security fixes land on `main`.

If you consume this project as a dependency, note that security fixes may ship alongside other changes on `main`.

## Reporting a Vulnerability

Preferred (if enabled for this repo): report privately via GitHub Security Advisories.

If advisories are not available, open an issue that only says you have a security report and ask for a private contact channel. Please do not include exploit details in a public issue.

At this time, we only support reporting via GitHub. If additional channels become available, we'll document them here.

We follow responsible disclosure practices and prefer to coordinate on timing before any public write-up.

We try to review and acknowledge security reports as quickly as we can, with priority given to critical and high-impact vulnerabilities.

Security issues include things like authentication/authorization bypass, sensitive data exposure, remote code execution, and supply-chain compromise. Non-security bugs can be filed as regular issues.

## Remediation

Confirmed issues are fixed on `main` (we do not currently maintain backport branches). For security-sensitive changes, we prefer to coordinate disclosure timing via the report channel.

GitHub Actions must be referenced by commit SHA. When updating a pinned SHA (including Dependabot PRs), verify it corresponds to the intended upstream release/tag.

CI workflows should prefer `pull_request` over `pull_request_target` unless there's a clear need and a dedicated security review.

## Dependencies

We use Dependabot to propose updates for both npm dependencies and pinned GitHub Actions.

When reporting, include:

- A short description of the issue and impact
- Steps to reproduce (or a minimal PoC)
- Any relevant logs or screenshots (sanitized)

We do not currently run a paid bug bounty. Please ensure any PoC does not use real user data or impact real users.
