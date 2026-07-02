/**
 * scrape.js — سحب قوانين وتشريعات اليمن من موقع الجهاز المركزي للرقابة والمحاسبة
 *
 * الاستخدام:
 *   node scraper/scrape.js                 # سحب كل القوانين (يتخطى المحفوظ مسبقاً)
 *   node scraper/scrape.js --force         # إعادة سحب الكل
 *   node scraper/scrape.js --limit 10      # أول 10 قوانين فقط (للاختبار)
 *   node scraper/scrape.js --only 247,284  # قوانين محددة بالمعرّف
 *
 * المخرجات:
 *   www/data/index.json      فهرس كل القوانين (بيانات وصفية)
 *   www/data/laws/{id}.json  نص كل قانون مقسّم إلى مواد
 *   scraper/report.json      تقرير الجودة والأخطاء
 *
 * المتطلبات: Node 18+ ، حزمة cheerio ، أداة pdftotext (poppler-utils)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const cheerio = require('cheerio');
const { fixArabicPdfText, findSuspiciousWords } = require('./arabic-fix');

const BASE = 'https://www.cocayemen.com';
const INDEX_URL = `${BASE}/laws`;
const OUT_DIR = path.join(__dirname, '..', 'www', 'data');
const LAWS_DIR = path.join(OUT_DIR, 'laws');
const TMP_DIR = path.join(__dirname, 'tmp');
const REPORT_PATH = path.join(__dirname, 'report.json');
const UA = 'YemenLawsApp/1.0 (offline legal library; contact: repo owner)';
const DELAY_MS = 1200;
const RETRIES = 3;

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : Infinity;
const ONLY = args.includes('--only')
  ? new Set(args[args.indexOf('--only') + 1].split(',').map((s) => s.trim()))
  : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, asBuffer = false) {
  let lastErr;
  for (let i = 1; i <= RETRIES; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      const data = asBuffer ? Buffer.from(await res.arrayBuffer()) : await res.text();
      return { data, contentType };
    } catch (e) {
      lastErr = e;
      console.warn(`  ⚠ محاولة ${i}/${RETRIES} فشلت: ${e.message}`);
      await sleep(2000 * i);
    }
  }
  throw lastErr;
}

/* ---------------------------------- الفهرس ---------------------------------- */

function parseTitleMeta(rawTitle) {
  const title = rawTitle.replace(/\s+/g, ' ').trim();
  // أنماط: "5 - 1995 العمل" ، "(1-1990) العلم الوطني" ، "قانون رقم (39) لسنة 2006م بشأن..."
  let number = null;
  let year = null;

  let m = title.match(/^\(?\s*(\d+)\s*[-–]\s*(\d{4})\s*\)?\s*(.*)$/);
  if (m) {
    number = m[1];
    year = m[2];
  } else {
    m = title.match(/رقم\s*\(?\s*(\d+)\s*\)?\s*لسنة\s*(\d{4})/);
    if (m) {
      number = m[1];
      year = m[2];
    } else {
      m = title.match(/(\d{4})\s*م?/);
      if (m) year = m[1];
    }
  }
  // تصحيح سنوات مبتورة مثل "199" و"210"
  if (year && year.length === 3) year = year.startsWith('19') ? `${year}0` : null;
  if (year === '210') year = '2010';

  const isAmendment = /تعديل/.test(title);
  let type = 'قانون';
  if (/^مشروع/.test(title)) type = 'مشروع قانون';
  else if (/^قرار/.test(title) || /قرار رئيس|قرار وزير/.test(title)) type = 'قرار';
  else if (/لائحة|الالئحة|اللائحة/.test(title)) type = 'لائحة';

  return { title, number, year, isAmendment, type };
}

