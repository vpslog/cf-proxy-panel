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

function providerName(index) {
  return `remote_rules_${index + 1}`;
}

function policyForGroup(groupName) {
  if (/拦截|净化|reject/i.test(groupName)) {
    return 'REJECT';
  }

  if (/直连|direct/i.test(groupName)) {
    return 'DIRECT';
  }

  return 'Proxy';
}

function parseInlineRule(groupName, rawRule) {
  const policy = policyForGroup(groupName);
  const rule = rawRule.replace(/^\[\]/, '').trim();

  if (/^FINAL$/i.test(rule)) {
    return policy === 'DIRECT' ? 'MATCH,DIRECT' : 'MATCH,Proxy';
  }

  const parts = rule.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.at(-1) === 'no-resolve') {
    return `${parts.slice(0, -1).join(',')},${policy},no-resolve`;
  }

  return `${rule},${policy}`;
}

async function fetchRemoteText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'cf-proxy-panel' }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch remote rules: ${response.status}`);
  }

  return response.text();
}

function parseAcl4ssrConfig(text) {
  const ruleProviders = {};
  const rules = [];
  let providerIndex = 0;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || !trimmed.startsWith('ruleset=')) {
      continue;
    }

    const value = trimmed.slice('ruleset='.length);
    const commaIndex = value.indexOf(',');
    if (commaIndex < 0) {
      continue;
    }

    const groupName = value.slice(0, commaIndex).trim();
    const target = value.slice(commaIndex + 1).trim();

    if (target.startsWith('[]')) {
      rules.push(parseInlineRule(groupName, target));
      continue;
    }

    if (/^https?:\/\//i.test(target)) {
      const [ruleUrl] = target.split(',');
      const name = providerName(providerIndex);
      providerIndex += 1;
      ruleProviders[name] = {
        type: 'http',
        behavior: 'classical',
        url: ruleUrl.trim(),
        path: `./ruleset/${name}.yaml`,
        interval: 86400
      };
      rules.push(`RULE-SET,${name},${policyForGroup(groupName)}`);
    }
  }

  return { ruleProviders, rules };
}

async function buildRemoteRules(remoteRuleUrl) {
  if (!remoteRuleUrl) {
    return { rules: getClashRules('balanced') };
  }

  if (/\.ini($|\?)/i.test(remoteRuleUrl)) {
    const parsed = parseAcl4ssrConfig(await fetchRemoteText(remoteRuleUrl));
    if (parsed.rules.length > 0) {
      return parsed;
    }
  }

  return {
    ruleProviders: {
      remote_rules: {
        type: 'http',
        behavior: 'classical',
        url: remoteRuleUrl,
        path: './ruleset/remote_rules.yaml',
        interval: 86400
      }
    },
    rules: [
      'DOMAIN-SUFFIX,local,DIRECT',
      'IP-CIDR,127.0.0.0/8,DIRECT',
      'IP-CIDR,10.0.0.0/8,DIRECT',
      'IP-CIDR,172.16.0.0/12,DIRECT',
      'IP-CIDR,192.168.0.0/16,DIRECT',
      'RULE-SET,remote_rules,Proxy',
      'GEOIP,CN,DIRECT',
      'MATCH,Proxy'
    ]
  };
}

export async function resolveClashRules(settings = {}) {
  try {
    return await buildRemoteRules(String(settings.remoteRuleUrl || '').trim());
  } catch (error) {
    console.error('Failed to load remote rules:', error);
    return { rules: getClashRules('balanced') };
  }
}

export function buildClashConfig(proxies, routing = {}) {
  const config = {
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
    rules: routing.rules || getClashRules('balanced')
  };

  if (routing.ruleProviders && Object.keys(routing.ruleProviders).length > 0) {
    config['rule-providers'] = routing.ruleProviders;
  }

  return config;
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
