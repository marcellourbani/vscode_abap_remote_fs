# Security Policy

We take security seriously. Which, for a project that connects to enterprise SAP systems, should be reassuring.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.4.x   | ✅ Actively maintained |
| 2.0–2.3 | ⚠️ Best effort (we'll look, no promises) |
| 1.x     | ❌ End of life. It's 2026. Let go |
| 0.x     | ❌ We pretend these don't exist |

## Reporting a Vulnerability

**Do NOT open a public GitHub issue.** We know it's tempting. Resist.

Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) feature on this repository, or email the maintainers directly.

Tell us:
- What's broken and how
- How to reproduce it
- What an attacker could do with it
- A fix, if you have one (we'll buy you a virtual coffee)

We aim to acknowledge within 48 hours. Critical issues get patched within a week. Non-critical issues get patched when we stop procrastinating.

## How We Handle Your Secrets

### SAP Credentials
- Stored in VS Code's SecretStorage (your OS keychain — not a JSON file, not localStorage, not vibes)
- If you put a password in plaintext `settings.json`, we'll show you a warning.
- Your credentials go to exactly one place: your SAP system. Nowhere else. Ever

### MCP Server
- Binds to `127.0.0.1` only — your neighbor's laptop cannot reach it
- Optional API key authentication (Bearer token) for all endpoints except `/health`
- Cross-origin requests? Rejected. OPTIONS preflight? Also rejected. We don't negotiate with browsers
- Tool invocations carry a one-time nonce — replay attacks get nothing

### AI Tool Security
- All language model tools validate inputs and sanitize SQL parameters (no, you can't `DROP TABLE` via Copilot)
- A tool guard prevents other extensions from calling our tools without authorization
- Your SAP data stays local — the AI sees what you explicitly send through VS Code's language model API, nothing more

### Things We Deliberately Don't Do
- Phone home
- Collect telemetry about your SAP data
- Store credentials in plaintext (and we judge extensions that do)
- Execute code fetched from the internet
- Anything that would make your security team nervous (more nervous than usual)

## Known Limitations (a.k.a. Not Our Fault But Good to Know)

- We trust your SAP system. If your SAP system is compromised... well, you have much bigger problems than a VS Code extension
- Debug recordings (`.abaprecord` files) capture variable values from runtime. These are basically core dumps with extra steps. Treat them accordingly
- Data Workbook outputs (`.sapwb`) may contain query results stored locally. Don't put them in public repos
- If someone has physical access to your machine and your OS keychain is unlocked, they can read your stored passwords. But again — bigger problems

## Dependencies

Dependabot watches our `package.json` files like a hawk. Critical CVEs get addressed promptly. If you spot something we missed, tell us — we're not too proud to accept help.
