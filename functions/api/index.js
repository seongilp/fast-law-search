/**
 * 공개 API 사용 안내 — GET /api
 *
 * 검색 API(/api/search/{검색어})의 사용법을 사람이 읽을 수 있는 형태로 제공한다.
 * UI 빌드와 무관하게 Function 이 직접 서빙하므로, API 코드가 바뀌면 이 파일만
 * 함께 고치면 되고 문서와 구현이 갈라지지 않는다.
 */

const CACHE_SECONDS = 3600;

const PAGE = String.raw`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>검색 API 안내 · 대한민국 법령 검색</title>
<meta name="description" content="법령·판례를 키 없이 조회하는 공개 JSON 검색 API 사용 안내">
<style>
  :root {
    --bg: #ffffff;
    --fg: #0f172a;
    --muted: #64748b;
    --line: #e2e8f0;
    --card: #f8fafc;
    --accent: #2563eb;
    --accent-soft: #eff6ff;
    --code-bg: #0f172a;
    --code-fg: #e2e8f0;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b1120;
      --fg: #e2e8f0;
      --muted: #94a3b8;
      --line: #1e293b;
      --card: #111c33;
      --accent: #60a5fa;
      --accent-soft: #14243f;
      --code-bg: #070d1a;
      --code-fg: #cbd5e1;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo",
      "Segoe UI", Roboto, "Malgun Gothic", sans-serif;
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 820px; margin: 0 auto; padding: 56px 24px 96px; }
  header { text-align: center; margin-bottom: 48px; }
  .badge {
    display: inline-grid; place-items: center;
    width: 60px; height: 60px; border-radius: 16px;
    background: var(--accent-soft); font-size: 28px; margin-bottom: 18px;
  }
  h1 { font-size: 2rem; font-weight: 800; margin: 0 0 10px; letter-spacing: -0.02em; }
  .lead { color: var(--muted); margin: 0; font-size: 0.98rem; }
  h2 {
    font-size: 1.15rem; font-weight: 700; margin: 44px 0 14px;
    padding-bottom: 8px; border-bottom: 1px solid var(--line);
  }
  p { margin: 0 0 14px; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.88em; background: var(--card);
    border: 1px solid var(--line); border-radius: 6px; padding: 2px 6px;
  }
  pre {
    background: var(--code-bg); color: var(--code-fg);
    border-radius: 12px; padding: 18px 20px; overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.86rem; line-height: 1.6; margin: 0 0 16px;
  }
  pre code { background: none; border: 0; padding: 0; font-size: inherit; color: inherit; }
  .endpoint {
    background: var(--accent-soft); border: 1px solid var(--line);
    border-radius: 12px; padding: 16px 20px; margin-bottom: 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.95rem; overflow-x: auto; white-space: nowrap;
  }
  .method { color: var(--accent); font-weight: 700; margin-right: 10px; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 16px; font-size: 0.92rem; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 0.85rem; }
  td:first-child { white-space: nowrap; }
  .tbl-wrap { overflow-x: auto; }
  .try { margin: 6px 0 20px; }
  .try a {
    display: inline-block; color: var(--accent); text-decoration: none;
    border: 1px solid var(--line); border-radius: 999px;
    padding: 6px 14px; margin: 0 8px 8px 0; font-size: 0.88rem;
    background: var(--bg); transition: background .15s, border-color .15s;
  }
  .try a:hover { background: var(--accent-soft); border-color: var(--accent); }
  .note {
    background: var(--card); border-left: 3px solid var(--accent);
    border-radius: 0 8px 8px 0; padding: 12px 16px; margin: 0 0 16px;
    color: var(--muted); font-size: 0.9rem;
  }
  footer {
    margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--line);
    text-align: center; color: var(--muted); font-size: 0.85rem;
  }
  a { color: var(--accent); }
</style>
</head>
<body>
<div class="wrap">

<header>
  <div class="badge">⚖️</div>
  <h1>검색 API</h1>
  <p class="lead">대한민국 법령·행정규칙·판례를 <strong>키 없이</strong> 조회하는 공개 JSON API</p>
</header>

<h2>엔드포인트</h2>
<div class="endpoint"><span class="method">GET</span>https://law.zihado.com/api/search/{검색어}</div>
<p class="note">인증이 필요 없습니다. CORS가 열려 있어 브라우저에서 바로 호출할 수 있습니다.</p>

<div class="try">
  <a href="/api/search/개인정보?per_page=3">개인정보 검색 →</a>
  <a href="/api/search/주택임대차?per_page=3">주택임대차 →</a>
  <a href="/api/search/손해배상?type=precedents&per_page=3">판례 검색 →</a>
</div>

<h2>파라미터</h2>
<div class="tbl-wrap">
<table>
  <thead><tr><th>이름</th><th>값</th><th>기본</th><th>설명</th></tr></thead>
  <tbody>
    <tr><td><code>type</code></td><td><code>laws</code> · <code>precedents</code></td><td><code>laws</code></td><td>법령·행정규칙 또는 판례</td></tr>
    <tr><td><code>page</code></td><td>1 이상</td><td><code>1</code></td><td>페이지 번호</td></tr>
    <tr><td><code>per_page</code></td><td>1 ~ 100</td><td><code>20</code></td><td>페이지당 건수 (범위를 넘기면 경계값으로 조정)</td></tr>
    <tr><td><code>full</code></td><td><code>1</code></td><td>—</td><td>조문 본문 전체 포함 (기본은 앞 500자)</td></tr>
  </tbody>
</table>
</div>

<h2>예시</h2>
<pre><code>curl 'https://law.zihado.com/api/search/개인정보?per_page=5'
curl 'https://law.zihado.com/api/search/손해배상?type=precedents'
curl 'https://law.zihado.com/api/search/제29조?full=1'</code></pre>

<h2>응답</h2>
<pre><code>{
  "query": "개인정보",
  "type": "laws",
  "page": 1,
  "per_page": 5,
  "total": 8536,
  "total_pages": 1708,
  "took_ms": 9,
  "results": [
    {
      "law_name": "개인정보 보호법",
      "law_type": "법률",
      "chapter": "제4장",
      "article_label": "제29조",
      "article_title": "안전조치의무",
      "content": "제29조 (안전조치의무) …",
      "ministry": ["개인정보보호위원회"],
      "status": "현행",
      "promulgation_date": 20250311,
      "enforcement_date": 20260315,
      "source_url": "https://www.law.go.kr/…",
      "snippet": "&lt;mark&gt;개인정보&lt;/mark&gt;처리자는 …"
    }
  ]
}</code></pre>
<p><code>snippet</code>은 검색어가 <code>&lt;mark&gt;</code>로 감싸진 하이라이트 조각입니다.
판례(<code>type=precedents</code>)는 <code>case_name</code>, <code>case_no</code>,
<code>court</code>, <code>decided_date</code>, <code>holding</code>, <code>summary</code> 필드로 응답합니다.</p>

<h2>오류</h2>
<div class="tbl-wrap">
<table>
  <thead><tr><th>상태</th><th>상황</th></tr></thead>
  <tbody>
    <tr><td><code>400</code></td><td>검색어 누락, 잘못된 <code>type</code></td></tr>
    <tr><td><code>502</code></td><td>검색 서버 응답 실패</td></tr>
    <tr><td><code>503</code></td><td>검색 서비스 미설정</td></tr>
  </tbody>
</table>
</div>
<pre><code>{ "error": "검색어가 필요합니다." }</code></pre>

<h2>이용 안내</h2>
<p class="note">
  개인이 운영하는 무료 서비스입니다. 응답은 엣지에서 5분간 캐시되며,
  과도한 호출은 제한될 수 있습니다. 대량·상업적 이용을 계획 중이라면 미리 알려주세요.
</p>
<p>데이터 출처는 <a href="https://www.law.go.kr" target="_blank" rel="noreferrer">국가법령정보센터</a>이며,
법적 효력이 있는 원문은 해당 사이트를 기준으로 합니다.</p>

<footer>
  <a href="/">← 법령 검색으로 돌아가기</a> ·
  <a href="https://github.com/seongilp/fast-law-search" target="_blank" rel="noreferrer">GitHub</a>
</footer>

</div>
</body>
</html>`;

export async function onRequestGet() {
  return new Response(PAGE, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
      "access-control-allow-origin": "*",
    },
  });
}
