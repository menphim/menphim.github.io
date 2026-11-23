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
    'hero.kicker': 'Robotic Vision Engineer',
    'hero.title': 'Perception for<br /><span class="hl">autonomous mobility.</span>',
    'hero.lede':
      'I research and develop perception models — object detection, multi-object tracking and segmentation — and the MLOps pipelines that keep improving them.',
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
    'fx.run': '▶ Try object detection on this photo',
    'fx.hint': 'Loads an object detection model (about 7 MB) and detects what is in this photo, right in your browser.',
    'fx.camera': 'Try with camera',
    'fx.stop': 'Stop camera',
    'fx.end': 'End detection',
    'fx.privacy':
      'The camera starts only when you press the button. Video is processed only in this browser and is never sent or stored.',
    'fx.loading': 'Loading model…',
    'fx.ready': 'EfficientDet-Lite0 · in-browser',
    'fx.noCamera': 'Camera unavailable',
    'fx.error': 'Could not load the model',
    team: 'Team',
    top: (p) => `Top ${p}%`,
    'of.teams': (n) => `of ${n} teams`,
    'of.participants': (n) => `of ${n} participants`,
    'medal.gold': 'Gold',
    'medal.silver': 'Silver',
    'medal.bronze': 'Bronze',
    'strip.label': 'Items per year',
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
    'hero.kicker': 'ロボットビジョンエンジニア',
    'hero.title': '自律移動ロボット・<wbr />モビリティの<br /><span class="hl">認識技術</span>',
    'hero.lede':
      '物体検出・複数物体追跡・セグメンテーションなどの認識モデルと、それを継続的に改善する仕組み（MLOps）を研究開発しています。',
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
    'sec.contest': 'コンペ成績',
    'sec.achievement': '受賞歴',
    'footer.top': 'トップへ戻る ↑',
    now: '現在',
    'fx.run': '▶ この写真で物体検出を試す',
    'fx.hint': '物体検出モデル（約7MB）を読み込み、この写真に写っているものをブラウザ内で検出します。',
    'fx.camera': 'カメラで試す',
    'fx.stop': 'カメラを止める',
    'fx.end': '検出を終了',
    'fx.privacy': 'カメラはボタンを押したときだけ起動します。映像はこの端末のブラウザ内だけで処理され、送信も保存もされません。',
    'fx.loading': 'モデルを読み込み中…',
    'fx.ready': 'EfficientDet-Lite0 · ブラウザ内で実行',
    'fx.noCamera': 'カメラを使えませんでした',
    'fx.error': 'モデルを読み込めませんでした',
    team: 'チーム',
    top: (p) => `上位 ${p}%`,
    'of.teams': (n) => `${n}チーム中`,
    'of.participants': (n) => `${n}名中`,
    'medal.gold': '金',
    'medal.silver': '銀',
    'medal.bronze': '銅',
    'strip.label': '年別の件数',
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

const YEAR_RE = /(?<!\d)(?:19|20)\d{2}(?!\d)/g;
const fmtNum = (n) => n.toLocaleString('en-US');

// 行末のリンク（DOI・Write-up など）と太字（受賞など）を本文から取り外す
const popTrailing = (node) => {
  const links = [];
  const notes = [];
  while (node.lastChild) {
    const n = node.lastChild;
    if (n.nodeType === 3 && !n.textContent.trim()) n.remove();
    else if (n.nodeName === 'A') {
      links.unshift(n);
      n.remove();
    } else if (n.nodeName === 'STRONG') {
      notes.unshift(n.textContent.trim());
      n.remove();
    } else break;
  }
  links.forEach((a) => {
    a.className = 'chip-link';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  });
  return { links, notes };
};

