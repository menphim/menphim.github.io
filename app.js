// =========================================================
// Markdown で書かれた各セクションを読み込み、種類ごとにレイアウトを整える。
// コンテンツの編集は *.md ファイルだけで完結する:
//   - "# 見出し"   : ページ側に見出しがあるので表示しない
//   - "## 見出し"  : グループ（カード / タイムラインのまとまり）
//   - "* 項目"     : 各エントリ
// =========================================================

// 日本語版は "about.ja.md" のように ".ja.md" のファイルを読み込む（無ければ英語版を表示）。
// =========================================================

// GitHub Pages のサブパス配信にも対応するため、ページの置き場所を基準に解決する
const baseUrl = new URL('.', window.location.href);

// =========================================================
// i18n: 画面の固定文言（Markdown 以外）
// =========================================================
const I18N = {
  en: {
    'meta.title': 'Takuma Mori — Robotic Vision Engineer',
    'meta.description':
      'Takuma Mori — Robotic vision engineer working on perception, MLOps and vision-language models for autonomous mobility.',
    skip: 'Skip to main content',
    brand: 'Takuma Mori',
    'nav.about': 'About',
    'nav.experience': 'Experience',
    'nav.research': 'Research',
    'nav.patent': 'Patents',
    'nav.contest': 'Contests',
    'nav.achievement': 'Awards',
    'hero.kicker': 'Robotic Vision Engineer · Honda R&amp;D',
    'hero.title': 'Building perception<br /><span class="grad">for autonomous mobility.</span>',
    'hero.lede':
      'I build perception systems for autonomous mobility — detection, tracking and segmentation — and the MLOps / continual-learning loops that keep them improving.',
    'hero.cta': 'View research',
    'focus.label': 'Current focus',
    'focus.text': 'MLOps &amp; continual learning for perception in autonomous mobility, and vision-language models.',
    'stat.research': 'Publications',
    'stat.patent': 'Patents &amp; filings',
    'stat.contest': 'Contests',
    'stat.achievement': 'Awards',
    'stat.years': 'Years in industry',
    'sec.about': 'Profile',
    'sec.experience': 'Work &amp; education',
    'sec.research': 'Publications',
    'sec.patent': 'Intellectual property',
    'sec.contest': 'Competition results',
    'sec.achievement': 'Awards &amp; honors',
    'footer.top': 'Back to top ↑',
    now: 'NOW',
    team: 'Team',
    loading: 'Loading…',
    loadError: (f) => `Could not load ${f}.`,
    fileProtocol:
      'A local web server is required: run <code>python -m http.server 8000</code> and open http://localhost:8000.',
  },
  ja: {
    'meta.title': '森 巧磨 — ロボットビジョンエンジニア',
    'meta.description': '森 巧磨（ロボットビジョンエンジニア）。自律移動ロボット・モビリティ向けの認識技術、MLOps、視覚言語モデルを研究開発しています。',
    skip: '本文へスキップ',
    brand: '森 巧磨',
    'nav.about': 'プロフィール',
    'nav.experience': '経歴',
    'nav.research': '研究',
    'nav.patent': '特許',
    'nav.contest': 'コンペ',
    'nav.achievement': '受賞',
    'hero.kicker': 'ロボットビジョンエンジニア · 本田技術研究所',
    'hero.title': '自律移動のための<br /><span class="grad">認識技術を<wbr />開発しています。</span>',
    'hero.lede':
      '本田技術研究所で、自律移動ロボット・モビリティ向けの認識技術（物体検出・追跡・セグメンテーション）を研究開発しています。',
    'hero.cta': '研究を見る',
    'focus.label': 'Current focus',
    'focus.text': '認識モデルの MLOps・継続学習、視覚言語モデル',
    'stat.research': '論文・発表',
    'stat.patent': '特許・出願',
    'stat.contest': 'コンペ実績',
    'stat.achievement': '受賞',
    'stat.years': '実務経験（年）',
    'sec.about': 'プロフィール',
    'sec.experience': '職歴・学歴',
    'sec.research': '論文・発表',
    'sec.patent': '特許',
    'sec.contest': 'コンペティション成績',
    'sec.achievement': '受賞歴',
    'footer.top': 'トップへ戻る ↑',
    now: '現在',
    team: 'チーム',
    loading: '読み込み中…',
    loadError: (f) => `${f} を読み込めませんでした。`,
    fileProtocol:
      'ローカルで確認するには開発サーバーが必要です: <code>python -m http.server 8000</code> を実行して http://localhost:8000 を開いてください。',
  },
};

