import { getCorsHeaders, isAuthorized, unauthorizedResponse } from './auth.js';
import { loadSettings, saveSettings, SETTINGS_KEY } from './settings.js';

function jsonResponse(data, init = {}, headers = getCorsHeaders()) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers || {}) }
  });
}

async function listAllKeys(env) {
  const keys = [];
  let cursor;

  do {
    const page = await env.PROXY_STORE.list({ cursor });
    keys.push(...page.keys.map((key) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return keys;
}

function isProfileKey(key) {
  return key !== SETTINGS_KEY && !key.startsWith('__');
}

async function loadProfiles(env) {
  const keys = await listAllKeys(env);
  const profiles = [];

  for (const key of keys.filter(isProfileKey)) {
    const value = await env.PROXY_STORE.get(key);
    if (value) {
      profiles.push({ id: key, ...JSON.parse(value) });
    }
  }

  return profiles.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function replaceProfiles(env, profiles) {
  const keys = await listAllKeys(env);
  await Promise.all(keys.filter(isProfileKey).map((key) => env.PROXY_STORE.delete(key)));

  const now = Date.now();
  for (const profile of profiles) {
    if (!profile.alias || !profile.url) {
      continue;
    }

    const id = String(profile.id || profile.createdAt || `${now}-${Math.random()}`).replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanProfile = {
      id,
      alias: String(profile.alias).trim(),
      url: String(profile.url).trim(),
      enabled: profile.enabled !== false,
      createdAt: Number(profile.createdAt) || now,
      updatedAt: Number(profile.updatedAt) || now
    };

    await env.PROXY_STORE.put(id, JSON.stringify(cleanProfile));
  }
}

export async function handleBackup(request, env) {
  const corsHeaders = getCorsHeaders();

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!isAuthorized(request, env)) {
    return unauthorizedResponse(corsHeaders);
  }

  try {
    if (request.method === 'GET') {
      return jsonResponse({
        version: 1,
        exportedAt: new Date().toISOString(),
        profiles: await loadProfiles(env),
        settings: await loadSettings(env)
      }, {}, corsHeaders);
    }

    if (request.method === 'POST') {
      const backup = await request.json();
      if (!Array.isArray(backup.profiles)) {
        return jsonResponse({ error: 'Invalid backup: profiles must be an array' }, { status: 400 }, corsHeaders);
      }

      await replaceProfiles(env, backup.profiles);
      const settings = await saveSettings(env, backup.settings || {});
      return jsonResponse({
        success: true,
        importedProfiles: backup.profiles.length,
        settings
      }, {}, corsHeaders);
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 }, corsHeaders);
  }
}
