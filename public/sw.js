// 思维沙盘 Service Worker
const CACHE_NAME = "cognitive-sandbox-v1";

// 需要缓存的静态资源
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// 安装：预缓存核心资源
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 请求拦截：缓存优先，API 请求走网络
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API 请求：网络优先
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // 静态资源：缓存优先
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
      );
    })
  );
});
