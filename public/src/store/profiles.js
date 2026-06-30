const API_BASE = '';

function getAuthToken() {
  return localStorage.getItem('subconvert_token') || '';
}

function setAuthToken(token) {
  localStorage.setItem('subconvert_token', token);
}

function clearAuthToken() {
  localStorage.removeItem('subconvert_token');
}

function authHeaders(extra = {}) {
  const token = getAuthToken();
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: authHeaders(options.headers || {})
  });

  if (response.status === 401) {
    throw new Error('UNAUTHORIZED');
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function loadProfiles() {
  return requestJson('/store');
}

async function addProfile(alias, url) {
  return requestJson('/store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias, url })
  });
}

async function updateProfile(id, updates) {
  return requestJson(`/store/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
}

async function deleteProfile(id) {
  return requestJson(`/store/${id}`, {
    method: 'DELETE'
  });
}

async function loadSettings() {
  return requestJson('/settings');
}

async function saveSettings(settings) {
  return requestJson('/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  });
}

async function exportDatabase() {
  return requestJson('/backup');
}

async function importDatabase(backup) {
  return requestJson('/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(backup)
  });
}
