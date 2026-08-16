const authState = {
  isRegisterMode: false,
  nextPath: '/'
};

function isNativeApp() {
  return Boolean(window.Capacitor);
}

let apiDiscoveryPromise = null;

function getApiCandidates() {
  const fromWindow = String(window.CARECOMPASS_API_BASE || '').trim().replace(/\/$/, '');
  const fromQuery = String(getQueryParam('apiBase') || '').trim().replace(/\/$/, '');
  const fromStorage = getStoredApiBase();
  const candidates = [
    fromWindow,
    fromQuery,
    fromStorage,
    'http://10.0.2.2:3000',
    'http://10.0.2.2:3001',
    'http://192.168.1.7:3001',
    'http://192.168.1.7:3000',
    'http://192.168.1.10:3000',
    'http://192.168.1.10:3001',
    'http://192.168.0.7:3001',
    'http://192.168.0.7:3000',
    'http://192.168.0.10:3001',
    'http://192.168.0.10:3000'
  ].filter(Boolean);

  return [...new Set(candidates)];
}

async function canReachApi(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);

  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    return Boolean(res.ok && data.status === 'ok');
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverAndStoreApiBase() {
  if (!isNativeApp()) {
    return '';
  }

  const stored = getStoredApiBase();
  if (stored) {
    const reachable = await canReachApi(stored);
    if (reachable) {
      return stored;
    }
  }

  const candidates = getApiCandidates();
  const results = await Promise.all(candidates.map(async (candidate) => ({
    candidate,
    reachable: await canReachApi(candidate)
  })));

  for (const result of results) {
    if (result.reachable) {
      setStoredApiBase(result.candidate);
      return result.candidate;
    }
  }

  return '';
}

async function ensureApiBase() {
  if (!isNativeApp()) {
    return '';
  }

  if (!apiDiscoveryPromise) {
    apiDiscoveryPromise = discoverAndStoreApiBase().finally(() => {
      apiDiscoveryPromise = null;
    });
  }

  return apiDiscoveryPromise;
}

function getStoredApiBase() {
  return String(localStorage.getItem('carecompass-api-base') || '').trim().replace(/\/$/, '');
}

function setStoredApiBase(value) {
  const normalized = String(value || '').trim().replace(/\/$/, '');
  if (normalized) {
    localStorage.setItem('carecompass-api-base', normalized);
  } else {
    localStorage.removeItem('carecompass-api-base');
  }
}

function resolveApiUrl(url) {
  const raw = String(url || '');
  if (!raw) {
    return raw;
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (!raw.startsWith('/')) {
    return raw;
  }

  const base = getStoredApiBase();
  return base ? `${base}${raw}` : raw;
}

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name) || '';
}

function setAuthMessage(message) {
  const el = document.getElementById('authMessage');
  if (el) {
    el.textContent = message || '';
  }
}

function updateAuthMode() {
  const title = document.getElementById('authTitle');
  const submit = document.getElementById('authSubmitButton');
  const toggle = document.getElementById('authToggleButton');
  const displayNameField = document.getElementById('displayNameField');

  if (title) title.textContent = authState.isRegisterMode ? 'Create account' : 'Login';
  if (submit) {
    const icon = authState.isRegisterMode ? 'icon-plus' : 'icon-arrow-right-circle';
    submit.innerHTML = `<svg class="icon" aria-hidden="true"><use href="/icons/sprite.svg#${icon}"></use></svg>${authState.isRegisterMode ? 'Create account' : 'Login'}`;
  }
  if (toggle) toggle.textContent = authState.isRegisterMode ? 'Use existing account instead' : 'Create account instead';
  if (displayNameField) displayNameField.hidden = !authState.isRegisterMode;
}

async function fetchJson(url, options = {}) {
  const isRelativeUrl = String(url || '').startsWith('/');
  if (isRelativeUrl && isNativeApp()) {
    await ensureApiBase();
  }

  try {
    const res = await fetch(resolveApiUrl(url), options);
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const data = contentType.includes('application/json')
      ? await res.json().catch(() => ({}))
      : {};

    if (!res.ok) {
      const noApiBase = !getStoredApiBase();
      if (isRelativeUrl && isNativeApp() && noApiBase && !data.message) {
        return {
          success: false,
          _networkError: true,
          message: 'Cannot find the backend server. Make sure phone and backend are on the same Wi-Fi network.'
        };
      }

      return {
        success: false,
        _networkError: false,
        message: data.message || `Request failed (${res.status})`
      };
    }

    return { ...data, _networkError: false };
  } catch (error) {
    if (isRelativeUrl && isNativeApp()) {
      await ensureApiBase();
      try {
        const retry = await fetch(resolveApiUrl(url), options);
        const retryData = await retry.json().catch(() => ({}));
        return { ...retryData, _networkError: false };
      } catch (retryError) {
        // fall through to standard network error response
      }
    }

    return {
      success: false,
      _networkError: true,
      message: 'Unable to connect to the server. Connect to the same network as your backend and retry.'
    };
  }
}

function completeAuth(token, user) {
  localStorage.setItem('carecompass-token', token);
  localStorage.setItem('carecompass-user', JSON.stringify(user));
  window.location.href = authState.nextPath || '/';
}

async function tryAutoRedirectIfAlreadyLoggedIn() {
  const token = localStorage.getItem('carecompass-token') || '';
  if (!token) {
    return;
  }

  const data = await fetchJson('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (data.success) {
    window.location.href = authState.nextPath || '/';
  } else if (data._networkError) {
    setAuthMessage(data.message);
  } else {
    localStorage.removeItem('carecompass-token');
    localStorage.removeItem('carecompass-user');
  }
}

document.getElementById('authToggleButton').addEventListener('click', () => {
  authState.isRegisterMode = !authState.isRegisterMode;
  updateAuthMode();
  setAuthMessage(authState.isRegisterMode ? 'Create a separate account for each user whose reports should stay isolated.' : 'Login with the account tied to these reports and reminders.');
});

document.getElementById('authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());

  const endpoint = authState.isRegisterMode ? '/api/auth/register' : '/api/auth/login';

  const data = await fetchJson(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!data.success) {
    if (data._networkError) {
      setAuthMessage(data.message);
    } else {
      setAuthMessage(data.message || 'Authentication failed.');
    }
    return;
  }

  form.reset();
  setAuthMessage('');
  completeAuth(data.token, data.user);
});

async function bootAuthPage() {
  const next = getQueryParam('next');
  authState.nextPath = next && next.startsWith('/') ? next : '/';
  const message = getQueryParam('message');

  if (isNativeApp()) {
    await ensureApiBase();
  }

  updateAuthMode();
  setAuthMessage(message || 'Use a separate login for each person\'s reports and reminders.');
  await tryAutoRedirectIfAlreadyLoggedIn();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  if (isNativeApp()) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    }).catch(() => {});
    return;
  }

  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (error) {
      console.warn('Service worker registration failed:', error);
    }
  });
}

registerServiceWorker();
bootAuthPage();
