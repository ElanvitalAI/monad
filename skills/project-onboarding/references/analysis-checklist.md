# Analysis Checklist

프로젝트 타입별 자동 탐지 및 스캔 전략.

## Project Type Detection

매니페스트 파일 존재 여부로 프로젝트 타입을 판별한다.

| Manifest File | Project Type | Entry Point Candidates |
|---|---|---|
| `package.json` + `next.config.*` | Next.js | `app/page.tsx`, `app/layout.tsx`, `pages/index.tsx` |
| `package.json` + `vite.config.*` | Vite (React/Vue/Svelte) | `src/main.tsx`, `src/App.tsx`, `index.html` |
| `package.json` + `angular.json` | Angular | `src/main.ts`, `src/app/app.component.ts` |
| `package.json` (no framework) | Node.js | `index.js`, `src/index.ts`, `server.js`, `app.js` |
| `requirements.txt` or `pyproject.toml` | Python | `app.py`, `main.py`, `manage.py`, `wsgi.py` |
| `go.mod` | Go | `main.go`, `cmd/*/main.go` |
| `Cargo.toml` | Rust | `src/main.rs`, `src/lib.rs` |
| `pubspec.yaml` | Flutter/Dart | `lib/main.dart` |
| `Gemfile` | Ruby | `config.ru`, `app.rb` |
| `build.gradle` or `pom.xml` | Java/Kotlin | `src/main/java/**/Application.java` |

**Python Framework Detection:**
| Keyword in Dependencies | Framework |
|---|---|
| `streamlit` | Streamlit |
| `fastapi` | FastAPI |
| `flask` | Flask |
| `django` | Django |
| `gradio` | Gradio |

## Exclusion Patterns

항상 제외하는 디렉토리/파일:
```
node_modules/
.venv/
venv/
__pycache__/
.git/
dist/
build/
.next/
.nuxt/
.output/
.cache/
coverage/
*.pyc
*.pyo
*.egg-info/
.DS_Store
*.lock (read but don't trace)
```

추가로 `.gitignore`에 명시된 패턴도 제외.

## Scan Priority Order

1. **README.md** (or README.rst, README.txt) — 프로젝트 목적, 설치, 실행
2. **Manifest file** — 의존성, 스크립트, 메타데이터
3. **Entry point** — 앱 시작점, 주요 라우팅/네비게이션
4. **Config files** — .env.example, docker-compose.yml, Dockerfile, CI/CD
5. **Auth module** — auth/, login, OAuth, session 관련 파일
6. **Route/Page files** — pages/, routes/, app/ 디렉토리
7. **Component files** — components/, views/, templates/
8. **Service/Logic files** — services/, lib/, utils/, helpers/
9. **Data/Model files** — models/, schema/, data/, prisma/, migrations/
10. **Test files** — tests/, __tests__/, *.test.*, *.spec.*
11. **Documentation** — docs/, CLAUDE.md, CONTRIBUTING.md

## Feature Detection Heuristics

코드에서 기능 영역을 자동 탐지하는 키워드:

| Feature Area | Detection Keywords / Patterns |
|---|---|
| Authentication | `auth/`, `login`, `signup`, `session`, `jwt`, `oauth`, `passport`, `next-auth` |
| Database | `prisma/`, `models/`, `schema`, `migration`, `sequelize`, `sqlalchemy`, `mongoose` |
| API Integration | `api/`, `services/`, `fetch(`, `axios`, `requests.`, environment variables with `_API_KEY` |
| File Upload | `upload`, `multer`, `formdata`, `multipart`, `dropzone` |
| Payment | `stripe`, `payment`, `billing`, `subscription`, `pricing` |
| Email/Notification | `email`, `smtp`, `sendgrid`, `notification`, `push` |
| Search | `search`, `elasticsearch`, `algolia`, `fuse` |
| Caching | `redis`, `cache`, `memcached` |
| Real-time | `websocket`, `socket.io`, `sse`, `pubsub` |
| AI/ML | `anthropic`, `openai`, `transformers`, `langchain`, `llm` |
| Deployment | `Dockerfile`, `docker-compose`, `*.yaml` (k8s), `vercel.json`, `netlify.toml` |
| CI/CD | `.github/workflows/`, `cloudbuild.yaml`, `.gitlab-ci.yml`, `Jenkinsfile` |

## Large Project Sampling Strategy

소스 파일이 200개 이상인 대형 프로젝트:

1. **Entry point 읽기** — 전체 파일 읽기
2. **Import 추적** — entry point에서 3레벨까지 import된 파일만 읽기
3. **나머지** — 파일명과 디렉토리 구조만 기록 (내용은 읽지 않음)
4. **핵심 파일 우선** — 위 Scan Priority Order 상위 항목은 항상 읽기
5. **테스트 파일** — 구조만 확인, 내용은 스킵 (Fluent 모드에서도)

## Data Model Detection

| Pattern | Data Storage Type |
|---|---|
| `prisma/schema.prisma` | Prisma ORM (PostgreSQL/MySQL/SQLite) |
| `models.py` with Django imports | Django ORM |
| SQLAlchemy models | SQLAlchemy ORM |
| `*.schema.ts` with mongoose | MongoDB |
| JSON files in `data/` | File-based JSON storage |
| `.sql` migration files | Raw SQL migrations |
| Supabase config | Supabase (PostgreSQL) |
| Firebase config | Firebase (NoSQL) |