const CATEGORY_RULES = [
  ['اتفاقيات دولية', /الموافقة على|انضمام|اتفاقية|معاهدة|بروتوكول|قرض/],
  ['نفط ومعادن وطاقة', /نفط|معادن|مناجم|محاجر|صافر|توتال|المشاركة في الإنتاج|المشاركة في االنتاج/],
  ['جزائي وأمني', /عقوبات|جرائم|جزائية|سجون|مخدرات|اختطاف|تقطع|عفو|أحداث|احداث|ألغام|االغام|فساد|ذمة مالية/],
  ['أحوال شخصية وأسرة', /أحوال شخصية|احوال شخصية|وقف|حقوق الطفل/],
  ['عمل وتأمينات ووظائف', /العمل(?!ة)|تأمينات|تامينات|معاشات|تدريب مهني|نقابات|أجور|اجور|مرتبات|وظائف|خدمة مدنية|تدوير وظيفي/],
  ['ضرائب وجمارك وزكاة', /ضرائب|ضريبة|جمارك|جمركية|زكاة|تعرفة|دمغة|رسوم/],
  ['تجاري ومصرفي واستثمار', /تجاري|تجارية|شركات|سجل تجاري|بنوك|بنك|مصارف|صرافة|استثمار|مناقصات|مزايدات|تأجير تمويلي|التجارة|احتكار|منافسة|غسل الأموال|غسيل الاموال|غسل االموال|الدفع/],
  ['مدني وقضائي', /المدني|إثبات|اثبات|مرافعات|تحكيم|توثيق|وثائق|سلطة قضائية|قضايا الدولة|محاماة|رسوم قضائية/],
  ['عقارات وأراضي وبناء', /عقاري|أراضي|اراضي|استملاك|بناء|مؤجر|إيجار|ايجار|تخطيط/],
  ['إداري وحكم محلي وسياسي', /سلطة محلية|تقسيم|مجلس الوزراء|مجلس الرئاسة|انتخابات|استفتاء|أحزاب|احزاب|جمعيات|مظاهرات|مجلس النواب|مجلس الشورى|محافظة/],
  ['إعلام وملكية فكرية وثقافة', /صحافة|مطبوعات|إذاعة|اذاعة|تلفزيون|آثار|اثار|تراث|فكري|أسماء تجارية|اسماء تجارية|ملكية/],
  ['صحة وبيئة', /صح[يةه]|طبية|صيدلانية|بيئة|تدخين|نظافة|مياه|يود|أغذية|اغذية|معاقين/],
  ['تعليم وشباب', /جامعات|تعليم|معهد|كليات|بعثات|أمية|امية|معلم|مدرسية|شباب|نشء|النشئ|بدنية/],
  ['دفاع وأمن وطني', /قوات مسلحة|دفاع|شرطة|أمن|امن|عسكرية|احتياط/],
  ['زراعة وثروة سمكية', /زراعي|سمكي|أحياء مائية|احياء مائية|بذور|مبيدات|حجر نباتي|حيوانية|صيد/],
  ['نقل واتصالات', /مرور|نقل|طيران|بحري|بريد|اتصالات|سكك|مركبات|جوازات/],
  ['مالية عامة', /موازنة|مالي|دين عام|احتياط عام|تحصيل|اعتماد|خصخصة|تموين|مال العام/],
  ['سيادي وهوية وطنية', /علم|نشيد|شعار|جنسية|يوم وطني|أوسمة|اوسمة|عطلات|إجازات|اجازات|سلام جمهوري/],
];

function categorize(title) {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(title)) return cat;
  return 'أخرى';
}

async function fetchIndex() {
  console.log('📥 جلب فهرس القوانين...');
  const { data: html } = await fetchWithRetry(INDEX_URL);
  const $ = cheerio.load(html);
  const seen = new Map();

  $('a[href*="/laws/"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const m = href.match(/\/laws\/(\d+)\s*$/);
    if (!m) return;
    const id = m[1];
    const rawTitle = $(a).text().trim();
    if (!rawTitle) return; // روابط فارغة موجودة في الموقع
    if (!seen.has(id)) seen.set(id, rawTitle);
  });

  console.log(`   وجدت ${seen.size} قانوناً في الفهرس`);
  return [...seen.entries()].map(([id, rawTitle]) => {
    const meta = parseTitleMeta(rawTitle);
    return { id, ...meta, category: categorize(meta.title), source_url: `${BASE}/laws/${id}` };
  });
}

/* ----------------------------- تحميل واستخراج ----------------------------- */

