const DEFAULT_ENDPOINT = "https://medabase.wecaresolutions.org/api/integrations/cookies";

const targetSelect = document.getElementById("target-select");
const endpointInput = document.getElementById("endpoint-input");
const tokenInput = document.getElementById("token-input");
const cookieOutput = document.getElementById("cookie-output");
const vsInput = document.getElementById("vs-input");
const vsauthInput = document.getElementById("vsauth-input");
const refreshBtn = document.getElementById("refresh-btn");
const copyBtn = document.getElementById("copy-btn");
const pushBtn = document.getElementById("push-btn");
const statusEl = document.getElementById("status");

function getActiveTabId() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0]?.id || null);
    });
  });
}

function setStatus(message, isError = false) {
  statusEl.textContent = message || "";
  statusEl.classList.remove("success", "error");
  statusEl.classList.add(isError ? "error" : "success");
  statusEl.style.display = "block";
}

async function guessEndpointFromActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs?.[0]?.url || "";
      try {
        const parsed = new URL(url);
        if (parsed.hostname.includes("wecaresolutions")) {
          resolve(`${parsed.origin}/api/integrations/cookies`);
          return;
        }
      } catch (err) {
        // ignore parsing errors
      }
      resolve(DEFAULT_ENDPOINT);
    });
  });
}

async function updateFromStorage() {
  const { medaCookieEndpoint, medaCookieToken } = await chrome.storage.sync.get([
    "medaCookieEndpoint",
    "medaCookieToken",
    "medaCookieVS",
    "medaCookieVSAUTH",
  ]);
  if (medaCookieEndpoint) {
    endpointInput.value = medaCookieEndpoint;
  } else {
    endpointInput.value = await guessEndpointFromActiveTab();
  }
  if (medaCookieToken) {
    tokenInput.value = medaCookieToken;
  }
  const { medaCookieVS, medaCookieVSAUTH } = await chrome.storage.sync.get([
    "medaCookieVS",
    "medaCookieVSAUTH",
  ]);
  if (medaCookieVS) vsInput.value = medaCookieVS;
  if (medaCookieVSAUTH) vsauthInput.value = medaCookieVSAUTH;
}

async function refreshCookies() {
  setStatus("Fetching cookies...");
  const tabId = await getActiveTabId();
  chrome.runtime.sendMessage(
    { type: "FETCH_COOKIES", target: targetSelect.value, tabId },
    (response) => {
      if (chrome.runtime.lastError) {
        setStatus(`Extension error: ${chrome.runtime.lastError.message}`, true);
        return;
      }
      if (!response?.ok) {
        setStatus(response?.error || "Unable to fetch cookies", true);
        return;
      }
      cookieOutput.value = response.cookieHeader;
      setStatus(`Captured ${response.count} cookies`);
    },
  );
}

async function copyCookies() {
  if (!cookieOutput.value) {
    setStatus("No cookies to copy", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(cookieOutput.value);
    setStatus("Cookie header copied to clipboard");
  } catch (err) {
    setStatus(`Clipboard error: ${err.message}`, true);
  }
}

async function pushCookies() {
  const endpoint = endpointInput.value.trim();
  const apiToken = tokenInput.value.trim();
  if (!endpoint) {
    setStatus("Enter an endpoint before pushing", true);
    return;
  }
  await chrome.storage.sync.set({ medaCookieEndpoint: endpoint });
  await chrome.storage.sync.set({ medaCookieToken: apiToken });
   await chrome.storage.sync.set({ medaCookieVS: vsInput.value.trim() || "", medaCookieVSAUTH: vsauthInput.value.trim() || "" });
  setStatus("Sending to API...");
  const extraHeaders = { "Content-Type": "application/json" };
  if (apiToken) {
    extraHeaders["X-Meda-Token"] = apiToken;
  }
  const tabId = await getActiveTabId();
  const vsOverride = vsInput.value.trim();
  const vsauthOverride = vsauthInput.value.trim();
  chrome.runtime.sendMessage(
    {
      type: "PUSH_COOKIES",
      target: targetSelect.value,
      endpoint,
      headers: { method: "POST", extra: extraHeaders },
      tabId,
      overrides: {
        vs: vsOverride,
        vsauth: vsauthOverride,
      },
    },
    (response) => {
      if (chrome.runtime.lastError) {
        setStatus(`Extension error: ${chrome.runtime.lastError.message}`, true);
        return;
      }
      if (!response?.ok) {
        setStatus(response?.error || "API rejected the payload", true);
        return;
      }
      const status = response.status || 200;
      const sent = response.count || response.cookieHeader?.length || "some";
      setStatus(`Pushed ${sent} cookies (HTTP ${status})`);
    },
  );
}

refreshBtn.addEventListener("click", refreshCookies);
copyBtn.addEventListener("click", copyCookies);
pushBtn.addEventListener("click", pushCookies);
endpointInput.addEventListener("change", () => {
  chrome.storage.sync.set({ medaCookieEndpoint: endpointInput.value.trim() });
});
tokenInput.addEventListener("change", () => {
  chrome.storage.sync.set({ medaCookieToken: tokenInput.value.trim() });
});

updateFromStorage().then(refreshCookies);
