# 배포 구성 (운영 메모)

## 라이브
- **UI**: https://law.zihado.com (Cloudflare Pages, 프로젝트명 `law`, 별칭 fast-law-search.pages.dev)
- **검색 엣지 캐시**: https://law-search-cache.zihado.workers.dev (Cloudflare Worker, UI 가 호출)
- **검색 origin**: https://api-law.zihado.com (Cloudflare Tunnel → Droplet Typesense:8108)
- **UI 레포**: https://github.com/seongilp/fast-law-search

## 검색 엣지 캐시 (Cloudflare Worker)
- 소스: `edge-cache/worker.js` + `wrangler.toml`. 배포: `cd edge-cache && npx wrangler deploy`
- 흐름: 브라우저 → 워커(엣지 Cache API) → api-law.zihado.com → Typesense
- `multi_search`/`documents/search` 결과를 키(경로+쿼리+본문 해시)로 엣지 캐시,
  TTL **1시간**. 반복 검색은 드롭릿 안 거치고 엣지 즉시 응답(부하↓, 글로벌 지연↓).
- 응답 헤더 `x-edge-cache: HIT|MISS` 로 확인. CORS·api키(헤더/쿼리) 그대로 프록시.
- 신선도: 새벽 재색인 후 최대 1시간 캐시 잔존(법령 변경 드물어 허용). 즉시 반영이 필요하면
  TTL 을 줄이거나 워커 캐시키에 alias 컬렉션명을 포함하면 됨.
- UI 전환: `ui/.env.local` 의 `VITE_TYPESENSE_HOST=law-search-cache.zihado.workers.dev`.
  롤백은 이 값을 `api-law.zihado.com` 으로 되돌리고 재빌드/재배포(코드 DEFAULTS 도 직결값).

## 구성도
```
브라우저 ──HTTPS──> law.zihado.com (Cloudflare Pages, 정적 UI/dist)
   │
   └──HTTPS──> api-law.zihado.com ──> Cloudflare Tunnel
                                          │ (cloudflared 컨테이너, .tuntoken)
                                          ▼
                                      DO Droplet  typesense:8108
                                      (법령+행정규칙 조문 ~517,000건, alias=kr_laws)
```
> ⚠️ 이전 메모의 "Caddy + nip.io(146-190-96-6.nip.io)" 구성은 **사용하지 않는다**.
> 실제 외부 노출은 **Cloudflare Tunnel(cloudflared)** 이고 공개 주소는 `api-law.zihado.com`.
> Droplet 8108 은 호스트에 바인딩되어 있으나 외부 방화벽으로 막고 터널 경유만 허용.

> **행정규칙 수집 (2026-06-03, Claude 가 SSH 로 Droplet 에 직접 배포)**:
> law.go.kr OpenAPI 에서 현행 행정규칙(고시·훈령·예규·세칙 등) ~23,584건을
> 수집해 `corpus/kr` 에 법령과 함께 색인. 수집기 `collector/` + OC 키 `.lawoc`
> 를 Droplet 에 올리고 `reindex.sh` 에 수집 단계를 통합했다(이하 참조).

## DigitalOcean Droplet
- 이름: `legalize-typesense`, 리전 sgp1, 2GB/1vCPU ($12/월)
- IP: `146.190.96.6`
- 앱 경로: `/opt/legalize/`
  - `docker-compose.yml` — **typesense 단독** (admin key·`--enable-cors`, 외부 노출 금지)
  - `cloudflared` 컨테이너 — Cloudflare Tunnel(토큰 `.tuntoken`)로 api-law.zihado.com 노출
    (compose 가 아니라 별도 `docker run` 으로 기동되어 있음)
  - `corpus/` — 원본 법령 레포(`legalize-kr/legalize-kr`) clone + 행정규칙 수집분(untracked)
  - `collector/` — 행정규칙 수집기 (search 레포의 `collector/` 사본)
  - `.lawoc` — law.go.kr OpenAPI OC 키 (chmod 600, git·코드 미포함)
  - `.adminkey` / `.telegram` / `.tuntoken` — 운영 비밀 (chmod 600)
  - `reindex.sh` — 법령 pull + 행정규칙 수집 + 무중단 재색인 스크립트
- 8108 은 호스트 바인딩되어 있으나 외부 방화벽 차단 → 실제 접근은 Cloudflare Tunnel 경유.

## 자동 재색인
- Droplet cron: 매일 03:00 KST → `reindex.sh`
  (법령 레포 `git pull` → 행정규칙 `collector.fetch` 수집(resume) → `index.py --alias` 무중단 전환)
- 행정규칙 수집은 non-fatal: law.go.kr 일시 장애 시에도 기존 수집분으로 색인 계속.
- 수동: `ssh root@146.190.96.6 /opt/legalize/reindex.sh`
- **flock** 으로 동시 실행 방지(`.reindex.lock`). 중복 실행 시 alias/cleanup
  충돌로 실패(RC=2)하던 문제를 막는다.
- **텔레그램 알림**(성공/실패 모두):
  - ✅ 성공: `법령 색인 완료 / 조문 N건 / alias 전환 / 🔎 law.zihado.com`
  - ❌ 실패: `법령 색인 실패` + 마지막 로그 4줄
  - 봇 `@opgarun_bot`(opgarun 과 공용), chat id `66077028`
  - 자격: Droplet `/opt/legalize/.telegram` (chmod 600, `TELEGRAM_BOT_TOKEN`
    /`TELEGRAM_CHAT_ID`). git·코드에 미포함.
- `reindex.sh` 는 Droplet 운영 파일(레포에 없음). 전체 내용은 `docs/reindex.sh` 참고용 사본.

## 키 관리
- **admin(쓰기) 키**: Droplet 의 `docker-compose.yml` 에만 존재. 외부 노출 금지.
- **search-only 키**: UI `ui/.env.local` 의 `VITE_TYPESENSE_SEARCH_KEY`.
  `documents:search` 권한만 → 브라우저 노출 안전.
- 키 재발급(rotate) 시: admin 키로 `POST /keys` 호출 후 `ui/.env.local` 갱신 → 재빌드/재배포.

## UI 재배포
```bash
cd ui
# .env.local 에 운영 Typesense 값이 들어 있어야 함 (.env.example 참고)
#   VITE_TYPESENSE_HOST=api-law.zihado.com / PORT=443 / PROTOCOL=https
pnpm build
# ★ Pages 프로젝트명은 'law' (도메인 fast-law-search.pages.dev / law.zihado.com)
npx wrangler pages deploy dist --project-name law --branch main --commit-dirty=true
```

## Cloudflare Pages 빌드 프리셋 관련
대시보드 Git 연동 시 **Framework preset 은 "None"** 으로 둔다 (VitePress 아님).
- Build command: `cd ui && npm install && npm run build`
- Build output: `ui/dist`
- 환경변수(VITE_*)는 Pages 프로젝트 설정에 등록.
현재는 `wrangler` CLI 로 직접 배포 중이라 프리셋과 무관.
