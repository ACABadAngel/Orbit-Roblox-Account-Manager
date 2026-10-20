# Connect Orbit to KeyAuth

Orbit supports KeyAuth's hosted **API 1.3**, using license-only login. No Orbit
license server, app secret, Seller API key, or KeyAuth account password is needed
in the desktop application. Your KeyAuth account remains under your control.

## Set up the KeyAuth application

1. Create an account at <https://keyauth.cc/> and create an application for Orbit.
2. Copy the **application name**, **Owner ID** (10 characters), and **version**
   shown in your application's integration settings. Orbit defaults to KeyAuth
   application version `1.0`; this must match the dashboard. It is independent of
   Orbit's package version, so routine app updates need not invalidate activation.
3. Create subscriptions named exactly `free`, `plus`, and `pro`. Names are
   case-sensitive. Existing subscription names can instead be mapped in Orbit's
   connection form. KeyAuth's numeric subscription level assigns a key to a
   subscription; Orbit checks the resulting **subscription name**, not the number.
4. Enable HWID locking. Orbit sends a SHA-256 identifier derived from its random,
   encrypted installation ID. It does not read physical hardware serial numbers.
5. Generate a short timed `plus` or `pro` license for testing. The key uses its
   KeyAuth duration/expiry. Free local features work without a key.

Use an application compatible with license-only login. KeyAuth client 2FA,
token-file validation and executable hash validation are not implemented by this
integration. If those controls are required by an existing application, configure
a separate application or extend/test the integration rather than assuming they
are supported. Orbit never follows KeyAuth's version-update download links or
executes files from a licensing response.

## Connect and activate

In the new Orbit build, open **Account & License → Connect service → KeyAuth**.
Enter the application name, Owner ID, version, and Plus/Pro subscription names.
Connecting verifies KeyAuth initialization. Then choose **Activate a key** and
paste your test key exactly as issued; Orbit preserves its letter case.

| Subscription | Orbit access | Managed peer PCs |
| --- | --- | --- |
| `free` | Local Free features | 0 |
| `plus` | Remote control, recurring schedules, workflows, extended history, alerts | 2 |
| `pro` | Plus and cross-PC bulk actions | 5 |

A free giveaway can use a timed `plus` or `pro` key; issuing it at no charge does
not change its permissions. Create batches and choose their subscription/duration
in KeyAuth. A license-only key becomes a KeyAuth user on first use. Check both
the **Licenses** and **Users** pages when revoking already-used keys.

The peer allowance is separate from the controller installation's HWID binding.
For a move/reinstall, the publisher must manage the HWID in KeyAuth. Removing a
key locally logs out and erases the locally saved key; it does not reset HWID.
Reinstalling/removing Orbit's vault changes the installation identity. This is an
installation limit, not a guarantee of one physical device/person.

## Ship the official connection

The initial config deliberately has no invented application identity. Customers
can connect manually, or you can include the public settings in the next build.
Use GitHub **repository Variables** (not secrets) with these names:

| Variable | Value |
| --- | --- |
| `ORBIT_LICENSE_PROVIDER` | `keyauth` |
| `ORBIT_KEYAUTH_NAME` | Exact application name |
| `ORBIT_KEYAUTH_OWNER_ID` | Owner ID |
| `ORBIT_KEYAUTH_VERSION` | Matching KeyAuth version, e.g. `1.0` |
| `ORBIT_KEYAUTH_SUBSCRIPTIONS` | Optional JSON subscription mapping |

For local builds, set the same environment variables, run
`node scripts/configure-services.mjs`, then build the app. Alternatively edit
`app/config/services.json` directly. Only public configuration belongs there.
An existing, manually connected Orbit service remains selected until explicitly
changed. Switching providers requires fresh activation and cannot interrupt an
unresolved purchase.

Optional per-feature grants are supported in the subscription mapping, e.g.:

```json
{
  "free": "free",
  "plus": "plus",
  "pro": "pro",
  "remoteControl": "remote-only",
  "workflows": "workflows-only"
}
```

Create the corresponding subscriptions in KeyAuth. A `remote-only` subscription
grants two managed peers with Free as the base plan. Other available feature keys
are `advancedSchedules`, `extendedHistory`, `alerts`, and `crossMachineBulk`.
Features from simultaneous active subscriptions are combined. At the earliest
subscription expiry, Orbit requires fresh validation before granting access again;
an expired Pro subscription cannot borrow a cheaper subscription's later expiry.

## Validation and limits

Orbit checks TLS, KeyAuth's pinned Ed25519 API signature and timestamp, the owner
when returned, installation HWID, active subscription names and expiry. Requests
use POST bodies so activation keys do not appear in request URLs. Neither raw keys
nor session IDs are returned to renderer state. Keys stay in the OS-encrypted vault;
KeyAuth session IDs and paid grants are held in memory only.

On startup Orbit revalidates a saved key. It checks the active session and reloads
license data every 30 seconds. A network/verification failure pauses paid actions
immediately; even without a timer, the in-memory grant expires after at most
60 seconds or the earliest subscription expiry. Free features, Stop/release,
saved accounts and already-running games remain available. No 72-hour offline
receipt is used for KeyAuth. KeyAuth may record its normal request/IP information;
Orbit sends application IDs, the activation key and installation identifier, not
Roblox sessions or account data.

KeyAuth activation is **not checkout**. A store/payment integration must deliver
the appropriate key after a confirmed purchase. The existing self-hosted Stripe
service is still available separately; KeyAuth mode does not show its checkout,
billing, installation-management or automatic-trial buttons. Do not embed a Seller
API key in the app or a public website. Automated key issuance belongs in a trusted
server or a supported store integration and needs separate payment setup.

Run `npm test` for signed mocked API coverage, then validate a real short timed key
in KeyAuth before selling: successful activation, case-sensitive keys, ban/revoke,
expiry, wrong HWID, restart, lost network, and Plus/Pro peer limits. A live test
requires your own application details and a key; automated checks do not create
an account, generate real licenses, or contact KeyAuth.

Official references:
- <https://docs.keyauth.cc/api/getting-started/initialization>
- <https://docs.keyauth.cc/api/getting-started/license/license-login>
- <https://docs.keyauth.cc/overview/security-practices>
- <https://github.com/KeyAuth/KeyAuth-Python-Example>
