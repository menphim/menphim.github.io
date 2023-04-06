// 自己紹介のコンテンツを取得
const aboutContent = document.querySelector("#about-content");
fetch("about.md")
  .then((response) => response.text())
  .then((text) => {
    aboutContent.innerHTML = marked(text);
  });

// 経歴のコンテンツを取得
const experienceContent = document.querySelector("#experience-content");
fetch("experience.md")
  .then((response) => response.text())
  .then((text) => {
    experienceContent.innerHTML = marked(text);
  });

// 研究業績のコンテンツを取得
const researchContent = document.querySelector("#research-content");
fetch("research.md")
  .then((response) => response.text())
  .then((text) => {
    researchContent.innerHTML = marked(text);
  });

const contestContent = document.querySelector("#contest-content");
fetch("contest.md")
  .then((response) => response.text())
  .then((text) => {
    contestContent.innerHTML = marked(text);
  });
    
// 受賞歴のコンテンツを取得
const achievementContent = document.querySelector("#achievement-content");
fetch("achievement.md")
  .then((response) => response.text())
  .then((text) => {
    achievementContent.innerHTML = marked(text);
  });

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