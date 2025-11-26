# Meda Cookie Relay (Chrome Extension)

A minimal Chrome extension that collects the authenticated cookie headers for VanillaSoft and OnlySales so you can paste or post them into the MedaBase backend without hunting through DevTools each time.

## Features

- One-click cookie capture for `s2.vanillasoft.net` and `app.onlysales.io`.
- Copy the cookie header to the clipboard or push it to any HTTPS endpoint.
- Remembers the last webhook/API endpoint and API token you entered, and pre-fills the endpoint based on the active MedaBase tab.
- Service worker keeps cookie access out of the popup (MV3 compliant).

## Project structure

```
meda-cookie-extension/
├── manifest.json           # Chrome MV3 configuration
├── popup.html              # UI shell
├── popup.js                # Popup logic (refresh/copy/push)
├── service-worker.js       # Cookie collection + background messaging
└── README.md
```

## Installation

Download the latest release asset extension-dist.zip and use Chrome ‘Load unpacked’ pointing to the unzipped folder.

## Local development / testing

1. Run `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the `meda-cookie-extension` directory.
4. Pin the extension, log into VanillaSoft or OnlySales in another tab, then click the extension icon to refresh/copy/push the cookies.

The popup auto-refreshes the selected site’s cookies on open, so keeping the login tab active in the same profile is enough.

## Hooking into MedaBase

- If you open the popup while viewing MedaBase, the endpoint field auto-fills with `https://your-host/api/integrations/cookies`. Otherwise it falls back to `https://medabase.wecaresolutions.org/api/integrations/cookies`.
- Paste the API token generated on the Integrations page (Browser Extension API section). Both endpoint and token are remembered in Chrome sync storage for future sessions.
- Whenever you hit **Push to API**, the extension sends

```json
{
  "target": "vanillasoft", // or "onlysales"
  "cookies": "COOKIE=header" ,
  "generatedAt": "2025-11-17T19:10:00Z"
}
```

`service-worker.js` is the only place you need to tweak if MedaBase wants a different payload shape or HTTP method. The extension automatically attaches `X-Meda-Token` when a token is provided.

## Next steps / ideas

- Encrypt payloads with a shared secret before pushing.
- Auto-detect additional platforms (Dialer, OnlySales staging, etc.).
- Build a tiny MedaBase endpoint that accepts this payload and updates `integration_settings` automatically.
- Package the extension in the Chrome Web Store for easier deployment.