// タグの外にある区切り文字で分割する（最大 max 回）
const splitOutsideTags = (html, sep, max) => {
  const parts = [];
  let inTag = false;
  let start = 0;
  for (let i = 0; i < html.length && parts.length < max; i++) {
    const ch = html[i];
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;
    else if (!inTag && html.startsWith(sep, i)) {
      parts.push(html.slice(start, i));
      start = i + sep.length;
      i = start - 1;
    }
  }
  parts.push(html.slice(start));
  return parts;
};

// セクション左の欄に、グループへの目次（件数つき）を入れる
const fillRail = (rail, groups, extra) => {
  if (!rail) return;
  rail.replaceChildren();
  if (extra) rail.append(extra);
  if (groups.length < 2) return;
  const ul = el('ul', 'rail-nav');
  groups.forEach((g) => {
    const li = el('li');
    const a = el('a');
    a.href = `#${g.id}`;
    a.append(el('span', '', escapeHtml(g.title)), el('i', '', String(g.count).padStart(2, '0')));
    li.append(a);
    ul.append(li);
  });
  rail.append(ul);
};

// =========================================================
// Renderers
//   render(root, ctx) : ctx = { sid: セクションの id, rail: 左欄の要素 }
// =========================================================
const renderers = {
  // プロフィール: 文章 + 専門分野（入れ子のリスト）を仕様表のような列にする
  about(root) {
    const { intro, groups } = splitGroups(root);
    const all = intro.concat(...groups.map((g) => g.nodes));
    const prose = el('div', 'about-prose');
    const spec = el('div', 'spec');

    all.forEach((node) => {
      const isFocusList =
        node.tagName === 'UL' && Array.from(node.children).some((li) => li.querySelector('ul'));
      if (!isFocusList) {
        prose.append(node);
        return;
      }
      Array.from(node.children).forEach((li, i) => {
        const { html, nested } = splitLi(li);
        const col = el('div', 'spec-col reveal');
        col.style.setProperty('--d', `${i * 0.06}s`);
        col.append(el('span', 'spec-no', String(i + 1).padStart(2, '0')));
        col.append(el('h3', '', html));
        if (nested.length) {
          const ul = el('ul');
          nested.forEach((list) => $$(':scope > li', list).forEach((c) => ul.append(el('li', '', c.innerHTML))));
          col.append(ul);
        }
        spec.append(col);
      });
    });

    const out = [prose];
    if (spec.children.length) out.push(spec);
    return out;
  },

  experience(root, ctx) {
    const { intro, groups } = splitGroups(root);
    // "Apr. 2018 - Now: ..." / "2018年4月 - 現在：..."
    const dateRe = /^([^:：]*?\d{4}[^:：]*?)\s*[:：]\s*([\s\S]+)$/;

    // 入れ子のリスト: 日付のない見出し行（"Role" / "職種" など）の下に項目がある場合は、
    // 見出しごとにラベル付きの枠にする。それ以外は通常の入れ子タイムライン。
    const renderNested = (body, list) => {
      const lis = $$(':scope > li', list);
      const labeled =
        lis.length > 0 &&
        lis.every((li) => {
          const { text, nested } = splitLi(li);
          return !dateRe.test(text) && nested.length > 0;
        });
      if (!labeled) {
        body.append(buildTimeline(lis, true));
        return;
      }
      const boxes = el('div', 'tl-boxes');
      lis.forEach((li) => {
        const { html, nested } = splitLi(li);
        const box = el('div', 'tl-box');
        box.append(el('div', 'tl-sub-label', html));
        nested.forEach((n) => box.append(buildTimeline($$(':scope > li', n), true)));
        boxes.append(box);
      });
      body.append(boxes);
    };

    const buildTimeline = (items, sub) => {
      const ol = el('ol', `timeline${sub ? ' sub' : ''}`);
      items.forEach((li) => {
        const { html, text, nested } = splitLi(li);
        const m = text.match(dateRe);
        const date = m ? m[1].replace(/\s+/g, ' ').trim() : '';
        const hasLink = /<a\s/i.test(html);
        const current = /\b(now|present)\b|現在/i.test(date);

        const item = el('li', `tl-item${current ? ' current' : ''}${sub ? '' : ' reveal'}`);
        item.append(el('div', 'tl-date', escapeHtml(date)));

        const body = el('div', 'tl-body');
        if (hasLink || !m) {
          // リンク等を含む場合は元の HTML を尊重
          const [title, rest] = hasLink ? [html, ''] : splitTitle(text);
          body.append(el('div', 'tl-title', hasLink ? title : escapeHtml(title)));
          if (rest) body.append(el('div', 'tl-sub', escapeHtml(rest)));
        } else {
          const [title, rest] = splitTitle(m[2].trim());
          body.append(el('div', 'tl-title', escapeHtml(title) + (current ? `<span class="badge-now">${t('now')}</span>` : '')));
          if (rest) body.append(el('div', 'tl-sub', escapeHtml(rest)));
        }
        nested.forEach((list) => renderNested(body, list));
        item.append(body);
        ol.append(item);
      });
      return ol;
    };

    const out = intro.map((n) => n);
    const nav = [];
    groups.forEach((g, gi) => {
      const wrap = el('div', 'group');
      wrap.id = `${ctx.sid}-g${gi}`;
      const items = topItems(g.nodes);
      wrap.append(groupTitle(g.title, items.length));
      g.nodes.filter((n) => !['UL', 'OL'].includes(n.tagName)).forEach((n) => wrap.append(n));
      if (items.length) wrap.append(buildTimeline(items, false));
      out.push(wrap);
      nav.push({ id: wrap.id, title: g.title, count: items.length });
    });
    fillRail(ctx.rail, nav);
    return out;
  },

  // 論文・発表: "著者. タイトル. 掲載先." の形の行を、タイトルを先頭にして並べる
  research(root, ctx, strip = true) {
    const { intro, groups } = splitGroups(root);
    const out = groups.length ? [...intro] : [];
    const list = groups.length ? groups : [{ title: '', nodes: intro }];
    const entries = [];
    const nav = [];

    list.forEach((g, gi) => {
      const items = topItems(g.nodes);
      const wrap = el('div', 'group');
      wrap.id = `${ctx.sid}-g${gi}`;
      if (g.title) wrap.append(groupTitle(g.title, items.length));
      const ul = el('ul', 'pubs');
      items.forEach((li) => {
        const years = li.textContent.match(YEAR_RE);
        const year = years ? years[years.length - 1] : '';
        const prev = entries[entries.length - 1];
        const rep = prev && prev.gi === gi && String(prev.year) === year;
        const row = el('li', `pub brk reveal${rep ? ' rep' : ''}`);
        row.id = `${ctx.sid}-p${entries.length}`;
        row.append(el('div', 'pub-year', year));

        const tmp = li.cloneNode(true);
        const { links, notes } = popTrailing(tmp);
        const parts = splitOutsideTags(tmp.innerHTML.trim(), '. ', 2);
        const body = el('div', 'pub-body');
        let title = tmp.textContent.trim();
        if (parts.length === 3 && parts[1].trim()) {
          const h = el('p', 'pub-title', parts[1]);
          title = h.textContent;
          notes.forEach((n) => h.append(' ', el('span', 'award', escapeHtml(n))));
          body.append(h, el('p', 'pub-authors', parts[0]));
          const venue = el('p', 'pub-venue', parts[2]);
          links.forEach((a) => venue.append(' ', a));
          body.append(venue);
        } else {
          // 形が違う行はそのまま表示する
          const p = el('p', 'pub-authors', tmp.innerHTML);
          notes.forEach((n) => p.append(' ', el('span', 'award', escapeHtml(n))));
          links.forEach((a) => p.append(' ', a));
          body.append(p);
        }
        row.append(body);
        ul.append(row);
        entries.push({ year: Number(year), gi, row, title });
      });
      wrap.append(ul);
      out.push(wrap);
      if (g.title) nav.push({ id: wrap.id, title: g.title, count: items.length });
    });

    if (strip && entries.length >= 6) {
      const chart = buildYearStrip(entries, list);
      if (chart) out.splice(groups.length ? intro.length : 0, 0, chart);
    }
    fillRail(ctx.rail, nav);
    return out;
  },

  patent(root, ctx) {
    return renderers.research(root, ctx, false);
  },

  contest(root, ctx) {
    const { intro, groups } = splitGroups(root);
    const out = [...intro];
    const tally = { gold: 0, silver: 0, bronze: 0 };
    const nav = [];

    groups.forEach((g, gi) => {
      const items = topItems(g.nodes).map(parseResult);
      const wrap = el('div', 'group');
      wrap.id = `${ctx.sid}-g${gi}`;
      wrap.append(groupTitle(g.title, items.length));
      items.forEach((r) => {
        if (r.medal && tally[r.tier] !== undefined) tally[r.tier]++;
      });
      wrap.append(items.every((r) => r.kind === 'rating') ? buildRatings(items) : buildBoard(items));
      out.push(wrap);
      nav.push({ id: wrap.id, title: g.title, count: items.length });
    });

    // 左欄: メダルの内訳
    let medals = null;
    if (tally.gold + tally.silver + tally.bronze > 0) {
      medals = el('ul', 'tally');
      ['gold', 'silver', 'bronze'].forEach((k) => {
        const li = el('li', k);
        li.append(el('i'), el('b', '', String(tally[k])), el('span', '', t(`medal.${k}`)));
        medals.append(li);
      });
    }
    fillRail(ctx.rail, nav, medals);
    return out;
  },

  // 受賞: 件数が少ないので 1 つの表にまとめ、分類（## 見出し）は列として示す
  achievement(root, ctx) {
    const { intro, groups } = splitGroups(root);
    const items = groups.flatMap((g) =>
      topItems(g.nodes).map((li) => {
        const { html } = splitLi(li);
        const tmp = el('div', '', html);
        const { links } = popTrailing(tmp);
        const [text, team] = splitTeam(tmp.textContent.trim());
        // "Award in Event" / "賞名：大会名"
        const m = text.match(/^(.+?)(?:\s+in\s+|：)([\s\S]+)$/);
        const event = m ? m[2] : '';
        const year = (event || text).match(YEAR_RE);
        return {
          kind: 'award',
          badge: '★',
          tier: 'gold',
          title: escapeHtml(m ? m[1] : text),
          meta: [escapeHtml(event), teamMeta(team)].filter(Boolean).join(' · '),
          year: year ? year[0] : '',
          cat: g.title,
          links,
        };
      })
    );
    items.sort((a, b) => Number(b.year) - Number(a.year));
    fillRail(ctx.rail, []);
    return [...intro, buildBoard(items)];
  },
};

