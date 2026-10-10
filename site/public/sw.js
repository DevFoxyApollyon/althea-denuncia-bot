// Service worker do portal: recebe as notificações do servidor e mostra o aviso,
// mesmo com o site fechado. Não guarda páginas em cache.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (evento) => evento.waitUntil(self.clients.claim()));

// Só caminhos do próprio site: a notificação nunca leva para outro endereço.
const caminhoSeguro = (url) => (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/');

self.addEventListener('push', (evento) => {
  let dados = {};
  try { dados = evento.data.json(); } catch { /* aviso sem conteúdo */ }

  evento.waitUntil(self.registration.showNotification(dados.titulo || 'Portal de denúncias', {
    body: dados.corpo || '',
    tag: dados.tag || undefined,
    icon: '/icone-192.png',
    badge: '/icone-192.png',
    data: { url: caminhoSeguro(dados.url) }
  }));
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const url = caminhoSeguro(evento.notification.data?.url);

  evento.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const aberta = janelas.find(janela => new URL(janela.url).origin === self.location.origin);
    if (aberta) {
      await aberta.navigate(url).catch(() => {});
      return aberta.focus();
    }
    return self.clients.openWindow(url);
  })());
});
