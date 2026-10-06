/**
 * 문서 헤딩의 id(앵커) 규칙. 사이트(lib/content.ts)와 실습 3 파서(labs/lab3-rag/scripts)가 함께 쓴다.
 * 근거 카드의 "원문 보기" 링크(/docs/<chapter>/<doc>#<id>)가 정확한 절로 가려면 둘이 같은 규칙이어야 한다.
 * Node 스크립트에서도 바로 import 할 수 있게 의존성 없이 둔다.
 */

export function slugifyHeading(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

/** marked 가 렌더링한 헤딩 인라인 HTML 에서 태그를 걷어 낸 글자 */
export function headingPlainText(inlineHtml: string) {
  return inlineHtml.replace(/<[^>]+>/g, "");
}

/**
 * 한 문서 안에서 헤딩 id 를 차례로 발급한다. 같은 id 가 다시 나오면 `-1`, `-2` 를 붙인다.
 * id 를 만들 수 없는 헤딩(기호뿐)은 `h<지금까지 목차에 오른 헤딩 수>` 로 대신한다.
 */
export class HeadingIds {
  private seen = new Map<string, number>();
  private tocCount = 0;

  next(plain: string, depth: number) {
    let id = slugifyHeading(plain) || `h${this.tocCount}`;
    const n = this.seen.get(id) ?? 0;
    this.seen.set(id, n + 1);
    if (n > 0) id = `${id}-${n}`;
    if (depth === 2 || depth === 3) this.tocCount++;
    return id;
  }
}