// 年ごとの件数を小さなマスの積み上げで示す。マスは各項目へのリンクで、行とホバーが連動する
const buildYearStrip = (entries, groups) => {
  const years = entries.map((e) => e.year).filter(Boolean);
  if (!years.length) return null;
  const min = Math.min(...years);
  const max = Math.max(...years);

  const strip = el('div', 'yearstrip reveal');
  strip.setAttribute('aria-hidden', 'true');
  const cols = el('div', 'ys-cols');
  for (let y = min; y <= max; y++) {
    const col = el('div', 'ys-col');
    const stack = el('div', 'ys-stack');
    entries
      .filter((e) => e.year === y)
      .forEach((e) => {
        const dot = el('a', `ys-dot g${e.gi % 4}`);
        dot.href = `#${e.row.id}`;
        dot.title = e.title;
        dot.tabIndex = -1;
        const sync = (on) => () => {
          dot.classList.toggle('hot', on);
          e.row.classList.toggle('hot', on);
        };
        [dot, e.row].forEach((node) => {
          node.addEventListener('mouseenter', sync(true));
          node.addEventListener('mouseleave', sync(false));
        });
        stack.append(dot);
      });
    col.append(stack, el('span', 'ys-year', String(y)));
    cols.append(col);
  }

  const legend = el('p', 'ys-legend');
  legend.append(el('span', 'ys-caption', t('strip.label')));
  groups.forEach((g, gi) => {
    if (!g.title) return;
    const item = el('span', 'ys-key');
    item.append(el('i', `ys-dot g${gi % 4}`), document.createTextNode(g.title));
    legend.append(item);
  });
  strip.append(cols, legend);
  return strip;
};

