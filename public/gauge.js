// 압력계 모양 타이머 (가운데 큰 숫자는 분:초, 아래는 진입 시각)
// 눈금은 진입한 뒤 지난 분. 0분(왼쪽 끝)에서 시계 방향으로 올라가며
// 초록(진입중) → 노랑(경고) → 빨강(위험) 구간을 지난다. 위험 시간 뒤로 빨간 구간을 조금 더 둔다.
// 바깥 가는 링은 센터 색(착순)이고, 계기판 색은 테마(styles.css 의 data-gauge)가 정한다.
const Gauge = (() => {
    const C = 100; // 중심 (viewBox 0 0 200 200)

    // 톤 5가지. colors 는 1착·2착·3착… 센터 색 — 빨강·주황·노랑·초록은 상태색이라 쓰지 않는다
    const THEMES = [
        { id: 'graphite', name: '그래파이트', desc: '기본 · 짙은 회색', colors: ['#2f6fdb', '#7c4fd6', '#12a596', '#d6458f', '#3f51b5', '#9c6b3f'] },
        { id: 'black', name: '블랙', desc: '야간 · 대비 강하게', colors: ['#1d5bbf', '#8d3fae', '#0f8a7e', '#b8327a', '#33449c', '#8a5a32'] },
        { id: 'navy', name: '네이비', desc: '푸른 계기판', colors: ['#2e9be6', '#5b5fe3', '#17b3c7', '#e05fa8', '#7d8bf0', '#b08560'] },
        { id: 'ivory', name: '아이보리', desc: '실제 압력계처럼', colors: ['#4a78b5', '#8467b8', '#3a948f', '#b5638f', '#5a6aa8', '#97795a'] },
        { id: 'white', name: '화이트', desc: '햇빛 아래 · 밝게', colors: ['#2f6fdb', '#7c4fd6', '#12a596', '#d6458f', '#3f51b5', '#9c6b3f'] }
    ];
    const NO_RING = '#8f989f'; // 착순 전·소속 없음

    function theme(id) {
        return THEMES.find(t => t.id === id) || THEMES[0];
    }

    // n 번째(0부터) 착순 센터 색. 6착 넘으면 처음 색부터 다시
    function centerColor(themeId, n) {
        const c = theme(themeId).colors;
        return n >= 0 ? c[n % c.length] : NO_RING;
    }

    function scaleMax(s) {
        return s.dangerTime + Math.max(3, Math.round(s.dangerTime * 0.125));
    }

    // 분 → 바늘 각도 (12시 방향 0도, 시계 방향 +)
    function angle(minutes, s) {
        const max = scaleMax(s);
        return -135 + 270 * Math.max(0, Math.min(max, minutes)) / max;
    }

    function pt(r, a) {
        const t = a * Math.PI / 180;
        return [C + r * Math.sin(t), C - r * Math.cos(t)];
    }

    function arc(r, a1, a2) {
        const [x1, y1] = pt(r, a1);
        const [x2, y2] = pt(r, a2);
        return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
    }

    function clock(ms) {
        const sec = Math.floor(Math.max(0, ms) / 1000);
        return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    }

    // s: { warningTime, dangerTime }, elapsed: ms, sub: 아래 작은 글씨, ring: 센터 색
    function svg(s, elapsed = 0, sub = '', ring = NO_RING) {
        const warn = Math.min(s.warningTime, s.dangerTime);
        const major = s.dangerTime <= 20 ? 5 : s.dangerTime <= 60 ? 10 : 20;
        const minor = major / 5;
        let ticks = '';
        for (let m = 0; m <= s.dangerTime + 1e-9; m += minor) {
            const a = angle(m, s);
            const isMajor = Math.abs(m / major - Math.round(m / major)) < 1e-6;
            const [x1, y1] = pt(isMajor ? 66 : 70, a);
            const [x2, y2] = pt(75, a);
            ticks += `<line class="${isMajor ? 'gauge-tick-major' : 'gauge-tick'}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
            if (isMajor) {
                // 0 은 시간 숫자에 붙어 보이지 않게 호를 따라 조금 위로 올린다
                const [lx, ly] = pt(56, m === 0 ? a + 12 : a);
                ticks += `<text class="gauge-num" x="${lx.toFixed(1)}" y="${(ly + 4.5).toFixed(1)}">${Math.round(m)}</text>`;
            }
        }

        return `
<svg class="gauge" viewBox="0 0 200 200" role="img" aria-label="경과 시간 압력계" style="--ring: ${ring}">
  <circle class="gauge-bezel" cx="100" cy="100" r="99"/>
  <circle class="gauge-ring" cx="100" cy="100" r="94.5"/>
  <circle class="gauge-face" cx="100" cy="100" r="91"/>
  <path class="gauge-band-ok" d="${arc(81, angle(0, s), angle(warn, s))}"/>
  <path class="gauge-band-warn" d="${arc(81, angle(warn, s), angle(s.dangerTime, s))}"/>
  <path class="gauge-band-danger" d="${arc(81, angle(s.dangerTime, s), angle(scaleMax(s), s))}"/>
  ${ticks}
  <text class="gauge-unit" x="100" y="80">경과 시간 (분)</text>
  <rect class="gauge-lcd" x="57" y="125" width="86" height="35" rx="6"/>
  <text class="gauge-time" x="100" y="153">${clock(elapsed)}</text>
  <text class="gauge-sub" x="100" y="175">${sub}</text>
  <g class="gauge-needle" style="transform: rotate(${angle(elapsed / 60000, s).toFixed(2)}deg)">
    <polygon class="gauge-needle-body" points="97.8,112 102.2,112 100.8,27 99.2,27"/>
  </g>
  <circle class="gauge-hub" cx="100" cy="100" r="7"/>
  <circle class="gauge-hub-cap" cx="100" cy="100" r="2.5"/>
</svg>`;
    }

    // 이미 그려진 압력계의 바늘과 숫자만 바꾼다
    function update(root, s, elapsed, sub) {
        const needle = root.querySelector('.gauge-needle');
        if (!needle) return;
        needle.style.transform = `rotate(${angle(elapsed / 60000, s).toFixed(2)}deg)`;
        root.querySelector('.gauge-time').textContent = clock(elapsed);
        if (sub !== undefined) root.querySelector('.gauge-sub').textContent = sub;
    }

    return { svg, update, clock, THEMES, theme, centerColor };
})();
