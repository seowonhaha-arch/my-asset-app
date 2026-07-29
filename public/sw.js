// ⚠️ 원본 파일은 './sw.js'를 등록만 하고 실제 내용은 없었어요.
// 지금은 "설치는 되지만 아무것도 캐싱하지 않는" 최소 버전입니다.
// 오프라인 캐싱이 필요하면 나중에 vite-plugin-pwa 도입을 추천해요.
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