const LANGS = Object.keys(I18N);

// URL の ?lang= → 前回の選択 → ブラウザの言語 の順で決める
const detectLang = () => {
  const q = new URLSearchParams(window.location.search).get('lang');
  if (LANGS.includes(q)) return q;
  try {
    const saved = localStorage.getItem('lang');
    if (LANGS.includes(saved)) return saved;
  } catch (e) {}
  return (navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
};

let lang = detectLang();
const t = (key) => I18N[lang][key] ?? I18N.en[key] ?? key;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const el = (tag, className, html) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
};

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// レンダリング済み HTML を「h2 ごとのグループ」に分割する
const splitGroups = (root) => {
  const intro = [];
  const groups = [];
  let current = null;
  Array.from(root.children).forEach((node) => {
    if (node.tagName === 'H1') return;
    if (node.tagName === 'H2') {
      current = { title: node.textContent.trim(), nodes: [] };
      groups.push(current);
      return;
    }
    (current ? current.nodes : intro).push(node);
  });
  return { intro, groups };
};

// li から直下のテキスト部分（ネストしたリストを除く）と子リストを取り出す
const splitLi = (li) => {
  const clone = li.cloneNode(true);
  const nested = Array.from(clone.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
  nested.forEach((n) => n.remove());
  return { html: clone.innerHTML.trim(), text: clone.textContent.trim(), nested };
};

const topItems = (nodes) =>
  nodes
    .filter((n) => n.tagName === 'UL' || n.tagName === 'OL')
    .flatMap((list) => Array.from(list.children).filter((c) => c.tagName === 'LI'));

const groupTitle = (title, count) => {
  const h = el('h3', 'group-title');
  h.textContent = title;
  if (count !== undefined) h.append(el('span', 'count', String(count)));
  return h;
};

// 「前半 / 後半」に分ける: "Role at Org" → [Role, at Org] / "A, B" → [A, B]
const splitTitle = (text) => {
  const at = text.match(/^(.+?)\s+(at\s+.+)$/);
  if (at) return [at[1], at[2]];
  const comma = text.match(/^(.+?)(?:,\s*|、\s*)(.+)$/);
  if (comma) return [comma[1], comma[2]];
  return [text, ''];
};

// 末尾の "(Team: xxx)" / "（チーム：xxx）" を取り出す
const splitTeam = (text) => {
  const m =
    text.match(/^([\s\S]*?)\s*\(Team:\s*(.+)\)\s*$/i) || text.match(/^([\s\S]*?)\s*（チーム[:：]\s*(.+)）\s*$/);
  return m ? [m[1], m[2]] : [text, ''];
};

const teamMeta = (team) => (team ? `${t('team')} ${escapeHtml(team)}` : '');

// メダル表記を CSS のクラス名にそろえる（Gold / 金 → gold）
const MEDALS = { gold: 'gold', silver: 'silver', bronze: 'bronze', 金: 'gold', 銀: 'silver', 銅: 'bronze' };
const medalClass = (m) => (m ? MEDALS[m.trim().toLowerCase()] || '' : '');
const medalTag = (m) => (m ? `<span class="medal ${medalClass(m)}">${escapeHtml(m)}</span>` : '');

// =========================================================
// Renderers
// =========================================================
const renderers = {
  about(root) {
    const { intro, groups } = splitGroups(root);
    const all = intro.concat(...groups.map((g) => g.nodes));
    const layout = el('div', 'about-layout');
    const prose = el('div', 'about-prose');
    const grid = el('div', 'focus-grid');

    all.forEach((node) => {
      const isFocusList =
        node.tagName === 'UL' && Array.from(node.children).some((li) => li.querySelector('ul'));
      if (!isFocusList) {
        prose.append(node);
        return;
      }
      Array.from(node.children).forEach((li) => {
        const { html, nested } = splitLi(li);
        const card = el('div', 'card focus-item reveal');
        card.append(el('h3', '', html));
        if (nested.length) {
          const chips = el('ul', 'chips');
          nested.forEach((list) => $$(':scope > li', list).forEach((c) => chips.append(el('li', '', c.innerHTML))));
          card.append(chips);
        }
        grid.append(card);
      });
    });

    layout.append(prose);
    if (grid.children.length) layout.append(grid);
    return [layout];
  },

  experience(root) {
    const { intro, groups } = splitGroups(root);
    // "Apr. 2018 - Now: ..." / "2018年4月 - 現在：..."
    const dateRe = /^([^:：]*?\d{4}[^:：]*?)\s*[:：]\s*([\s\S]+)$/;

    const buildTimeline = (items) => {
      const ol = el('ol', 'timeline');
      items.forEach((li) => {
        const { html, text, nested } = splitLi(li);
        const m = text.match(dateRe);
        const date = m ? m[1].replace(/\s+/g, ' ').trim() : '';
        const hasLink = /<a\s/i.test(html);
        const current = /\b(now|present)\b|現在/i.test(date);

        const item = el('li', `tl-item${current ? ' current' : ''}`);
        item.append(el('div', 'tl-date', escapeHtml(date)));
        const rail = el('div', 'tl-rail');
        rail.append(el('span', 'tl-node'));
        item.append(rail);

        const body = el('div', 'tl-body');
        if (hasLink || !m) {
          // リンク等を含む場合は元の HTML を尊重
          const [title, sub] = hasLink ? [html, ''] : splitTitle(text);
          body.append(el('div', 'tl-title', hasLink ? title : escapeHtml(title)));
          if (sub) body.append(el('div', 'tl-sub', escapeHtml(sub)));
        } else {
          const [title, sub] = splitTitle(m[2].trim());
          body.append(el('div', 'tl-title', escapeHtml(title) + (current ? `<span class="badge-now">${t('now')}</span>` : '')));
          if (sub) body.append(el('div', 'tl-sub', escapeHtml(sub)));
        }
        nested.forEach((list) => body.append(buildTimeline($$(':scope > li', list))));
        item.append(body);
        ol.append(item);
      });
      return ol;
    };

    const out = intro.map((n) => n);
    groups.forEach((g) => {
      const wrap = el('div', 'group reveal');
      wrap.append(groupTitle(g.title));
      const items = topItems(g.nodes);
      g.nodes.filter((n) => !['UL', 'OL'].includes(n.tagName)).forEach((n) => wrap.append(n));
      if (items.length) wrap.append(buildTimeline(items));
      out.push(wrap);
    });
    return out;
  },

  research(root) {
    const { intro, groups } = splitGroups(root);
    const out = groups.length ? [...intro] : [];
    const list = groups.length ? groups : [{ title: '', nodes: intro }];
    list.forEach((g) => {
      const items = topItems(g.nodes);
      const wrap = el('div', 'group');
      if (g.title) wrap.append(groupTitle(g.title, items.length));
      const ul = el('ul', 'pubs');
      items.forEach((li, i) => {
        const years = li.textContent.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/g);
        const card = el('li', 'card pub reveal');
        card.style.setProperty('--d', `${Math.min(i, 6) * 0.04}s`);
        card.append(el('div', 'pub-year', years ? years[years.length - 1] : ''));
        card.append(el('div', 'pub-body', li.innerHTML));
        ul.append(card);
      });
      wrap.append(ul);
      out.push(wrap);
    });
    return out;
  },

  contest(root) {
    return renderCards(root, (raw, html) => {
      const [text, team] = splitTeam(raw);
      // 英語: "26th place in ..." / "268th (Bronze) place in ..."
      // 日本語: "26位：..." / "268位（銅）：..."
      const m =
        text.match(/^(\d+)(?:st|nd|rd|th)\s*(?:\(([^)]+)\))?\s*place\s+in\s+([\s\S]+)$/i) ||
        text.match(/^(\d+)位\s*(?:（([^）]+)）)?\s*[:：]\s*([\s\S]+)$/);
      // 順位は不明だが圏内が確定しているもの: "Top 10 (Gold) in ..." / "トップ10（金）：..."
      const top =
        text.match(/^Top\s+(\d+)\s*(?:\(([^)]+)\))?\s+in\s+([\s\S]+)$/i) ||
        text.match(/^トップ\s*(\d+)\s*(?:（([^）]+)）)?\s*[:：]\s*([\s\S]+)$/);
      if (top) {
        return { badge: `TOP${top[1]}`, tier: medalClass(top[2]), title: escapeHtml(top[3].trim()) + medalTag(top[2]), meta: teamMeta(team) };
      }
      if (!m) {
        // "Platform: Rating" / "Platform：Rating" 形式（Ratings など）。Platform 部分のリンクは残す
        const r = html.match(/^(.+?)(?::\s+|：\s*)([\s\S]+)$/);
        return r ? { badge: '★', tier: '', icon: true, title: r[1], meta: r[2] } : null;
      }
      const rank = Number(m[1]);
      const tier = medalClass(m[2]) || (rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '');
      return { badge: `#${rank}`, tier, title: escapeHtml(m[3].trim()) + medalTag(m[2]), meta: teamMeta(team) };
    });
  },

  achievement(root) {
    return renderCards(root, (raw) => {
      const [text, team] = splitTeam(raw);
      // "Award in Event" / "賞名：大会名"
      const m = text.match(/^(.+?)(?:\s+in\s+|：)([\s\S]+)$/);
      const place = text.match(/^(\d+)(?:(?:st|nd|rd|th)\s+place|位)/i);
      const tier = place ? (['', 'gold', 'silver', 'bronze'][Number(place[1])] || '') : 'gold';
      return {
        badge: place ? `#${place[1]}` : '★',
        tier,
        icon: !place,
        title: escapeHtml(m ? m[1] : text),
        meta: [m ? escapeHtml(m[2]) : '', teamMeta(team)].filter(Boolean).join(' · '),
      };
    });
  },
};

