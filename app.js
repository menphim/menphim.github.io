// Markdownロードの共通ハンドラ
// GitHub Pages対応: パスを正規化してbasePathを取得
let basePath = window.location.pathname;
// パスが/で終わっていない場合、最後のスラッシュまでの部分を取得
// index.htmlなどのファイル名が含まれている場合も対応
if (!basePath.endsWith('/')) {
  // 最後のスラッシュまでの部分を取得（ファイル名を除去）
  const lastSlashIndex = basePath.lastIndexOf('/');
  basePath = lastSlashIndex >= 0 ? basePath.substring(0, lastSlashIndex + 1) : '/';
}
// ルートパスの場合は/を保証
if (basePath === '') {
  basePath = '/';
}

const loadMarkdown = (selector, url) => {
  const target = document.querySelector(selector);
  if (!target) return;

  // file://プロトコルで開いている場合の検出
  if (window.location.protocol === 'file:') {
    target.innerHTML = '<p style="color: #ffb4a2; margin: 0;">⚠️ ローカルで開く場合は開発サーバーが必要です。<br>ターミナルで <code>python -m http.server 8000</code> または <code>npx serve</code> を実行してから <code>http://localhost:8000</code> にアクセスしてください。</p>';
    return;
  }

  target.innerHTML = '<p style="color: var(--muted); margin: 0;">Loading...</p>';

  // basePathが/で終わっていることを保証してからURLを結合
  const resolvedUrl = `${basePath}${url}`;

  fetch(resolvedUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`${resolvedUrl} fetch failed: ${response.status}`);
      return response.text();
    })
    .then((text) => {
      target.innerHTML = marked(text);
    })
    .catch((err) => {
      console.error(err);
      target.innerHTML = '<p style="color: #ffb4a2;">コンテンツを読み込めませんでした。ファイルの配置やホスティングを確認してください。</p>';
    });
};

loadMarkdown('#about-content', 'about.md');
loadMarkdown('#experience-content', 'experience.md');
loadMarkdown('#research-content', 'research.md');
loadMarkdown('#contest-content', 'contest.md');
loadMarkdown('#achievement-content', 'achievement.md');

// ナビゲーションのアクティブ状態を更新
const updateActiveNav = () => {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
  
  let currentSection = '';
  const scrollPosition = window.scrollY + 100;

  sections.forEach((section) => {
    const sectionTop = section.offsetTop;
    const sectionHeight = section.offsetHeight;
    if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
      currentSection = section.getAttribute('id');
    }
  });

  navLinks.forEach((link) => {
    link.classList.remove('active');
    if (link.getAttribute('href') === `#${currentSection}`) {
      link.classList.add('active');
    }
  });
};

// スムーズスクロールの実装
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (event) {
        event.preventDefault();

        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
          target.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
          // ハッシュを更新（履歴に追加）
          history.pushState(null, '', this.getAttribute('href'));
          // アクティブ状態を更新
          setTimeout(updateActiveNav, 100);
        }
    });
});

// スクロール時にアクティブ状態を更新
window.addEventListener('scroll', updateActiveNav);
// 初期状態を設定
updateActiveNav();

// モバイルナビの開閉
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

// 画像のエラーハンドリング
document.querySelectorAll('img').forEach((img) => {
  img.addEventListener('error', function() {
    this.style.display = 'none';
  });
});