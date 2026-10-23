# References and dependencies

Orbit is an original implementation. No source files or assets were copied
from either reference project.

- [Froststrap](https://github.com/Froststrap/Froststrap), MPL-2.0:
  launcher selection and named launch-profile inspiration. Orbit can hand off
  launches to an installed Froststrap executable or registered protocol handler.
- [Roblox Account Manager](https://github.com/ic3w0lf22/Roblox-Account-Manager),
  GPL-3.0: account-group and queued-launch workflow reference; the public
  authentication-ticket/protocol flow and published Windows singleton name
  were inspected for interoperability. All helper code was written independently.
  The archived manager is not bundled or required.
- Electron, electron-builder and electron-updater: MIT. selfsigned: MIT.
  Stripe Node SDK: MIT (used only by the separate licensing service). Transitive dependency
  notices are included by the packaging tool as applicable.

Roblox and game names belong to their respective owners. Orbit is independent
and is not endorsed by Roblox, Froststrap, or Roblox Account Manager.

## Native C# preview

The native rewrite under `native/` uses Microsoft WebView2 solely for Roblox sign-in.
Package and licence: https://www.nuget.org/packages/Microsoft.Web.WebView2 .
The user must have Microsoft's WebView2 Runtime installed to use that sign-in flow.

Froststrap was consulted for bootstrapper features and Roblox package/deployment
conventions. Its source is MPL-2.0: https://github.com/Froststrap/Froststrap .
The new bootstrapper is independently implemented and does not bundle Froststrap
source. Any future direct source reuse must preserve the applicable MPL notices.

The native core also uses BouncyCastle.Cryptography for legacy scrypt backup
compatibility and Ed25519 verification. See https://www.bouncycastle.org/about/license/
and the package's bundled notices.
