// Service worker VTB : coquille de l'app en cache pour l'usage hors ligne.
// Les données de l'app sont dans IndexedDB : ce cache ne concerne que les fichiers statiques.
//
// À CHAQUE déploiement : incrémenter CACHE_NAME (v5 -> v6...).
const CACHE_NAME = 'vtb-pwa-v8';
const APP_SHELL = [
    './',
    './manifest.json',
    './assets/icon-192.png',
    './assets/icon-512.png'
];

// Mettre à false si les libs (exceljs, jspdf, autotable) sont EMBARQUÉES dans index.html.
// Mettre à true si index.html les charge depuis cdnjs : sans ça, Excel/PDF ne marchent pas hors ligne.
// (Les réponses CDN "opaques" ne sont jamais mises en cache par le code générique plus bas.)
const PRECACHE_CDN_LIBS = false;
const CDN_LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];

// Réseau instable (zone mal couverte) : au-delà de ce délai on ouvre la copie en cache
// au lieu de laisser l'écran blanc.
const NAV_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        // index.html est OBLIGATOIRE : s'il échoue, l'installation échoue et l'ancien SW reste actif
        // (plus de SW "installé" sans page en cache = plus d'app hors ligne sans le savoir).
        await cache.add('./index.html');
        // le reste : un par un, un fichier manquant (icône...) ne bloque pas l'installation
        await Promise.all(APP_SHELL.map((u) => cache.add(u).catch(() => {})));
        if (PRECACHE_CDN_LIBS) {
            // mode cors : réponse lisible/cachable (une balise <script> sans crossorigin reçoit une réponse opaque)
            await Promise.all(CDN_LIBS.map((u) => cache.add(new Request(u, { mode: 'cors' })).catch(() => {})));
        }
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    // PAGE : réseau d'abord (nouvelle version dès le 1er lancement en ligne), MAIS avec délai max.
    // Hors ligne ou réseau trop lent -> copie en cache.
    if (req.mode === 'navigate' || req.destination === 'document') {
        const refreshed = fetch(req).then((response) => {
            if (response && response.status === 200) {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy));
            }
            return response;
        });
        refreshed.catch(() => {});
        event.waitUntil(refreshed.catch(() => {})); // laisse finir la mise à jour du cache même si le délai a été dépassé
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS));
        event.respondWith(
            Promise.race([refreshed, timeout]).catch(() =>
                caches.match('./index.html')
                    .then((r) => r || caches.match('./'))
                    .then((r) => r || refreshed) // aucune copie (1re visite) : on attend le réseau
            )
        );
        return;
    }

    // RESTE (manifest, icônes, libs) : cache d'abord, mise à jour silencieuse.
    event.respondWith(
        caches.match(req).then((cached) => {
            const network = fetch(req).then((response) => {
                if (response && response.status === 200) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(req, copy));
                }
                return response;
            }).catch(() => cached);
            return cached || network;
        })
    );
});
