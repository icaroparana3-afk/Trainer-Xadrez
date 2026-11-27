/* Service worker do TrainerX: guarda o app no aparelho para funcionar sem internet.
   Estratégia: tenta a internet primeiro (para pegar atualizações) e, se não houver conexão,
   usa a cópia guardada. Também mostra as notificações e o lembrete diário (sem servidor). */
const CACHE = 'trainer-xadrez-v56';
const ESTADO = 'trainer-xadrez-estado';          // o que o app deixa para o lembrete (não é apagado nas atualizações)
const ARQUIVOS = ['./', './index.html', './manifest.json', './icone-192.png', './icone-512.png', './icone-maskable-512.png', './apple-touch-icon.png', './privacidade.html', './config.js',
  // v51: motor e baús saíram do index.html; são guardados aqui para o jogo continuar funcionando sem internet
  './motor.js', './stockfish.js', './stockfish.wasm',
  ...['madeira', 'prata', 'real'].flatMap(b => [`./bau-${b}-fechado.webp`, `./bau-${b}-aberto.webp`])];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ARQUIVOS.map(a => c.add(a).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== ESTADO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;   // nuvem (Firebase) sempre pela internet
  if (/\/musicas\/|\.(mp3|ogg|flac)$/i.test(new URL(req.url).pathname)) return;   // v49: músicas da rádio vão direto (são grandes e tocam aos pedaços), estejam onde estiverem
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

/* tocar numa notificação: volta para o app (ou abre) e vai para a tela certa */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const ir = e.notification.data && e.notification.data.ir;
  e.waitUntil((async () => {
    const lista = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = lista.find(x => new URL(x.url).origin === self.location.origin);
    if (c) { await c.focus(); if (ir) c.postMessage({ tipo: 'ir', ir }); return; }
    await self.clients.openWindow('./' + (ir ? '#ir=' + ir : ''));
  })());
});

/* lembrete diário (Android, app instalado): o celular acorda o app de vez em quando */
const dia = (t = new Date()) => t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
/* decide se lembra e com que texto (null = não lembra agora) */
function decidir(st, agora) {
  if (!st || !st.on) return null;
  const hoje = dia(agora), ontem = dia(new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1));
  if (st.ultimo === hoje || st.avisado === hoje) return null;     // já jogou hoje ou já foi lembrado
  if (agora.getHours() < 9 || agora.getHours() >= 21) return null; // não incomoda de madrugada
  const emRisco = st.ultimo === ontem && st.atual >= 2;
  return { titulo: emRisco ? `Sua sequência de ${st.atual} dias` : 'TrainerX',
    corpo: emRisco ? 'Jogue hoje para não perder a sequência!' : 'O desafio do dia já está esperando por você.', ir: 'diario' };
}
async function lembrar(soDecidir, hora) {
  const c = await caches.open(ESTADO), r = await c.match('estado.json'); if (!r) return null;
  const st = await r.json(), agora = new Date();
  if (hora != null) agora.setHours(hora, 0, 0, 0);
  const n = decidir(st, agora); if (!n || soDecidir) return n;
  await self.registration.showNotification(n.titulo, { body: n.corpo, tag: 'lembrete', icon: 'icone-192.png', badge: 'icone-192.png', data: { ir: n.ir } });
  st.avisado = dia(agora);
  await c.put('estado.json', new Response(JSON.stringify(st), { headers: { 'content-type': 'application/json' } }));
  return n;
}
self.addEventListener('periodicsync', e => { if (e.tag === 'lembrete') e.waitUntil(lembrar().catch(() => null)); });
/* usado pelos testes: diz o que o lembrete faria, sem mostrar nada */
self.addEventListener('message', e => {
  if (e.data && e.data.tipo === 'testar-lembrete') e.waitUntil(lembrar(true, e.data.hora).catch(() => null).then(n => e.source && e.source.postMessage({ tipo: 'lembrete', nota: n })));
});
