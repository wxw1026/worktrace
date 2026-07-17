import { z } from "astro/zod";

// ─── TopicTrend ────────────────────────────────────────────────────

/** 话题趋势 schema，记录某话题在各月份的提及次数 */
export const topicTrendSchema = z.object({
  /** 话题标签名称 */
  topic_label: z.string(),
  /** 各月份出现次数列表，month 格式 YYYY-MM */
  monthly_counts: z.array(
    z.object({
      /** 月份，格式 YYYY-MM */
      month: z.string(),
      /** 该月出现次数 */
      count: z.number().int().min(0),
    })
  ).default([]),
});

/** 话题趋势类型 */
export type TopicTrend = z.infer<typeof topicTrendSchema>;

// ─── TodoSummary ───────────────────────────────────────────────────

/** 待办摘要 schema，汇总各状态的待办事项数量 */
export const todoSummarySchema = z.object({
  /** 待处理数量 */
  total_pending: z.number().int().min(0),
  /** 进行中数量 */
  total_in_progress: z.number().int().min(0),
  /** 已完成数量 */
  total_completed: z.number().int().min(0),
  /** 已逾期数量 */
  total_overdue: z.number().int().min(0),
});

/** 待办摘要类型 */
export type TodoSummary = z.infer<typeof todoSummarySchema>;

// ─── KeywordHeatmap ────────────────────────────────────────────────

/** 关键词共现热度 schema，记录关键词对及共现次数 */
export const keywordHeatmapSchema = z.object({
  /** 关键词对及共现次数列表 */
  keyword_pairs: z.array(
    z.object({
      /** 关键词 1 */
      keyword1: z.string(),
      /** 关键词 2 */
      keyword2: z.string(),
      /** 共现次数 */
      co_occurrence_count: z.number().int().min(0),
    })
  ).default([]),
});

/** 关键词共现热度类型 */
export type KeywordHeatmap = z.infer<typeof keywordHeatmapSchema>;
