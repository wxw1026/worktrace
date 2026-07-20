import Fuse, { type FuseResultMatch } from 'fuse.js';

export interface SearchEntry {
  id: string;
  data: {
    metadata: { title: string; date: string };
    summary: string;
    raw_text_summary: string;
  };
}

export interface SearchResult {
  item: SearchEntry;
  score: number;
  titleHighlight: string;
  snippetHighlight: string;
}

/**
 * 搜索会议（供服务端 API / 构建脚本调用）
 * - 模糊搜索 title / summary / raw_text_summary
 * - 返回高亮分词 + 上下文摘要
 */
export function searchMeetings(query: string, meetings: SearchEntry[], limit = 8): SearchResult[] {
  if (!query.trim()) return [];

  const fuse = new Fuse(meetings, {
    keys: ['data.metadata.title', 'data.summary', 'data.raw_text_summary'],
    threshold: 0.4,
    includeMatches: true,
    minMatchCharLength: 1,
    ignoreLocation: true,
  });

  const raw = fuse.search(query, { limit });

  return raw.map((r) => {
    const titleMatches = r.matches?.filter((m) => m.key === 'data.metadata.title');
    const bodyMatches = r.matches?.filter(
      (m) => m.key === 'data.summary' || m.key === 'data.raw_text_summary',
    );

    return {
      item: r.item,
      score: r.score ?? 1,
      titleHighlight: highlightText(r.item.data.metadata.title, titleMatches),
      snippetHighlight: buildSnippet(
        r.item.data.summary || r.item.data.raw_text_summary,
        bodyMatches,
        120,
      ),
    };
  });
}

/** 在文本中对匹配位置添加 <mark> 标签 */
function highlightText(
  text: string,
  matches: readonly FuseResultMatch[] | undefined,
): string {
  if (!matches || matches.length === 0) return escapeHtml(text);

  const indices: [number, number][] = [];
  for (const m of matches) {
    if (m.indices) indices.push(...(m.indices as [number, number][]));
  }
  if (indices.length === 0) return escapeHtml(text);

  indices.sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [];
  for (const [start, end] of indices) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  let result = '';
  let cursor = 0;
  for (const [s, e] of merged) {
    result += escapeHtml(text.slice(cursor, s));
    result += `<mark class="search-highlight">${escapeHtml(text.slice(s, e + 1))}</mark>`;
    cursor = e + 1;
  }
  result += escapeHtml(text.slice(cursor));
  return result;
}

/** 构建上下文摘要（首个匹配附近 120 字符），高亮匹配 */
function buildSnippet(
  text: string,
  matches: readonly FuseResultMatch[] | undefined,
  maxLen: number,
): string {
  if (!text) return '';
  if (!matches || matches.length === 0) {
    return escapeHtml(text.length > maxLen ? text.slice(0, maxLen) + '…' : text);
  }

  const allIndices: [number, number][] = [];
  for (const m of matches) {
    if (m.indices) allIndices.push(...(m.indices as [number, number][]));
  }
  if (allIndices.length === 0) {
    return escapeHtml(text.length > maxLen ? text.slice(0, maxLen) + '…' : text);
  }

  allIndices.sort((a, b) => a[0] - b[0]);
  const firstMatch = allIndices[0][0];
  const half = Math.floor(maxLen / 2);
  let start = Math.max(0, firstMatch - half);
  let end = Math.min(text.length, start + maxLen);

  // Adjust all indices to snippet-relative positions
  const relMatches = matches.map((m) => ({
    key: m.key,
    indices: (m.indices as [number, number][] | undefined)?.map(
      ([s, e]) => [Math.max(0, s - start), Math.min(end - start, e - start)] as [number, number],
    ),
    value: m.value,
  }));

  let snippet = text.slice(start, end);
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet = snippet + '…';

  return highlightText(snippet, relMatches as FuseResultMatch[]);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
