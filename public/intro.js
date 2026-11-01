// 사용법 안내 (화면에 음영을 주고 실제 버튼을 강조하며 기능 설명)
(function () {
    // 화면에 없는 대상(예: 경보 중인 대가 없어 경보 정지 버튼이 없음)은 건너뛴다
    const steps = [
        {
            target: '.status-overview',
            pill: ['pill-red', '상황판'],
            text: '대기·진입중·일시정지·경고·위험 상태인 <b>대의 수</b>를 한눈에 볼 수 있습니다.<br>누르면 그 상태인 대만 보입니다. 경고·위험인 대는 카드 맨 위로 올라옵니다.'
        },
        {
            target: '#addTeamBtn',
            pill: ['pill-blue', '대 추가'],
            text: '<b>대 추가</b>를 누르고 <b>① 안전센터 → ② 차량</b>을 고른 뒤 진입 대원과 배정 위치(층·방면 또는 구역)를 넣습니다.<br>목록 끝의 <b>+ 칸</b>도 같은 버튼입니다.'
        },
        {
            target: '.team-card .btn-start',
            pill: ['pill-green', '▶ 진입 시작'],
            text: '대원이 들어가면 <b>진입 시작</b>을 누릅니다. 압력계 바늘이 <b class="c-warn">노랑</b>(경고)·<b class="c-danger">빨강</b>(위험)에 들어가면 소리·진동·음성·화면 깜빡임으로 알립니다.'
        },
        {
            target: '.team-card .btn-mute',
            pill: ['pill-orange', '경보 정지'],
            text: '<b>경보 정지</b>는 소리·진동·음성·깜빡임만 끄고 타이머와 색은 그대로 둡니다.<br>경고에서 꺼도 위험이 되면 다시 울립니다.'
        },
        {
            target: '.team-card .btn-floor',
            pill: ['pill-blue', '층 바꾸기'],
            text: '<b>층 버튼</b>을 누르면 층·방면을 바로 바꿀 수 있습니다.<br>진입 중이면 "3층 → 5층 이동"으로 기록되고 시간은 이어집니다.'
        },
        {
            target: '.team-card .btn-edit',
            pill: ['pill-orange', '편집'],
            text: '<b>편집</b>에서 차량·대원·대장을 바꾸고, 2인1조로 따로 움직일 때는 <b>조 나누기</b>(1조·2조)를 합니다.<br>대 삭제도 이 창 맨 아래에 있습니다.'
        },
        {
            target: '#reportBtn',
            pill: ['pill-red', '현황 보고'],
            text: '층별로 <b>어느 대가 몇 분째</b> 들어가 있는지 정리하고, 그대로 읽을 보고 문장을 만들어 줍니다.'
        },
        {
            target: '#rosterBtn',
            pill: ['pill-blue', '편성표'],
            text: '<b>출동대편성표</b>(엑셀·한글 hwpx·PDF)를 불러옵니다.<br>응원 출동이면 다른 소방서 편성표도 더할 수 있습니다.'
        },
        {
            target: '#settingsBtn',
            pill: ['pill-orange', '설정'],
            text: '<b class="c-warn">경고시간</b>·<b class="c-danger">위험시간</b>, 압력계 톤, 카드 정렬, 알림을 바꾸고 <b>저장</b>을 누릅니다.<br><b>활동 기록</b>(지난 현장 포함)도 여기서 엑셀로 내려받습니다.'
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
