import { handleStore } from './src/store.js';
import { handleSubscribe } from './src/subscribe.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/store')) {
      return handleStore(request, env);
    }

    if (url.pathname === '/subscribe') {
      return handleSubscribe(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