// コンテスト・受賞共通: h2 ごとのカードに、li をバッジ付きの行として並べる
const renderCards = (root, parse) => {
  const { intro, groups } = splitGroups(root);
  const grid = el('div', 'card-grid');
  groups.forEach((g, gi) => {
    const items = topItems(g.nodes);
    const card = el('article', 'card cat reveal');
    card.style.setProperty('--d', `${(gi % 3) * 0.06}s`);
    const head = el('div', 'cat-head');
    head.append(el('h3', '', escapeHtml(g.title)));
    head.append(el('span', 'count', String(items.length).padStart(2, '0')));
    card.append(head);

    const ul = el('ul', 'results');
    items.forEach((li) => {
      const { html, text } = splitLi(li);
      const hasLink = /<a\s/i.test(html);
      const r = parse(text, html);
      const row = el('li', 'result');
      row.append(el('span', `rank ${r ? r.tier : ''}${!r || r.icon ? ' icon' : ''}`, r ? r.badge : '•'));
      const body = el('div', 'result-body', r ? r.title : html);
      if (r && r.meta) body.append(el('span', 'meta', r.meta));
      row.append(body);
      ul.append(row);
    });
    card.append(ul);
    grid.append(card);
  });
  return [...intro, grid];
};

// =========================================================
// Loading
// =========================================================
const counts = {};

