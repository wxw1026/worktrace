import { execSync } from 'node:child_process';
import { readdirSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ── Paths ──────────────────────────────────────────────────────────
const PROJECT_ROOT = resolve(import.meta.dirname!, '..');
const PDF_DIR = resolve(PROJECT_ROOT, '..'); // parent "meeting" directory
const OUTPUT_DIR = resolve(PROJECT_ROOT, 'data', 'raw');
const PDFTOTEXT = '/opt/homebrew/bin/pdftotext';
const REPORT_PATH = resolve(PROJECT_ROOT, 'data', 'extraction-report.json');

// ── Types ──────────────────────────────────────────────────────────
interface ParsedFile {
  filename: string;
  title: string;
  date: string; // YYYY-MM-DD
}

interface ExtractionResult {
  filename: string;
  slug: string;
  date: string;
  char_count: number;
  status: 'ok' | 'partial' | 'failed';
}

interface Report {
  total: number;
  success: number;
  failed: number;
  files: ExtractionResult[];
}

// ── Regex ──────────────────────────────────────────────────────────
// Matches "2026年4月10日", "2026年1月6日", etc.
const DATE_RE = /(\d{4})年(\d{1,2})月(\d{1,2})日/;

// ── Helpers ────────────────────────────────────────────────────────

/** Parse PDF filename into title + date. Returns null if no date found. */
function parseFilename(filename: string): ParsedFile | null {
  const basename = filename.replace(/\.pdf$/i, '');
  const dateMatch = basename.match(DATE_RE);
  if (!dateMatch) {
    console.warn(`  ⚠ Skipping "${filename}" — no date pattern found`);
    return null;
  }

  const year = parseInt(dateMatch[1], 10);
  const month = parseInt(dateMatch[2], 10);
  const day = parseInt(dateMatch[3], 10);

  // Title = everything before the matched date, trimmed
  const dateIndex = basename.indexOf(dateMatch[0]);
  let title = basename.slice(0, dateIndex).trim();

  // Clean common prefixes / suffixes
  title = title
    .replace(/^智能纪要[：:]\s*/, '')  // "智能纪要："
    .replace(/^25年/, '')              // special: "25年年终ppt修改…"
    .replace(/\s*-\s*飞书云文档$/, '')  // trailing " - 飞书云文档"
    .trim();

  // Fallback title
  if (!title) {
    title = `会议纪要_${year}_${month}_${day}`;
  }

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { filename, title, date: dateStr };
}

/** Create a filesystem-safe slug from a Chinese title. */
function makeSlug(title: string): string {
  return title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')  // strip invalid filename chars
    .replace(/\s+/g, '-')                    // spaces → hyphens
    .replace(/[（(]/g, '-')                   // fullwidth/halfwidth open paren
    .replace(/[）)]/g, '')                    // close paren
    .replace(/--+/g, '-')                    // collapse multiple hyphens
    .replace(/^-|-$/g, '')                   // trim leading/trailing hyphens
    .slice(0, 80);                           // guard against too-long names
}

/** Run pdftotext and return extracted text. */
function extractText(pdfPath: string): string {
  const cmd = `"${PDFTOTEXT}" -layout "${pdfPath}" -`;
  return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });
}

// ── Main ───────────────────────────────────────────────────────────

function main(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. Scan PDFs
  const allFiles = readdirSync(PDF_DIR);
  const pdfFiles = allFiles.filter((f) => f.toLowerCase().endsWith('.pdf'));
  console.log(`Found ${pdfFiles.length} PDF files in ${PDF_DIR}\n`);

  // 2. Parse filenames
  const parsed: ParsedFile[] = [];
  for (const f of pdfFiles) {
    const p = parseFilename(f);
    if (p) parsed.push(p);
  }

  // 3. Group by date (for same-date disambiguation)
  const byDate = new Map<string, ParsedFile[]>();
  for (const p of parsed) {
    const list = byDate.get(p.date) ?? [];
    list.push(p);
    byDate.set(p.date, list);
  }

  // 4. Process each file
  const results: ExtractionResult[] = [];

  for (const [date, items] of byDate) {
    // Sort by filename for deterministic -1/-2 ordering
    items.sort((a, b) => a.filename.localeCompare(b.filename, 'zh'));

    const needsDisambiguation = items.length > 1;
    let counter = 0;

    for (const item of items) {
      counter++;
      const baseSlug = makeSlug(item.title);
      const slug = needsDisambiguation
        ? `${date}-${baseSlug}-${counter}`
        : `${date}-${baseSlug}`;

      const pdfPath = join(PDF_DIR, item.filename);
      const txtPath = join(OUTPUT_DIR, `${slug}.txt`);

      try {
        const text = extractText(pdfPath);
        writeFileSync(txtPath, text, 'utf-8');

        const charCount = text.length;
        let status: ExtractionResult['status'];
        if (charCount === 0) {
          status = 'failed';
        } else if (charCount < 200) {
          status = 'partial';
        } else {
          status = 'ok';
        }

        results.push({
          filename: item.filename,
          slug,
          date,
          char_count: charCount,
          status,
        });

        const icon = status === 'ok' ? '✓' : status === 'partial' ? '△' : '✗';
        console.log(`${icon} ${slug}.txt  (${charCount} chars, ${status})`);
      } catch (err: any) {
        console.error(`✗ ${item.filename}: ${err.message}`);
        results.push({
          filename: item.filename,
          slug,
          date,
          char_count: 0,
          status: 'failed',
        });
      }
    }
  }

  // 5. Write report
  const report: Report = {
    total: results.length,
    success: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status !== 'ok').length,
    files: results,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Extraction complete`);
  console.log(`  Total:   ${report.total}`);
  console.log(`  Success: ${report.success}`);
  console.log(`  Failed:  ${report.failed}`);
  console.log(`  Report:  ${REPORT_PATH}`);
  console.log(`═══════════════════════════════════════════`);
}

main();
