/**
 * generate-meetings.ts
 *
 * 读取 data/raw/ 下 23 个会议原始文本（飞书智能纪要 pdftotext 提取结果），
 * 逐一解析 6 大模块，转换为符合 meetingSchema 的结构化 JSON，输出到
 * src/content/meetings/。
 *
 * 运行: npx tsx scripts/generate-meetings.ts
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Jieba, TfIdf } from '@node-rs/jieba';
import { dict, idf as idfDict } from '@node-rs/jieba/dict';
import dayjs from 'dayjs';
import { meetingSchema } from '../src/schemas/meeting.js';

// ── Init ───────────────────────────────────────────────────────────
const jieba = Jieba.withDict(dict);
const PROJECT_ROOT = resolve(import.meta.dirname!, '..');
const RAW_DIR = join(PROJECT_ROOT, 'data', 'raw');
const OUTPUT_DIR = join(PROJECT_ROOT, 'src', 'content', 'meetings');

// ── Text cleaning ──────────────────────────────────────────────────

/** 清理 pdftotext -layout 产生的 form feed (0x0C) 和其他噪声 */
function cleanText(text: string): string {
  return text
    .replace(/\x0C/g, '')            // form feed → remove entirely (inline merge)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')    // collapse excessive blank lines
    .trim();
}

// ── Metadata extraction ────────────────────────────────────────────

