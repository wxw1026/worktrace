import Fuse from 'fuse.js';

export interface SearchEntry {
  id: string;
  title: string;
  date: string;
  summary: string;
  raw_text_summary: string;
}

/**
 * 创建 fuse.js 模糊搜索索引
 * 搜索 title / summary / raw_text_summary 三个字段
 */
export function createSearchIndex(items: SearchEntry[]) {
  return new Fuse(items, {
    keys: ['title', 'summary', 'raw_text_summary'],
    threshold: 0.3,
    includeMatches: true,
    minMatchCharLength: 1,
    ignoreLocation: true,
  });
}
