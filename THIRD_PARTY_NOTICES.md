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
- Electron and electron-builder: MIT. selfsigned: MIT. Transitive dependency
  notices are included by the packaging tool as applicable.

Roblox and game names belong to their respective owners. Orbit is independent
and is not endorsed by Roblox, Froststrap, or Roblox Account Manager.