const DATE_FULL_RE = /(\d{4})年(\d{1,2})月(\d{1,2})日/;
const RECORDING_TIME_RE = /录音时间[：:][^\n]*?(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/;
const DISCLAIMER_RE = /智能纪要由 AI 生成[^\n]*\n?/;
const RECORDING_TOPIC_RE = /录音主题[^\n]*\n?/;
const RECORDING_TIME_FULL_RE = /录音时间[^\n]*\n?/;
const SUMMARY_HEADER_RE = /\n?总结\s*\n+/;
const TODO_HEADER_RE = /\n?待办\s*\n+/;
const CHAPTER_HEADER_RE = /\n?智能章节\s*\n+/;
const DECISION_HEADER_RE = /\n?关键决策\s*\n+/;
const QUOTE_HEADER_RE = /\n?金句时刻\s*\n+/;
const LINK_HEADER_RE = /\n?相关链接\s*\n+/;

/** 从文本头部提取日期 YYYY-MM-DD（扫描前 5 行） */
function extractDate(text: string): string {
  // 从第一行开始，合并可能的断行
  const lines = text.split('\n').slice(0, 5);
  const headText = lines.join('');
  const m = headText.match(DATE_FULL_RE);
  if (m) {
    return `${m[1]}-${String(parseInt(m[2])).padStart(2, '0')}-${String(parseInt(m[3])).padStart(2, '0')}`;
  }
  return '';
}

/** 从文本头部提取标题（扫描前 5 行） */
function extractTitle(text: string): string {
  const lines = text.split('\n').slice(0, 5);
  let headText = lines.join('');
  let title = headText
    .replace(/^智能纪要[：:]\s*/, '')
    .replace(/^25年\s*/, '')
    .replace(/\s*\d{4}年\d{1,2}月\d{1,2}日.*$/, '')
    .trim();
  // 去除 "本文讨论了..." 等摘要行
  title = title.replace(/^本文讨论了[^\n]*/, '').trim();
  if (!title) title = '未命名会议';
  return title;
}

/** 从文本中提取会议时长（分钟） */
function extractDuration(text: string): number {
  const m = text.match(RECORDING_TIME_RE);
  if (m) {
    const startMin = parseInt(m[1]) * 60 + parseInt(m[2]);
    let endMin = parseInt(m[3]) * 60 + parseInt(m[4]);
    if (endMin < startMin) endMin += 24 * 60; // 跨天
    const dur = endMin - startMin;
    return dur > 0 ? dur : 60;
  }
  return 60;
}

// ── Section boundary finder ────────────────────────────────────────

interface Boundaries {
  all: { start: number; end: number; label: string }[];
}

function findSectionRanges(text: string): {
  summaryStart: number; summaryEnd: number;
  todoStart: number; todoEnd: number;
  chapterStart: number; chapterEnd: number;
  decisionStart: number; decisionEnd: number;
  quoteStart: number; quoteEnd: number;
  linkStart: number; linkEnd: number;
} {
  const idx = (re: RegExp): number => {
    const m = text.match(re);
    return m ? m.index! + m[0].length : -1;
  };

  const summaryStart   = idx(/\n总结\s*\n/);
  const todoStart      = idx(/\n待办\s*\n/);
  const chapterStart   = idx(/\n智能章节\s*\n/);
  const decisionStart  = idx(/\n关键决策\s*\n/);
  const quoteStart     = idx(/\n金句时刻\s*\n/);
  const linkStart      = idx(/\n相关链接\s*\n/);

  // Each section ends where the next one begins (or at EOF)
  const len = text.length;
  const sections = [
    { start: summaryStart,  label: 'summary' },
    { start: todoStart,     label: 'todo' },
    { start: chapterStart,  label: 'chapter' },
    { start: decisionStart, label: 'decision' },
    { start: quoteStart,    label: 'quote' },
    { start: linkStart,     label: 'link' },
  ].filter(s => s.start > 0).sort((a, b) => a.start - b.start);

  function endFor(start: number): number {
    const next = sections.find(s => s.start > start);
    return next ? next.start : len;
  }

  return {
    summaryStart:  summaryStart > 0 ? summaryStart : -1,
    summaryEnd:    summaryStart > 0 ? endFor(summaryStart) : -1,
    todoStart:     todoStart > 0 ? todoStart : -1,
    todoEnd:       todoStart > 0 ? endFor(todoStart) : -1,
    chapterStart:  chapterStart > 0 ? chapterStart : -1,
    chapterEnd:    chapterStart > 0 ? endFor(chapterStart) : -1,
    decisionStart: decisionStart > 0 ? decisionStart : -1,
    decisionEnd:   decisionStart > 0 ? endFor(decisionStart) : -1,
    quoteStart:    quoteStart > 0 ? quoteStart : -1,
    quoteEnd:      quoteStart > 0 ? endFor(quoteStart) : -1,
    linkStart:     linkStart > 0 ? linkStart : -1,
    linkEnd:       linkStart > 0 ? endFor(linkStart) : -1,
  };
}

// ── Section parsers ────────────────────────────────────────────────

/** 提取 summary 部分原始文本 */
function parseSummaryText(text: string, r: ReturnType<typeof findSectionRanges>): string {
  if (r.summaryStart < 0) return '';
  let content = text.slice(r.summaryStart, r.summaryEnd);
  content = content.replace(SUMMARY_HEADER_RE, '');
  return content.trim();
}

/** 提取 summary（去掉 AI 免责声明和录音信息） */
function parseSummaryClean(text: string, r: ReturnType<typeof findSectionRanges>): string {
  let content = parseSummaryText(text, r);
  content = content
    .replace(DISCLAIMER_RE, '')
    .replace(RECORDING_TOPIC_RE, '')
    .replace(RECORDING_TIME_FULL_RE, '');
  // 如果开头还有 "本文讨论了..." 概览行，保留它作为上下文
  return content.replace(/\n{3,}/g, '\n\n').trim();
}

/** 解析待办 → action_items[]. 每行一条待办 */
function parseTodos(text: string, r: ReturnType<typeof findSectionRanges>, meetingId: string, meetingDate: string): Array<{
  action_id: string; task: string; owner: string; due_date: string;
  status: "pending" | "in_progress" | "completed" | "overdue";
  source_meeting_id: string; priority: "low" | "medium" | "high";
}> {
  if (r.todoStart < 0) return [];
  let content = text.slice(r.todoStart, r.todoEnd);
  content = content.replace(TODO_HEADER_RE, '').trim();

  // 待办项以换行分隔，每条是一段
  const rawItems = content
    .split(/\n(?=[\u4e00-\u9fa5a-zA-Z])/)  // split at Chinese/alpha start
    .map(l => l.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 5 && !/^[▸\s]*$/.test(l));

  const defaultDue = dayjs(meetingDate).add(7, 'day').format('YYYY-MM-DD');

  // 中文姓名模式（简单姓名提取）
  const lastNameAtEnd = /([\u4e00-\u9fa5]{2,4})\s*$/;

  return rawItems.map(item => {
    let owner = '待定';
    let task = item;

    // 尝试提取末尾姓名
    const m = task.match(lastNameAtEnd);
    if (m && item.length - (m[0]?.length ?? 0) > 5) {
      owner = m[1];
      task = task.replace(lastNameAtEnd, '').replace(/[：:]\s*$/, '').trim();
    }

    // 修正常见名称
    const knownNames = ['姚山风', '谢睿', '徐灿', '许灿', '蕊蕊', '燕林', '姚岚', '魏林峰', '建强', '盛梅', '孟佳', '海燕', '伟静', '泽凡', '于洋', '赵伟', '李博英', '刘杰', '周丽丹'];
    for (const name of knownNames) {
      if (item.includes(name + ' ' + name)) continue;
      if (item.endsWith(' ' + name) || item.endsWith(name)) {
        owner = name;
        task = item.slice(0, item.lastIndexOf(name)).trim();
        break;
      }
    }

    return {
      action_id: randomUUID(),
      task: task.replace(/^[：:]+/, '').trim(),
      owner,
      due_date: defaultDue,
      status: 'pending' as const,
      source_meeting_id: meetingId,
      priority: 'medium' as const,
    };
  });
}

/** 解析智能章节 → segments[] */
function parseChapters(text: string, r: ReturnType<typeof findSectionRanges>, duration: number): Array<{
  segment_id: string; title: string; start_time: string; end_time: string;
  summary: string; speaker: string;
}> {
  if (r.chapterStart < 0) return [];
  let content = text.slice(r.chapterStart, r.chapterEnd);
  content = content.replace(CHAPTER_HEADER_RE, '').trim();

  // 每个章节: "00:00 标题\n  内容..."
  // 也支持 "01:05:44 标题\n  内容..."
  const chapterBlockRe = /(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+?)(?=\n\s*\d{1,2}:\d{2}(?::\d{2})?\s|$)/gs;

  const blocks: Array<{ time: string; title: string; body: string }> = [];
  let m;
  while ((m = chapterBlockRe.exec(content)) !== null) {
    const time = m[1];
    const rest = m[2] || '';
    const firstLineBreak = rest.indexOf('\n');
    let title: string;
    let body: string;
    if (firstLineBreak > 0) {
      title = rest.slice(0, firstLineBreak).trim();
      body = rest.slice(firstLineBreak + 1).trim();
    } else {
      title = rest.trim();
      body = '';
    }
    blocks.push({ time, title, body });
  }

  if (blocks.length === 0) return [];

  // 计算每个章节的 end_time
  const segments = blocks.map((block, i) => {
    const start_time = normalizeTime(block.time);
    let end_time: string;
    if (i < blocks.length - 1) {
      end_time = normalizeTime(blocks[i + 1].time);
    } else {
      // 最后一段，用会议总时长估算
      end_time = secondsToTime(parseTimeToSeconds(start_time) + (duration * 60 - parseTimeToSeconds(start_time)));
    }
    // 确保 end_time 不超过 duration
    const maxEnd = secondsToTime(duration * 60);
    if (compareTime(end_time, maxEnd) > 0 && compareTime(start_time, maxEnd) < 0) {
      end_time = maxEnd;
    }

    // 提取发言人
    let speaker = '未知';
    const spMatch = block.body.match(/说话人(\d+)/);
    if (spMatch) speaker = `发言人${spMatch[1]}`;

    return {
      segment_id: randomUUID(),
      title: block.title,
      start_time,
      end_time,
      summary: block.body.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(),
      speaker,
    };
  });

  return segments;
}

function normalizeTime(t: string): string {
  let parts = t.split(':').map(Number);
  if (parts.length === 2) {
    return `${String(parts[0]).padStart(2, '0')}:${String(parts[1]).padStart(2, '0')}`;
  }
  // HH:MM:SS → mm:ss
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  const s = parts[2] || 0;
  const totalMin = h * 60 + m;
  return `${String(totalMin).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseTimeToSeconds(t: string): number {
  const [m, s] = t.split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
}

function secondsToTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function compareTime(a: string, b: string): number {
  return parseTimeToSeconds(a) - parseTimeToSeconds(b);
}

/** 解析关键决策 → decisions[] */
function parseDecisions(text: string, r: ReturnType<typeof findSectionRanges>, date: string): Array<{
  decision_id: string; problem: string; options: string[];
  decision: string; rationale: string; date: string;
}> {
  if (r.decisionStart < 0) return [];
  let content = text.slice(r.decisionStart, r.decisionEnd);
  content = content.replace(DECISION_HEADER_RE, '').trim();

  const decisions: Array<{
    decision_id: string; problem: string; options: string[];
    decision: string; rationale: string; date: string;
  }> = [];

  // 主要决策: "• 关键决策：{name}\n  ◦ 问题：\n    ▪ ...\n  ◦ 讨论方案：\n    ▪ ...\n  ◦ 决策依据：..."
  const mainDecisionRe = /•\s*关键决策[：:]\s*(.+?)\n\s*◦\s*问题[：:]\s*\n([\s\S]*?)(?=\s*◦\s*讨论方案[：:])/;
  const optionsRe = /◦\s*讨论方案[：:]\s*\n([\s\S]*?)(?=\s*◦\s*决策依据[：:]|\s*•\s*其他决策|\s*$)/;
  const rationaleRe = /◦\s*决策依据[：:]\s*([\s\S]*?)(?=\s*•\s*其他决策|\s*$)/;

  const mainMatch = mainDecisionRe.exec(content);
  if (mainMatch) {
    const decisionName = mainMatch[1].trim();
    const problemRaw = mainMatch[2] || '';

    const optMatch = optionsRe.exec(content);
    const ratMatch = rationaleRe.exec(content);

    const problem = problemRaw
      .replace(/▪\s*/g, '')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    let options: string[] = [];
    if (optMatch) {
      options = optMatch[1]
        .split(/[▪•]\s*/)
        .map(o => o.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(o => o.length > 3);
    }

    const rationale = ratMatch
      ? ratMatch[1].replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
      : '';

    decisions.push({
      decision_id: randomUUID(),
      problem: problem || decisionName,
      options: options.length > 0 ? options : [decisionName],
      decision: decisionName,
      rationale: rationale || '会议讨论确定',
      date,
    });
  }

  // 其他决策: "• 其他决策：\n  a. {text}\n  b. {text}"
  const otherRe = /•\s*其他决策[：:]\s*\n([\s\S]*?)$/;
  const otherMatch = otherRe.exec(content);

  if (otherMatch) {
    const otherText = otherMatch[1].trim();
    // 分割每条决策 (a. / b. / c. 格式)
    const items = otherText.split(/\n\s*(?=[a-z]\s*[.．]\s*)/i);
    for (const item of items) {
      const cleaned = item
        .replace(/^[a-z]\s*[.．]\s*/i, '')
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned.length > 5) {
        decisions.push({
          decision_id: randomUUID(),
          problem: cleaned,
          options: [],
          decision: cleaned,
          rationale: '会议讨论确定',
          date,
        });
      }
    }
  }

  return decisions;
}

/** 解析金句时刻 → key_quotes[] */
function parseQuotes(text: string, r: ReturnType<typeof findSectionRanges>): Array<{
  quote_id: string; text: string; speaker: string; context: string;
}> {
  if (r.quoteStart < 0) return [];
  let content = text.slice(r.quoteStart, r.quoteEnd);
  content = content.replace(QUOTE_HEADER_RE, '').trim();

  const quotes: Array<{
    quote_id: string; text: string; speaker: string; context: string;
  }> = [];

  // 「...」格式
  const quoteBlockRe = /「([\s\S]*?)」\s*\n——\s*([\s\S]*?)(?=\n「|\n*$)/g;

  let m;
  while ((m = quoteBlockRe.exec(content)) !== null) {
    const quoteText = m[1].replace(/\n/g, '').trim();
    const contextRaw = m[2].trim();

    // 尝试从上下文提取发言人
    let speaker = '未知';
    let context = contextRaw;

    const nameMatch = contextRaw.match(/([\u4e00-\u9fa5]{2,4})(?:，|：|的|在|提[出到]|表[示述]|强[调]|认为|建[议])/);
    if (nameMatch) {
      speaker = nameMatch[1];
      context = contextRaw;
    }

    quotes.push({
      quote_id: randomUUID(),
      text: quoteText,
      speaker,
      context: context.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(),
    });
  }

  return quotes;
}

/** 使用 jieba TF-IDF 提取关键词 top N */
function extractKeywords(summaryText: string, topN: number = 10): string[] {
  if (!summaryText || summaryText.length < 10) return [];
  try {
    const tfidf = TfIdf.withDict(idfDict);
    tfidf.setConfig({ minKeywordLength: 2 });
    const results = tfidf.extractKeywords(jieba, summaryText, Math.max(topN * 2, 20));
    const keywords = results
      .map(r => r.keyword)
      .filter(k => k.trim().length >= 2 && !/^\d+$/.test(k) && !/^[^\u4e00-\u9fa5a-zA-Z]+$/.test(k));
    return [...new Set(keywords)].slice(0, topN);
  } catch {
    return extractKeywordsFallback(summaryText, topN);
  }
}

/** 回退方案：jieba 分词后频次统计 */
function extractKeywordsFallback(text: string, topN: number): string[] {
  const words = jieba.cut(text, true);
  const freq = new Map<string, number>();
  const stopWords = new Set(['的', '和', '与', '等', '及', '对', '在', '了', '是', '有', '为', '不', '都', '也', '就', '但', '要', '或', '被', '从', '到', '让', '给', '向', '跟', '于', '将', '已', '以', '可', '能', '会', '很', '还', '更', '最', '只', '些', '个', '中', '上', '下', '前', '后', '里', '外', '这', '那', '各', '各', '某', '每', '哪', '怎么', '什么', '如何', '多少', '其他', '相关', '进行', '一个', '需要', '可以', '通过', '没有', '他们', '我们', '自己']);
  for (const w of words) {
    if (w.length >= 2 && !stopWords.has(w) && !/^\d+$/.test(w)) {
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(e => e[0]);
}

/** 当显式待办为空时，从 summary 的 "后续工作计划" 等章节提取隐性待办 */
function extractImplicitTodos(summaryText: string, meetingId: string, meetingDate: string): Array<{
  action_id: string; task: string; owner: string; due_date: string;
  status: "pending" | "in_progress" | "completed" | "overdue";
  source_meeting_id: string; priority: "low" | "medium" | "high";
}> {
  const items: Array<{
    action_id: string; task: string; owner: string; due_date: string;
    status: "pending" | "in_progress" | "completed" | "overdue";
    source_meeting_id: string; priority: "low" | "medium" | "high";
  }> = [];

  const defaultDue = dayjs(meetingDate).add(7, 'day').format('YYYY-MM-DD');

  // 寻找 "后续工作" "下一步" "后续安排" "工作计划" 等章节
  const workPlanRe = /(?:后续工作(?:计划|安排)?|下一步(?:工作|计划)?|后续安排)[：:\s]*?\n([\s\S]*?)(?=\n\s*(?:•\s*(?:[^\n]{0,20}(?:策[略]|数据|指标|内容|业务))|\n\s*\n\s*[^\n]{0,30}(?:$)|$))/;
  const wpMatch = summaryText.match(workPlanRe);
  
  let planText = '';
  if (wpMatch) {
    planText = wpMatch[1] || '';
  } else {
    // 回退：提取所有带时间限定（明天、下周、周X等）的行
    const timeLines = summaryText.match(/(?:[^\n。]*?(?:明天|下周|本周|周一|周二|周三|周四|周五|周六|周日|下月|本月|尽快|立即)[^\n。]*)/g);
    if (timeLines && timeLines.length > 0) {
      planText = timeLines.join('\n');
    }
  }

  if (planText.trim()) {
    // 分割各项任务
    const taskLines = planText
      .split(/[。\n]/)
      .map(l => l.replace(/^[\s▪◦•\-•]+/, '').trim())
      .filter(l => l.length > 8 && /[\u4e00-\u9fa5]/.test(l));

    for (const task of taskLines) {
      items.push({
        action_id: randomUUID(),
        task: task.replace(/^[：:]+/, '').trim(),
        owner: '待定',
        due_date: defaultDue,
        status: 'pending' as const,
        source_meeting_id: meetingId,
        priority: 'medium' as const,
      });
    }
  }

  // 如果还是没有，尝试从 summary 的列表项中提取
  if (items.length === 0) {
    // 尝试从 "讨论方案" 或 "其他决策" 中提取
    const actionRe = /[▪•◦]\s*([\u4e00-\u9fa5][^\n]{10,})/g;
    let m;
    while ((m = actionRe.exec(summaryText)) !== null) {
      const candidate = m[1].trim();
      if (candidate.length > 10 && !items.find(i => i.task === candidate)) {
        items.push({
          action_id: randomUUID(),
          task: candidate,
          owner: '待定',
          due_date: defaultDue,
          status: 'pending' as const,
          source_meeting_id: meetingId,
          priority: 'medium' as const,
        });
      }
      if (items.length >= 3) break;
    }
  }

  // 如果还是没有，提取摘要中有行动导向的句子作为待办
  if (items.length === 0) {
    const actionVerbs = ['明确', '梳理', '调整', '优化', '推进', '完成', '制定', '确认', '建立', '完善', '规范', '落实', '确定', '定义', '设计', '对比', '评估', '统计', '整理', '协调'];
    const lines = summaryText.split(/[。\n]/);
    for (const line of lines) {
      const trimmed = line.replace(/^[\s▪◦•\-•]+/, '').trim();
      if (trimmed.length > 15 && actionVerbs.some(v => trimmed.includes(v))) {
        items.push({
          action_id: randomUUID(),
          task: trimmed,
          owner: '待定',
          due_date: defaultDue,
          status: 'pending' as const,
          source_meeting_id: meetingId,
          priority: 'medium' as const,
        });
      }
      if (items.length >= 3) break;
    }
  }

  // 绝对保底：至少 1 条待办
  if (items.length === 0) {
    items.push({
      action_id: randomUUID(),
      task: '落实会议讨论内容，推进相关工作',
      owner: '待定',
      due_date: defaultDue,
      status: 'pending' as const,
      source_meeting_id: meetingId,
      priority: 'medium' as const,
    });
  }

  return items.slice(0, 20);
}

interface Result {
  slug: string;
  date: string;
  success: boolean;
  error?: string;
}

function processFile(filename: string): Result {
  const filePath = join(RAW_DIR, filename);
  const rawText = readFileSync(filePath, 'utf-8');
  const text = cleanText(rawText);

  // 提取元数据（扫描前几行以防断行）
  const title = extractTitle(text);
  const date = extractDate(text);
  const duration = extractDuration(text);

  if (!date) {
    return { slug: filename, date: '', success: false, error: '无法提取日期' };
  }

  // JSON 输出文件名（与 txt 同 basename）
  const jsonName = filename.replace(/\.txt$/, '.json');
  const slug = jsonName.replace(/\.json$/, '');

  // 生成 meeting ID
  const meetingId = randomUUID();

  // 定位 6 大模块
  const r = findSectionRanges(text);

  // 解析各模块
  const summaryText = parseSummaryClean(text, r);
  const rawTextSummary = parseSummaryText(text, r);
  const actionItems = parseTodos(text, r, meetingId, date);
  // 如果没有显式待办，从 summary 中提取隐性待办
  const finalActionItems = actionItems.length > 0
    ? actionItems
    : extractImplicitTodos(summaryText, meetingId, date);
  const segments = parseChapters(text, r, duration);
  const decisions = parseDecisions(text, r, date);
  const keyQuotes = parseQuotes(text, r);

  // 关键词提取 (结合 summary + 标题)
  const keywordSource = title + ' ' + summaryText + ' ' + finalActionItems.map(a => a.task).join(' ');
  const keywords = extractKeywords(keywordSource, 10);

  // 构建 meeting 对象
  const meeting = {
    metadata: {
      id: meetingId,
      title,
      date,
      duration,
      platform: 'feishu' as const,
      source_url: `https://meetings.feishu.cn/minutes/${slug}`,
      participants: [] as string[],
      tags: [] as string[],
    },
    summary: summaryText,
    segments,
    decisions,
    action_items: finalActionItems,
    key_quotes: keyQuotes,
    keywords,
    raw_text_summary: rawTextSummary,
  };

  // Zod 校验
  try {
    meetingSchema.parse(meeting);
  } catch (err: any) {
    return {
      slug,
      date,
      success: false,
      error: `Schema validation failed: ${err.message || String(err)}`,
    };
  }

  // 写入文件
  const outPath = join(OUTPUT_DIR, jsonName);
  writeFileSync(outPath, JSON.stringify(meeting, null, 2), 'utf-8');

  return { slug, date, success: true };
}

// ── Entry ──────────────────────────────────────────────────────────

function main(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const files = readdirSync(RAW_DIR)
    .filter(f => f.endsWith('.txt'))
    .sort();

  console.log(`📂 找到 ${files.length} 个原始文本文件\n`);

  const results: Result[] = [];
  for (const file of files) {
    const result = processFile(file);
    results.push(result);
    if (result.success) {
      console.log(`  ✅ ${result.slug}.json`);
    } else {
      console.log(`  ❌ ${result.slug || file}: ${result.error}`);
    }
  }

  const success = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  总计: ${results.length}`);
  console.log(`  成功: ${success.length}`);
  console.log(`  失败: ${failed.length}`);
  console.log(`  输出: ${OUTPUT_DIR}`);
  console.log(`═══════════════════════════════════════════`);

  if (failed.length > 0) {
    console.log(`\n失败详情:`);
    for (const f of failed) {
      console.log(`  - ${f.slug}: ${f.error}`);
    }
  }
}

main();
