// API 调用工具
async function convertSubscription(backendUrl, url, target = 'clash') {
    const encodedUrl = encodeURIComponent(url);
    const apiUrl = `${backendUrl}/sub?target=${target}&url=${encodedUrl}`;
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        return await response.text();
    } catch (e) {
        console.error('Failed to convert subscription:', e);
        return null;
    }
}

function generateSubscriptionLink(backendUrl, url, target = 'clash', config = '') {
    const encodedUrl = encodeURIComponent(url);
    let link = `${backendUrl}/sub?target=${target}&url=${encodedUrl}`;
    if (config) {
        link += `&config=${encodeURIComponent(config)}`;
    }
    return link;
}

// Cloudflare Workers API
const WORKERS_BASE_URL = 'https://your-worker-url.workers.dev'; // 需要替换为实际的 workers URL

async function convertViaWorkers(url, target = 'clash', config = '') {
    try {
        const response = await fetch(`${WORKERS_BASE_URL}/convert`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, target, config })
        });
        if (!response.ok) {
            throw new Error(`Workers API error: ${response.status}`);
        }
        return await response.text();
    } catch (e) {
        console.error('Failed to convert via workers:', e);
        return null;
    }
}

async function storeProxyConfig(id, config) {
    try {
        const response = await fetch(`${WORKERS_BASE_URL}/store`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, config })
        });
        if (!response.ok) {
            throw new Error(`Store API error: ${response.status}`);
        }
        const result = await response.json();
        return result;
    } catch (e) {
        console.error('Failed to store proxy config:', e);
        return null;
    }
}

function generateShortLink(id) {
    return `${WORKERS_BASE_URL}/link/${id}`;
}