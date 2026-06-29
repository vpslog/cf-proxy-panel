function safeDecode(value = '') {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function base64Decode(value) {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return atob(padded);
}

export function base64Encode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function dropUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(dropUndefined);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined && entryValue !== '')
        .map(([key, entryValue]) => [key, dropUndefined(entryValue)])
    );
  }

  return value;
}

function parseVlessLink(link, fallbackName) {
  try {
    const urlPart = link.replace('vless://', '');
    const [uuidHost, queryHash = ''] = urlPart.split('?');
    const [uuid, hostPort] = uuidHost.split('@');
    const [host, port = '443'] = hostPort.split(':');
    const [query = '', hash = ''] = queryHash.split('#');
    const params = new URLSearchParams(query);
    const network = params.get('type') || 'tcp';

    return dropUndefined({
      name: fallbackName || safeDecode(hash) || host,
      server: host,
      port: parseInt(port, 10) || 443,
      type: 'vless',
      uuid,
      tls: params.get('security') !== 'none',
      flow: params.get('flow') || undefined,
      network,
      'reality-opts': params.get('security') === 'reality'
        ? {
            'public-key': params.get('pbk'),
            'short-id': params.get('sid') || ''
          }
        : undefined,
      'client-fingerprint': params.get('fp') || undefined,
      servername: params.get('sni') || host,
      'ws-opts': network === 'ws'
        ? {
            path: params.get('path') || '/',
            headers: params.get('host') ? { Host: params.get('host') } : undefined
          }
        : undefined,
      udp: true
    });
  } catch (e) {
    console.error('Failed to parse vless link:', e);
    return null;
  }
}

function parseVmessLink(link, fallbackName) {
  try {
    const jsonStr = base64Decode(link.replace('vmess://', ''));
    const config = JSON.parse(jsonStr);
    const network = config.net || 'tcp';

    return dropUndefined({
      name: fallbackName || config.ps || config.add,
      server: config.add,
      port: parseInt(config.port, 10),
      type: 'vmess',
      uuid: config.id,
      alterId: parseInt(config.aid, 10) || 0,
      cipher: config.scy || 'auto',
      tls: config.tls === 'tls',
      network,
      'ws-opts': network === 'ws'
        ? {
            path: config.path || '/',
            headers: { Host: config.host || config.add }
          }
        : undefined,
      udp: true
    });
  } catch (e) {
    console.error('Failed to parse vmess link:', e);
    return null;
  }
}

export function parseProxyLink(link, name) {
  const trimmed = String(link || '').trim();

  if (trimmed.startsWith('vless://')) {
    return parseVlessLink(trimmed, name);
  }

  if (trimmed.startsWith('vmess://')) {
    return parseVmessLink(trimmed, name);
  }

  return null;
}

export function stringifyYaml(value, indent = 0) {
  const spaces = ' '.repeat(indent);

  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === 'object') {
        const nested = stringifyYaml(item, indent + 2).trimStart();
        return `${spaces}- ${nested}`;
      }

      return `${spaces}- ${String(item)}\n`;
    }).join('');
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, entryValue]) => {
      if (entryValue && typeof entryValue === 'object') {
        return `${spaces}${key}:\n${stringifyYaml(entryValue, indent + 2)}`;
      }

      return `${spaces}${key}: ${String(entryValue)}\n`;
    }).join('');
  }

  return `${spaces}${String(value)}\n`;
}

