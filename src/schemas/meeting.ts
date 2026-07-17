import { z } from "astro/zod";

// ─── MeetingMetadata ───────────────────────────────────────────────

/** 会议元数据 schema */
export const metadataSchema = z.object({
  /** 会议唯一标识符 */
  id: z.string(),
  /** 会议标题 */
  title: z.string(),
  /** 会议日期，格式 YYYY-MM-DD */
  date: z.string(),
  /** 会议时长（分钟） */
  duration: z.number().positive(),
  /** 会议平台，目前仅支持飞书 */
  platform: z.literal("feishu"),
  /** 会议原始链接 */
  source_url: z.string().url(),
  /** 参会人员列表 */
  participants: z.array(z.string()).default([]),
  /** 标签列表 */
  tags: z.array(z.string()).default([]),
});

/** 会议元数据类型 */
export type MeetingMetadata = z.infer<typeof metadataSchema>;

// ─── MeetingSegment ────────────────────────────────────────────────

/** 会议分段 schema，对应纪要中的章节划分 */
export const segmentSchema = z.object({
  /** 分段唯一标识符 */
  segment_id: z.string(),
  /** 分段标题 */
  title: z.string(),
  /** 分段开始时间，格式 mm:ss */
  start_time: z.string(),
  /** 分段结束时间，格式 mm:ss */
  end_time: z.string(),
  /** 分段摘要内容 */
  summary: z.string(),
  /** 发言人或主讲人姓名 */
  speaker: z.string(),
});

/** 会议分段类型 */
export type MeetingSegment = z.infer<typeof segmentSchema>;

// ─── Topic ─────────────────────────────────────────────────────────

/** 话题 schema，表示跨会议的热点话题 */
export const topicSchema = z.object({
  /** 话题唯一标识符 */
  topic_id: z.string(),
  /** 话题名称/标签 */
  label: z.string(),
  /** 话题关联的关键词列表 */
  keywords: z.array(z.string()).default([]),
  /** 关联的会议 ID 列表 */
  meeting_ids: z.array(z.string()).default([]),
  /** 话题首次出现日期 */
  first_seen_date: z.string(),
  /** 话题最近出现日期 */
  last_seen_date: z.string(),
  /** 话题出现频次 */
  frequency: z.number().int().min(0),
});

/** 话题类型 */
export type Topic = z.infer<typeof topicSchema>;

// ─── Decision ──────────────────────────────────────────────────────

/** 决策 schema，记录会议中做出的决策 */
export const decisionSchema = z.object({
  /** 决策唯一标识符 */
  decision_id: z.string(),
  /** 决策要解决的问题 */
  problem: z.string(),
  /** 备选方案列表 */
  options: z.array(z.string()).default([]),
  /** 最终决策内容 */
  decision: z.string(),
  /** 决策理由/依据 */
  rationale: z.string(),
  /** 决策日期 */
  date: z.string(),
});

/** 决策类型 */
export type Decision = z.infer<typeof decisionSchema>;

// ─── ActionItem ────────────────────────────────────────────────────

/** 待办事项 schema，记录会议中产生的行动项 */
export const actionItemSchema = z.object({
  /** 行动项唯一标识符 */
  action_id: z.string(),
  /** 待办任务描述 */
  task: z.string(),
  /** 负责人 */
  owner: z.string(),
  /** 截止日期，格式 YYYY-MM-DD */
  due_date: z.string(),
  /** 任务状态 */
  status: z.enum(["pending", "in_progress", "completed", "overdue"]),
  /** 来源会议 ID */
  source_meeting_id: z.string(),
  /** 优先级 */
  priority: z.enum(["low", "medium", "high"]),
});

/** 待办事项类型 */
export type ActionItem = z.infer<typeof actionItemSchema>;

// ─── KeyQuote ──────────────────────────────────────────────────────

/** 关键引言 schema，记录会议中的重要发言 */
export const keyQuoteSchema = z.object({
  /** 引言唯一标识符 */
  quote_id: z.string(),
  /** 引言原文 */
  text: z.string(),
  /** 发言人 */
  speaker: z.string(),
  /** 引言上下文/背景 */
  context: z.string(),
});

/** 关键引言类型 */
export type KeyQuote = z.infer<typeof keyQuoteSchema>;

// ─── Meeting（顶层容器） ───────────────────────────────────────────

/** 会议顶层 schema，聚合元数据、分段、决策、待办、引言等所有信息 */
export const meetingSchema = z.object({
  /** 会议元数据 */
  metadata: metadataSchema,
  /** 会议整体摘要 */
  summary: z.string(),
  /** 会议分段列表 */
  segments: z.array(segmentSchema).default([]),
  /** 决策列表 */
  decisions: z.array(decisionSchema).default([]),
  /** 行动项列表 */
  action_items: z.array(actionItemSchema).default([]),
  /** 关键引言列表 */
  key_quotes: z.array(keyQuoteSchema).default([]),
  /** 关键词列表 */
  keywords: z.array(z.string()).default([]),
  /** 原始文本摘要（未结构化的全文总结） */
  raw_text_summary: z.string(),
});

/** 会议类型 */
export type Meeting = z.infer<typeof meetingSchema>;
