# 대한민국 법령 초고속 검색 (Typesense)

🔎 **라이브: https://law.zihado.com**

`kr/` 디렉터리의 법령 마크다운(약 5,700개 파일)을 **조문(條) 단위**로 인덱싱해
타이핑하는 즉시(instant-search) 결과가 나오는 전문검색 시스템입니다.

- **엔진**: [Typesense](https://typesense.org) (인메모리, 한국어 `locale: ko` 토크나이저)
- **인덱싱 단위**: 법령의 각 조문 1개 = 도큐먼트 1개 → "어느 법 / 몇 조"까지 바로 매칭
- **UI**: Vite + React + TypeScript + Tailwind CSS + shadcn/ui + react-instantsearch
  - 첫 화면은 검색창만(구글식). 검색을 시작하면 패싯·결과·페이지네이션이 나타남
  - **커맨드 팔레트(⌘K / Ctrl+K)**: 어디서나 띄워서 라이브 검색 + 최근/추천 검색어
  - **다크모드 토글**(우상단): localStorage 저장 + 시스템 설정 자동 감지, FOUC 방지
  - 법령구분/소관부처/상태 패싯, 본문 하이라이트, URL 동기화(링크 공유)

```
search/
├── docker-compose.yml      # Typesense 서버
├── .env.example            # 인덱서 설정 템플릿 (→ .env 로 복사)
├── Makefile                # up / index / ui 단축 명령
├── verify.sh               # 인덱스 상태 + 샘플검색 확인
├── indexer/                # 파이썬 인덱서
│   ├── config.py           #   환경설정 로딩
│   ├── parse.py            #   .md → frontmatter + 조문 파서 (순수 함수)
│   ├── schema.py           #   Typesense 컬렉션 스키마
│   ├── index.py            #   파싱 + 배치 업로드 (CLI)
│   └── requirements.txt
├── ui/                     # ★ 웹 UI (Vite+React+Tailwind+shadcn)
│   ├── src/
│   │   ├── App.tsx                # 레이아웃 (헤더/사이드바/결과)
│   │   ├── lib/typesense.ts       # 어댑터 + 검색 파라미터
│   │   ├── components/            # SearchInput, RefinementFacet, LawHitCard …
│   │   └── components/ui/         # shadcn 컴포넌트 (button, card, badge …)
│   └── .env.example              # VITE_* 접속 설정 (→ .env.local)
└── web/                    # (legacy) 빌드 없이 보는 순수 HTML 버전
```

## 빠른 시작

전제: Docker, Python 3.10+, Node 18+ & pnpm

```bash
cd search
cp .env.example .env          # 인덱서용 (필요시 API 키 수정)

make up                       # 1) Typesense 기동 (localhost:8108)
make index                    # 2) kr/ 전체 인덱싱 (약 20만 조문, 수 분)
make ui                       # 3) 웹 UI(dev) → http://localhost:8088
```

`make all` 하나로 1~3을 순차 실행할 수도 있습니다.
UI 접속 설정은 `ui/.env.local`(VITE_* 변수)에서 바꿉니다.

## 동작 방식

### 1. 파싱 (`indexer/parse.py`)
각 `.md` 의 YAML frontmatter(`제목·법령구분·소관부처·공포/시행일자·상태·법령MST·출처`)를
읽고, 본문을 `##### 제N조` 헤더 기준으로 조문 단위 분할합니다.
편/장/절/관 헤더는 각 조문의 `chapter` 컨텍스트로 추적합니다.
`제15조의2` 같은 가지번호, `삭제` 조문, frontmatter 누락 파일도 처리합니다.

### 2. 인덱싱 (`indexer/index.py`)
조문마다 도큐먼트를 만들어 2,000건씩 배치 upsert 합니다.
파일 단위로 오류를 격리해서, 한 파일이 깨져도 전체 인덱싱은 계속됩니다.

```bash
python indexer/index.py          # 컬렉션 재생성 후 전량
python indexer/index.py --keep   # 기존 유지하고 upsert(증분)
```

### 3. 검색 (`ui/`)
`content`(본문), `article_title`(조 제목), `law_name`(법령명), `chapter`를
가중치(5/4/3/1)로 함께 질의하고 결과를 하이라이트합니다.
좌측 패싯으로 **법령구분 / 소관부처 / 상태** 필터링, 상단에 활성 필터 칩과
검색 통계(건수·응답시간), 하단에 페이지네이션이 있습니다.
검색 상태는 URL에 동기화되어(`routing`) 링크 공유가 됩니다.

## 검색 도큐먼트 스키마

| 필드 | 타입 | 용도 |
|---|---|---|
| `content` | string(ko) | 조문 본문 (주 검색 대상) |
| `article_title` | string(ko) | 조 제목 |
| `law_name` | string(ko) | 법령명 (패싯) |
| `chapter` | string(ko) | 편/장/절 컨텍스트 |
| `law_type` | string | 법령구분 (패싯) |
| `ministry` | string[] | 소관부처 (패싯) |
| `status` | string | 상태 (패싯) |
| `article_label` | string | "제15조의2" |
| `article_no` / `article_seq` | int32 | 조 번호 / 정렬키 |
| `promulgation_date` / `enforcement_date` | int32 | 공포/시행일 (YYYYMMDD) |
| `mst` / `source_url` / `file_path` | string | 표시·링크용(미색인) |

## 성능

코퍼스(약 274MB, 수십만 조문)는 Typesense 기준 작은 규모라
질의 응답이 보통 수~수십 ms입니다. 인메모리 인덱스이므로 컨테이너에
2~4GB RAM을 권장합니다 (`docker-compose.yml` 에 4g 제한 설정).

## 운영 시 보안

- `ui/.env.local` 의 `VITE_TYPESENSE_SEARCH_KEY` 는 빌드 결과(브라우저)에
  노출됩니다. 운영에서는 Typesense의 **scoped search-only API key**
  (`documents:search` 권한만)를 발급해 사용하세요.
- 관리(쓰기) 키(`TYPESENSE_API_KEY`)는 인덱서에서만 사용하고 외부에 노출하지 마세요.
