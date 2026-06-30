import { getCorsHeaders, isAuthorized, unauthorizedResponse } from './auth.js';

export const SETTINGS_KEY = '__cf_proxy_panel_settings';
export const DEFAULT_REMOTE_RULE_URL = 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini';

export const DEFAULT_SETTINGS = {
  remoteRuleUrl: DEFAULT_REMOTE_RULE_URL
};

export function normalizeSettings(settings = {}) {
  return {
    remoteRuleUrl: String(settings.remoteRuleUrl || DEFAULT_SETTINGS.remoteRuleUrl).trim()
  };
}

export async function loadSettings(env) {
  const value = await env.PROXY_STORE.get(SETTINGS_KEY);
  if (!value) {
    return { ...DEFAULT_SETTINGS };
  }

  return normalizeSettings(JSON.parse(value));
}

export async function saveSettings(env, settings) {
  const normalized = normalizeSettings(settings);
  await env.PROXY_STORE.put(SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

function jsonResponse(data, init = {}, headers = getCorsHeaders()) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers || {}) }
  });
}

export async function handleSettings(request, env) {
  const corsHeaders = getCorsHeaders();

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!isAuthorized(request, env)) {
    return unauthorizedResponse(corsHeaders);
  }

  try {
    if (request.method === 'GET') {
      return jsonResponse(await loadSettings(env), {}, corsHeaders);
    }

    if (request.method === 'PUT') {
      const settings = await request.json();
      return jsonResponse(await saveSettings(env, settings), {}, corsHeaders);
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 }, corsHeaders);
  }
}