const ROUTING_RULES = {
  balanced: [
    'DOMAIN-SUFFIX,local,DIRECT',
    'IP-CIDR,127.0.0.0/8,DIRECT',
    'IP-CIDR,10.0.0.0/8,DIRECT',
    'IP-CIDR,172.16.0.0/12,DIRECT',
    'IP-CIDR,192.168.0.0/16,DIRECT',
    'IP-CIDR,169.254.0.0/16,DIRECT',
    'IP-CIDR,224.0.0.0/4,DIRECT',
    'IP-CIDR6,::1/128,DIRECT',
    'IP-CIDR6,fc00::/7,DIRECT',
    'DOMAIN-SUFFIX,google.com,Proxy',
    'DOMAIN-SUFFIX,googleapis.com,Proxy',
    'DOMAIN-SUFFIX,gstatic.com,Proxy',
    'DOMAIN-SUFFIX,youtube.com,Proxy',
    'DOMAIN-SUFFIX,ytimg.com,Proxy',
    'DOMAIN-SUFFIX,facebook.com,Proxy',
    'DOMAIN-SUFFIX,instagram.com,Proxy',
    'DOMAIN-SUFFIX,whatsapp.com,Proxy',
    'DOMAIN-SUFFIX,twitter.com,Proxy',
    'DOMAIN-SUFFIX,x.com,Proxy',
    'DOMAIN-SUFFIX,telegram.org,Proxy',
    'DOMAIN-SUFFIX,t.me,Proxy',
    'DOMAIN-SUFFIX,github.com,Proxy',
    'DOMAIN-SUFFIX,githubusercontent.com,Proxy',
    'DOMAIN-SUFFIX,openai.com,Proxy',
    'DOMAIN-SUFFIX,chatgpt.com,Proxy',
    'DOMAIN-SUFFIX,anthropic.com,Proxy',
    'DOMAIN-SUFFIX,discord.com,Proxy',
    'DOMAIN-SUFFIX,netflix.com,Proxy',
    'GEOIP,CN,DIRECT',
    'MATCH,Proxy'
  ],
  blacklist: [
    'DOMAIN-SUFFIX,local,DIRECT',
    'IP-CIDR,127.0.0.0/8,DIRECT',
    'IP-CIDR,10.0.0.0/8,DIRECT',
    'IP-CIDR,172.16.0.0/12,DIRECT',
    'IP-CIDR,192.168.0.0/16,DIRECT',
    'DOMAIN-SUFFIX,google.com,Proxy',
    'DOMAIN-SUFFIX,youtube.com,Proxy',
    'DOMAIN-SUFFIX,facebook.com,Proxy',
    'DOMAIN-SUFFIX,instagram.com,Proxy',
    'DOMAIN-SUFFIX,twitter.com,Proxy',
    'DOMAIN-SUFFIX,x.com,Proxy',
    'DOMAIN-SUFFIX,telegram.org,Proxy',
    'DOMAIN-SUFFIX,t.me,Proxy',
    'DOMAIN-SUFFIX,github.com,Proxy',
    'DOMAIN-SUFFIX,openai.com,Proxy',
    'DOMAIN-SUFFIX,chatgpt.com,Proxy',
    'MATCH,DIRECT'
  ],
  global: [
    'DOMAIN-SUFFIX,local,DIRECT',
    'IP-CIDR,127.0.0.0/8,DIRECT',
    'IP-CIDR,10.0.0.0/8,DIRECT',
    'IP-CIDR,172.16.0.0/12,DIRECT',
    'IP-CIDR,192.168.0.0/16,DIRECT',
    'MATCH,Proxy'
  ],
  direct: ['MATCH,DIRECT']
};

export function getClashRules(mode = 'balanced') {
  return ROUTING_RULES[mode] || ROUTING_RULES.balanced;
}

export function buildClashConfig(proxies, ruleMode = 'balanced') {
  return {
    port: 7890,
    'socks-port': 7891,
    'allow-lan': true,
    mode: 'Rule',
    'log-level': 'info',
    'external-controller': ':9090',
    proxies,
    'proxy-groups': [
      {
        name: 'Proxy',
        type: 'select',
        proxies: proxies.map((proxy) => proxy.name)
      }
    ],
    rules: getClashRules(ruleMode)
  };
}

export function buildV2RaySubscription(configs) {
  const links = configs
    .map((config) => String(config.url || '').trim())
    .filter((url) => url.startsWith('vmess://') || url.startsWith('vless://'));

  return base64Encode(links.join('\n'));
}

export function convertSubscriptionToClash(subscriptionText) {
  try {
    const decoded = base64Decode(subscriptionText);
    const links = decoded.split('\n').filter((link) => link.trim());
    const proxies = links.map((link) => parseProxyLink(link)).filter(Boolean);

    if (proxies.length === 0) {
      return null;
    }

    return stringifyYaml(buildClashConfig(proxies));
  } catch (e) {
    console.error('Failed to convert subscription:', e);
    return null;
  }
}
