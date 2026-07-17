import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const meetings = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/meetings' }),
  schema: z.object({
    metadata: z.object({
      id: z.string(),
      title: z.string(),
      date: z.string(),
      duration: z.number().positive(),
      platform: z.literal('feishu'),
      source_url: z.string(),
      participants: z.array(z.string()).default([]),
      tags: z.array(z.string()).default([]),
    }),
    summary: z.string(),
    segments: z.array(z.object({
      segment_id: z.string(),
      title: z.string(),
      start_time: z.string(),
      end_time: z.string(),
      summary: z.string(),
      speaker: z.string(),
    })).default([]),
    decisions: z.array(z.object({
      decision_id: z.string(),
      problem: z.string(),
      options: z.array(z.string()).default([]),
      decision: z.string(),
      rationale: z.string(),
      date: z.string(),
    })).default([]),
    action_items: z.array(z.object({
      action_id: z.string(),
      task: z.string(),
      owner: z.string(),
      due_date: z.string(),
      status: z.enum(['pending', 'in_progress', 'completed', 'overdue']),
      source_meeting_id: z.string(),
      priority: z.enum(['low', 'medium', 'high']),
    })).default([]),
    key_quotes: z.array(z.object({
      quote_id: z.string(),
      text: z.string(),
      speaker: z.string(),
      context: z.string(),
    })).default([]),
    keywords: z.array(z.string()).default([]),
    raw_text_summary: z.string(),
  }),
});

export const collections = { meetings };
