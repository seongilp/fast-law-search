/**
 * 공개 검색 API — GET /api/search/{검색어}
 *
 * 브라우저/외부 클라이언트 → (이 Pages Function) → api-law.zihado.com(Typesense @ ebs)
 *
 * Typesense 검색 키를 서버 측(Pages 환경변수 TYPESENSE_SEARCH_KEY)에서만 쥐므로
 * 이용자는 키 없이 호출한다. 응답은 Typesense 원형이 아니라 안정적인 자체 스키마로
 * 감싸서 내보낸다(내부 색인 구조가 바뀌어도 외부 계약을 유지하기 위해).
 *
 * 예) /api/search/개인정보?type=laws&page=1&per_page=20
 */

const ORIGIN = "https://api-law.zihado.com";
const CACHE_SECONDS = 300;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;
/** 목록 응답이 비대해지지 않도록 본문은 잘라서 준다(full=1 이면 원문). */
const CONTENT_PREVIEW_CHARS = 500;

const COLLECTIONS = {
  laws: {
    collection: "kr_laws",
    queryBy: "law_name,article_title,content",
    sortBy: "_text_match:desc,article_seq:asc",
  },
  precedents: {
    collection: "kr_precedents",
    queryBy: "case_name,holding,summary,body",
    sortBy: "_text_match:desc,decided_date:desc",
  },
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS,
      ...extraHeaders,
    },
  });
}

function usage(status, error) {
  return json(
    {
      error,
      docs: "https://law.zihado.com/api",
      usage: "GET /api/search/{검색어}",
      params: {
        type: `${Object.keys(COLLECTIONS).join(" | ")} (기본 laws)`,
        page: "1부터 (기본 1)",
        per_page: `1~${MAX_PER_PAGE} (기본 ${DEFAULT_PER_PAGE})`,
        full: "1이면 조문 본문 전체 포함 (기본은 앞부분만)",
      },
      examples: [
        "/api/search/개인정보",
        "/api/search/주택임대차?per_page=5",
        "/api/search/손해배상?type=precedents",
      ],
    },
    status,
  );
}

/**
 * 정수 파라미터. 숫자가 아니면 기본값, 범위를 벗어나면 가장 가까운 경계로 깎는다.
 * (per_page=120 을 요청한 이용자는 20건이 아니라 상한인 100건을 기대한다.)
 */
function intParam(raw, fallback, min, max) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Typesense 하이라이트에서 가장 잘 맞은 조각 하나를 뽑는다(<mark> 포함). */
function pickSnippet(hit) {
  const highlights = Array.isArray(hit?.highlights) ? hit.highlights : [];
  for (const h of highlights) {
    if (typeof h?.snippet === "string" && h.snippet.length > 0) return h.snippet;
  }
  return null;
}

