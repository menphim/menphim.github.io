// =========================================================
// Markdown で書かれた各セクションを読み込み、種類ごとにレイアウトを整える。
// コンテンツの編集は *.md ファイルだけで完結する:
//   - "# 見出し"   : ページ側に見出しがあるので表示しない
//   - "## 見出し"  : グループ（カード / タイムラインのまとまり）
//   - "* 項目"     : 各エントリ
// =========================================================

// GitHub Pages のサブパス配信にも対応するため、ページの置き場所を基準に解決する
const baseUrl = new URL('.', window.location.href);

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
  const comma = text.match(/^(.+?),\s*(.+)$/);
  if (comma) return [comma[1], comma[2]];
  return [text, ''];
};

// 末尾の "(Team: xxx)" を取り出す
const splitTeam = (text) => {
  const m = text.match(/^([\s\S]*?)\s*\(Team:\s*(.+)\)\s*$/i);
  return m ? [m[1], m[2]] : [text, ''];
};

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
    const dateRe = /^([^:]*?\d{4}[^:]*?)\s*:\s*([\s\S]+)$/;

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
          const [t, s] = hasLink ? [html, ''] : splitTitle(text);
          body.append(el('div', 'tl-title', hasLink ? t : escapeHtml(t)));
          if (s) body.append(el('div', 'tl-sub', escapeHtml(s)));
        } else {
          const [t, s] = splitTitle(m[2].trim());
          body.append(el('div', 'tl-title', escapeHtml(t) + (current ? '<span class="badge-now">NOW</span>' : '')));
          if (s) body.append(el('div', 'tl-sub', escapeHtml(s)));
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
      // "26th place in ... (Team: xxx)" / "268th (Bronze) place in ..."
      const [text, team] = splitTeam(raw);
      const m = text.match(/^(\d+)(?:st|nd|rd|th)\s*(?:\(([^)]+)\))?\s*place\s+in\s+([\s\S]+)$/i);
      // "Top 10 (Gold) in ..." 形式（順位は不明だが圏内が確定しているもの）
      const top = text.match(/^Top\s+(\d+)\s*(?:\(([^)]+)\))?\s+in\s+([\s\S]+)$/i);
      if (top) {
        const medal = top[2] ? top[2].toLowerCase() : '';
        return {
          badge: `TOP${top[1]}`,
          tier: medal,
          title: escapeHtml(top[3].trim()) + (top[2] ? `<span class="medal ${medal}">${escapeHtml(top[2])}</span>` : ''),
          meta: team ? `Team ${escapeHtml(team)}` : '',
        };
      }
      if (!m) {
        // "Platform: Rating" 形式（Ratings など）。Platform 部分のリンクは残す
        const r = html.match(/^(.+?):\s+([\s\S]+)$/);
        return r ? { badge: '★', tier: '', icon: true, title: r[1], meta: r[2] } : null;
      }
      const rank = Number(m[1]);
      const medal = m[2] ? m[2].toLowerCase() : '';
      const tier = medal || (rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '');
      return {
        badge: `#${rank}`,
        tier,
        title: escapeHtml(m[3].trim()) + (m[2] ? `<span class="medal ${medal}">${escapeHtml(m[2])}</span>` : ''),
        meta: team ? `Team ${escapeHtml(team)}` : '',
      };
    });
  },

  achievement(root) {
    return renderCards(root, (raw) => {
      const [text, team] = splitTeam(raw);
      const m = text.match(/^(.+?)\s+in\s+([\s\S]+)$/);
      const place = text.match(/^(\d+)(?:st|nd|rd|th)\s+place/i);
      const tier = place ? (['', 'gold', 'silver', 'bronze'][Number(place[1])] || '') : 'gold';
      return {
        badge: place ? `#${place[1]}` : '★',
        tier,
        icon: !place,
        title: escapeHtml(m ? m[1] : text),
        meta: [m ? escapeHtml(m[2]) : '', team ? `Team ${escapeHtml(team)}` : ''].filter(Boolean).join(' · '),
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

const loadSection = async (container) => {
  const file = container.dataset.md;
  const kind = container.dataset.kind;

  if (window.location.protocol === 'file:') {
    container.innerHTML =
      '<p class="md-status error">ローカルで確認するには開発サーバーが必要です: <code>python -m http.server 8000</code> を実行して http://localhost:8000 を開いてください。</p>';
    return;
  }

  container.innerHTML = '<p class="md-status">Loading…</p>';
  try {
    const res = await fetch(new URL(file, baseUrl), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${file}: ${res.status}`);
    const text = await res.text();

    const root = document.createElement('div');
    root.innerHTML = window.marked.parse(text);
    const items = topItems(Array.from(root.children));
    // コンテストは順位の付いた結果だけを数える（Ratings などは除外）
    counts[container.closest('section')?.id ?? kind] =
      kind === 'contest' ? items.filter((li) => /\bplace\b|^\s*Top\s+\d+/i.test(li.textContent)).length : items.length;

    const render = renderers[kind];
    const nodes = render ? render(root) : Array.from(root.children);
    container.replaceChildren(...nodes);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p class="md-status error">${escapeHtml(file)} を読み込めませんでした。</p>`;
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

// =========================================================
// Boot
// =========================================================
$('#year').textContent = new Date().getFullYear();
setupTheme();
const updateNav = setupNav();
setupReveal();

Promise.all($$('.md[data-md]').map(loadSection)).then(() => {
  fillStats();
  setupReveal();
  updateNav();
  // ハッシュ付きURLで来た場合、コンテンツ読み込み後に位置を合わせ直す
  try {
    if (window.location.hash) $(decodeURIComponent(window.location.hash))?.scrollIntoView();
  } catch (e) {}
});

$$('img').forEach((img) => img.addEventListener('error', () => (img.style.visibility = 'hidden')));
