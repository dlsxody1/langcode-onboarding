# 실습 3 — 측정 기록

새 기록은 위에 쌓는다. 4단계 평가 스크립트가 생기기 전에는 비어 있다.

```markdown
## YYYY-MM-DD — <단계> <바꾼 것 한 줄>
- 설정: parser=v1, chunk=section/600, search=bm25, synonyms=on, rerank=rules-v1, feedback=off, k=3
- Recall@1 / Recall@3 / MRR: 0.000 / 0.000 / 0.000  (직전 대비 ±0.000)
- 문항 종류별 Recall@3: 퀴즈 원문 0.00 / 패러프레이즈 0.00 / 사내 문서 0.00
- 형식별 Recall@3: md 0.00 / pdf 0.00 / docx 0.00
- audience 별 Recall@3: employee 0.00 / customer 0.00 · 권한 누출: 0건
- 좋아진 질문 / 나빠진 질문: ...
- 해석: ...
```
