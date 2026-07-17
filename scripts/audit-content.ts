/**
 * audit-content.ts — 内容质量审计：敏感信息扫描 + 格式完整性校验
 * 运行: npx tsx scripts/audit-content.ts
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname!, '..');
const MEETINGS_DIR = join(PROJECT_ROOT, 'src', 'content', 'meetings');
const DATA_DIR = join(PROJECT_ROOT, 'data');
const REPORT_PATH = join(DATA_DIR, 'audit-report.json');

// ─── 敏感信息扫描规则 ───────────────────────────────────────────────

const patterns = [
  {
    name: 'phone',
    regex: /1[3-9]\d{9}/g,
    severity: 'MEDIUM' as const,
    label: '手机号',
  },
  {
    name: 'idCard',
    regex: /\d{17}[\dXx]/g,
    severity: 'MEDIUM' as const,
    label: '身份证号',
  },
  {
    name: 'bankCard',
    regex: /\b\d{16,19}\b/g,
    severity: 'HIGH' as const,
    label: '银行卡号',
  },
  {
    name: 'email',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    severity: 'LOW' as const,
    label: '邮箱',
  },
];

type Severity = 'HIGH' | 'MEDIUM' | 'LOW';

interface Finding {
  file: string;
  field: string;
  matched: string;
  severity: Severity;
  label: string;
  action: 'redacted' | 'logged';
  context: string; // 周围文本片段（截断）
}

interface FormatIssue {
  file: string;
  field: string;
  issue: string;
}

interface AuditReport {
  generated_at: string;
  summary: {
    scanned: number;
    high_findings: number;
    medium_findings: number;
    low_findings: number;
    format_issues: number;
  };
  high_findings: Finding[];
  medium_findings: Finding[];
  low_findings: Finding[];
  format_issues: FormatIssue[];
}

// ─── 辅助函数 ────────────────────────────────────────────────────────

/** 检查匹配是否位于 UUID 上下文中（减少误报） */
function isUuidContext(fullText: string, matchIndex: number, matchLength: number): boolean {
  // 检查匹配前后 3 个字符是否有 UUID 典型分隔符 `-`
  const prefix = fullText.substring(Math.max(0, matchIndex - 3), matchIndex);
  const suffix = fullText.substring(matchIndex + matchLength, Math.min(fullText.length, matchIndex + matchLength + 3));
  // UUID 格式: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  // 如果前后有 `-` 且在 hex 字符环境中，很可能是 UUID
  const hasDashNearby = prefix.includes('-') || suffix.includes('-');
  // 检查周围是否全是 hex 字符 + 数字（UUID 特征）
  const surrounding = (prefix + suffix).replace(/-/g, '');
  const isAllHexLike = surrounding.length > 0 && /^[0-9a-fA-F]+$/.test(surrounding);
  return hasDashNearby && isAllHexLike;
}

/** 截取上下文（匹配前后各 20 字符） */
function getContext(fullText: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - 20);
  const end = Math.min(fullText.length, matchIndex + matchLength + 20);
  let ctx = fullText.substring(start, end);
  if (start > 0) ctx = '…' + ctx;
  if (end < fullText.length) ctx = ctx + '…';
  return ctx;
}

/** 递归遍历 JSON 的所有字符串字段 */
function* walkStrings(
  obj: unknown,
  filePath: string,
  path: string = 'root'
): Generator<{ value: string; field: string }> {
  if (typeof obj === 'string') {
    yield { value: obj, field: path };
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      yield* walkStrings(obj[i], filePath, `${path}[${i}]`);
    }
  } else if (obj !== null && typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      yield* walkStrings(val, filePath, `${path}.${key}`);
    }
  }
}

// ─── 格式完整性检查 ──────────────────────────────────────────────────

function checkFormatIntegrity(data: Record<string, unknown>, file: string): FormatIssue[] {
  const issues: FormatIssue[] = [];
  const m = data.metadata as Record<string, unknown> | undefined;

  // 必填字段非空检查
  if (!data.summary || (typeof data.summary === 'string' && data.summary.trim().length === 0)) {
    issues.push({ file, field: 'summary', issue: '必填字段 summary 为空' });
  }
  if (!data.raw_text_summary || (typeof data.raw_text_summary === 'string' && data.raw_text_summary.trim().length === 0)) {
    issues.push({ file, field: 'raw_text_summary', issue: '必填字段 raw_text_summary 为空' });
  }

  // metadata 检查
  if (!m) {
    issues.push({ file, field: 'metadata', issue: 'metadata 对象缺失' });
  } else {
    if (!m.id || (typeof m.id === 'string' && m.id.trim().length === 0))
      issues.push({ file, field: 'metadata.id', issue: '必填字段 id 为空' });
    if (!m.title || (typeof m.title === 'string' && m.title.trim().length === 0))
      issues.push({ file, field: 'metadata.title', issue: '必填字段 title 为空' });
    if (!m.date || (typeof m.date === 'string' && m.date.trim().length === 0))
      issues.push({ file, field: 'metadata.date', issue: '必填字段 date 为空' });
    // 日期格式 YYYY-MM-DD
    if (typeof m.date === 'string' && m.date.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(m.date)) {
      issues.push({ file, field: 'metadata.date', issue: `日期格式不符合 YYYY-MM-DD: ${m.date}` });
    }
    if (typeof m.duration === 'number' && m.duration <= 0) {
      issues.push({ file, field: 'metadata.duration', issue: `duration 必须为正数: ${m.duration}` });
    }
    if (!m.platform || m.platform !== 'feishu') {
      issues.push({ file, field: 'metadata.platform', issue: `platform 必须为 feishu: ${m.platform}` });
    }
  }

  // keywords 长度 ≥ 3
  const keywords = data.keywords as unknown[];
  if (!keywords || !Array.isArray(keywords) || keywords.length < 3) {
    issues.push({
      file,
      field: 'keywords',
      issue: `keywords 数组长度 < 3 (当前: ${Array.isArray(keywords) ? keywords.length : 0})`,
    });
  }

  // segments 非空检查
  const segments = data.segments as unknown[];
  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    issues.push({ file, field: 'segments', issue: 'segments 数组为空' });
  }

  return issues;
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────