function pdfToText(pdfPath) {
  return execFileSync('pdftotext', ['-enc', 'UTF-8', '-nopgbrk', pdfPath, '-'], {
    maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8');
}

async function extractLawText(law) {
  const { data, contentType } = await fetchWithRetry(law.source_url, true);
  const buf = data;
  const isPdf =
    contentType.includes('pdf') || (buf.length > 4 && buf.slice(0, 5).toString('latin1') === '%PDF-');

  if (isPdf) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const tmp = path.join(TMP_DIR, `${law.id}.pdf`);
    fs.writeFileSync(tmp, buf);
    const raw = pdfToText(tmp);
    fs.unlinkSync(tmp);
    return { raw, format: 'pdf' };
  }

  // صفحة HTML عادية
  const $ = cheerio.load(buf.toString('utf8'));
  $('script,style,nav,header,footer').remove();
  return { raw: $('body').text(), format: 'html' };
}

/* ------------------------------ تقسيم المواد ------------------------------ */

const ARTICLE_RE =
  /(?:^|\n)\s*(?:ال)?مادة\s*[\(]?\s*([0-9]{1,4}|[\u0660-\u0669]{1,4})\s*[\)]?\s*(?:مكرر(?:اً|ا)?)?\s*[:：\-]?/g;

function toWesternDigits(s) {
  return s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function splitArticles(text) {
  const matches = [...text.matchAll(ARTICLE_RE)];
  if (matches.length === 0) return { preamble: text.trim(), articles: [] };

  const preamble = text.slice(0, matches[0].index).trim();
  const articles = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const body = text.slice(start, end).replace(/\n+/g, '\n').trim();
    if (!body) continue;
    articles.push({ no: parseInt(toWesternDigits(matches[i][1]), 10), text: body });
  }
  return { preamble, articles };
}

/* ---------------------------------- التنفيذ ---------------------------------- */

(async () => {
  fs.mkdirSync(LAWS_DIR, { recursive: true });

  const report = { started_at: new Date().toISOString(), ok: [], failed: [], suspicious_words: {} };
  let index = await fetchIndex();

  if (ONLY) index = index.filter((l) => ONLY.has(l.id));
  index = index.slice(0, LIMIT);

  let done = 0;
  for (const law of index) {
    done++;
    const outPath = path.join(LAWS_DIR, `${law.id}.json`);
    if (!FORCE && fs.existsSync(outPath)) {
      const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      law.articleCount = existing.articles.length;
      law.hasText = existing.articles.length > 0 || !!existing.preamble;
      console.log(`⏭  [${done}/${index.length}] ${law.id} موجود مسبقاً — تخطي`);
      continue;
    }

    console.log(`📄 [${done}/${index.length}] ${law.id}: ${law.title.slice(0, 60)}`);
    try {
      const { raw, format } = await extractLawText(law);
      const fixed = fixArabicPdfText(raw);
      const { preamble, articles } = splitArticles(fixed);

      const record = {
        id: law.id,
        title: law.title,
        number: law.number,
        year: law.year,
        type: law.type,
        category: law.category,
        isAmendment: law.isAmendment,
        source_url: law.source_url,
        source_format: format,
        scraped_at: new Date().toISOString(),
        preamble,
        articles,
      };
      fs.writeFileSync(outPath, JSON.stringify(record, null, 1), 'utf8');

      law.articleCount = articles.length;
      law.hasText = articles.length > 0 || preamble.length > 100;
      report.ok.push({ id: law.id, articles: articles.length, format });

      const sus = findSuspiciousWords(fixed).slice(0, 15);
      if (sus.length) report.suspicious_words[law.id] = sus;

      if (articles.length === 0) console.warn(`   ⚠ لم يتم العثور على مواد — قد يكون مسحاً ضوئياً بحاجة OCR`);
      else console.log(`   ✔ ${articles.length} مادة`);
    } catch (e) {
      console.error(`   ✖ فشل: ${e.message}`);
      law.articleCount = 0;
      law.hasText = false;
      report.failed.push({ id: law.id, error: e.message });
    }
    await sleep(DELAY_MS);
  }

  // كتابة الفهرس العام
  const totalArticles = index.reduce((s, l) => s + (l.articleCount || 0), 0);
  const indexOut = {
    meta: {
      app: 'قوانين وتشريعات اليمن',
      source: INDEX_URL,
      generated_at: new Date().toISOString(),
      laws: index.length,
      articles: totalArticles,
      sample: false,
    },
    laws: index.map(({ id, title, number, year, type, category, isAmendment, articleCount, hasText }) => ({
      id, title, number, year, type, category, isAmendment,
      articleCount: articleCount || 0,
      hasText: !!hasText,
    })),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(indexOut, null, 1), 'utf8');

  report.finished_at = new Date().toISOString();
  report.summary = {
    total: index.length,
    ok: report.ok.length,
    failed: report.failed.length,
    total_articles: totalArticles,
    needs_ocr: report.ok.filter((r) => r.articles === 0).map((r) => r.id),
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 1), 'utf8');

  console.log('\n══════════════════════════════════');
  console.log(`✅ اكتمل: ${report.ok.length} قانون | ❌ فشل: ${report.failed.length}`);
  console.log(`📚 إجمالي المواد: ${totalArticles}`);
  if (report.summary.needs_ocr.length)
    console.log(`🔍 ملفات بلا مواد (قد تحتاج OCR): ${report.summary.needs_ocr.join(', ')}`);
  console.log('التقرير الكامل: scraper/report.json');
})().catch((e) => {
  console.error('فشل السحب:', e);
  process.exit(1);
});
