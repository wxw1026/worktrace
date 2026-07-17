/**
 * validate-meetings.ts — 验证所有生成的 JSON 文件
 * 运行: npx tsx scripts/validate-meetings.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { meetingSchema } from '../src/schemas/meeting.js';

const PROJECT_ROOT = resolve(import.meta.dirname!, '..');
const MEETINGS_DIR = join(PROJECT_ROOT, 'src', 'content', 'meetings');

const files = readdirSync(MEETINGS_DIR).filter(f => f.endsWith('.json'));

console.log(`📊 验证 ${files.length} 个 JSON 文件\n`);

let allPass = true;
const slugs = new Set<string>();
const issues: string[] = [];
let totalActions = 0, totalDecisions = 0, totalQuotes = 0, totalKeywords = 0, totalSegments = 0;

for (const file of files.sort()) {
  const data = JSON.parse(readFileSync(join(MEETINGS_DIR, file), 'utf-8'));
  const slug = file.replace('.json', '');

  // 去重检查
  if (slugs.has(slug)) { issues.push(`DUPLICATE slug: ${slug}`); }
  slugs.add(slug);

  // Schema 校验
  try {
    meetingSchema.parse(data);
  } catch (e: any) {
    issues.push(`SCHEMA FAIL [${slug}]: ${e.message}`);
    allPass = false;
    continue;
  }

  const m = data;

  // 字段检查
  if (!m.action_items || m.action_items.length === 0) issues.push(`NO action_items: ${slug}`);
  if (!m.keywords || m.keywords.length < 5) issues.push(`KEYWORDS < 5: ${slug} (got ${m.keywords?.length ?? 0})`);
  if (!m.summary || m.summary.length < 20) issues.push(`SHORT summary: ${slug} (${m.summary?.length ?? 0} chars)`);
  if (!m.metadata?.date) issues.push(`NO date: ${slug}`);
  if (!m.metadata?.title) issues.push(`NO title: ${slug}`);
  if (!m.metadata?.id) issues.push(`NO id: ${slug}`);
  if (m.metadata?.duration <= 0) issues.push(`INVALID duration: ${slug} (${m.metadata?.duration})`);

  // 一致性检查
  const mid = m.metadata?.id;
  if (mid && m.action_items?.length > 0) {
    for (const ai of m.action_items) {
      if (ai.source_meeting_id !== mid) {
        issues.push(`MISMATCH source_meeting_id in action_item: ${slug}`);
        break;
      }
    }
  }

  // 日期格式
  if (m.metadata?.date && !/^\d{4}-\d{2}-\d{2}$/.test(m.metadata.date)) {
    issues.push(`BAD date format: ${slug} (${m.metadata.date})`);
  }

  // 日期一致性：JSON 文件名中的日期应与 metadata.date 一致
  const fileNameDate = slug.slice(0, 10);
  if (fileNameDate !== m.metadata?.date) {
    issues.push(`DATE MISMATCH filename vs metadata: ${slug} (filename=${fileNameDate}, metadata=${m.metadata.date})`);
  }

  totalActions   += m.action_items?.length ?? 0;
  totalDecisions += m.decisions?.length ?? 0;
  totalQuotes    += m.key_quotes?.length ?? 0;
  totalKeywords  += m.keywords?.length ?? 0;
  totalSegments  += m.segments?.length ?? 0;

  // 每行输出
  console.log(
    `${slug.padEnd(52)} | acts:${String(m.action_items?.length ?? 0).padStart(2)} | decs:${String(m.decisions?.length ?? 0).padStart(2)} | quotes:${String(m.key_quotes?.length ?? 0).padStart(2)} | kw:${String(m.keywords?.length ?? 0).padStart(2)} | segs:${String(m.segments?.length ?? 0).padStart(3)} | date:${m.metadata?.date}`
  );
}

console.log(`\n═══════════════════════════════════════════════════`);
console.log(`  Files:        ${files.length}`);
console.log(`  Actions:      ${totalActions}  (avg ${(totalActions / files.length).toFixed(1)})`);
console.log(`  Decisions:    ${totalDecisions}  (avg ${(totalDecisions / files.length).toFixed(1)})`);
console.log(`  Key Quotes:   ${totalQuotes}  (avg ${(totalQuotes / files.length).toFixed(1)})`);
console.log(`  Keywords:     ${totalKeywords}  (avg ${(totalKeywords / files.length).toFixed(1)})`);
console.log(`  Segments:     ${totalSegments}  (avg ${(totalSegments / files.length).toFixed(1)})`);

if (issues.length > 0) {
  console.log(`\n❌ ${issues.length} 个问题:`);
  for (const i of issues) console.log(`   - ${i}`);
} else {
  console.log(`\n✅ 全部校验通过，无问题`);
}