// コンテストの 1 行を読み取る
//   英語: "26th place in ... (Team: xxx)" / "268th (Bronze) place in ... (2018, 3,943 teams)"
//   日本語: "26位：...（チーム：xxx）" / "268位（銅）：...（2018、3,943チーム）"
//   順位は不明だが圏内が確定しているもの: "Top 10 (Gold) in ..." / "トップ10（金）：..."
//   それ以外: "Platform: Rating" / "Platform：Rating"（Ratings など）
const parseResult = (li) => {
  const { html } = splitLi(li);
  const tmp = el('div', '', html);
  const { links } = popTrailing(tmp);
  const [text, team] = splitTeam(tmp.textContent.trim());

  const m =
    text.match(/^(\d+)(?:st|nd|rd|th)\s*(?:\(([^)]+)\))?\s*place\s+in\s+([\s\S]+)$/i) ||
    text.match(/^(\d+)位\s*(?:（([^）]+)）)?\s*[:：]\s*([\s\S]+)$/);
  const top =
    text.match(/^Top\s+(\d+)\s*(?:\(([^)]+)\))?\s+in\s+([\s\S]+)$/i) ||
    text.match(/^トップ\s*(\d+)\s*(?:（([^）]+)）)?\s*[:：]\s*([\s\S]+)$/);
  const hit = top || m;

  if (!hit) {
    // Platform 部分のリンクは残す
    const r = tmp.innerHTML.trim().match(/^(.+?)(?::\s+|：\s*)([\s\S]+)$/);
    return r ? { kind: 'rating', name: r[1], value: r[2], links } : { kind: 'plain', title: tmp.innerHTML, links };
  }

  const rank = Number(hit[1]);
  const info = splitInfo(hit[3].trim());
  const tier = medalClass(hit[2]) || (!top && rank <= 3 ? ['gold', 'silver', 'bronze'][rank - 1] : '');
  return {
    kind: 'rank',
    rank,
    badge: top ? `Top ${rank}` : String(rank),
    hash: !top,
    tier,
    medal: hit[2] || '',
    title: escapeHtml(info.title),
    meta: teamMeta(team),
    year: info.year,
    field: top ? 0 : info.field,
    unit: info.unit,
    links,
  };
};

