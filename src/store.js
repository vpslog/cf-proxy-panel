import { getCorsHeaders, isAuthorized, unauthorizedResponse } from './auth.js';
import { SETTINGS_KEY } from './settings.js';

function jsonResponse(data, init = {}, headers = getCorsHeaders()) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers || {}) }
  });
}

export async function handleStore(request, env) {
  const corsHeaders = getCorsHeaders();

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!isAuthorized(request, env)) {
    return unauthorizedResponse(corsHeaders);
  }

  try {
    const url = new URL(request.url);
    const id = url.pathname.split('/store/')[1];

    if (request.method === 'GET') {
      const keys = await env.PROXY_STORE.list();
      const configs = [];

      for (const key of keys.keys) {
        if (key.name === SETTINGS_KEY || key.name.startsWith('__')) {
          continue;
        }

        const value = await env.PROXY_STORE.get(key.name);
        if (value) {
          configs.push({ id: key.name, ...JSON.parse(value) });
        }
      }

      configs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return jsonResponse(configs, {}, corsHeaders);
    }

    if (request.method === 'POST') {
      const config = await request.json();
      if (!config.alias || !config.url) {
        return jsonResponse({ error: 'Alias and URL are required' }, { status: 400 }, corsHeaders);
      }

      const newId = Date.now().toString();
      const now = Date.now();
      const fullConfig = {
        alias: String(config.alias).trim(),
        url: String(config.url).trim(),
        enabled: config.enabled !== false,
        id: newId,
        createdAt: now,
        updatedAt: now
      };

      await env.PROXY_STORE.put(newId, JSON.stringify(fullConfig));
      return jsonResponse(fullConfig, {}, corsHeaders);
    }

    if (request.method === 'PUT') {
      if (!id) {
        return jsonResponse({ error: 'ID is required' }, { status: 400 }, corsHeaders);
      }

      const existing = await env.PROXY_STORE.get(id);
      if (!existing) {
        return jsonResponse({ error: 'Config not found' }, { status: 404 }, corsHeaders);
      }

      const updates = await request.json();
      const current = JSON.parse(existing);
      const updatedConfig = {
        ...current,
        ...updates,
        alias: updates.alias == null ? current.alias : String(updates.alias).trim(),
        url: updates.url == null ? current.url : String(updates.url).trim(),
        updatedAt: Date.now()
      };

      await env.PROXY_STORE.put(id, JSON.stringify(updatedConfig));
      return jsonResponse(updatedConfig, {}, corsHeaders);
    }

    if (request.method === 'DELETE') {
      if (!id) {
        return jsonResponse({ error: 'ID is required' }, { status: 400 }, corsHeaders);
      }

      await env.PROXY_STORE.delete(id);
      return jsonResponse({ success: true }, {}, corsHeaders);
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 }, corsHeaders);
  }
}
