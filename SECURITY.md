# Security Policy

## Supported versions

This repository (`1unns/daed`) is a **development fork**. It does not maintain
its own supported-version matrix.

| Where the build came from | Where to report |
| --- | --- |
| An official release from [daeuniverse/daed](https://github.com/daeuniverse/daed) | [daeuniverse/daed](https://github.com/daeuniverse/daed) security policy |
| A build produced from this fork | This repository (see below) |

If you are unsure which one you have, check the release page you downloaded from.

## Reporting a vulnerability

**Do not open a public issue, pull request, or discussion for a security problem.**

Use GitHub's private vulnerability reporting on this repository:

1. Go to the **Security** tab of this repository.
2. Choose **Report a vulnerability**.
3. Describe the issue with enough detail to reproduce it.

If private reporting is unavailable to you, contact the maintainer listed in
[`CODEOWNERS`](./CODEOWNERS) directly and ask for a private channel. Please do not
include exploit details in that first message.

### What to include

- Affected component (`apps/web`, `wing`, `packages/*`) and, when known, the
  submodule commit you built from.
- Whether the deployment served the panel over plain HTTP and whether the panel
  was reachable from an untrusted network.
- Reproduction steps, and the impact you believe the issue has.

### What to expect

This is a single-maintainer fork, so these are targets rather than contractual
commitments:

| Step | Target |
| --- | --- |
| Acknowledgement of the report | 3 business days |
| Initial assessment and severity | 7 business days |
| Fix or documented mitigation for critical issues | 30 days |

You will be told whether the issue belongs here or upstream. Issues that affect
the upstream product will be coordinated with [daeuniverse/daed](https://github.com/daeuniverse/daed)
rather than fixed silently in this fork.

## Scope

In scope:

- Authentication, authorization and session handling in `wing`.
- Input handling at every trust boundary (GraphQL requests, subscription
  fetching, DNS and proxy configuration imported from users).
- The web dashboard's handling of credentials and remote data.
- The build and release pipeline, including submodule pins.

Out of scope:

- Vulnerabilities that require an already-compromised host, or that depend on
  running the panel with `--privileged` / host networking on an untrusted
  network. Such deployments are documented as unsupported in the README; report
  them as hardening suggestions instead.
- Findings produced only by automated scanners without a demonstrated impact.
- Issues in third-party proxy servers or subscription providers.

## Deployment warning

The panel is an administrative interface. Its default configuration listens on
all interfaces so that first-time setup works on a headless device. If you expose
it beyond `localhost`, put it behind TLS and restrict CORS origins. See
[`docs/RUNBOOK.md`](./docs/RUNBOOK.md) for the supported deployment shape.
