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

const CLASH_GROUPS = {
  selector: '🚀 节点选择',
  auto: '♻️ 自动选择',
  foreignMedia: '🌍 国外媒体',
  telegram: '📲 电报信息',
  microsoft: 'Ⓜ️ 微软服务',
  apple: '🍎 苹果服务',
  googleFcm: '📢 谷歌FCM',
  direct: '🎯 全球直连',
  reject: '🛑 全球拦截',
  sanitize: '🍃 应用净化',
  fallback: '🐟 漏网之鱼'
};

const BUILTIN_GROUP_NAMES = new Set(Object.values(CLASH_GROUPS));

const ROUTING_RULES = {
  balanced: [
    `DOMAIN-SUFFIX,local,${CLASH_GROUPS.direct}`,
    `IP-CIDR,127.0.0.0/8,${CLASH_GROUPS.direct}`,
    `IP-CIDR,10.0.0.0/8,${CLASH_GROUPS.direct}`,
    `IP-CIDR,172.16.0.0/12,${CLASH_GROUPS.direct}`,
    `IP-CIDR,192.168.0.0/16,${CLASH_GROUPS.direct}`,
    `IP-CIDR,169.254.0.0/16,${CLASH_GROUPS.direct}`,
    `IP-CIDR,224.0.0.0/4,${CLASH_GROUPS.direct}`,
    `IP-CIDR6,::1/128,${CLASH_GROUPS.direct}`,
    `IP-CIDR6,fc00::/7,${CLASH_GROUPS.direct}`,
    `DOMAIN-SUFFIX,google.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,googleapis.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,gstatic.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,youtube.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,ytimg.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,facebook.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,instagram.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,whatsapp.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,twitter.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,x.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,telegram.org,${CLASH_GROUPS.telegram}`,
    `DOMAIN-SUFFIX,t.me,${CLASH_GROUPS.telegram}`,
    `DOMAIN-SUFFIX,github.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,githubusercontent.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,openai.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,chatgpt.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,anthropic.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,discord.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,netflix.com,${CLASH_GROUPS.foreignMedia}`,
    `GEOIP,CN,${CLASH_GROUPS.direct}`,
    `MATCH,${CLASH_GROUPS.fallback}`
  ],
  blacklist: [
    `DOMAIN-SUFFIX,local,${CLASH_GROUPS.direct}`,
    `IP-CIDR,127.0.0.0/8,${CLASH_GROUPS.direct}`,
    `IP-CIDR,10.0.0.0/8,${CLASH_GROUPS.direct}`,
    `IP-CIDR,172.16.0.0/12,${CLASH_GROUPS.direct}`,
    `IP-CIDR,192.168.0.0/16,${CLASH_GROUPS.direct}`,
    `DOMAIN-SUFFIX,google.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,youtube.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,facebook.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,instagram.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,twitter.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,x.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,telegram.org,${CLASH_GROUPS.telegram}`,
    `DOMAIN-SUFFIX,t.me,${CLASH_GROUPS.telegram}`,
    `DOMAIN-SUFFIX,github.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,openai.com,${CLASH_GROUPS.selector}`,
    `DOMAIN-SUFFIX,chatgpt.com,${CLASH_GROUPS.selector}`,
    `MATCH,${CLASH_GROUPS.direct}`
  ],
  global: [
    `DOMAIN-SUFFIX,local,${CLASH_GROUPS.direct}`,
    `IP-CIDR,127.0.0.0/8,${CLASH_GROUPS.direct}`,
    `IP-CIDR,10.0.0.0/8,${CLASH_GROUPS.direct}`,
    `IP-CIDR,172.16.0.0/12,${CLASH_GROUPS.direct}`,
    `IP-CIDR,192.168.0.0/16,${CLASH_GROUPS.direct}`,
    `MATCH,${CLASH_GROUPS.selector}`
  ],
  direct: [`MATCH,${CLASH_GROUPS.direct}`]
};

export function getClashRules(mode = 'balanced') {
  return ROUTING_RULES[mode] || ROUTING_RULES.balanced;
}

function providerName(index) {
  return `remote_rules_${index + 1}`;
}

function policyForGroup(groupName) {
  const name = String(groupName || '').trim();

  if (!name || /^(proxy|代理)$/i.test(name)) {
    return CLASH_GROUPS.selector;
  }

  if (/直连|direct/i.test(name)) {
    return CLASH_GROUPS.direct;
  }

  if (/净化/i.test(name)) {
    return CLASH_GROUPS.sanitize;
  }

  if (/拦截|拒绝|reject/i.test(name)) {
    return CLASH_GROUPS.reject;
  }

  return name;
}

function parseInlineRule(groupName, rawRule) {
  const policy = policyForGroup(groupName);
  const rule = rawRule.replace(/^\[\]/, '').trim();

  if (!rule || rule.startsWith('#') || rule.startsWith(';')) {
    return '';
  }

  if (/^FINAL$/i.test(rule)) {
    return `MATCH,${policy}`;
  }

  const parts = rule.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.at(-1) === 'no-resolve') {
    return `${parts.slice(0, -1).join(',')},${policy},no-resolve`;
  }

  return `${rule},${policy}`;
}

