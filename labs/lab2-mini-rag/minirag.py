#!/usr/bin/env python3
"""
미니 RAG 엔진 — 외부 의존성 0개 (Python 표준 라이브러리만).

라이브러리를 쓰면 5줄이면 되지만, 그러면 아무것도 안 남는다.
청킹 → 임베딩 → 색인 → 검색 → 평가를 직접 만들어 봐야
"왜 검색이 틀렸는가"를 디버깅할 수 있게 된다.

  python minirag.py search  "연차 며칠 쓸 수 있어?"
  python minirag.py compare "SKU 같은 코드 검색은?"      # 벡터 vs BM25 vs 하이브리드
  python minirag.py eval                                  # Recall@k / MRR
  python minirag.py eval --chunk-size 200 --overlap 0     # 설정 바꿔 비교
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

DOCS_DIR = Path(__file__).parent / "docs"
EVAL_FILE = Path(__file__).parent / "eval.jsonl"


# ─────────────────────────────────────────────────────────────
# 1. 청킹
# ─────────────────────────────────────────────────────────────

@dataclass
class Chunk:
    id: str
    doc: str                       # 출처 파일명
    section: str                   # 소속 섹션 (출처 표시용)
    text: str
    meta: dict = field(default_factory=dict)


def chunk_fixed(text: str, doc: str, size: int = 400, overlap: int = 40) -> list[Chunk]:
    """고정 길이 + 오버랩. 가장 단순하고, 문장 중간에서 자른다."""
    chunks, start, i = [], 0, 0
    step = max(1, size - overlap)
    while start < len(text):
        piece = text[start:start + size].strip()
        if piece:
            chunks.append(Chunk(id=f"{doc}#f{i}", doc=doc, section="(고정분할)", text=piece))
            i += 1
        start += step
    return chunks


def chunk_by_heading(text: str, doc: str, max_size: int = 1200) -> list[Chunk]:
    """구조 기반 분할. 마크다운 헤딩을 경계로 쓰고, 너무 크면 고정 분할로 되돌린다.

    규정·계약서처럼 조항 구조가 뚜렷한 문서에서 검색 품질이 눈에 띄게 좋아진다.
    각 청크 앞에 섹션 경로를 붙여 넣는 것(맥락 주입)이 핵심이다.
    """
    lines = text.splitlines()
    chunks: list[Chunk] = []
    path: list[str] = []            # 현재 헤딩 경로 (H1 > H2 > H3)
    buf: list[str] = []
    idx = 0

    def flush():
        nonlocal buf, idx
        body = "\n".join(buf).strip()
        buf = []
        if not body:
            return
        section = " > ".join(path) if path else "(본문)"
        # ── 맥락 주입: 청크만 떼어놔도 어디서 왔는지 알 수 있게 한다
        full = f"[{doc} > {section}]\n{body}"
        if len(full) <= max_size:
            chunks.append(Chunk(id=f"{doc}#h{idx}", doc=doc, section=section, text=full))
            idx += 1
        else:
            for sub in chunk_fixed(body, doc, size=max_size, overlap=100):
                sub.id = f"{doc}#h{idx}"
                sub.section = section
                sub.text = f"[{doc} > {section}]\n{sub.text}"
                chunks.append(sub)
                idx += 1

    for line in lines:
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            flush()
            level = len(m.group(1))
            path = path[: level - 1] + [m.group(2).strip()]
        else:
            buf.append(line)
    flush()
    return chunks


# ─────────────────────────────────────────────────────────────
# 2. 토크나이저 — 한국어가 왜 까다로운지
# ─────────────────────────────────────────────────────────────

_WORD = re.compile(r"[A-Za-z0-9]+|[가-힣]+")


def tokenize(text: str) -> list[str]:
    """어절 + 한글 문자 bigram.

    한국어는 교착어라 '휴가를 / 휴가는 / 휴가가' 가 전부 다른 어절이 된다.
    형태소 분석기(mecab-ko, Kiwi)가 정석이지만 의존성 없이 흉내내려면
    문자 bigram 이 싸고 쓸 만하다. '휴가를' → 휴가, 가를 ... 로 겹치는 부분이 생긴다.

    실무에서는 형태소 분석기나 Elasticsearch nori 를 쓴다.
    """
    toks: list[str] = []
    for w in _WORD.findall(text.lower()):
        toks.append(w)
        if re.fullmatch(r"[가-힣]+", w) and len(w) >= 2:
            toks.extend(w[i:i + 2] for i in range(len(w) - 1))
    return toks


# ─────────────────────────────────────────────────────────────
# 3. 임베딩
# ─────────────────────────────────────────────────────────────

class TfidfEmbedder:
    """TF-IDF 희소 벡터. 진짜 임베딩 모델의 '자리 표시자'다.

    ⚠️ 이건 의미(semantic)를 모른다. 글자가 겹쳐야 가깝다.
       그래서 '연차' 로 물으면 '휴가' 문서를 잘 못 찾는다 — 이 한계를 직접 보는 게 이 실습의 목적이다.
       진짜 임베딩 모델을 끼우려면 OpenAIEmbedder 를 써라 (아래).
    """
    name = "tfidf(로컬)"

    def __init__(self) -> None:
        self.idf: dict[str, float] = {}

    def fit(self, texts: list[str]) -> None:
        df: Counter[str] = Counter()
        for t in texts:
            df.update(set(tokenize(t)))
        n = len(texts)
        self.idf = {tok: math.log((n + 1) / (c + 1)) + 1 for tok, c in df.items()}

    def embed(self, text: str) -> dict[str, float]:
        tf = Counter(tokenize(text))
        if not tf:
            return {}
        vec = {tok: (c / len(list(tf.elements()))) * self.idf.get(tok, 1.0) for tok, c in tf.items()}
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        return {k: v / norm for k, v in vec.items()}

    @staticmethod
    def cosine(a: dict[str, float], b: dict[str, float]) -> float:
        # 이미 정규화돼 있으므로 내적 = 코사인 유사도
        if len(a) > len(b):
            a, b = b, a
        return sum(v * b.get(k, 0.0) for k, v in a.items())


class OpenAIEmbedder:
    """진짜 임베딩. OPENAI_API_KEY 가 있을 때만 동작한다 (urllib 만 사용).

    TfidfEmbedder 와 비교해보면 '의미 검색'이 무엇인지 체감할 수 있다.
    """
    name = "openai(text-embedding-3-small)"

    def __init__(self, model: str = "text-embedding-3-small") -> None:
        self.model = model
        self.key = os.environ["OPENAI_API_KEY"]
        self._cache: dict[str, list[float]] = {}

    def fit(self, texts: list[str]) -> None:
        self._embed_batch(texts)          # 미리 채워두면 검색이 빠르다

    def _embed_batch(self, texts: list[str]) -> None:
        import urllib.request
        todo = [t for t in texts if t not in self._cache]
        for i in range(0, len(todo), 64):
            batch = todo[i:i + 64]
            req = urllib.request.Request(
                "https://api.openai.com/v1/embeddings",
                data=json.dumps({"model": self.model, "input": batch}).encode(),
                headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=60) as r:
                payload = json.load(r)
            for text, item in zip(batch, payload["data"]):
                self._cache[text] = item["embedding"]

    def embed(self, text: str) -> dict[str, float]:
        if text not in self._cache:
            self._embed_batch([text])
        v = self._cache[text]
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        return {str(i): x / norm for i, x in enumerate(v)}

    cosine = staticmethod(TfidfEmbedder.cosine)


# ─────────────────────────────────────────────────────────────
# 4. BM25 — 키워드 검색
# ─────────────────────────────────────────────────────────────

class BM25:
    """고전 키워드 랭킹. 고유명사·제품코드·사번처럼 '정확한 글자'가 중요한 질의에 강하다."""

    def __init__(self, k1: float = 1.5, b: float = 0.75) -> None:
        self.k1, self.b = k1, b
        self.docs: list[list[str]] = []
        self.df: Counter[str] = Counter()
        self.avg_len = 0.0

    def fit(self, texts: list[str]) -> None:
        self.docs = [tokenize(t) for t in texts]
        self.df = Counter()
        for d in self.docs:
            self.df.update(set(d))
        self.avg_len = (sum(len(d) for d in self.docs) / len(self.docs)) if self.docs else 0.0

    def score(self, query: str, i: int) -> float:
        d = self.docs[i]
        if not d:
            return 0.0
        tf = Counter(d)
        n = len(self.docs)
        total = 0.0
        for q in set(tokenize(query)):
            if q not in tf:
                continue
            idf = math.log(1 + (n - self.df[q] + 0.5) / (self.df[q] + 0.5))
            denom = tf[q] + self.k1 * (1 - self.b + self.b * len(d) / (self.avg_len or 1))
            total += idf * tf[q] * (self.k1 + 1) / denom
        return total


# ─────────────────────────────────────────────────────────────
# 5. 색인 + 검색
# ─────────────────────────────────────────────────────────────

def rrf(rankings: list[list[str]], k: int = 60) -> dict[str, float]:
    """Reciprocal Rank Fusion — 점수 범위가 다른 검색기들을 '순위'만으로 합친다.

    BM25 점수(0~30)와 코사인 유사도(0~1)는 그냥 더할 수 없다. RRF 는 점수를 아예 안 본다.
    """
    scores: dict[str, float] = defaultdict(float)
    for ranking in rankings:
        for rank, cid in enumerate(ranking, start=1):
            scores[cid] += 1.0 / (k + rank)
    return dict(scores)


@dataclass
class Hit:
    chunk: Chunk
    score: float
    rank: int


class MiniRag:
    def __init__(self, embedder=None) -> None:
        self.embedder = embedder or TfidfEmbedder()
        self.bm25 = BM25()
        self.chunks: list[Chunk] = []
        self.vectors: list[dict[str, float]] = []

    def index(self, chunks: list[Chunk]) -> None:
        self.chunks = chunks
        texts = [c.text for c in chunks]
        self.embedder.fit(texts)
        self.bm25.fit(texts)
        self.vectors = [self.embedder.embed(t) for t in texts]

    # ── 메타데이터 필터는 '검색 전'에 적용한다 (엔터프라이즈 RAG 의 핵심) ──
    def _candidates(self, allow_docs: list[str] | None) -> list[int]:
        if not allow_docs:
            return list(range(len(self.chunks)))
        return [i for i, c in enumerate(self.chunks) if c.doc in allow_docs]

    def search_vector(self, q: str, k: int = 5, allow_docs=None) -> list[Hit]:
        qv = self.embedder.embed(q)
        cand = self._candidates(allow_docs)
        scored = sorted(
            ((self.embedder.cosine(qv, self.vectors[i]), i) for i in cand),
            key=lambda x: -x[0],
        )[:k]
        return [Hit(self.chunks[i], s, r) for r, (s, i) in enumerate(scored, 1)]

    def search_bm25(self, q: str, k: int = 5, allow_docs=None) -> list[Hit]:
        cand = self._candidates(allow_docs)
        scored = sorted(((self.bm25.score(q, i), i) for i in cand), key=lambda x: -x[0])[:k]
        return [Hit(self.chunks[i], s, r) for r, (s, i) in enumerate(scored, 1)]

    def search_hybrid(self, q: str, k: int = 5, pool: int = 20, allow_docs=None) -> list[Hit]:
        v = [h.chunk.id for h in self.search_vector(q, pool, allow_docs)]
        b = [h.chunk.id for h in self.search_bm25(q, pool, allow_docs)]
        fused = sorted(rrf([v, b]).items(), key=lambda x: -x[1])[:k]
        by_id = {c.id: c for c in self.chunks}
        return [Hit(by_id[cid], s, r) for r, (cid, s) in enumerate(fused, 1)]

    def search(self, q: str, mode: str = "hybrid", k: int = 5, allow_docs=None) -> list[Hit]:
        return {"vector": self.search_vector, "bm25": self.search_bm25,
                "hybrid": self.search_hybrid}[mode](q, k, allow_docs=allow_docs)


# ─────────────────────────────────────────────────────────────
# 6. 프롬프트 조립 — RAG 의 'G' 직전까지
# ─────────────────────────────────────────────────────────────

PROMPT_TEMPLATE = """당신은 사내 규정 안내 어시스턴트입니다.

