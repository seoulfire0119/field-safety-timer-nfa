// 사용법 안내 (화면에 음영을 주고 실제 버튼을 강조하며 기능 설명)
(function () {
    const steps = [
        {
            target: '.status-overview',
            pill: ['pill-red', '상황판'],
            text: '대기·진입중·일시정지·경고·위험 상태인 <b>대의 수</b>를 한눈에 볼 수 있습니다.<br>경고·위험인 대는 카드 맨 위로 올라옵니다.'
        },
        {
            target: '.team-card .btn-start',
            pill: ['pill-green', '▶ 진입 시작'],
            text: '<b>진입 시작</b> 버튼을 누르면 진입시간 측정이 시작됩니다.'
        },
        {
            target: '.team-card .btn-edit',
            pill: ['pill-orange', '이름 변경'],
            text: '<b>연필</b> 버튼으로 1착대 이름을 바꿀 수 있습니다.<br>편성표를 불러왔다면 <b>안전센터 → 차량</b>을 눌러 탑승 대원까지 넣을 수 있습니다.'
        },
        {
            target: '#rosterBtn',
            pill: ['pill-blue', '편성표'],
            text: '<b>출동대편성표</b>(엑셀·한글 hwpx·PDF)를 불러옵니다.<br>차량별로 <b>누가 진입했고 얼마나 됐는지</b> 볼 수 있습니다.'
        },
        {
            target: '#settingsBtn',
            pill: ['pill-orange', '시간 설정'],
            text: '<b>톱니바퀴</b>를 누르면 <b class="c-warn">경고시간</b>과 <b class="c-danger">위험시간</b>이 나오며, 시간 설정을 변경할 수 있습니다.'
        },
        {
            target: '#addTeamBtn',
            pill: ['pill-blue', '대 추가'],
            text: '<b>대 추가</b>(더하기) 버튼을 누르면 진압대를 더 추가할 수 있습니다.'
        },
        {
            target: '#aboutSection',
            pill: ['pill-red', '만든 이유'],
            text: '앱을 만든 이유와 소개 그림은 화면 맨 아래에서 <b>펼쳐</b> 볼 수 있습니다.'
        }
    ];

    let active = [];
    let index = 0;
    let root, hole, tip, pillEl, textEl, stepEl, prevBtn, nextBtn, raf = null;

    function build() {
        root = document.createElement('div');
        root.className = 'tour';
        root.innerHTML = `
<div class="tour-blocker"></div>
<div class="tour-hole"></div>
<div class="tour-tip" role="dialog" aria-live="polite">
  <div class="tour-tip-head">
    <span class="tour-pill"></span>
    <span class="tour-step"></span>
  </div>
  <div class="tour-text"></div>
  <div class="tour-nav">
    <button type="button" class="tour-skip">건너뛰기</button>
    <button type="button" class="tour-prev">이전</button>
    <button type="button" class="tour-next">다음 ›</button>
  </div>
</div>`;
        document.body.appendChild(root);
        hole = root.querySelector('.tour-hole');
        tip = root.querySelector('.tour-tip');
        pillEl = root.querySelector('.tour-pill');
        textEl = root.querySelector('.tour-text');
        stepEl = root.querySelector('.tour-step');
        prevBtn = root.querySelector('.tour-prev');
        nextBtn = root.querySelector('.tour-next');

        prevBtn.addEventListener('click', () => go(index - 1));
        nextBtn.addEventListener('click', () => (index === active.length - 1 ? end() : go(index + 1)));
        root.querySelector('.tour-skip').addEventListener('click', end);
        root.querySelector('.tour-blocker').addEventListener('click', () => go(index + 1 < active.length ? index + 1 : index));
        document.addEventListener('keydown', (e) => {
            if (!root.classList.contains('show')) return;
            if (e.key === 'Escape') end();
            if (e.key === 'ArrowRight') nextBtn.click();
            if (e.key === 'ArrowLeft' && index > 0) go(index - 1);
        });
    }

    function start() {
        if (!root) build();
        // 화면에 없는 버튼(예: 진입 중이라 진입 시작 버튼이 없음)은 건너뜀
        active = steps.filter((s) => document.querySelector(s.target));
        if (!active.length) return;
        root.classList.add('show');
        go(0);
        loop();
    }

    function go(i) {
        index = Math.max(0, Math.min(active.length - 1, i));
        const s = active[index];
        pillEl.className = 'tour-pill ' + s.pill[0];
        pillEl.textContent = s.pill[1];
        textEl.innerHTML = s.text;
        stepEl.textContent = `${index + 1} / ${active.length}`;
        prevBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
        nextBtn.textContent = index === active.length - 1 ? '완료' : '다음 ›';
        const el = document.querySelector(s.target);
        if (el) el.scrollIntoView({ block: 'center', behavior: 'auto' });
        place();
    }

    // 타이머 화면이 계속 다시 그려지므로 매 프레임 위치를 다시 계산
    function loop() {
        place();
        raf = requestAnimationFrame(loop);
    }

    function place() {
        const el = document.querySelector(active[index].target);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const pad = 8;
        hole.style.top = r.top - pad + 'px';
        hole.style.left = r.left - pad + 'px';
        hole.style.width = r.width + pad * 2 + 'px';
        hole.style.height = r.height + pad * 2 + 'px';

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const tw = Math.min(340, vw - 32);
        tip.style.width = tw + 'px';
        const th = tip.offsetHeight;
        let left = r.left + r.width / 2 - tw / 2;
        left = Math.max(16, Math.min(vw - tw - 16, left));
        let top = r.bottom + pad + 14;
        if (top + th > vh - 16) top = r.top - pad - 14 - th;
        if (top < 16) top = Math.max(16, vh - th - 16);
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
    }

    function end() {
        cancelAnimationFrame(raf);
        root.classList.remove('show');
        window.scrollTo({ top: 0 });
    }

    window.startTour = start;

    document.addEventListener('DOMContentLoaded', () => {
        const helpBtn = document.getElementById('helpBtn');
        // 사용방법 안내 버튼을 눌렀을 때만 안내
        if (helpBtn) helpBtn.addEventListener('click', start);
    });
})();
