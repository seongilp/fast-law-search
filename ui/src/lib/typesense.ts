import TypesenseInstantSearchAdapter from "typesense-instantsearch-adapter";

const env = import.meta.env;

export const COLLECTION =
  (env.VITE_TYPESENSE_COLLECTION as string) || "kr_laws";

const adapter = new TypesenseInstantSearchAdapter({
  server: {
    apiKey: (env.VITE_TYPESENSE_SEARCH_KEY as string) || "legalize_dev_key",
    nodes: [
      {
        host: (env.VITE_TYPESENSE_HOST as string) || "localhost",
        port: Number(env.VITE_TYPESENSE_PORT) || 8108,
        protocol: (env.VITE_TYPESENSE_PROTOCOL as string) || "http",
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

const TS_HOST = (env.VITE_TYPESENSE_HOST as string) || "localhost";
const TS_PORT = Number(env.VITE_TYPESENSE_PORT) || 8108;
const TS_PROTO = (env.VITE_TYPESENSE_PROTOCOL as string) || "http";
const TS_KEY = (env.VITE_TYPESENSE_SEARCH_KEY as string) || "legalize_dev_key";

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
