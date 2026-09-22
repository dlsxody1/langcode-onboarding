# 실습 2 — 미니 RAG 엔진 만들기

**외부 의존성 0개.** `pip install` 이 필요 없고, API 키도 필요 없다. Python 3.11+ 만 있으면 된다.

라이브러리를 쓰면 5줄이면 되지만 그러면 아무것도 안 남는다.
청킹 → 임베딩 → 색인 → 검색 → 평가를 **직접 만들어 봐야** "왜 검색이 틀렸는가"를 디버깅할 수 있게 된다.

```bash
cd labs/lab2-mini-rag
python3 minirag.py eval        # 윈도우는 python3 대신 python
```

> **윈도우 사용자:** 아래 모든 명령에서 `python3` → `python` 으로 바꿔 읽어라.
> 한글이 깨지면 PowerShell 에서 `$env:PYTHONUTF8 = "1"` 을 먼저 실행한다.
> 파일 이름에 한글이 있어도(`사내규정.md`) 동작하지만, 인자로 넘길 때는 따옴표로 감싸라 —
> `python minirag.py search "비밀번호" --only "보안정책.md"`

---

## 들어 있는 것

```
minirag.py        엔진 전부 (~350줄, 한국어 주석)
docs/             한국어 샘플 문서 3개 (사내규정 · 인사팀FAQ · 보안정책)
eval.jsonl        평가 케이스 20개 (질문 + 정답 문구)
```

`minirag.py` 안에 구현된 것:

| 섹션 | 내용 |
| --- | --- |
| 1 | 청킹 — 고정 길이+오버랩 / 헤딩 구조 기반 (+ 맥락 주입) |
| 2 | 한국어 토크나이저 — 어절 + 문자 bigram |
| 3 | 임베딩 — TF-IDF (로컬) / OpenAI (키 있을 때) |
| 4 | BM25 키워드 검색 |
| 5 | 색인, 벡터·BM25·하이브리드 검색, RRF, **검색 전 메타데이터 필터** |
| 6 | 프롬프트 조립 (출처 번호 + 토큰 예산) |
| 7 | 평가 — Recall@k, MRR |

---

## 명령어

```bash
# 청크가 어떻게 잘렸는지 눈으로 보기
python3 minirag.py chunks --strategy heading
python3 minirag.py chunks --strategy fixed --chunk-size 150 --overlap 0

# 검색
python3 minirag.py search "연차 며칠 쓸 수 있어?" --k 3
python3 minirag.py search "연차 며칠?" --prompt            # 최종 프롬프트까지 출력

# 세 방식 비교
python3 minirag.py compare "USB 써도 되나요?"

# 검색 전 메타데이터 필터 (권한 필터링의 원리)
python3 minirag.py search "비밀번호" --only 보안정책.md

# 평가
python3 minirag.py eval
python3 minirag.py eval --strategy fixed --chunk-size 150 --overlap 0
```

---

## 실습 과제

### 과제 1 — 청킹이 품질을 지배한다는 걸 직접 본다

```bash
python3 minirag.py eval --strategy heading
python3 minirag.py eval --strategy fixed --chunk-size 400 --overlap 40
python3 minirag.py eval --strategy fixed --chunk-size 150 --overlap 0
```

실제 결과 (참고용 — 직접 돌려봐라):

| 전략 | 청크 수 | Recall@5 | MRR |
| --- | --- | --- | --- |
| heading (구조 기반) | 21 | 0.950 | 0.636 |
| fixed 400 / overlap 40 | 9 | 0.950 | 0.624 |
| **fixed 150 / overlap 0** | 21 | **0.750** | 0.459 |

**모델도 프롬프트도 안 바꿨는데 Recall 이 0.95 → 0.75 로 떨어진다.**
놓친 질문 목록을 보면 이유가 보인다 — 조항이 중간에서 잘려 답이 두 청크에 나뉘었다.

> 이걸 직접 보고 나면 "RAG 품질의 8할은 청킹"이라는 말이 문장이 아니라 경험이 된다.

**해볼 것:** `--overlap` 만 0 → 50 으로 올려서 얼마나 회복되는지 확인해라.

### 과제 2 — TF-IDF 로는 못 찾는 질문을 찾아라

```bash
python3 minirag.py eval
```

`heading` 전략에서도 **딱 하나가 계속 실패**한다:

```
[vector] 놓친 질문 1개:
   - 두 시간만 자리를 비우고 싶습니다
```

정답은 `제17조 반반차(2시간 단위)` 인데, 질문과 문서 사이에 **겹치는 글자가 거의 없다.**
TF-IDF 는 글자가 겹쳐야 가깝다 — **의미를 모른다.**

