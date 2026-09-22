import "server-only";

import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";
import { CHAPTERS, type Chapter, type DocMeta } from "./chapters";

export * from "./chapters";

const ROOT = process.cwd();


/** 상대 마크다운 링크를 사이트 경로로 바꾸기 위한 색인 */
const FILE_TO_ROUTE = new Map<string, string>();
for (const c of CHAPTERS) {
  for (const d of c.docs) {
    FILE_TO_ROUTE.set(`${c.dir}/${d.file}`, `/docs/${c.id}/${d.slug}`);
  }
}

function slugifyHeading(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

export type Heading = { depth: number; text: string; id: string };

export function renderDoc(chapter: Chapter, doc: DocMeta): { html: string; headings: Heading[] } {
  const raw = fs.readFileSync(path.join(ROOT, chapter.dir, doc.file), "utf-8");
  const headings: Heading[] = [];
  const seen = new Map<string, number>();

  const renderer = new marked.Renderer();

  renderer.heading = function ({ tokens, depth }) {
    const text = this.parser.parseInline(tokens);
    const plain = text.replace(/<[^>]+>/g, "");
    let id = slugifyHeading(plain) || `h${headings.length}`;
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n > 0) id = `${id}-${n}`;
    if (depth === 2 || depth === 3) headings.push({ depth, text: plain, id });
    return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-label="이 절 링크">§</a>${text}</h${depth}>\n`;
  };

  renderer.link = function ({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    let target = href ?? "";

    if (target.endsWith(".md") || target.includes(".md#")) {
      const [filePart, hash] = target.split("#");
      // 문서 기준 상대 경로를 레포 루트 기준으로 정규화
      const resolved = path
        .normalize(path.join(chapter.dir, filePart))
        .replace(/\\/g, "/");
      const route = FILE_TO_ROUTE.get(resolved);
      if (route) target = hash ? `${route}#${hash}` : route;
      else target = `https://github.com/dlsxody1/langcode-onboarding/blob/main/${resolved}`;
    } else if (target.startsWith("../") || target.startsWith("./")) {
      const resolved = path.normalize(path.join(chapter.dir, target)).replace(/\\/g, "/");
      target = `https://github.com/dlsxody1/langcode-onboarding/blob/main/${resolved}`;
    }

    const external = target.startsWith("http");
    const attrs = external ? ' target="_blank" rel="noreferrer noopener"' : "";
    return `<a href="${target}"${title ? ` title="${title}"` : ""}${attrs}>${text}</a>`;
  };

  // 본문에 `02-csharp-dotnet/03-ef-core.md` 처럼 코드로 적힌 상호참조를 링크로 만든다.
  // 원본 .md 는 GitHub 에서도 읽으므로 그대로 두고, 사이트에서만 이어붙인다.
  renderer.codespan = function ({ text }) {
    const m = text.match(/^([\w.-]+\/[\w.-]+\.md)(?:\s*(\S+)\s*절)?$/);
    if (m) {
      const route = FILE_TO_ROUTE.get(m[1]);
      if (route) {
        const label = m[2] ? `${m[1]} ${m[2]}절` : m[1];
        return `<a class="xref" href="${route}"><code>${label}</code></a>`;
      }
    }
    return `<code>${text}</code>`;
  };

  // 표를 가로 스크롤 컨테이너로 감싼다 — 좁은 화면에서 레이아웃이 터지지 않게
  const baseTable = renderer.table.bind(renderer);
  renderer.table = function (token) {
    return `<div class="table-scroll">${baseTable(token)}</div>`;
  };

  const html = marked.parse(raw, { renderer, gfm: true, async: false }) as string;
  return { html, headings };
}
