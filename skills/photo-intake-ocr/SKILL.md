---
name: photo-intake-ocr
description: Triage attached photos or document images and route them into the right local workflow. Use when the user attaches an image/photo/screenshot/card/document and wants OCR, 저장, 인물 정보 정리, 명함 정리, 문서 저장, 사진 분류, or similar intake handling. For business cards, run Upstage OCR on the original image, keep the original public S3 upload, then try OpenCV-based card correction right before markdown generation and switch the representative markdown image to the corrected upload only if correction succeeds. For person photos, ask for or parse identity/context and save a people note. For document-like images, run Upstage OCR and save into the Obsidian Document folder. If the image is neither a person, business card, nor document, use Gemini image understanding to describe or identify it.
# 오픈코어 경계(scripts/skill-boundary.ts) — requires = 없으면 이 스킬이 일을 못 하는 catalog/resources.yaml 자원 id
requires: [upstage]
---

# Photo Intake OCR

첨부 이미지를 먼저 분류한 뒤, 명함 / 사람 / 문서 / 기타 흐름으로 보낸다.

## 핵심 분류 순서

1. 명함인지 확인
2. 아니면 사람 사진인지 확인
3. 아니면 문서류인지 확인
4. 셋 다 아니면 일반 이미지로 보고 Gemini 이미지 이해 사용

권장 1차 분류는 `image` tool이다.

## 저장 경로

- 문서류 OCR 결과: `~/Obsidian/ElanvitalAI/00. Inbox/07. Document`
- 사람 / 명함 노트: `~/Obsidian/ElanvitalAI/70. Collections/71. People`

## Upstage OCR 실행 규칙

이 환경에서는 비대화형 exec에서 `UPSTAGE_API_KEY`가 바로 안 보일 수 있고, bare `python3`가 Homebrew Python을 잡을 수 있다.

실행 순서:

1. 먼저 현재 환경변수에서 `UPSTAGE_API_KEY` 확인
2. 없으면 `~/.cache/upstage_api_key` 확인
3. 없으면 `source ~/.zshrc` 후 환경변수 확인
4. 그래도 없으면 사용자에게 API 키 연결 상태 확인 요청

Python 실행 규칙:

- 기본 실행은 `$(monad python where --path) scripts/upstage_ocr.py ...` 형태를 우선 사용 (monad venv — cv2 포함 · 2026-09-24)
- `monad` 가 없으면 `~/.local/share/monad/python/venv/bin/python` 을 직접 사용
- ⛔ bare `python3` · pyenv 전역(`~/.pyenv/versions/3.12.12`)은 지양 — 거기엔 cv2 가 없어 명함 보정이 조용히 원본으로 빠졌다(2026-09-24 실측)

OCR 스크립트:

- `scripts/upstage_ocr.py`
- 표준 라이브러리 기반이므로 `requests` 없이 동작

## 명함 처리 플로우

명함은 아래 순서를 고정한다.

1. `image` tool로 명함 여부 확인
2. **원본 이미지로** Upstage OCR 실행
3. OCR 결과에서 이름 / 회사 / 직함 / 이메일 / 전화번호 / 웹사이트 / 주소 / 메모 파싱
4. 원본 이미지를 public bucket `elanvital-public` 의 `people/<slug>/business-card/` 아래 업로드
5. markdown 생성 직전에 OpenCV 후처리 시도
   - `scripts/card_postprocess.py <원본이미지> --output <보정본경로> --meta-out <json> --stdout-json`
   - 시도 내용: contour 기반 crop, `minAreaRect` fallback, perspective correction, light Hough deskew, auto-trim
   - **성공(exit 0)** 하면 보정본도 같은 public bucket에 업로드
   - **실패(exit 2)** 하면 원본 public URL 유지
6. People note를 `/70. Collections/71. People/[이름].md` 로 저장
7. note 대표 이미지는 아래 규칙으로 넣기
   - 원본 업로드는 항상 유지
   - 보정 업로드 성공 시 대표 `![](...)` 이미지는 보정본 public URL로 교체
   - 실패 시 대표 이미지는 원본 public URL 유지
8. 추가 인물 사진이 있는지 먼저 확인하고, 없으면 자동으로 나머지 저장 흐름 진행
9. 이름이 불명확하면 회사명+직함 또는 임시 제목으로 저장 후 사용자 확인 요청

### 명함용 업로드 규칙

원본과 보정본을 구분해서 남긴다.

예시:

```bash
# 원본 업로드
./scripts/upload_people_image_ref.sh kim-woohyeon business-card ./card.jpg --json

# 보정본 업로드
./scripts/upload_people_image_ref.sh kim-woohyeon business-card-corrected ./card-corrected.jpg --json
```

`upload_people_image_ref.sh` 확장 사항:

