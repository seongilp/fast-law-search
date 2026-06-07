import TypesenseInstantSearchAdapter from "typesense-instantsearch-adapter";

const env = import.meta.env;

// 운영 기본값. 빌드 환경에서 VITE_* 가 주입되면 그 값이 우선하고,
// 없으면 아래 운영 서버로 동작한다(과거엔 localhost 로 fallback 해서
// 배포본이 검색을 못 했음). search-only 키는 documents:search 권한만 있어
// 브라우저 노출이 안전하다.
const DEFAULTS = {
  host: "api-law.zihado.com",
  port: 443,
  protocol: "https",
  searchKey: "vOivZ7H3LZN2KgfbJyazlNyAGnsPlxj2",
  collection: "kr_laws",
};

export const COLLECTION =
  (env.VITE_TYPESENSE_COLLECTION as string) || DEFAULTS.collection;

const adapter = new TypesenseInstantSearchAdapter({
  server: {
    apiKey: (env.VITE_TYPESENSE_SEARCH_KEY as string) || DEFAULTS.searchKey,
    nodes: [
      {
        host: (env.VITE_TYPESENSE_HOST as string) || DEFAULTS.host,
        port: Number(env.VITE_TYPESENSE_PORT) || DEFAULTS.port,
        protocol: (env.VITE_TYPESENSE_PROTOCOL as string) || DEFAULTS.protocol,
      },
    ],
    cacheSearchResultsForSeconds: 120,
  },
  additionalSearchParameters: {
    query_by: "content,article_title,law_name,chapter",
    query_by_weights: "3,5,4,1",
    highlight_full_fields: "content,article_title,law_name",
    highlight_affix_num_tokens: 16,
    num_typos: "1",
    sort_by: "_text_match:desc,article_seq:asc",
  },
});

export const searchClient = adapter.searchClient;

// ── 판례(precedents) ─────────────────────────────────────────────
export const PREC_COLLECTION =
  (env.VITE_TYPESENSE_PREC_COLLECTION as string) || "kr_precedents";

const precAdapter = new TypesenseInstantSearchAdapter({
  server: {
    apiKey: (env.VITE_TYPESENSE_SEARCH_KEY as string) || DEFAULTS.searchKey,
    nodes: [
      {
        host: (env.VITE_TYPESENSE_HOST as string) || DEFAULTS.host,
        port: Number(env.VITE_TYPESENSE_PORT) || DEFAULTS.port,
        protocol: (env.VITE_TYPESENSE_PROTOCOL as string) || DEFAULTS.protocol,
      },
    ],
    cacheSearchResultsForSeconds: 120,
  },
  additionalSearchParameters: {
    query_by: "case_name,holding,summary,body,refs_article",
    query_by_weights: "5,4,4,2,1",
    highlight_full_fields: "case_name,holding,summary",
    highlight_affix_num_tokens: 16,
    num_typos: "1",
    sort_by: "_text_match:desc,decided_date:desc",
  },
});

export const precSearchClient = precAdapter.searchClient;

/** 판례 검색 도큐먼트 타입 */
export interface PrecHit {
  id: string;
  serial?: string;
  case_name: string;
  case_no?: string;
  court?: string;
  case_type?: string;
  judgment_type?: string;
  decided_date: number;
  decided_year?: string;
  holding?: string;
  summary?: string;
  body?: string;
  refs_article?: string;
  source_url?: string;
  file_path?: string;
}

const TS_HOST = (env.VITE_TYPESENSE_HOST as string) || DEFAULTS.host;
const TS_PORT = Number(env.VITE_TYPESENSE_PORT) || DEFAULTS.port;
const TS_PROTO = (env.VITE_TYPESENSE_PROTOCOL as string) || DEFAULTS.protocol;
const TS_KEY = (env.VITE_TYPESENSE_SEARCH_KEY as string) || DEFAULTS.searchKey;

/**
 * 커맨드 팔레트용 경량 라이브 검색. InstantSearch 와 별개로
 * Typesense multi_search 를 직접 호출해 상위 결과를 즉시 가져온다.
 */
export async function quickSearch(
  query: string,
  perPage = 7,
  signal?: AbortSignal
): Promise<LawHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = `${TS_PROTO}://${TS_HOST}:${TS_PORT}/multi_search?x-typesense-api-key=${encodeURIComponent(
    TS_KEY
  )}`;
  const res = await fetch(url, {
    method: "POST",
    signal,
    body: JSON.stringify({
      searches: [
        {
          collection: COLLECTION,
          q: trimmed,
          query_by: "content,article_title,law_name,chapter",
          query_by_weights: "3,5,4,1",
          sort_by: "_text_match:desc,article_seq:asc",
          per_page: perPage,
          highlight_full_fields: "",
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Typesense ${res.status}`);
  const json = await res.json();
  const hits = json?.results?.[0]?.hits ?? [];
  return hits.map((h: { document: LawHit }) => h.document);
}

/**
 * 전체 코퍼스 규모(인덱싱된 총 조문 수)를 가볍게 조회한다.
 * 빈 검색(q=*) 의 found 만 받으므로 per_page=0 으로 본문 전송 없음.
 * 랜딩 카피에 "법령·행정규칙 등 N개 조문" 으로 라이브 표기 → 매일 자동 갱신.
 */
export async function fetchTotalArticles(signal?: AbortSignal): Promise<number> {
  const url = `${TS_PROTO}://${TS_HOST}:${TS_PORT}/multi_search?x-typesense-api-key=${encodeURIComponent(
    TS_KEY
  )}`;
  const res = await fetch(url, {
    method: "POST",
    signal,
    body: JSON.stringify({
      searches: [
        { collection: COLLECTION, q: "*", query_by: "content", per_page: 0 },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Typesense ${res.status}`);
  const json = await res.json();
  return Number(json?.results?.[0]?.found ?? 0);
}

/** 검색 도큐먼트(조문) 타입 */
export interface LawHit {
  id: string;
  content: string;
  article_title?: string;
  law_name: string;
  chapter?: string;
  law_type: string;
  ministry?: string[];
  status?: string;
  article_label?: string;
  article_no: number;
  article_seq: number;
  promulgation_date?: number;
  enforcement_date?: number;
  law_dir?: string;
  mst?: string;
  source_url?: string;
  file_path?: string;
}