function parseExtraRuleGroups(extraRuleGroups = []) {
  const rules = [];
  const ruleGroups = [];

  for (const group of extraRuleGroups) {
    const groupName = String(group?.name || '').trim();
    const content = String(group?.content || '');

    if (!groupName || !content.trim()) {
      continue;
    }

    const policy = policyForGroup(groupName);
    ruleGroups.push(policy);

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
        continue;
      }

      const parsed = parseInlineRule(groupName, trimmed);
      if (parsed) {
        rules.push(parsed);
      }
    }
  }

  return { rules, ruleGroups: [...new Set(ruleGroups)] };
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
  const ruleGroups = [];
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
    const policy = policyForGroup(groupName);
    ruleGroups.push(policy);

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
      rules.push(`RULE-SET,${name},${policy}`);
    }
  }

  return { ruleProviders, rules, ruleGroups: [...new Set(ruleGroups)] };
}

async function buildRemoteRules(remoteRuleUrl) {
  if (!remoteRuleUrl) {
    return { rules: getClashRules('balanced'), ruleGroups: Object.values(CLASH_GROUPS) };
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
      `DOMAIN-SUFFIX,local,${CLASH_GROUPS.direct}`,
      `IP-CIDR,127.0.0.0/8,${CLASH_GROUPS.direct}`,
      `IP-CIDR,10.0.0.0/8,${CLASH_GROUPS.direct}`,
      `IP-CIDR,172.16.0.0/12,${CLASH_GROUPS.direct}`,
      `IP-CIDR,192.168.0.0/16,${CLASH_GROUPS.direct}`,
      `RULE-SET,remote_rules,${CLASH_GROUPS.selector}`,
      `GEOIP,CN,${CLASH_GROUPS.direct}`,
      `MATCH,${CLASH_GROUPS.fallback}`
    ],
    ruleGroups: [CLASH_GROUPS.selector, CLASH_GROUPS.direct, CLASH_GROUPS.fallback]
  };
}

export async function resolveClashRules(settings = {}) {
  const extra = parseExtraRuleGroups(settings.extraRuleGroups);

  try {
    const routing = await buildRemoteRules(String(settings.remoteRuleUrl || '').trim());

    return {
      ...routing,
      rules: [...extra.rules, ...(routing.rules || getClashRules('balanced'))],
      ruleGroups: [...new Set([...(extra.ruleGroups || []), ...(routing.ruleGroups || [])])]
    };
  } catch (error) {
    console.error('Failed to load remote rules:', error);
    return {
      rules: [...extra.rules, ...getClashRules('balanced')],
      ruleGroups: extra.ruleGroups
    };
  }
}

function buildClashProxyGroups(proxies, routing = {}) {
  const proxyNames = proxies.map((proxy) => proxy.name);
  const selectable = [CLASH_GROUPS.selector, CLASH_GROUPS.auto, CLASH_GROUPS.direct, ...proxyNames];
  const directFirst = [CLASH_GROUPS.direct, CLASH_GROUPS.selector, ...proxyNames];
  const groups = [
    {
      name: CLASH_GROUPS.selector,
      type: 'select',
      proxies: [CLASH_GROUPS.auto, 'DIRECT', ...proxyNames]
    },
    {
      name: CLASH_GROUPS.auto,
      type: 'url-test',
      url: 'http://www.gstatic.com/generate_204',
      interval: 300,
      tolerance: 50,
      proxies: proxyNames
    },
    {
      name: CLASH_GROUPS.foreignMedia,
      type: 'select',
      proxies: selectable
    },
    {
      name: CLASH_GROUPS.telegram,
      type: 'select',
      proxies: directFirst
    },
    {
      name: CLASH_GROUPS.microsoft,
      type: 'select',
      proxies: directFirst
    },
    {
      name: CLASH_GROUPS.apple,
      type: 'select',
      proxies: directFirst
    },
    {
      name: CLASH_GROUPS.googleFcm,
      type: 'select',
      proxies: selectable
    },
    {
      name: CLASH_GROUPS.direct,
      type: 'select',
      proxies: ['DIRECT', CLASH_GROUPS.selector, CLASH_GROUPS.auto]
    },
    {
      name: CLASH_GROUPS.reject,
      type: 'select',
      proxies: ['REJECT', 'DIRECT']
    },
    {
      name: CLASH_GROUPS.sanitize,
      type: 'select',
      proxies: ['REJECT', 'DIRECT']
    }
  ];

  const usedNames = new Set(groups.map((group) => group.name));
  for (const name of routing.ruleGroups || []) {
    if (!name || usedNames.has(name) || name === 'DIRECT' || name === 'REJECT') {
      continue;
    }

    groups.push({
      name,
      type: 'select',
      proxies: selectable
    });
    usedNames.add(name);
  }

  if (!usedNames.has(CLASH_GROUPS.fallback)) {
    groups.push({
      name: CLASH_GROUPS.fallback,
      type: 'select',
      proxies: selectable
    });
  }

  return groups.filter((group) => BUILTIN_GROUP_NAMES.has(group.name) || group.proxies.length > 0);
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
    'proxy-groups': buildClashProxyGroups(proxies, routing),
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