// 言語別のファイル（about.ja.md）を優先し、無ければ英語版（about.md）にフォールバック
const fetchMarkdown = async (file) => {
  const candidates = lang === 'en' ? [file] : [file.replace(/\.md$/, `.${lang}.md`), file];
  for (const f of candidates) {
    const res = await fetch(new URL(f, baseUrl), { cache: 'no-cache' });
    if (res.ok) return res.text();
  }
  throw new Error(`${file}: not found`);
};

const loadSection = async (container) => {
  const file = container.dataset.md;
  const kind = container.dataset.kind;

  if (window.location.protocol === 'file:') {
    container.innerHTML = `<p class="md-status error">${t('fileProtocol')}</p>`;
    return;
  }

  container.innerHTML = `<p class="md-status">${t('loading')}</p>`;
  try {
    const text = await fetchMarkdown(file);

    const root = document.createElement('div');
    root.innerHTML = window.marked.parse(text);
    const items = topItems(Array.from(root.children));
    // コンテストは順位の付いた結果だけを数える（Ratings などは除外）
    counts[container.closest('section')?.id ?? kind] =
      kind === 'contest'
        ? items.filter((li) => /\bplace\b|^\s*Top\s+\d+|^\s*\d+位|^\s*トップ\s*\d+/i.test(li.textContent)).length
        : items.length;

    const render = renderers[kind];
    const nodes = render ? render(root) : Array.from(root.children);
    container.replaceChildren(...nodes);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p class="md-status error">${I18N[lang].loadError(escapeHtml(file))}</p>`;
  }
};

// 数値のカウントアップ
const animateCount = (node, target) => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !target) {
    node.textContent = String(target);
    return;
  }
  const start = performance.now();
  const dur = 1100;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    node.textContent = String(Math.round(target * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const fillStats = () => {
  $$('[data-count]').forEach((dd) => {
    const n = counts[dd.dataset.count];
    if (n !== undefined) animateCount(dd, n);
  });
  $$('[data-years-since]').forEach((dd) => {
    const since = new Date(`${dd.dataset.yearsSince}-04-01`);
    const years = Math.floor((Date.now() - since.getTime()) / (365.25 * 24 * 3600 * 1000));
    animateCount(dd, years);
  });
};

// =========================================================
// Interactions
// =========================================================
const setupReveal = () => {
  const targets = $$('.reveal:not(.in)');
  if (!('IntersectionObserver' in window)) {
    targets.forEach((t) => t.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    },
    { rootMargin: '0px 0px -8% 0px' }
  );
  targets.forEach((t) => io.observe(t));
};

const setupNav = () => {
  const header = $('.site-header');
  const links = $$('.nav-links a');
  const toggle = $('.nav-toggle');
  const menu = $('.nav-links');

  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // 現在表示中のセクションをハイライト
  const sections = links.map((a) => $(a.getAttribute('href'))).filter(Boolean);
  const update = () => {
    const y = window.scrollY + window.innerHeight * 0.35;
    let active = null;
    sections.forEach((s) => {
      if (s.offsetTop <= y) active = s.id;
    });
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
      active = sections[sections.length - 1]?.id ?? active;
    }
    links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${active}`));
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();

  const close = () => {
    menu.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  };
  toggle.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  links.forEach((a) => a.addEventListener('click', close));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && !toggle.contains(e.target)) close();
  });

  return update;
};

