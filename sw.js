/* AIVA Caisse - Service Worker
   Met en cache tous les fichiers de l'application pour qu'elle marche SANS Internet.
   IMPORTANT : quand vous modifiez un fichier, changez le numéro de VERSION ci-dessous
   pour que les téléphones téléchargent la nouvelle version. */
const VERSION = 'aiva-caisse-v1.1.0';
const FICHIERS = [
  './', './index.html', './manifest.webmanifest',
  './css/style.css',
  './js/utils.js', './js/db.js', './js/audit.js', './js/pdf.js', './js/coffre.js',
  './js/imprimante.js', './js/scanner.js', './js/demo.js',
  './js/vue-caisse.js', './js/vue-stock.js', './js/vue-dettes.js', './js/vue-depenses.js',
  './js/vue-achats.js', './js/vue-import.js', './js/vue-audit.js', './js/vue-rapports.js',
  './js/vue-plus.js', './js/vue-reglages.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

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
