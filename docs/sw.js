// Modo offline: guarda la app en el celular. Los datos NO pasan por aquí (van directo al Google Sheets).
importScripts('version.js');
const CACHE = 'campo-mango-' + self.APP_VERSION;
const ARCHIVOS = ['./', 'index.html', 'styles.css', 'version.js', 'forms.js', 'app.js', 'tablero.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('campo-mango-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'activar') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // la API va directo a internet
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).catch(() => caches.match('index.html')))
  );
});
