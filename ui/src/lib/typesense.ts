import TypesenseInstantSearchAdapter from "typesense-instantsearch-adapter";

const env = import.meta.env;

// 운영 기본값. 빌드 환경에서 VITE_* 가 주입되면 그 값이 우선하고,
// 없으면 아래 운영 서버로 동작한다(과거엔 localhost 로 fallback 해서
// 배포본이 검색을 못 했음). search-only 키는 documents:search 권한만 있어
// 브라우저 노출이 안전하다.
const DEFAULTS = {
  host: "146-190-96-6.nip.io",
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