규칙:
- 아래 <문서> 안의 내용만 근거로 답하십시오.
- 문서에 없는 내용은 추측하지 말고 "제공된 문서에서 확인할 수 없습니다"라고 답하십시오.
- 각 주장 끝에 [1], [2] 형식으로 근거 번호를 표시하십시오.
- 문서들이 서로 모순되면 그 사실을 알리고 각각을 제시하십시오.

<문서>
{context}
</문서>

질문: {question}
"""


def build_prompt(question: str, hits: list[Hit], budget: int = 4000) -> str:
    """토큰 예산 안에서 컨텍스트를 조립한다.

    실무 포인트 2가지:
      - 출처 번호를 붙여야 나중에 citation 을 매핑할 수 있다
      - LLM 은 프롬프트 가운데를 흘린다(lost in the middle) → 중요한 것을 앞뒤로
    """
    parts, used = [], 0
    for i, h in enumerate(hits, 1):
        block = f"[{i}] (출처: {h.chunk.doc} / {h.chunk.section})\n{h.chunk.text}\n"
        if used + len(block) > budget:
            break
        parts.append(block)
        used += len(block)
    return PROMPT_TEMPLATE.format(context="\n".join(parts), question=question)


# ─────────────────────────────────────────────────────────────
# 7. 평가 — 측정하지 않으면 조용히 나빠진다
# ─────────────────────────────────────────────────────────────

def _is_gold(hit: Hit, gold_phrases: list[str]) -> bool:
    """정답 판정: 그 청크 안에 '답이 적힌 문구'가 하나라도 들어 있는가.

    두 가지 설계 판단이 들어 있다.

    ① 문서가 아니라 '청크' 단위로 채점한다.
       문서 단위로 하면 문서가 3개뿐인 이 실습에서는 전부 만점이 나와 아무것도 구분하지 못한다.

    ② 정답 문구를 '리스트'로 받는다.
       한 질문에 답이 되는 청크가 여러 개일 수 있다. 예를 들어 "두 시간만 쓰고 싶다"는
       규정 제17조(반반차)로도, 인사팀 FAQ 로도 답할 수 있다.
       정답을 하나로만 잡아두면 멀쩡한 검색을 '실패'로 채점하게 되고,
       그러면 있지도 않은 문제를 고치려고 시간을 쓰게 된다.
       ← 평가셋을 처음 만들 때 실제로 가장 흔히 저지르는 실수다.
    """
    return any(g in hit.chunk.text for g in gold_phrases)


def recall_at_k(hits: list[Hit], gold_phrases: list[str], k: int) -> float:
    return 1.0 if any(_is_gold(h, gold_phrases) for h in hits[:k]) else 0.0


def mrr(hits: list[Hit], gold_phrases: list[str]) -> float:
    for rank, h in enumerate(hits, 1):
        if _is_gold(h, gold_phrases):
            return 1.0 / rank
    return 0.0


def _gold_of(case: dict) -> list[str]:
    g = case.get("gold_phrases") or case.get("gold_phrase")
    return g if isinstance(g, list) else [g]


def run_eval(rag: MiniRag, cases: list[dict], k: int = 5) -> dict:
    out = {}
    for mode in ("vector", "bm25", "hybrid"):
        r, m, misses = 0.0, 0.0, []
        for c in cases:
            gold = _gold_of(c)
            hits = rag.search(c["question"], mode=mode, k=max(k, 10))
            hit = recall_at_k(hits, gold, k)
            r += hit
            m += mrr(hits, gold)
            if hit == 0.0:
                misses.append(c["question"])
        n = len(cases) or 1
        out[mode] = {f"recall@{k}": r / n, "mrr": m / n, "misses": misses}
    return out


# ─────────────────────────────────────────────────────────────
# 8. CLI
# ─────────────────────────────────────────────────────────────

def load_chunks(strategy: str, size: int, overlap: int) -> list[Chunk]:
    chunks: list[Chunk] = []
    for path in sorted(DOCS_DIR.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        if strategy == "heading":
            chunks += chunk_by_heading(text, path.name)
        else:
            chunks += chunk_fixed(text, path.name, size, overlap)
    return chunks


def build_rag(args) -> MiniRag:
    chunks = load_chunks(args.strategy, args.chunk_size, args.overlap)
    embedder = None
    if args.embedder == "openai":
        if not os.environ.get("OPENAI_API_KEY"):
            sys.exit("OPENAI_API_KEY 가 없습니다. --embedder tfidf 로 실행하세요.")
        embedder = OpenAIEmbedder()
    rag = MiniRag(embedder)
    rag.index(chunks)
    print(f"· 청킹: {args.strategy} (size={args.chunk_size}, overlap={args.overlap}) "
          f"→ 청크 {len(chunks)}개 | 임베더: {rag.embedder.name}\n", file=sys.stderr)
    return rag


def print_hits(title: str, hits: list[Hit]) -> None:
    print(f"── {title}")
    if not hits:
        print("   (결과 없음)")
    for h in hits:
        preview = h.chunk.text.replace("\n", " ")[:90]
        print(f"   {h.rank}. [{h.score:6.4f}] {h.chunk.doc} / {h.chunk.section}")
        print(f"      {preview}...")
    print()


def main() -> None:
    p = argparse.ArgumentParser(description="미니 RAG — 의존성 없이 RAG 를 처음부터")
    p.add_argument("command", choices=["search", "compare", "eval", "chunks"])
    p.add_argument("question", nargs="?", default="")
    p.add_argument("--mode", default="hybrid", choices=["vector", "bm25", "hybrid"])
    p.add_argument("--k", type=int, default=5)
    p.add_argument("--strategy", default="heading", choices=["heading", "fixed"])
    p.add_argument("--chunk-size", type=int, default=400)
    p.add_argument("--overlap", type=int, default=40)
    p.add_argument("--embedder", default="tfidf", choices=["tfidf", "openai"])
    p.add_argument("--only", nargs="*", help="이 문서들로만 검색 (메타데이터 사전 필터 실습)")
    p.add_argument("--prompt", action="store_true", help="조립된 최종 프롬프트 출력")
    args = p.parse_args()

    if args.command == "chunks":
        for c in load_chunks(args.strategy, args.chunk_size, args.overlap):
            print(f"── {c.id}  ({len(c.text)}자)  {c.section}")
            print(c.text[:200].replace("\n", " "), "...\n")
        return

    rag = build_rag(args)

    if args.command == "eval":
        cases = [json.loads(l) for l in EVAL_FILE.read_text(encoding="utf-8").splitlines() if l.strip()]
        res = run_eval(rag, cases, k=args.k)
        print(f"평가 케이스 {len(cases)}개\n")
        print(f"{'mode':<8} {'recall@'+str(args.k):>10} {'MRR':>8}")
        for mode, m in res.items():
            print(f"{mode:<8} {m[f'recall@{args.k}']:>10.3f} {m['mrr']:>8.3f}")
        print()
        for mode, m in res.items():
            if m["misses"]:
                print(f"[{mode}] 놓친 질문 {len(m['misses'])}개:")
                for q in m["misses"]:
                    print(f"   - {q}")
        return

    if not args.question:
        sys.exit("질문을 입력하세요. 예: python minirag.py search '연차 며칠?'")

    if args.command == "compare":
        for mode in ("vector", "bm25", "hybrid"):
            print_hits(f"{mode}", rag.search(args.question, mode=mode, k=args.k, allow_docs=args.only))
        return

    hits = rag.search(args.question, mode=args.mode, k=args.k, allow_docs=args.only)
    print_hits(f"{args.mode} — {args.question}", hits)
    if args.prompt:
        print("=" * 70)
        print(build_prompt(args.question, hits))


if __name__ == "__main__":
    main()
