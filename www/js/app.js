/**
 * app.js — قوانين وتشريعات اليمن
 * SPA خفيف بدون أي مكتبات — توجيه عبر الـ hash، عرض القوانين، بحث شامل، مفضلة.
 */
(function () {
  'use strict';

  const view = document.getElementById('view');
  const btnBack = document.getElementById('btn-back');
  const topbarSub = document.getElementById('topbar-sub');
  const topbarActions = document.getElementById('topbar-actions');
  const toastEl = document.getElementById('toast');
  const modalRoot = document.getElementById('modal-root');

  /* --------------------------- التخزين المحلي --------------------------- */

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
      catch (_) { return fallback; }
    },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {} },
  };

  let favorites = store.get('favorites', []); // [{lawId, articleNo, lawTitle, preview}]
  let fontSize = store.get('lawFontSize', 18);
  document.documentElement.style.setProperty('--law-font-size', fontSize + 'px');

  const isFav = (lawId, no) => favorites.some((f) => f.lawId === lawId && f.articleNo === no);

  function toggleFav(law, article) {
    if (isFav(law.id, article.no)) {
      favorites = favorites.filter((f) => !(f.lawId === law.id && f.articleNo === article.no));
      toast('أزيلت من المفضلة');
    } else {
      favorites.unshift({
        lawId: law.id,
        articleNo: article.no,
        lawTitle: law.title,
        preview: article.text.slice(0, 90),
      });
      toast('أضيفت إلى المفضلة ★');
    }
    store.set('favorites', favorites);
  }

  /* ------------------------------ أدوات واجهة ------------------------------ */

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('نُسخ النص ✓'), () => fallbackCopy(text));
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('نُسخ النص ✓'); } catch (_) { toast('تعذر النسخ'); }
    ta.remove();
  }

  const esc = (s) => AR.escapeHtml(String(s || ''));

  function setChrome({ back = false, sub = '', actions = '' } = {}) {
    btnBack.classList.toggle('hidden', !back);
    topbarSub.textContent = sub || 'المكتبة القانونية اليمنية — بدون إنترنت';
    topbarActions.innerHTML = actions;
  }

  btnBack.addEventListener('click', () => history.back());

  /* ------------------------------- إخلاء أولي ------------------------------- */

  function firstRunDisclaimer() {
    if (store.get('disclaimerAck', false)) return;
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-label="تنبيه قانوني">
          <div class="frame-inner">
            <h3>تنبيه مهم قبل البدء</h3>
            <p>هذا التطبيق مكتبة وأداة بحث في قوانين الجمهورية اليمنية كما نُشرت في مصدرها،
            وهو لا يقدّم استشارة قانونية ولا يغني عن الرجوع إلى محامٍ مختص،
            خاصة في القضايا المعقدة أو المنظورة أمام القضاء.
            النصوص مستخرجة آلياً وقد تحتوي أخطاء استخراج — المرجع النهائي هو النص الرسمي المنشور.</p>
            <button class="btn-main" id="ack-btn">فهمت، ابدأ</button>
          </div>
        </div>
      </div>`;
    document.getElementById('ack-btn').addEventListener('click', () => {
      store.set('disclaimerAck', true);
      modalRoot.innerHTML = '';
    });
  }

  /* --------------------------------- الموجّه --------------------------------- */

  const routes = {
    home: renderHome,
    library: renderLibrary,
    year: renderYear,
    cat: renderCategory,
    law: renderLaw,
    search: renderSearch,
    favorites: renderFavorites,
    about: renderAbout,
  };

  let cancelSearch = null;

  function router() {
    if (cancelSearch) { cancelSearch(); cancelSearch = null; }
    const hash = location.hash.replace(/^#\/?/, '') || 'home';
    const [name, ...rest] = hash.split('/');
    const fn = routes[name] || renderHome;

    document.querySelectorAll('.nav-item').forEach((a) => {
      a.classList.toggle('active', a.dataset.nav === name || (name === 'home' && a.dataset.nav === 'home'));
    });

    view.innerHTML = '<div class="vwrap"><div class="empty">جارٍ التحميل…</div></div>';
    Promise.resolve(fn(rest.map(decodeURIComponent))).catch((e) => {
      view.innerHTML = `<div class="vwrap"><div class="empty"><span class="big">!</span>${esc(e.message)}</div></div>`;
    });
    view.scrollTo && window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', router);

  /* --------------------------------- الرئيسية --------------------------------- */

  async function renderHome() {
    setChrome({});
    const idx = await DB.loadIndex();
    const { meta, laws } = idx;

    const years = [...new Set(laws.map((l) => l.year).filter(Boolean))].sort((a, b) => b - a);
    const featured = laws
      .filter((l) => !l.isAmendment && l.articleCount > 30)
      .sort((a, b) => b.articleCount - a.articleCount)
      .slice(0, 6);

    view.innerHTML = `
    <div class="vwrap">
      ${meta.sample ? `<div class="banner">⚠ البيانات الحالية <b>عيّنة تجريبية</b> — لتحميل قاعدة القوانين الكاملة شغّل خطوة «تحديث قاعدة القوانين» من GitHub ثم أعد بناء التطبيق.</div>` : ''}

      <div class="official-frame">
        <div class="frame-inner">
          <div class="hero-count">${meta.laws}</div>
          <div class="hero-label">قانوناً وتشريعاً يمنياً بين يديك — بدون إنترنت</div>
          <div class="hero-meta">
            <span><b>${meta.articles}</b> مادة قانونية</span>
            <span><b>${years.length}</b> سنة تشريعية</span>
          </div>
        </div>
      </div>

      <div style="margin-top:16px">
        <div class="searchbox">
          <input id="home-q" type="search" placeholder="اكتب مشكلتك أو كلمة قانونية… مثال: فسخ عقد الإيجار" enterkeyhint="search" />
          <button class="go" id="home-go">بحث</button>
        </div>
      </div>

      <div class="section-title">القوانين الأساسية</div>
      ${featured.map(lawCard).join('') || '<div class="empty">لا توجد بيانات بعد</div>'}

      <div class="section-title">تصفح حسب السنة</div>
      <div class="grid-2">
        ${years.slice(0, 8).map((y) => {
          const n = laws.filter((l) => l.year === y).length;
          return `<div class="tile" data-go="#/year/${y}"><div class="t-big">${y}</div><div class="t-sub">${n} قانون</div></div>`;
        }).join('')}
      </div>
      ${years.length > 8 ? `<div class="card" data-go="#/library" style="text-align:center;margin-top:10px"><span class="card-title" style="color:var(--gold-2)">كل السنوات والتصنيفات ←</span></div>` : ''}

      <div class="notice">أداة بحث في النصوص القانونية اليمنية — لا تُعد استشارة قانونية ولا تغني عن محامٍ مختص.</div>
    </div>`;

    wireGo();
    const q = document.getElementById('home-q');
    const go = () => { if (q.value.trim()) location.hash = '#/search/' + encodeURIComponent(q.value.trim()); };
    document.getElementById('home-go').addEventListener('click', go);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  function lawCard(l) {
    return `
    <div class="card" data-go="#/law/${l.id}">
      <div class="card-title">${esc(l.title)}</div>
      <div class="card-meta">
        ${l.number && l.year ? `<span class="chip gold">${esc(l.number)} لسنة ${esc(l.year)}</span>` : l.year ? `<span class="chip gold">${esc(l.year)}</span>` : ''}
        <span class="chip">${esc(l.category)}</span>
        ${l.articleCount ? `<span class="chip">${l.articleCount} مادة</span>` : ''}
        ${l.isAmendment ? `<span class="chip amend">تعديل</span>` : ''}
        ${!l.hasText ? `<span class="chip">نص غير متوفر</span>` : ''}
      </div>
    </div>`;
  }

  function wireGo() {
    view.querySelectorAll('[data-go]').forEach((el) => {
      el.addEventListener('click', () => { location.hash = el.dataset.go; });
    });
  }

  /* --------------------------------- المكتبة --------------------------------- */

  async function renderLibrary(_, activeTab) {
    setChrome({ sub: 'تصفح القوانين' });
    const idx = await DB.loadIndex();
    const laws = idx.laws;
    const tab = activeTab || store.get('libTab', 'years');

    const years = [...new Set(laws.map((l) => l.year).filter(Boolean))].sort((a, b) => b - a);
    const cats = [...new Set(laws.map((l) => l.category))].sort((a, b) => a.localeCompare(b, 'ar'));

    view.innerHTML = `
    <div class="vwrap">
      <div class="tabs">
        <button id="tab-years" class="${tab === 'years' ? 'active' : ''}">حسب السنة</button>
        <button id="tab-cats" class="${tab === 'cats' ? 'active' : ''}">حسب المجال</button>
      </div>
      <div class="grid-2">
        ${tab === 'years'
          ? years.map((y) => {
              const n = laws.filter((l) => l.year === y).length;
              return `<div class="tile" data-go="#/year/${y}"><div class="t-big">${y}</div><div class="t-sub">${n} قانون</div></div>`;
            }).join('')
          : cats.map((c) => {
              const n = laws.filter((l) => l.category === c).length;
              return `<div class="tile" data-go="#/cat/${encodeURIComponent(c)}"><div class="t-big" style="font-size:14px">${esc(c)}</div><div class="t-sub">${n} قانون</div></div>`;
            }).join('')}
      </div>
    </div>`;

    wireGo();
    document.getElementById('tab-years').addEventListener('click', () => { store.set('libTab', 'years'); renderLibrary([], 'years'); });
    document.getElementById('tab-cats').addEventListener('click', () => { store.set('libTab', 'cats'); renderLibrary([], 'cats'); });
  }

  async function renderYear([year]) {
    setChrome({ back: true, sub: `قوانين سنة ${year}` });
    const idx = await DB.loadIndex();
    const laws = idx.laws.filter((l) => l.year === year);
    view.innerHTML = `
    <div class="vwrap">
      <div class="section-title">قوانين سنة ${esc(year)} — ${laws.length} قانون</div>
      ${laws.map(lawCard).join('') || '<div class="empty">لا توجد قوانين لهذه السنة</div>'}
    </div>`;
    wireGo();
  }

  async function renderCategory([cat]) {
    setChrome({ back: true, sub: cat });
    const idx = await DB.loadIndex();
    const laws = idx.laws.filter((l) => l.category === cat)
      .sort((a, b) => (b.year || '0').localeCompare(a.year || '0'));
    view.innerHTML = `
    <div class="vwrap">
      <div class="section-title">${esc(cat)} — ${laws.length} قانون</div>
      ${laws.map(lawCard).join('') || '<div class="empty">لا توجد قوانين في هذا المجال</div>'}
    </div>`;
    wireGo();
  }

  /* ------------------------------- قارئ القانون ------------------------------- */

  async function renderLaw([id, artNo]) {
    const law = await DB.getLaw(id);
    setChrome({
      back: true,
      sub: law.title.slice(0, 44),
      actions: `
        <button class="icon-btn" id="font-minus" aria-label="تصغير الخط">ا-</button>
        <button class="icon-btn" id="font-plus" aria-label="تكبير الخط">ا+</button>`,
    });

    const badges = `
      ${law.number && law.year ? `<span class="chip gold">قانون رقم ${esc(law.number)} لسنة ${esc(law.year)}م</span>` : ''}
      <span class="chip">${esc(law.category)}</span>
      ${law.isAmendment ? `<span class="chip amend">قانون تعديل</span>` : ''}
      <span class="chip">${law.articles.length} مادة</span>`;

    view.innerHTML = `
    <div class="vwrap">
      <div class="law-header"><div class="frame-inner">
        <div class="law-title">${esc(law.title)}</div>
        <div class="law-badges">${badges}</div>
      </div></div>

      <div class="searchbox" style="margin-bottom:16px">
        <input id="inlaw-q" type="search" placeholder="بحث داخل هذا القانون…" enterkeyhint="search" />
        <button class="go" id="inlaw-go">بحث</button>
      </div>

      ${law.preamble ? `<div class="preamble">${esc(law.preamble)}</div>` : ''}
      <div id="articles"></div>

      <div class="notice">
        المصدر: الجهاز المركزي للرقابة والمحاسبة — <span dir="ltr">${esc(law.source_url || '')}</span><br/>
        النص مستخرج آلياً وقد يحتوي أخطاء استخراج؛ المرجع النهائي هو النص الرسمي.
      </div>
    </div>`;

    const articlesEl = document.getElementById('articles');

    function renderArticles(tokens) {
      const list = tokens && tokens.length
        ? law.articles.filter((a) => tokens.every((t) => AR.normalize(a.text).includes(t)))
        : law.articles;

      articlesEl.innerHTML = list.length
        ? list.map((a) => `
          <div class="article" id="art-${a.no}">
            <div class="article-head">
              <span class="article-seal">المادة (${a.no})</span>
              <div class="article-tools">
                <button data-copy="${a.no}" aria-label="نسخ المادة">⎘</button>
                <button data-fav="${a.no}" class="${isFav(law.id, a.no) ? 'faved' : ''}" aria-label="إضافة للمفضلة">★</button>
              </div>
            </div>
            <div class="article-body">${tokens && tokens.length ? AR.highlight(a.text, tokens) : esc(a.text)}</div>
          </div>`).join('')
        : '<div class="empty">لا توجد مواد مطابقة داخل هذا القانون</div>';

      articlesEl.querySelectorAll('[data-copy]').forEach((b) => {
        b.addEventListener('click', () => {
          const no = parseInt(b.dataset.copy, 10);
          const art = law.articles.find((x) => x.no === no);
          copyText(`المادة (${no}) — ${law.title}\n\n${art.text}\n\nالمصدر: ${law.source_url || ''}`);
        });
      });
      articlesEl.querySelectorAll('[data-fav]').forEach((b) => {
        b.addEventListener('click', () => {
          const no = parseInt(b.dataset.fav, 10);
          const art = law.articles.find((x) => x.no === no);
          toggleFav(law, art);
          b.classList.toggle('faved', isFav(law.id, no));
        });
      });
    }

    renderArticles(null);

    // بحث داخل القانون
    const q = document.getElementById('inlaw-q');
    const doInlaw = () => renderArticles(AR.tokenize(q.value));
    document.getElementById('inlaw-go').addEventListener('click', doInlaw);
    q.addEventListener('input', () => { if (!q.value.trim()) renderArticles(null); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') doInlaw(); });

    // حجم الخط
    document.getElementById('font-plus').addEventListener('click', () => setFont(1));
    document.getElementById('font-minus').addEventListener('click', () => setFont(-1));
    function setFont(d) {
      fontSize = Math.max(14, Math.min(26, fontSize + d));
      store.set('lawFontSize', fontSize);
      document.documentElement.style.setProperty('--law-font-size', fontSize + 'px');
    }

    // الانتقال لمادة محددة (من نتائج البحث أو المفضلة)
    if (artNo) {
      requestAnimationFrame(() => {
        const el = document.getElementById('art-' + artNo);
        if (el) {
          el.scrollIntoView({ block: 'center' });
          el.classList.add('flash');
          setTimeout(() => el.classList.remove('flash'), 2200);
        }
      });
    }
  }

  /* -------------------------------- بحث شامل -------------------------------- */

  async function renderSearch([initialQ]) {
    setChrome({ sub: 'بحث شامل في كل القوانين' });
    view.innerHTML = `
    <div class="vwrap">
      <div class="searchbox">
        <input id="q" type="search" placeholder="ابحث في ${'كل'} القوانين… مثال: مكافأة نهاية الخدمة" enterkeyhint="search" value="${esc(initialQ || '')}" />
        <button class="go" id="q-go">بحث</button>
      </div>
      <div class="progress hidden" id="prog"><div></div></div>
      <div class="progress-label hidden" id="prog-label"></div>
      <div id="results" style="margin-top:16px">
        <div class="empty"><span class="big">⌕</span>اكتب مشكلتك أو المصطلح القانوني بكلماتك —<br/>البحث يشمل نصوص كل المواد ويعمل بدون إنترنت.</div>
      </div>
    </div>`;

    const q = document.getElementById('q');
    const results = document.getElementById('results');
    const prog = document.getElementById('prog');
    const progBar = prog.firstElementChild;
    const progLabel = document.getElementById('prog-label');

    async function run() {
      const tokens = AR.tokenize(q.value);
      if (!tokens.length) { toast('اكتب كلمتين على الأقل من حرفين فأكثر'); return; }
      if (cancelSearch) cancelSearch();

      results.innerHTML = '';
      prog.classList.remove('hidden');
      progLabel.classList.remove('hidden');

      // 1) تطابق العناوين فوراً
      const titleHits = await DB.searchTitles(tokens);
      if (titleHits.length) {
        results.innerHTML = `<div class="section-title">قوانين تطابق عناوينها بحثك</div>` +
          titleHits.slice(0, 10).map(lawCard).join('') +
          `<div class="section-title">نتائج داخل نصوص المواد</div><div id="art-hits"></div>`;
      } else {
        results.innerHTML = `<div class="section-title">نتائج داخل نصوص المواد</div><div id="art-hits"></div>`;
      }
      wireGo();
      const artHits = document.getElementById('art-hits');
      let totalHits = 0;

      cancelSearch = DB.searchAll(tokens, {
        onBatch(batch, done, total) {
          progBar.style.width = Math.round((done / total) * 100) + '%';
          progLabel.textContent = `فحص ${done} من ${total} قانوناً…`;
          if (!batch.length) return;
          totalHits += batch.length;
          artHits.insertAdjacentHTML('beforeend', batch.map((r) => `
            <div class="card" data-go="#/law/${r.law.id}/${r.articleNo}">
              <div class="card-title" style="font-size:13.5px;color:var(--gold-2)">${esc(r.law.title)}</div>
              <div class="card-meta"><span class="chip gold">المادة (${r.articleNo})</span>
                ${r.law.year ? `<span class="chip">${esc(r.law.year)}</span>` : ''}</div>
              <div style="font-family:var(--font-body);font-size:14.5px;line-height:2;margin-top:8px">
                ${AR.highlight(AR.snippet(r.text, tokens), tokens)}
              </div>
            </div>`).join(''));
          wireGo();
        },
        onDone(count) {
          prog.classList.add('hidden');
          progLabel.textContent = count
            ? `اكتمل البحث — ${count} مادة مطابقة`
            : '';
          if (!count && !titleHits.length) {
            results.innerHTML = `<div class="empty"><span class="big">∅</span>لا توجد نتائج لـ «${esc(q.value)}»<br/>جرّب كلمات أعم أو مرادفات قانونية.</div>`;
          }
          cancelSearch = null;
        },
      });
    }

    document.getElementById('q-go').addEventListener('click', run);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { q.blur(); run(); } });
    if (initialQ) run(); else q.focus();
  }

  /* --------------------------------- المفضلة --------------------------------- */

  function renderFavorites() {
    setChrome({ sub: 'موادك المحفوظة' });
    view.innerHTML = `
    <div class="vwrap">
      ${favorites.length
        ? `<div class="section-title">المفضلة — ${favorites.length} مادة</div>` +
          favorites.map((f) => `
          <div class="card" data-go="#/law/${f.lawId}/${f.articleNo}">
            <div class="card-meta" style="margin:0 0 6px"><span class="chip gold">المادة (${f.articleNo})</span></div>
            <div class="card-title" style="font-size:13.5px">${esc(f.lawTitle)}</div>
            <div style="font-family:var(--font-body);font-size:14px;color:var(--muted);margin-top:6px">${esc(f.preview)}…</div>
          </div>`).join('')
        : `<div class="empty"><span class="big">★</span>ما من مواد محفوظة بعد.<br/>اضغط ★ على أي مادة لتصل إليها بسرعة من هنا.</div>`}
    </div>`;
    wireGo();
  }

  /* ---------------------------------- حول ---------------------------------- */

  async function renderAbout() {
    setChrome({ sub: 'عن التطبيق' });
    let meta = { laws: '—', articles: '—', generated_at: null };
    try { meta = (await DB.loadIndex()).meta; } catch (_) {}
    const updated = meta.generated_at ? new Date(meta.generated_at).toLocaleDateString('ar') : '—';

    view.innerHTML = `
    <div class="vwrap about">
      <div class="official-frame"><div class="frame-inner">
        <div class="law-title">قوانين وتشريعات اليمن</div>
        <div class="hero-label" style="margin-top:6px">مكتبة قانونية يمنية كاملة تعمل بدون إنترنت</div>
      </div></div>

      <div class="section-title">المصدر</div>
      <p>النصوص القانونية مأخوذة من الموقع الرسمي للجهاز المركزي للرقابة والمحاسبة
      <span dir="ltr">(cocayemen.com)</span>، وتُستخرج وتُعالج آلياً لتحويلها إلى مواد قابلة للبحث والتصفح.</p>
      <p class="muted">قاعدة البيانات: ${meta.laws} قانون / ${meta.articles} مادة — آخر تحديث: ${updated}</p>

      <div class="section-title">تنبيه قانوني</div>
      <p>هذا التطبيق أداة بحث واطلاع على النصوص القانونية، ولا يقدّم استشارة قانونية،
      ولا يغني عن الرجوع إلى محامٍ مرخّص خاصة في القضايا المعقدة.
      النصوص مستخرجة آلياً من ملفات PDF حكومية وقد تتضمن أخطاء استخراج؛
      المرجع النهائي دائماً هو النص الرسمي المنشور في الجريدة الرسمية.</p>

      <div class="section-title">الإصدار</div>
      <p class="muted">الإصدار 1.0 — المرحلة الأولى: المكتبة والبحث دون اتصال.<br/>
      قادم في المراحل التالية: المساعد القانوني الذكي، الحاسبات القانونية، وتحليل العقود.</p>
    </div>`;
  }

  /* ---------------------------------- تشغيل ---------------------------------- */

  firstRunDisclaimer();
  router();
})();
