/* Service worker do Trainer de Xadrez: guarda o app no aparelho para funcionar sem internet.
   Estratégia: tenta a internet primeiro (para pegar atualizações) e, se não houver conexão,
   usa a cópia guardada. */
const CACHE = 'trainer-xadrez-v27';
const ARQUIVOS = ['./', './index.html', './manifest.json', './icone-192.png', './icone-512.png', './config.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ARQUIVOS.map(a => c.add(a).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;   // nuvem (Firebase) sempre pela internet
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // cache: 'no-cache' pergunta ao site se há versão nova (sem isso o navegador usava a cópia velha por até 10 min)
      const resp = await Promise.race([fetch(req, { cache: 'no-cache' }), new Promise((_, rej) => setTimeout(() => rej(new Error('lento')), 5000))]);
      if (resp && resp.ok) cache.put(req, resp.clone());
      return resp;
    } catch (err) {
      const salvo = await cache.match(req, { ignoreSearch: true });
      if (salvo) return salvo;
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || (await cache.match('./'));
      return new Response('', { status: 504 });
    }
  })());
});