// 末尾の括弧から開催年と参加数を取り出す: "(2026, 6,299 teams)" / "（2026、6,299チーム）" / "(2016)"
const splitInfo = (title) => {
  const fallbackYear = () => (title.match(YEAR_RE) || [''])[0];
  const m = title.match(/^([\s\S]*?)\s*[（(]([^（）()]*)[）)]\s*$/);
  if (!m) return { title, year: fallbackYear() };
  const en = m[2].match(/^(\d{4})(?:,\s*([\d,]+)\s*(teams?|participants?))?$/i);
  const ja = m[2].match(/^(\d{4})(?:、\s*(?:([\d,]+)\s*チーム|参加者\s*([\d,]+)\s*名))?$/);
  if (!en && !ja) return { title, year: fallbackYear() };
  const count = en ? en[2] : ja[2] || ja[3];
  const unit = en ? (/^p/i.test(en[3] || '') ? 'participants' : 'teams') : ja[3] ? 'participants' : 'teams';
  return {
    title: m[1],
    year: (en || ja)[1],
    field: count ? Number(count.replace(/,/g, '')) : 0,
    unit,
  };
};

// 順位表: 順位 | 名称 | 上位何% か | 年
const buildBoard = (items) => {
  const ul = el('ul', 'board');
  if (!items.some((r) => r.field || r.cat)) ul.classList.add('no-pct');
  items.forEach((r) => {
    const row = el('li', `lb-row brk reveal ${r.tier || ''}`);
    if (r.kind === 'rank') {
      row.append(el('span', 'lb-rank', (r.hash ? '<small>#</small>' : '') + escapeHtml(r.badge)));
    } else {
      row.append(el('span', 'lb-rank icon', r.badge || '•'));
    }

    const main = el('div', 'lb-main');
    const title = el('span', 'lb-title', r.title + medalTag(r.medal));
    (r.links || []).forEach((a) => title.append(' ', a));
    main.append(title);
    if (r.meta) main.append(el('span', 'lb-meta', r.meta));
    row.append(main);

    const pct = el('div', 'lb-pct');
    if (r.field) {
      const p = (r.rank / r.field) * 100;
      pct.append(el('span', 'lb-pct-num', t('top')(p < 10 ? p.toFixed(1) : String(Math.round(p)))));
      const bar = el('span', 'lb-bar');
      const fill = el('i');
      fill.style.width = `${Math.max(2, 100 - p).toFixed(1)}%`;
      bar.append(fill);
      pct.append(bar, el('span', 'lb-field', t(`of.${r.unit}`)(fmtNum(r.field))));
    } else if (r.cat) {
      pct.append(el('span', 'lb-cat', escapeHtml(r.cat)));
    }
    row.append(pct, el('span', 'lb-year', r.year || ''));
    ul.append(row);
  });
  return ul;
};

