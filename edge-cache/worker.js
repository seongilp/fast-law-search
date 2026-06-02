/**
 * law.zihado.com 검색 엣지 캐시 프록시.
 *
 * 브라우저 → (이 워커, Cloudflare 엣지) → api-law.zihado.com(Typesense @ DO)
 *
 * 검색 요청(multi_search / documents/search)의 결과를 엣지 Cache API 에 저장한다.
 * - 같은 쿼리 반복 시 드롭릿을 거치지 않고 엣지에서 즉시 응답(부하↓, 지연↓)
 * - 캐시 키 = 경로+쿼리+본문 해시. TTL 경과 시 자동 만료 → 최신 색인 반영.
 * - 그 외 요청은 그대로 패스스루(캐시 안 함).
 */
const ORIGIN = "https://api-law.zihado.com";
const TTL_SECONDS = 3600; // 1시간 (반복 검색 가속 + 신선도 균형)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-TYPESENSE-API-KEY,x-typesense-api-key",
  "Access-Control-Max-Age": "86400",
};

function withCors(resp) {
  const r = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
  return r;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildOriginRequest(request, originUrl, bodyText) {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  // Typesense 검색 전용 키 전달(헤더/쿼리 어느 쪽으로 와도 동작하게 헤더 보존)
  const key = request.headers.get("X-TYPESENSE-API-KEY");
  if (key) headers.set("X-TYPESENSE-API-KEY", key);
  return new Request(originUrl, {
    method: request.method,
    headers,
    body: request.method === "POST" ? bodyText : undefined,
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const originUrl = ORIGIN + url.pathname + url.search;
    const isSearch =
      url.pathname.includes("/multi_search") ||
      url.pathname.includes("/documents/search");

    // 비검색 요청은 캐시 없이 그대로 프록시
    if (!isSearch) {
      const passBody = request.method === "POST" ? await request.text() : undefined;
      const resp = await fetch(buildOriginRequest(request, originUrl, passBody));
      return withCors(resp);
    }

    // 검색: 캐시 키 = 경로+쿼리+본문 해시
    const bodyText = request.method === "POST" ? await request.text() : "";
    const hash = await sha256(`${url.pathname}${url.search}|${bodyText}`);
    const cacheKey = new Request(`https://law-search-cache/${hash}`, { method: "GET" });
    const cache = caches.default;

    const hit = await cache.match(cacheKey);
    if (hit) {
      const r = withCors(hit);
      r.headers.set("x-edge-cache", "HIT");
      return r;
    }

    // MISS → origin 조회
    const originResp = await fetch(buildOriginRequest(request, originUrl, bodyText));

    // 성공 응답만 캐시(에러는 캐시하지 않음)
    if (originResp.ok) {
      const toStore = new Response(originResp.clone().body, originResp);
      toStore.headers.set("Cache-Control", `public, max-age=${TTL_SECONDS}`);
      ctx.waitUntil(cache.put(cacheKey, toStore));
    }

    const out = withCors(originResp);
    out.headers.set("x-edge-cache", "MISS");
    return out;
  },
};
