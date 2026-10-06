/**
 * 토크나이저: 어절 + 한글 문자 bigram. labs/lab2-mini-rag/minirag.py 의 tokenize() 를 그대로 옮겼다.
 *
 * 한국어는 교착어라 "휴가를 / 휴가는 / 휴가가" 가 전부 다른 어절이 된다.
 * 형태소 분석기(mecab-ko, Kiwi)가 정석이지만, 의존성 없이 흉내 내려면 문자 bigram 이 싸고 쓸 만하다.
 * "휴가를" → 휴가를, 휴가, 가를 — 조사가 달라도 "휴가" 조각으로 서로 걸린다.
 *
 * 색인(scripts)과 검색(서버)이 반드시 같은 함수를 써야 한다. 한쪽만 바꾸면 아무것도 안 걸린다.
 * 그래서 의존성 없이 두고, Node 스크립트에서도 바로 import 한다.
 */

const WORD = /[a-z0-9]+|[가-힣]+/g;
const HANGUL_WORD = /^[가-힣]{2,}$/;

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const w of text.toLowerCase().match(WORD) ?? []) {
    tokens.push(w);
    if (HANGUL_WORD.test(w)) for (let i = 0; i < w.length - 1; i++) tokens.push(w.slice(i, i + 2));
  }
  return tokens;
}