// レーティング: "色（補足）" の形なら色名と補足に分け、色名には見本を添える
const RATING_COLORS = {
  gray: '#808080', brown: '#804000', green: '#008000', cyan: '#00c0c0', blue: '#0000ff', yellow: '#c0c000', orange: '#ff8000', red: '#ff0000',
  灰色: '#808080', 茶色: '#804000', 緑: '#008000', 水色: '#00c0c0', 青: '#0000ff', 黄色: '#c0c000', 橙: '#ff8000', 赤: '#ff0000',
};

const buildRatings = (items) => {
  const ul = el('ul', 'ratings');
  items.forEach((r, i) => {
    const li = el('li', 'rating reveal');
    li.style.setProperty('--d', `${i * 0.06}s`);
    li.append(el('span', 'rating-name', r.name || ''));
    const m = (r.value || r.title || '').match(/^([\s\S]*?)\s*[（(]([\s\S]*)[）)]\s*$/);
    const value = el('span', 'rating-value', m ? m[1] : r.value || r.title || '');
    const color = RATING_COLORS[value.textContent.trim().toLowerCase()];
    if (color) {
      const sw = el('i', 'swatch');
      sw.style.background = color;
      value.prepend(sw);
    }
    li.append(value);
    if (m) li.append(el('span', 'rating-note', m[2]));
    ul.append(li);
  });
  return ul;
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

    const section = container.closest('section');
    const ctx = { sid: section?.id ?? kind, rail: section ? $('.rail-meta', section) : null };
    ctx.rail?.replaceChildren();
    const render = renderers[kind];
    const nodes = render ? render(root, ctx) : Array.from(root.children);
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

  // ヘッダーの背景と、画面上端の読み進みバー
  const bar = $('.progress i');
  const onScroll = () => {
    header.classList.toggle('scrolled', window.scrollY > 8);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (bar) bar.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
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
    const apply = () => {
      root.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch (e) {}
    };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduce) {
      apply();
      return;
    }
    // ボタンの位置から円が広がるように切り替える
    const r = btn.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    document.startViewTransition(apply).ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    });
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
