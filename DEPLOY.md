# 배포 구성 (운영 메모)

## 라이브
- **UI**: https://fast-law-search.pages.dev (Cloudflare Pages)
- **검색 API**: https://146-190-96-6.nip.io (DigitalOcean Droplet, Typesense + Caddy)
- **UI 레포**: https://github.com/seongilp/fast-law-search

## 구성도
```
브라우저 ──HTTPS──> Cloudflare Pages (정적 UI, dist)
   │
   └──HTTPS──> nip.io 도메인 ──> DO Droplet
                                  ├─ Caddy (자동 TLS, :443 → typesense:8108)
                                  └─ Typesense (조문 204,817건, alias=kr_laws)
```

## DigitalOcean Droplet
- 이름: `legalize-typesense`, 리전 sgp1, 2GB/1vCPU ($12/월)
- IP: `146.190.96.6`
- 앱 경로: `/opt/legalize/`
  - `docker-compose.yml` — typesense + caddy (admin key 가 여기 있음, 외부 노출 금지)
  - `Caddyfile` — nip.io 호스트 자동 HTTPS
  - `corpus/` — 원본 법령 레포(`legalize-kr/legalize-kr`) clone
  - `reindex.sh` — 무중단 재색인 스크립트
- 방화벽(ufw): 22/80/443 만 개방. 8108 은 외부 차단(Caddy 경유만).

## 자동 재색인
- Droplet cron: 매일 03:00 KST → `reindex.sh`
  (원본 레포 `git pull` → `index.py --alias` 무중단 전환)
- 수동: `ssh root@146.190.96.6 /opt/legalize/reindex.sh`

## 키 관리
- **admin(쓰기) 키**: Droplet 의 `docker-compose.yml` 에만 존재. 외부 노출 금지.
- **search-only 키**: UI `ui/.env.local` 의 `VITE_TYPESENSE_SEARCH_KEY`.
  `documents:search` 권한만 → 브라우저 노출 안전.
- 키 재발급(rotate) 시: admin 키로 `POST /keys` 호출 후 `ui/.env.local` 갱신 → 재빌드/재배포.

## UI 재배포
```bash
cd ui
# .env.local 에 운영 Typesense 값이 들어 있어야 함 (.env.example 참고)
pnpm build
npx wrangler pages deploy dist --project-name fast-law-search --branch main
```

## Cloudflare Pages 빌드 프리셋 관련
대시보드 Git 연동 시 **Framework preset 은 "None"** 으로 둔다 (VitePress 아님).
- Build command: `cd ui && npm install && npm run build`
- Build output: `ui/dist`
- 환경변수(VITE_*)는 Pages 프로젝트 설정에 등록.
현재는 `wrangler` CLI 로 직접 배포 중이라 프리셋과 무관.
