/**
 * db.js — طبقة البيانات المحلية (تعمل بالكامل بدون إنترنت)
 * كل الملفات مضمّنة داخل التطبيق في www/data/
 */
(function () {
  'use strict';

  let indexData = null;
  const lawCache = new Map();        // id -> law record
  const normCache = new Map();       // id -> [{no, norm}] نصوص مطبّعة للبحث

  async function loadIndex() {
    if (indexData) return indexData;
    const res = await fetch('data/index.json');
    if (!res.ok) throw new Error('تعذر تحميل فهرس القوانين');
    indexData = await res.json();
    return indexData;
  }

  async function getLaw(id) {
    if (lawCache.has(id)) return lawCache.get(id);
    const res = await fetch(`data/laws/${id}.json`);
    if (!res.ok) throw new Error(`تعذر تحميل القانون ${id}`);
    const law = await res.json();
    lawCache.set(id, law);
    return law;
  }

  function normArticles(law) {
    if (normCache.has(law.id)) return normCache.get(law.id);
    const arr = (law.articles || []).map((a) => ({ no: a.no, norm: AR.normalize(a.text) }));
    normCache.set(law.id, arr);
    return arr;
  }

  /**
   * بحث شامل تدريجي في كل القوانين.
   * tokens: كلمات مطبّعة. تُستدعى onBatch(results, done, total) دفعة دفعة.
   * يرجع دالة إلغاء.
   */
  function searchAll(tokens, { onBatch, onDone, batchSize = 12, maxResults = 250 }) {
    let cancelled = false;
    (async () => {
      const idx = await loadIndex();
      const laws = idx.laws.filter((l) => l.hasText);
      const total = laws.length;
      let done = 0;
      let count = 0;

      for (let i = 0; i < laws.length && !cancelled && count < maxResults; i += batchSize) {
        const batch = laws.slice(i, i + batchSize);
        const results = [];

        await Promise.all(
          batch.map(async (meta) => {
            try {
              const law = await getLaw(meta.id);
              const arts = normArticles(law);
              for (const a of arts) {
                if (tokens.every((t) => a.norm.includes(t))) {
                  const orig = law.articles.find((x) => x.no === a.no);
                  results.push({ law: meta, articleNo: a.no, text: orig ? orig.text : '' });
                  count++;
                  if (count >= maxResults) break;
                }
              }
            } catch (_) { /* ملف مفقود — تجاهل */ }
          })
        );

        done = Math.min(i + batchSize, total);
        if (!cancelled && (results.length || done % 36 === 0 || done === total)) {
          onBatch(results, done, total);
        }
        // إفساح المجال لواجهة المستخدم
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!cancelled && onDone) onDone(count);
    })().catch((e) => { if (onDone) onDone(0, e); });

    return () => { cancelled = true; };
  }

  /** بحث فوري في عناوين القوانين فقط */
  async function searchTitles(tokens) {
    const idx = await loadIndex();
    return idx.laws.filter((l) => {
      const norm = AR.normalize(l.title);
      return tokens.every((t) => norm.includes(t));
    });
  }

  window.DB = { loadIndex, getLaw, searchAll, searchTitles };
})();
