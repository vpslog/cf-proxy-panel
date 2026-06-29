export function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Auth-Token'
  };
}

function extractToken(request) {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get('token');
  const headerToken = request.headers.get('X-Auth-Token');
  const authHeader = request.headers.get('Authorization') || '';

  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return headerToken || queryToken || '';
}

export function isAuthorized(request, env) {
  if (!env.AUTH_TOKEN) {
    return true;
  }

  return extractToken(request) === env.AUTH_TOKEN;
}

export function unauthorizedResponse(headers = getCorsHeaders()) {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}