**이게 진짜 임베딩 모델이 필요한 이유의 전부다.** 키가 있다면 바로 확인할 수 있다:

```bash
export OPENAI_API_KEY=sk-...
python3 minirag.py eval --embedder openai
python3 minirag.py search "두 시간만 자리를 비우고 싶습니다" --embedder openai --mode vector
```

키가 없으면 실행하지 말고 **"왜 실패하는지"만 이해하고 넘어가라.** 그게 핵심이다.

### 과제 3 — 벡터와 BM25 가 각각 이기는 질문

```bash
python3 minirag.py compare "MFA"
python3 minirag.py compare "v4.2"
python3 minirag.py compare "집에서 일하고 싶어요"
```

짧은 약어·버전 문자열은 BM25 가 강하고, 풀어 쓴 자연어 질문은 벡터가 강하다.
**두 검색의 실패 유형이 다르다는 것** 이 하이브리드의 존재 이유다.

> ⚠️ 이 실습의 기본 임베더는 TF-IDF 라 **벡터도 결국 어휘 기반**이다.
> 그래서 두 결과가 비슷하게 나온다. 진짜 임베딩을 끼워야 차이가 극적으로 벌어진다.
> **이 한계를 인지하고 있는 것 자체가 배움이다.**

### 과제 4 — 검색 전 필터 (권한 필터링의 원리)

```bash
python3 minirag.py search "승인" --k 5
python3 minirag.py search "승인" --k 5 --only 보안정책.md
```

`_candidates()` 가 **검색 전에** 후보를 좁힌다. 엔터프라이즈 RAG 에서 `acl_groups` 로 하는 일이 정확히 이것이다.

**해볼 것:** 코드를 고쳐서 **검색 후 필터링**으로 바꿔보고, top-k 가 전부 걸러져 결과가 0개가 되는 상황을 만들어라.
(→ `03-rag/04-enterprise-rag.md` 에서 "후처리 필터링이 왜 안 되는가"라고 쓴 것의 실물)

### 과제 5 — 검색은 맞는데 답이 틀리는 경우

```bash
python3 minirag.py search "연차 며칠?" --k 2 --prompt
```

1위로 **제16조(소멸)** 가 나온다. 진짜 답인 **제15조(15일 부여)** 가 아니다.
질문이 너무 짧아 "연차"라는 단어만으로 판단됐기 때문이다.

이때 LLM 에 이 프롬프트를 넣으면 "이월되지 않습니다" 같은 엉뚱한 답이 나온다.
**모델 잘못이 아니라 검색 잘못이다.** 디버깅의 첫 단계가 왜 "top-k 를 먼저 본다"인지 알 수 있다.

**해볼 것:** `--k 5` 로 올리면 정답 청크가 들어오는가? k 를 올리는 것과 리랭킹을 넣는 것의 차이는?

### 과제 6 — 직접 고쳐보기 (원하면)

| 난이도 | 과제 |
| --- | --- |
| ★ | `eval.jsonl` 에 실패하는 질문을 5개 더 추가하고 왜 실패하는지 분석 |
| ★ | 청크에 `valid_to` 메타데이터를 넣고 만료된 청크를 검색에서 제외 |
| ★★ | **부모-자식 청킹** — 작은 청크로 검색하고 프롬프트엔 부모 섹션을 넣기 |
| ★★ | RRF 에 검색기별 가중치를 넣고 평가 점수가 어떻게 변하는지 |
| ★★ | `nDCG@k` 추가 구현 |
| ★★★ | LLM 리랭킹 — 1차 top-20 을 LLM 에 주고 재정렬시키기 (키 필요) |
| ★★★ | 대화 맥락 압축 — 이전 턴 + 후속 질문 → 독립 질문 재작성 (키 필요) |

---

## 이 실습에서 남겨야 할 것

1. **RAG 는 마법이 아니다.** 자르고, 숫자로 바꾸고, 가까운 걸 찾고, 프롬프트에 붙인다. 그게 전부다.
2. **품질은 모델이 아니라 청킹과 검색에서 나온다.** 과제 1 의 숫자가 그 증거다.
3. **측정할 수 있으면 개선할 수 있다.** 평가셋 20개를 만드는 데 10분이면 되고, 그게 없으면 아무 비교도 못 한다.
4. **답이 이상하면 top-k 부터 본다.** 과제 5 에서 직접 겪은 것.

입사해서 실제 RAG 코드를 볼 때, 이 350줄이 어디로 확장됐는지를 찾으면 된다.
**파일은 수십 개가 되겠지만 뼈대는 같다.**
