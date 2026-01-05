// Markdownロードの共通ハンドラ
const basePath = window.location.pathname.endsWith('/')
  ? window.location.pathname
  : window.location.pathname.replace(/[^/]*$/, '');

const loadMarkdown = (selector, url) => {
  const target = document.querySelector(selector);
  if (!target) return;

  target.innerHTML = '<p style="color: var(--muted); margin: 0;">Loading...</p>';

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

// スムーズスクロールの実装
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (event) {
        event.preventDefault();

        const target = document.querySelector(this.getAttribute('href'));
        target.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    });
});

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