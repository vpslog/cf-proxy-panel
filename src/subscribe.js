import {
  buildClashConfig,
  buildV2RaySubscription,
  parseProxyLink,
  resolveClashRules,
  stringifyYaml
} from './converter.js';
import { getCorsHeaders, isAuthorized } from './auth.js';
import { loadSettings } from './settings.js';

function textResponse(body, init = {}, headers = getCorsHeaders()) {
  return new Response(body, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) }
  });
}

async function loadConfigs(env, id) {
  if (id) {
    const configStr = await env.PROXY_STORE.get(id);
    return configStr ? [JSON.parse(configStr)] : [];
  }

  const keys = await env.PROXY_STORE.list();
  const configs = [];

  for (const key of keys.keys) {
    const configStr = await env.PROXY_STORE.get(key.name);
    if (configStr) {
      const config = JSON.parse(configStr);
      if (config.enabled) {
        configs.push(config);
      }
    }
  }

  return configs;
}

export async function handleSubscribe(request, env) {
  const corsHeaders = getCorsHeaders();

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!isAuthorized(request, env)) {
    return textResponse('Unauthorized', { status: 401 }, corsHeaders);
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const target = (url.searchParams.get('target') || 'clash').toLowerCase();

  try {
    const configs = await loadConfigs(env, id);

    if (configs.length === 0) {
      return textResponse('No subscriptions found', { status: 404 }, corsHeaders);
    }

    if (target === 'v2ray') {
      return textResponse(buildV2RaySubscription(configs), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'attachment; filename="cf-proxy-panel-v2ray.txt"'
        }
      }, corsHeaders);
    }

    const allProxies = configs
      .map((config) => parseProxyLink(config.url, config.alias))
      .filter(Boolean);

    if (allProxies.length === 0) {
      return textResponse('No valid proxies found', { status: 404 }, corsHeaders);
    }

    const routing = await resolveClashRules(await loadSettings(env));
    return textResponse(stringifyYaml(buildClashConfig(allProxies, routing)), {
      headers: {
        'Content-Type': 'text/yaml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="cf-proxy-panel.yaml"'
      }
    }, corsHeaders);
  } catch (error) {
    console.error('Subscribe error:', error);
    return textResponse('Internal server error', { status: 500 }, corsHeaders);
  }
}
