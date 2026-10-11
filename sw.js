/* EvoBuskin - Service Worker
   Met en cache tous les fichiers de l'application pour qu'elle marche SANS Internet.
   IMPORTANT : quand vous modifiez un fichier, changez le numéro de VERSION ci-dessous
   pour que les téléphones téléchargent la nouvelle version. */
const VERSION = 'evobuskin-v1.3.2';
const FICHIERS = [
  './js/auth-config.js', './js/auth.js', './js/auth-ui.js', './js/cloud-db.js',
'./js/sync.js', './js/security-monitor.js', './js/subscriptions.js',

// Installation : on télécharge tous les fichiers dans le cache
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

// Activation : on supprime les anciens caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Requêtes : le cache d'abord (rapide, hors connexion), sinon le réseau
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((reponse) => {
      if (reponse) return reponse;
      return fetch(e.request).catch(() => {
        // Hors connexion et fichier inconnu : on renvoie la page d'accueil
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'Hors connexion' });
      });
    })
  );
});