- `--public-url`: public URL만 반환
- `--json`: `bucket`, `region`, `key`, `s3_uri`, `public_url` 등을 JSON으로 반환
- `--basename-name <name>`: S3 object basename override

## 사람 사진 처리 플로우

1. `image` tool로 사람 사진 여부 확인
2. 기존 명함/People note와 연결 가능한지 먼저 확인
3. 사용자가 준 텍스트에서 이름/관계/메모 파싱
4. 이름이 없으면 짧게 질문
5. person slug를 정한 뒤 원본 이미지를 `people/<slug>/portrait/` 아래 업로드
6. note를 저장 또는 업데이트
7. portrait public URL도 Markdown 이미지 문법으로 추가

포함하면 좋은 필드:

- 이름
- 관계/소속
- 맥락
- 만난 곳/출처
- 메모
- business card image source
- portrait image source

## 문서류 처리 플로우

1. `image` tool로 문서 여부 확인
2. Upstage OCR 실행
3. OCR 결과를 한국어로 정돈
4. `/00. Inbox/07. Document` 아래 markdown 저장
5. 문서 제목은 가능하면 OCR 상단 제목 기준으로 설정

## 기타 이미지 처리 플로우

1. Gemini image understanding 사용
2. 무엇으로 보이는지 설명
3. 사용자가 원하면 저장/노트화 추가 진행

## People note 작성 규칙

- 파일명은 되도록 사람 이름 사용
- 이름이 불확실하면 임시 제목 사용 후 본문에 불확실성 표기
- 한국어 설명 우선
- 대표 이미지에는 실제 markdown 이미지 문법 사용
- 원본 / 보정본을 모두 남기되 의미를 구분해서 기록

권장 이미지 섹션 예시:

```markdown
## 이미지
![홍길동 명함](REPRESENTATIVE_PUBLIC_URL)

## 이미지 소스
- 명함 대표 이미지(public): REPRESENTATIVE_PUBLIC_URL
- 명함 원본 이미지(public): ORIGINAL_PUBLIC_URL
- 명함 보정 이미지(public): CORRECTED_PUBLIC_URL_OR_EMPTY
- 명함 원본 이미지 소스(s3): ORIGINAL_S3_URI
- 명함 보정 이미지 소스(s3): CORRECTED_S3_URI_OR_EMPTY
- 원본 로컬 이미지 경로:
```

템플릿은 필요 시 `references/people-note-template.md` 를 참고한다.

## 문서 note 작성 규칙

- 문서 제목
- 필요 시 짧은 요약
- JSON 기반 후처리로 정돈한 본문
- 표가 있으면 Markdown 표 우선
- 원본 이미지 정보
- OCR 원문 또는 구조 복원이 애매한 부분은 별도 블록으로 남기기
- OCR 신뢰도/한계 메모

원칙:
- 문서에 표가 많은데 `text-only`만으로 구조를 잃어버리면, 그건 엔진 한계라기보다 처리 방식 문제일 수 있다
- 따라서 문서류는 기본적으로 `full JSON → 구조 후처리 → Markdown` 흐름으로 처리한다

템플릿은 필요 시 `references/document-note-template.md` 를 참고한다.

## 보정 성공 판정

`card_postprocess.py` 기준:

- card region을 찾고 warp 결과를 저장하면 success
- quad 실패 시 `minAreaRect` fallback 허용
- deskew는 각도 절대값이 약 `0.5°` 이상일 때만 적용
- region 미검출이면 원본 fallback + exit code `2`

즉, **OCR은 원본으로**, **대표 이미지는 보정 성공 시에만 보정본으로** 라는 원칙을 유지한다.

## 검증 체크리스트

저장 전 확인:

- 분류 결과가 명확한가
- 명함/문서이면 OCR이 실제로 원본 이미지에 대해 실행됐는가
- 원본 public 업로드가 남아 있는가
- 보정 성공 시 보정본 public 업로드도 남아 있는가
- markdown 대표 이미지 링크가 올바른 URL을 가리키는가
- People note에 이름 또는 임시 제목이 있는가
- 문서 note에 OCR 텍스트가 비어 있지 않은가

## 스크립트

- `scripts/upstage_ocr.py`
  - 입력 파일을 Upstage OCR로 보내고 JSON/text 결과를 받는다.
- `scripts/card_postprocess.py`
  - 명함 이미지 crop / perspective correction / light deskew / auto-trim 시도
  - 성공 시 exit 0, 실패 시 원본 fallback을 기록하고 exit 2
- `scripts/upload_people_image_ref.sh`
  - 사람 slug, 이미지 kind, 로컬 파일 경로를 받아 S3 업로드 수행
  - 기본 bucket은 `elanvital-public`
  - 기본값은 AWS default credentials chain 사용
