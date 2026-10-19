# Changelog

## 0.1.1

- Fix launch ticket requests returning HTTP 415: send an explicit JSON content
  type and empty JSON object on both the initial request and CSRF retry.
- Report request-format and service errors separately from account verification.
- Add a regression check against a local HTTP endpoint that rejects missing or
  invalid JSON, then exercises the CSRF retry and ticket response.
- Update project links to the current GitHub account name.

Existing account data and launch profiles are preserved. Install the updated
build, reopen Orbit, and retry Launch. Signing in again is only needed if Roblox
separately reports an expired session or verification requirement.
