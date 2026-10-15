/* Service worker CMS Store Kompas.com (scope /admin/).
   Sengaja minimal: tidak menyimpan halaman atau data apa pun, semua request tetap ke jaringan.
   Dipakai supaya CMS bisa dipasang sebagai aplikasi di HP; notifikasi push & mode offline menyusul. */
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) { return caches.delete(key); }));
    }).then(function () { return self.clients.claim(); })
  );
});
