// 웹 UI 접속 설정. 운영 시 SEARCH_ONLY_KEY 는 반드시 검색 전용(scoped) 키로 교체하세요.
window.LEGALIZE_CONFIG = {
  host: "localhost",
  port: "8108",
  protocol: "http",
  // 검색 전용 키 (.env 의 TYPESENSE_SEARCH_ONLY_KEY 와 동일하게)
  searchOnlyApiKey: "legalize_dev_key",
  collection: "kr_laws",
};