function truncate(text, limit) {
  if (typeof text !== "string") return null;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function mapLaw(doc, full) {
  return {
    law_name: doc.law_name ?? null,
    law_type: doc.law_type ?? null,
    chapter: doc.chapter ?? null,
    article_label: doc.article_label ?? null,
    article_title: doc.article_title ?? null,
    content: full ? (doc.content ?? null) : truncate(doc.content, CONTENT_PREVIEW_CHARS),
    ministry: Array.isArray(doc.ministry) ? doc.ministry : [],
    status: doc.status ?? null,
    promulgation_date: doc.promulgation_date ?? null,
    enforcement_date: doc.enforcement_date ?? null,
    source_url: doc.source_url ?? null,
  };
}

function mapPrecedent(doc, full) {
  return {
    case_name: doc.case_name ?? null,
    case_no: doc.case_no ?? null,
    court: doc.court ?? null,
    case_type: doc.case_type ?? null,
    judgment_type: doc.judgment_type ?? null,
    decided_date: doc.decided_date ?? null,
    holding: full ? (doc.holding ?? null) : truncate(doc.holding, CONTENT_PREVIEW_CHARS),
    summary: full ? (doc.summary ?? null) : truncate(doc.summary, CONTENT_PREVIEW_CHARS),
    body: full ? (doc.body ?? null) : undefined,
    source_url: doc.source_url ?? null,
  };
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestGet({ params, request, env, waitUntil }) {
  // [[query]] 는 경로 세그먼트 배열 — 검색어에 '/' 가 있어도 원형을 복원한다.
  const raw = Array.isArray(params.query) ? params.query.join("/") : (params.query ?? "");
  let q;
  try {
    q = decodeURIComponent(raw).trim();
  } catch {
    return usage(400, "검색어의 URL 인코딩이 올바르지 않습니다.");
  }
  if (!q) return usage(400, "검색어가 필요합니다.");

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "laws";
  const target = COLLECTIONS[type];
  if (!target) {
    return usage(400, `지원하지 않는 type 입니다: ${type}`);
  }

  const page = intParam(url.searchParams.get("page"), 1, 1, 1000);
  const perPage = intParam(
    url.searchParams.get("per_page"),
    DEFAULT_PER_PAGE,
    1,
    MAX_PER_PAGE,
  );
  const full = url.searchParams.get("full") === "1";

  const searchKey = env.TYPESENSE_SEARCH_KEY;
  if (!searchKey) {
    // 배포 환경에 검색 키가 없으면 조용히 빈 결과를 주지 않고 명시적으로 실패시킨다.
    return json({ error: "검색 서비스가 설정되지 않았습니다." }, 503);
  }

  // 엣지 캐시: 같은 질의 반복 시 홈서버(ebs)까지 가지 않는다.
  // 정규화한 파라미터로 키를 만들어 파라미터 순서가 달라도 같은 캐시를 쓴다.
  const cacheKey = new Request(
    `https://law-api-cache/search?${new URLSearchParams({
      q,
      type,
      page: String(page),
      per_page: String(perPage),
      full: full ? "1" : "0",
    })}`,
    { method: "GET" },
  );
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const hit = new Response(cached.body, cached);
    hit.headers.set("x-api-cache", "HIT");
    return hit;
  }

  const upstream = new URL(`${ORIGIN}/collections/${target.collection}/documents/search`);
  upstream.searchParams.set("q", q);
  upstream.searchParams.set("query_by", target.queryBy);
  upstream.searchParams.set("sort_by", target.sortBy);
  upstream.searchParams.set("page", String(page));
  upstream.searchParams.set("per_page", String(perPage));
  upstream.searchParams.set("highlight_affix_num_tokens", "12");

  let upstreamResp;
  try {
    upstreamResp = await fetch(upstream.toString(), {
      headers: { "X-TYPESENSE-API-KEY": searchKey },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });
  } catch {
    return json({ error: "검색 서버에 연결하지 못했습니다." }, 502);
  }

  if (!upstreamResp.ok) {
    // 업스트림 오류 원문(키·내부 경로 포함 가능)을 그대로 노출하지 않는다.
    return json({ error: "검색에 실패했습니다.", status: upstreamResp.status }, 502);
  }

  const data = await upstreamResp.json();
  const hits = Array.isArray(data.hits) ? data.hits : [];
  const mapper = type === "precedents" ? mapPrecedent : mapLaw;

  const found = data.found ?? 0;
  const resp = json(
    {
      query: q,
      type,
      page,
      per_page: perPage,
      total: found,
      total_pages: perPage > 0 ? Math.ceil(found / perPage) : 0,
      took_ms: data.search_time_ms ?? null,
      results: hits.map((hit) => ({
        ...mapper(hit.document ?? {}, full),
        snippet: pickSnippet(hit),
      })),
    },
    200,
    { "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
  );

  waitUntil(cache.put(cacheKey, resp.clone()));
  resp.headers.set("x-api-cache", "MISS");
  return resp;
}
