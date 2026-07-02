/**
 * normalize.js — تطبيع النص العربي للبحث
 * يوحّد الهمزات والتاء المربوطة والألف المقصورة ويحذف التشكيل والكشيدة،
 * مع خريطة مواقع تربط النص المطبّع بالنص الأصلي لغرض التظليل.
 */
(function () {
  'use strict';

  const DIACRITICS = /[\u064B-\u0652\u0670\u0640]/; // تشكيل + كشيدة
  const MAP = {
    'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا',
    'ة': 'ه',
    'ى': 'ي',
    'ؤ': 'و',
    'ئ': 'ي',
  };

  /** تطبيع بسيط (للاستعلامات) */
  function normalize(text) {
    let out = '';
    for (const ch of text) {
      if (DIACRITICS.test(ch)) continue;
      out += MAP[ch] || ch;
    }
    return out.toLowerCase();
  }

  /** تطبيع مع خريطة: يرجع { norm, map } حيث map[i] = موقع الحرف في النص الأصلي */
  function normalizeWithMap(text) {
    let norm = '';
    const map = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (DIACRITICS.test(ch)) continue;
      norm += (MAP[ch] || ch).toLowerCase();
      map.push(i);
    }
    return { norm, map };
  }

  /** تقسيم استعلام إلى كلمات مطبّعة */
  function tokenize(query) {
    return normalize(query)
      .split(/[^\u0621-\u064A0-9a-z]+/)
      .filter((t) => t.length >= 2);
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * يظلّل كل مواقع الكلمات المطبّعة داخل النص الأصلي بوسم <mark>
   * ويرجع HTML آمناً.
   */
  function highlight(originalText, tokens) {
    if (!tokens.length) return escapeHtml(originalText);
    const { norm, map } = normalizeWithMap(originalText);
    const ranges = [];
    for (const tok of tokens) {
      let from = 0, idx;
      while ((idx = norm.indexOf(tok, from)) !== -1) {
        const start = map[idx];
        const endNorm = idx + tok.length - 1;
        const end = map[Math.min(endNorm, map.length - 1)] + 1;
        ranges.push([start, end]);
        from = idx + tok.length;
      }
    }
    if (!ranges.length) return escapeHtml(originalText);

    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [ranges[0]];
    for (let i = 1; i < ranges.length; i++) {
      const last = merged[merged.length - 1];
      if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
      else merged.push(ranges[i]);
    }

    let html = '';
    let pos = 0;
    for (const [s, e] of merged) {
      html += escapeHtml(originalText.slice(pos, s));
      html += '<mark>' + escapeHtml(originalText.slice(s, e)) + '</mark>';
      pos = e;
    }
    html += escapeHtml(originalText.slice(pos));
    return html;
  }

  /** مقتطف حول أول تطابق */
  function snippet(originalText, tokens, radius = 70) {
    const { norm, map } = normalizeWithMap(originalText);
    let best = -1;
    for (const tok of tokens) {
      const i = norm.indexOf(tok);
      if (i !== -1 && (best === -1 || i < best)) best = i;
    }
    if (best === -1) return originalText.slice(0, radius * 2);
    const origIdx = map[best];
    const start = Math.max(0, origIdx - radius);
    const end = Math.min(originalText.length, origIdx + radius * 2);
    return (start > 0 ? '…' : '') + originalText.slice(start, end) + (end < originalText.length ? '…' : '');
  }

  window.AR = { normalize, normalizeWithMap, tokenize, highlight, snippet, escapeHtml };
})();