const setupTheme = () => {
  const btn = $('.theme-toggle');
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: light)');
  const current = () => root.dataset.theme || (media.matches ? 'light' : 'dark');
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch (e) {}
  });
};

// 画面の固定文言・<title>・言語属性を切り替える
const applyStaticText = () => {
  document.documentElement.lang = lang;
  document.title = t('meta.title');
  $('meta[name="description"]')?.setAttribute('content', t('meta.description'));
  $$('[data-i18n]').forEach((node) => {
    node.innerHTML = t(node.dataset.i18n);
  });
};

const loadAll = async () => {
  Object.keys(counts).forEach((k) => delete counts[k]);
  await Promise.all($$('.md[data-md]').map(loadSection));
  fillStats();
  setupReveal();
  updateNav();
};

const setLang = async (next) => {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem('lang', lang);
  } catch (e) {}
  const url = new URL(window.location.href);
  url.searchParams.set('lang', lang);
  history.replaceState(null, '', url);
  applyStaticText();
  await loadAll();
};

// =========================================================
// Boot
// =========================================================
$('#year').textContent = new Date().getFullYear();
applyStaticText();
setupTheme();
const updateNav = setupNav();
setupReveal();

$('.lang-toggle').addEventListener('click', () => setLang(lang === 'en' ? 'ja' : 'en'));

loadAll().then(() => {
  // ハッシュ付きURLで来た場合、コンテンツ読み込み後に位置を合わせ直す
  try {
    if (window.location.hash) $(decodeURIComponent(window.location.hash))?.scrollIntoView();
  } catch (e) {}
});

$$('img').forEach((img) => img.addEventListener('error', () => (img.style.visibility = 'hidden')));