function main() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const files = readdirSync(MEETINGS_DIR).filter((f) => f.endsWith('.json'));
  const highFindings: Finding[] = [];
  const mediumFindings: Finding[] = [];
  const lowFindings: Finding[] = [];
  const formatIssues: FormatIssue[] = [];
  let modifiedCount = 0;

  console.log(`🔍 开始审计 ${files.length} 个 JSON 文件\n`);

  for (const file of files.sort()) {
    const filePath = join(MEETINGS_DIR, file);
    let rawContent = readFileSync(filePath, 'utf-8');
    let contentModified = false;

    // ─── 第一步：格式完整性检查 ───
    const data = JSON.parse(rawContent);
    const fmtIssues = checkFormatIntegrity(data, file);
    formatIssues.push(...fmtIssues);

    // ─── 第二步：敏感信息扫描 ───
    for (const { value, field } of walkStrings(data, file)) {
      // 跳过 metadata.id（UUID 字段，必然匹配数字模式）
      if (field.endsWith('.id') || field.endsWith('.segment_id') ||
          field.endsWith('.decision_id') || field.endsWith('.action_id') ||
          field.endsWith('.quote_id') || field.endsWith('.topic_id') ||
          field.endsWith('.source_meeting_id') || field.endsWith('metadata.source_url')) {
        continue;
      }

      for (const pattern of patterns) {
        // 对每次循环重置 lastIndex
        const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
        let match: RegExpExecArray | null;

        while ((match = regex.exec(value)) !== null) {
          const matchedStr = match[0];
          const matchIndex = match.index;

          // UUID 上下文过滤（所有严重级别都过滤，避免修改 UUID）
          if (isUuidContext(value, matchIndex, matchedStr.length)) {
            continue;
          }

          const finding: Finding = {
            file,
            field,
            matched: matchedStr,
            severity: pattern.severity,
            label: pattern.label,
            action: pattern.severity === 'HIGH' ? 'redacted' : 'logged',
            context: getContext(value, matchIndex, matchedStr.length),
          };

          if (pattern.severity === 'HIGH') {
            highFindings.push(finding);
            // 自动脱敏：替换原始内容中的匹配项
            rawContent = rawContent.replace(matchedStr, '[已脱敏]');
            contentModified = true;
          } else if (pattern.severity === 'MEDIUM') {
            mediumFindings.push(finding);
          } else {
            lowFindings.push(finding);
          }
        }
      }
    }

    // ─── 第三步：回写脱敏后的文件 ───
    if (contentModified) {
      writeFileSync(filePath, rawContent, 'utf-8');
      modifiedCount++;
      console.log(`  ✏️  已脱敏: ${file}`);
    } else if (fmtIssues.length > 0) {
      console.log(`  ⚠️  格式问题: ${file} (${fmtIssues.length} 项)`);
    } else {
      console.log(`  ✅ ${file}`);
    }
  }

  // ─── 第四步：生成审计报告 ───
  const report: AuditReport = {
    generated_at: new Date().toISOString(),
    summary: {
      scanned: files.length,
      high_findings: highFindings.length,
      medium_findings: mediumFindings.length,
      low_findings: lowFindings.length,
      format_issues: formatIssues.length,
    },
    high_findings: highFindings,
    medium_findings: mediumFindings,
    low_findings: lowFindings,
    format_issues: formatIssues,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');

  // ─── 控制台输出 ───
  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`  扫描文件:     ${report.summary.scanned}`);
  console.log(`  HIGH 发现:    ${report.summary.high_findings} (已脱敏 ${modifiedCount} 个文件)`);
  console.log(`  MEDIUM 发现:  ${report.summary.medium_findings}`);
  console.log(`  LOW 发现:     ${report.summary.low_findings}`);
  console.log(`  格式问题:     ${report.summary.format_issues}`);
  console.log(`  报告已输出:   data/audit-report.json`);

  if (report.summary.high_findings > 0) {
    console.log(`\n  🔴 HIGH 级别发现详情:`);
    for (const f of highFindings) {
      console.log(`     - ${f.file} / ${f.field}: "${f.matched}" → [已脱敏]`);
    }
  }

  if (report.summary.format_issues > 0) {
    console.log(`\n  ⚠️  格式问题详情 (前 10 项):`);
    for (const fi of formatIssues.slice(0, 10)) {
      console.log(`     - ${fi.file}: ${fi.field} — ${fi.issue}`);
    }
    if (formatIssues.length > 10) {
      console.log(`     ... 还有 ${formatIssues.length - 10} 项，详见报告`);
    }
  }

  console.log(`\n✅ 审计完成`);
}

main();
