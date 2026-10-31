// 화면 흐름 테스트 (앱이 실행 중이어야 한다: docker compose up -d --build)
//   npm run test:e2e
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { sleep, launch, openApp, click, isShown, startWithDummy, addVehicle, lastCard } = require('./browser');

const SAMPLE_XLSX = path.join(__dirname, '..', 'public', 'samples', 'roster-sample.xlsx');
let browser;

test.before(async () => { browser = await launch(); });
test.after(async () => { await browser.close(); });

test('처음 접속하면 편성표를 불러오기 전까지 쓸 수 없다', async () => {
    const page = await openApp(browser);
    assert.ok(await isShown(page, 'rosterModal'));
    assert.ok(await page.$eval('#closeRosterModalBtn', (b) => b.hidden));
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    assert.ok(await isShown(page, 'rosterModal'), 'Esc·바깥 클릭으로 닫히면 안 됨');

    await startWithDummy(page);
    await page.reload({ waitUntil: 'networkidle0' });
    assert.ok(!(await isShown(page, 'rosterModal')), '한 번 불러오면 다시 묻지 않음');
    assert.deepEqual(page.errors, []);
});

test('날짜가 다른 편성표는 두 번 확인한 뒤에만 쓴다', async () => {
    const page = await openApp(browser);
    const upload = async () => {
        await (await page.$('#rosterFile')).uploadFile(SAMPLE_XLSX);
        await page.waitForSelector('#confirmDialog.show');
    };
    await upload();
    assert.match(await page.$eval('#confirmMessage', (e) => e.textContent), /오늘.*과 다릅니다/);
    await click(page, '#confirmNo');
    await sleep(200);
    assert.ok(await isShown(page, 'rosterModal'), '아니오 → 불러오지 않음');

    await upload();
    await click(page, '#confirmYes');
    await sleep(200);
    assert.match(await page.$eval('#confirmMessage', (e) => e.textContent), /정말 사용하시겠습니까/);
    await click(page, '#confirmYes');
    await sleep(300);
    assert.ok(!(await isShown(page, 'rosterModal')), '두 번 예 → 불러옴');
});

test('차량을 고르지 않으면 저장되지 않는다', async () => {
    const page = await openApp(browser);
    await startWithDummy(page);
    await click(page, '#addTeamBtn');
    await sleep(300);
    await click(page, '#saveTeamBtn');
    assert.ok(await page.$eval('#stepCenter', (e) => e.classList.contains('step-error')));
    await click(page, '[data-center="작전119안전센터"]');
    await click(page, '#saveTeamBtn');
    assert.ok(await page.$eval('#stepVehicle', (e) => e.classList.contains('step-error')));
    assert.ok(await isShown(page, 'teamModal'));
    await click(page, '[data-vehicle="화학차"]');
    // 배정 위치가 없으면 아직 저장되지 않는다
    await click(page, '#saveTeamBtn');
    assert.ok(await page.$eval('#stepLocation', (e) => e.classList.contains('step-error')));
    assert.ok(await isShown(page, 'teamModal'));
    await page.type('#assignedFloor', '2');
    await click(page, '#saveTeamBtn');
    await sleep(300);
    assert.ok(!(await isShown(page, 'teamModal')));
    assert.equal(await page.$eval('#teamName', (e) => e.value), '작전 화학차');
});

test('대원명은 눌러야 보이고, 대장을 바꿀 수 있다', async () => {
    const page = await openApp(browser);
    await startWithDummy(page);
    await click(page, '#addTeamBtn');
    await sleep(300);
    await click(page, '[data-center="계산119안전센터"]');
    await click(page, '[data-vehicle="펌프차"]');
    assert.equal((await page.$$('#rosterMembers input[data-member]')).length, 0, '처음엔 이름 숨김');
    await click(page, '[data-toggle-members]');
    assert.equal(await page.$eval('.member-check.is-leader span', (e) => e.textContent), '노승현');
    await click(page, '[data-leader="예다슬"]');
    await page.type('#assignedFloor', '2');
    await click(page, '#saveTeamBtn');
    await sleep(300);

    const card = await lastCard(page);
    await card.$eval('.btn-members', (b) => b.click());
    const chips = await (await lastCard(page)).$$eval('.member-chip', (cs) => cs.map((c) => (c.classList.contains('leader') ? '⭐' : '') + c.textContent.replace('⭐', '').trim()));
    assert.deepEqual(chips, ['⭐예다슬', '노승현', '유초록', '도하늘']);
});

test('경고·위험: 음성·화면 깜빡임·기록, 화면 꺼짐 방지', async () => {
    const page = await openApp(browser);
    await startWithDummy(page);
    await addVehicle(page, '계산119안전센터', '펌프차', -2);
    assert.equal(await (await lastCard(page)).$eval('.team-floor', (e) => e.innerText.trim().split('\n').pop()), '지하2층');

    await (await lastCard(page)).$eval('.btn-start', (b) => b.click());
    await sleep(400);
    assert.equal(await page.evaluate(() => window.__wake), 1, '진입 중 화면 꺼짐 방지');

    await page.evaluate(() => { window.fieldSafetyTimer.teams.at(-1).entryTime = Date.now() - 31 * 60000; });
    await sleep(1500);
    assert.ok(await page.evaluate(() => document.body.classList.contains('flash-warning')));
    await page.evaluate(() => { window.fieldSafetyTimer.teams.at(-1).entryTime = Date.now() - 41 * 60000; });
    await sleep(1500);
    assert.ok(await page.evaluate(() => document.body.classList.contains('flash-danger')));
    assert.match(await page.$eval('#alertFlashBanner', (e) => e.textContent), /계산 펌프차 41분/);
    assert.deepEqual(await page.evaluate(() => window.__spoken), [
        '경고. 1착 계산 펌프차, 30분 경과.',
        '위험. 1착 계산 펌프차, 40분 경과. 즉시 확인하세요.'
    ]);

    await (await lastCard(page)).$eval('.btn-pause', (b) => b.click());
    await sleep(400);
    assert.ok(!(await page.evaluate(() => document.body.classList.contains('flash-danger'))));
    assert.equal(await page.evaluate(() => window.__wake), 0, '진입 중인 대가 없으면 해제');

    await click(page, '#settingsBtn');
    await click(page, '#showLogBtn');
    await sleep(200);
    const types = await page.$$eval('.log-item .log-type', (ls) => ls.map((l) => l.textContent.split(' · ')[0]));
    assert.deepEqual(types, ['일시정지', '위험', '경고', '진입 시작']);
    await click(page, '#exportLogBtn');
    await sleep(400);
    const csv = await page.evaluate(() => window.__csv);
    assert.equal(await page.evaluate(() => window.__csvBom), '239,187,191', '엑셀 한글 깨짐 방지 BOM');
    assert.match(csv, /^﻿"날짜","시각","소방서","출동대","착순","대명","내용"/);
    assert.match(csv, /"인천계양소방서","계산119안전센터","1착","계산 펌프차","위험","41:00","⭐노승현/);
    assert.deepEqual(page.errors, []);
});

test('경고·위험인 대만 위로 오고, 나머지는 등록한 순서 그대로', async () => {
    const page = await openApp(browser);
    await startWithDummy(page);
    await addVehicle(page, '계산119안전센터', '펌프차', 2);
    await addVehicle(page, '작전119안전센터', '펌프차', 3);
    await addVehicle(page, '계양119구조대', '구조버스', 4);
    await page.evaluate(() => {
        const app = window.fieldSafetyTimer;
        const ago = { '계산 펌프차': 8, '작전 펌프차': 41, '구조버스': 31 };
        app.teams.forEach((t) => {
            const key = Object.keys(ago).find((k) => t.name.endsWith(k));
            if (key) { t.status = 'active'; t.entryTime = Date.now() - ago[key] * 60000; }
        });
        app.render();
    });
    await sleep(1500);
    const names = await page.$$eval('.team-card h3', (hs) => hs.map((h) => h.textContent));
    assert.deepEqual(names, ['작전 펌프차', '계양구조대 구조버스', '1착대', '2착대', '3착대', '계산 펌프차']);
    assert.match(await page.$eval('.team-card .gauge-time', (e) => e.textContent), /^41:0\d$/);
    assert.match(await page.$eval('.team-card .team-leader', (e) => e.textContent), /^대장 /);
    assert.match(await page.$eval('.team-card .team-remain', (e) => e.textContent), /^위험 1분 넘음$/);
    const remains = await page.$$eval('.team-card .team-remain', (es) => es.map((e) => e.textContent));
    assert.ok(remains.includes('위험까지 9분') && remains.includes('경고까지 22분'), remains.join());
    assert.deepEqual(page.errors, []);
});

test('진입·일시정지·이어서 시작은 카드 자리를 바꾸지 않고, 누른 카드만 움직인다', async () => {
    const page = await openApp(browser);
    await startWithDummy(page);
    // 1~3착대에 소속·차량을 넣어 둔다 (없으면 진입 시작이 안 된다)
    await page.evaluate(() => {
        const app = window.fieldSafetyTimer;
        app.teams.forEach((t, i) => Object.assign(t, { center: '작전119안전센터', vehicle: '펌프차', floor: i + 2, members: [{ name: `대원${i}`, role: '대장' }] }));
        app.saveTeams(); app.render();
    });
    const names = () => page.$$eval('.team-card h3', (hs) => hs.map((h) => h.textContent).join(','));
    const press = async (name, sel) => {
        await page.evaluate((name, sel) => {
            const card = [...document.querySelectorAll('.team-card')].find((c) => c.querySelector('h3').textContent === name);
            card.querySelector(sel).click();
        }, name, sel);
        await sleep(700); // 같은 카드 두 번 누름 방지(0.6초)보다 길게
    };
    const status = () => page.evaluate(() => window.fieldSafetyTimer.teams.map((t) => t.status).join(','));
    const order = await names();

    await press('1착대', '.btn-start');
    await press('2착대', '.btn-start');
    await press('1착대', '.btn-pause');
    await press('2착대', '.btn-pause');
    assert.equal(await status(), 'paused,paused,waiting');
    assert.equal(await page.$eval('#statusPaused', (e) => e.textContent), '2', '상황판 일시정지 칸');
    assert.match(await page.$eval('.team-card .gauge-sub', (e) => e.textContent), /^\d\d시 \d\d분 진입$/, '일시정지 중에도 진입 시각');
    await press('2착대', '.btn-resume');
    assert.equal(await status(), 'paused,active,waiting', '누른 2착대만 이어서 시작');
    assert.equal(await names(), order, '카드 자리는 그대로');

    // 같은 카드를 빠르게 두 번 누르면 두 번째는 무시 (진입 시작 → 곧바로 일시정지 되지 않게)
    await page.evaluate(() => {
        const card = [...document.querySelectorAll('.team-card')].find((c) => c.querySelector('h3').textContent === '3착대');
        card.querySelector('.btn-start').click();
        const again = [...document.querySelectorAll('.team-card')].find((c) => c.querySelector('h3').textContent === '3착대');
        again.querySelector('.btn-pause').click();
    });
    assert.equal(await status(), 'paused,active,active');
    assert.deepEqual(page.errors, []);
});

test('넓은 1층 현장은 층 대신 구역으로 배정하고, 기록에도 남는다', async () => {
    const page = await openApp(browser);
    await startWithDummy(page);
    await click(page, '#addTeamBtn');
    await sleep(300);
    await click(page, '[data-center="계산119안전센터"]');
    await click(page, '[data-vehicle="펌프차"]');
    await click(page, '#locToggle [data-loc="zone"]');
    assert.ok(await page.$eval('#locFloor', (e) => e.hidden), '구역을 고르면 층 입력은 숨김');
    await click(page, '#zoneChips [data-zone="후면"]');
    await click(page, '#saveTeamBtn');
    await sleep(300);
    const card = await lastCard(page);
    assert.equal(await card.$eval('.team-floor', (e) => e.textContent), '후면');
    await card.$eval('.btn-start', (b) => b.click());
    await sleep(300);
    assert.equal(await page.evaluate(() => window.fieldSafetyTimer.teams.at(-1).floor), null);

    // 다시 열면 구역 탭과 값이 그대로, 직접 입력도 된다
    await (await lastCard(page)).$eval('.btn-edit', (b) => b.click());
    await sleep(300);
    assert.equal(await page.$eval('#assignedZone', (e) => e.value), '후면');
    await page.$eval('#assignedZone', (e) => { e.value = ''; });
    await page.type('#assignedZone', 'B동');
    await click(page, '#saveTeamBtn');
    await sleep(300);
    assert.equal(await (await lastCard(page)).$eval('.team-floor', (e) => e.textContent), 'B동');

    await click(page, '#settingsBtn');
    await click(page, '#showLogBtn');
    await sleep(200);
    // 진입한 뒤 구역을 바꾸면 옮겨 간 것으로 기록된다 (맨 위가 최신)
    const logs = await page.$$eval('.log-item', (es) => es.map((e) => e.textContent.replace(/\s+/g, ' ')));
    assert.match(logs[0], /1착 계산 펌프차 · B동 위치 이동 \(후면 → B동\)/);
    assert.match(logs[1], /1착 계산 펌프차 · 후면 진입 시작/);
    assert.deepEqual(page.errors, []);
});

test('소속·차량·배정 위치가 없는 대는 진입 시작이 안 되고 안내 창이 뜬다', async () => {
    const page = await openApp(browser);
    await startWithDummy(page);
    await page.$eval('.team-card .btn-start', (b) => b.click());
    await sleep(300);
    assert.ok(await isShown(page, 'unitRequiredDialog'));
    assert.equal(await page.evaluate(() => window.fieldSafetyTimer.teams[0].status), 'waiting');
    const notice = await page.$eval('#unitRequiredMessage', (e) => e.textContent);
    assert.match(notice, /소속\(안전센터\)·차량/);
    assert.match(notice, /배정 위치/);
    assert.deepEqual(await page.$$eval('.team-card:first-child .team-nounit', (es) => es.map((e) => e.textContent)), ['소속·차량 미선택', '위치 미입력']);

    // 입력하러 가기 → 소속·차량만 고르고 위치를 비우면 저장되지 않는다
    await click(page, '#unitRequiredPick');
    await sleep(300);
    assert.ok(await isShown(page, 'teamModal'));
    await click(page, '[data-center="작전119안전센터"]');
    await click(page, '[data-vehicle="펌프차"]');
    await click(page, '#saveTeamBtn');
    await sleep(300);
    assert.ok(await isShown(page, 'teamModal'), '위치 없이 저장 안 됨');
    assert.ok(await page.$eval('#stepLocation', (e) => e.classList.contains('step-error')));

    // 위치까지 넣으면 저장되고 시작된다
    await page.type('#assignedFloor', '3');
    await click(page, '#saveTeamBtn');
    await sleep(800);
    const id = await page.evaluate(() => window.fieldSafetyTimer.teams[0].id);
    await page.$eval(`[data-team-id="${id}"] .btn-start`, (b) => b.click());
    await sleep(300);
    assert.equal(await page.evaluate(() => window.fieldSafetyTimer.teams[0].status), 'active');
    assert.deepEqual(page.errors, []);
});

test('착순: 먼저 진입한 센터가 1착, 같은 센터 대는 같은 색이고 초기화해도 그대로', async () => {
    const page = await openApp(browser);
    await startWithDummy(page);
    await page.evaluate(() => {
        const app = window.fieldSafetyTimer;
        const set = [['계산119안전센터', 5], ['작전119안전센터', 9], ['작전119안전센터', 0]];
        app.teams.forEach((t, i) => {
            [t.center, t.vehicle] = [set[i][0], '펌프차'];
            if (set[i][1]) { t.status = 'active'; t.entryTime = t.firstEntryAt = Date.now() - set[i][1] * 60000; }
        });
        app.render();
    });
    const badges = () => page.$$eval('.team-card', (cs) => cs.map((c) => c.querySelector('.arrival-badge').textContent));
    assert.deepEqual(await badges(), ['2착계산', '1착작전', '1착작전']);
    const rings = await page.$$eval('.team-card .gauge', (gs) => gs.map((g) => g.style.getPropertyValue('--ring').trim()));
    assert.equal(rings[1], rings[2], '같은 센터는 같은 색');
    assert.notEqual(rings[0], rings[1]);

    await page.evaluate(() => {
        const app = window.fieldSafetyTimer;
        const t = app.teams[1];
        Object.assign(t, { status: 'waiting', entryTime: null, firstEntryAt: null });
        app.render();
    });
    assert.deepEqual(await badges(), ['2착계산', '1착작전', '1착작전'], '초기화해도 착순 유지');

    // 모든 대가 대기로 돌아가면 현장이 끝난 것: 다음 현장은 착순을 새로 센다
    await page.evaluate(() => {
        const app = window.fieldSafetyTimer;
        app.teams.forEach((t) => Object.assign(t, { status: 'waiting', entryTime: null, firstEntryAt: null }));
        app.render();
        Object.assign(app.teams[0], { status: 'active', entryTime: Date.now(), firstEntryAt: Date.now() });
        app.render();
    });
    assert.deepEqual(await badges(), ['1착계산', '착순 전 · 작전', '착순 전 · 작전']);
    assert.deepEqual(page.errors, []);
});

test('설정에서 압력계 톤 5가지 중 고르면 바로 바뀌고 다시 열어도 유지', async () => {
    const page = await openApp(browser);
    await startWithDummy(page);
    await click(page, '#settingsBtn');
    await sleep(300);
    assert.equal(await page.$$eval('.theme-pick', (b) => b.length), 5);
    assert.equal(await page.$eval('html', (h) => h.dataset.gauge), 'graphite');
    await click(page, '.theme-pick[data-theme="white"]');
    assert.equal(await page.$eval('html', (h) => h.dataset.gauge), 'white');
    assert.equal(await page.$eval('.gauge-face', (c) => getComputedStyle(c).fill), 'rgb(255, 255, 255)');
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('html', (h) => h.dataset.gauge), 'white');
    assert.deepEqual(page.errors, []);
});

test('상황판 상태를 누르면 그 상태인 대만 보이고, 다시 누르면 전체', async () => {
    const page = await openApp(browser);
    await startWithDummy(page);
    await page.evaluate(() => {
        const app = window.fieldSafetyTimer;
        app.teams.forEach((t) => { t.center = '작전119안전센터'; t.vehicle = '펌프차'; });
        Object.assign(app.teams[0], { status: 'active', entryTime: Date.now() - 41 * 60000 });
        app.render();
    });
    await sleep(1300);
    const count = () => page.$$eval('.team-card', (cs) => cs.length);
    assert.equal(await count(), 3);
    await click(page, '.status-card[data-filter="waiting"]');
    assert.equal(await count(), 2);
    assert.ok(!(await page.$eval('#filterInfo', (e) => e.hidden)));
    await click(page, '.status-card[data-filter="paused"]');
    assert.equal(await count(), 0);
    assert.match(await page.$eval('.filter-empty', (e) => e.textContent), /일시정지 상태인 대가 없습니다/);
    await click(page, '#filterInfo button');
    assert.equal(await count(), 3);
    assert.ok(await page.$eval('#filterInfo', (e) => e.hidden));
    assert.deepEqual(page.errors, []);
});

test('진입한 대의 층을 바꾸면 옮겨 간 것으로 기록되고 시간은 이어진다 + 층별 현황 보고', async () => {
    const page = await openApp(browser);
    await startWithDummy(page);
    await page.evaluate(() => {
        const app = window.fieldSafetyTimer;
        const set = [['작전119안전센터', 3, 20], ['계산119안전센터', 2, 10], ['작전119안전센터', null, 0]];
        app.teams.forEach((t, i) => {
            Object.assign(t, { center: set[i][0], vehicle: '펌프차', floor: set[i][1] });
            if (set[i][2]) Object.assign(t, { status: 'active', entryTime: Date.now() - set[i][2] * 60000, firstEntryAt: Date.now() - set[i][2] * 60000 });
        });
        app.render();
    });
    const first = await page.evaluate(() => window.fieldSafetyTimer.teams[0]);
    await page.evaluate(() => window.fieldSafetyTimer.showTeamModal(window.fieldSafetyTimer.teams[0]));
    await sleep(300);
    await page.$eval('#assignedFloor', (e) => { e.value = '4'; });
    await click(page, '#saveTeamBtn');
    await sleep(300);
    const after = await page.evaluate(() => window.fieldSafetyTimer.teams[0]);
    assert.equal(after.floor, 4);
    assert.equal(after.entryTime, first.entryTime, '시간은 이어진다');
    const log = await page.evaluate(() => window.fieldSafetyTimer.logs.at(-1));
    assert.equal(log.type, '위치 이동 (3층 → 4층)');
    assert.equal(log.arrival, '1착');

    await click(page, '#reportBtn');
    await sleep(300);
    const floors = await page.$$eval('.report-floor h3', (hs) => hs.map((h) => h.textContent));
    assert.deepEqual(floors, ['4층', '2층'], '높은 층부터');
    const text = await page.$eval('#reportText', (e) => e.textContent);
    assert.match(text, /진입 2개 대/);
    assert.match(text, /4층에 1착 .*20분 경과/);
    assert.match(text, /2층에 2착 .*10분 경과/);
    assert.match(await page.$eval('.report-team-sub', (e) => e.textContent), /3층에서 .*이동/);
    assert.deepEqual(page.errors, []);
});

test('진입 대원을 아무도 체크하지 않으면 시작 안 됨, 경고 시간은 위험보다 짧아야 함, 진입 중 삭제는 기록', async () => {
    const page = await openApp(browser);
    await startWithDummy(page);
    await page.evaluate(() => {
        const app = window.fieldSafetyTimer;
        Object.assign(app.teams[0], { center: '작전119안전센터', vehicle: '펌프차', floor: 3, members: [] });
        app.render();
    });
    await page.$eval('.team-card .btn-start', (b) => b.click());
    await sleep(300);
    assert.match(await page.$eval('#unitRequiredMessage', (e) => e.textContent), /진입 대원/);
    assert.equal(await page.evaluate(() => window.fieldSafetyTimer.teams[0].status), 'waiting');
    await click(page, '#unitRequiredClose');

    // 경고 45분 > 위험 40분은 저장하지 않는다
    await click(page, '#settingsBtn');
    await sleep(300);
    await page.$eval('#warningTime', (e) => { e.value = '45'; e.dispatchEvent(new Event('change')); });
    assert.equal(await page.evaluate(() => window.fieldSafetyTimer.settings.warningTime), 30);
    assert.equal(await page.$eval('#warningTime', (e) => e.value), '30');
    await page.evaluate(() => window.fieldSafetyTimer.closeAllModals());

    // 진입 중인 대를 지우면 한 번 더 경고하고 기록을 남긴다
    await page.evaluate(() => {
        const app = window.fieldSafetyTimer;
        Object.assign(app.teams[0], { members: [{ name: '가', role: '대장' }], status: 'active', entryTime: Date.now() - 5 * 60000 });
        app.render();
    });
    const id = await page.evaluate(() => window.fieldSafetyTimer.teams[0].id);
    await page.$eval(`[data-team-id="${id}"] .btn-delete`, (b) => b.click());
    await sleep(300);
    assert.match(await page.$eval('#confirmMessage', (e) => e.textContent), /아직 진입 중입니다/);
    await click(page, '#confirmYes');
    await sleep(300);
    assert.equal(await page.evaluate(() => window.fieldSafetyTimer.logs.at(-1).type), '삭제 (진입 중)');
    assert.deepEqual(page.errors, []);
});

test('새로고침하면 새 현장: 진입 중인 대가 없으면 바로 비우고, 있으면 이어서/새로 묻는다', async () => {
    const page = await openApp(browser);
    await startWithDummy(page);
    await addVehicle(page, '작전119안전센터', '펌프차', 3);
    await page.evaluate(() => window.fieldSafetyTimer.addLog(window.fieldSafetyTimer.teams.at(-1), '테스트', 0));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(300);
    assert.ok(!(await isShown(page, 'resumeDialog')));
    assert.deepEqual(await page.$$eval('.team-card h3', (hs) => hs.map((h) => h.textContent)), ['1착대', '2착대', '3착대']);
    assert.equal(await page.evaluate(() => window.fieldSafetyTimer.logs.length), 0);
    assert.ok(!(await isShown(page, 'rosterModal')), '편성표는 그대로');

    // 진입 중이면 묻는다: 이어서 하기 → 그대로
    await page.evaluate(() => {
        const app = window.fieldSafetyTimer;
        Object.assign(app.teams[0], { status: 'active', entryTime: Date.now() - 7 * 60000 });
        app.saveTeams();
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(300);
    assert.ok(await isShown(page, 'resumeDialog'));
    assert.match(await page.$eval('#resumeMessage', (e) => e.textContent), /1착대 7분/);
    await click(page, '#resumeContinueBtn');
    assert.equal(await page.evaluate(() => window.fieldSafetyTimer.teams[0].status), 'active');

    // 새 현장 시작 → 모두 비움
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(300);
    await click(page, '#resumeNewBtn');
    await sleep(300);
    assert.equal(await page.evaluate(() => window.fieldSafetyTimer.teams.filter((t) => t.entryTime).length), 0);
    assert.ok(!(await isShown(page, 'resumeDialog')));
    assert.deepEqual(page.errors, []);
});

test('소속·차량을 정하지 않은 빈 칸(1~3착대)은 대기 대로 세지 않는다', async () => {
    const page = await openApp(browser);
    await startWithDummy(page);
    assert.equal(await page.$eval('#statusWaiting', (e) => e.textContent), '0');
    await click(page, '#reportBtn');
    await sleep(300);
    assert.doesNotMatch(await page.$eval('#reportModal', (e) => e.textContent), /대기/);
    await page.evaluate(() => window.fieldSafetyTimer.closeAllModals());

    await addVehicle(page, '작전119안전센터', '펌프차', 3);
    assert.equal(await page.$eval('#statusWaiting', (e) => e.textContent), '1');
    await click(page, '#reportBtn');
    await sleep(300);
    assert.match(await page.$eval('#reportText', (e) => e.textContent), /진입해 있는 대가 없습니다/);
    await page.evaluate(() => window.fieldSafetyTimer.closeAllModals());
    await click(page, '.status-card[data-filter="waiting"]');
    assert.deepEqual(await page.$$eval('.team-card h3', (hs) => hs.map((h) => h.textContent)), ['작전 펌프차']);
    assert.deepEqual(page.errors, []);
});

test('응원 출동: 소방서 여러 곳 편성표, 소방서→센터→차량, 진입 차량 외에는 더보기, 직접 입력', async () => {
    const page = await openApp(browser);
    await startWithDummy(page);
    const stations = await page.evaluate(() => window.fieldSafetyTimer.rosters.map((r) => r.station));
    assert.deepEqual(stations, ['인천계양소방서', '인천미추홀소방서', '인천검단소방서', '인천강화소방서', '인천서해소방서', '인천부평소방서']);

    // 계양(내 소방서) 차량 하나
    await addVehicle(page, '작전119안전센터', '펌프차', 3);

    // 검단: 펌프차·물탱크차·구조는 바로 보이고, 고가·굴절·산불진화·구급은 더보기 안
    await click(page, '#addTeamBtn');
    await sleep(300);
    assert.equal(await page.$$eval('.station-tab', (b) => b.length), 6);
    assert.equal(await page.$eval('.station-tab.active', (b) => b.textContent.trim()), '계양');
    await click(page, '.station-tab[data-station="인천검단소방서"]');
    await click(page, '[data-center="검단119안전센터"]');
    const shown = () => page.$$eval('#rosterVehicles [data-vehicle]', (bs) => bs.map((b) => b.textContent.trim()));
    assert.deepEqual(await shown(), ['펌프차', '물탱크차']);
    await click(page, '[data-more]');
    assert.deepEqual(await shown(), ['펌프차', '물탱크차', '고가차', '굴절차', '산불진화차', '구급차']);
    await click(page, '[data-vehicle="펌프차"]');
    assert.equal(await page.$eval('#teamName', (e) => e.value), '검단 펌프차');
    await page.type('#assignedFloor', '4');
    await click(page, '#saveTeamBtn');
    await sleep(300);
    const t = await page.evaluate(() => window.fieldSafetyTimer.teams.at(-1));
    assert.equal(t.station, '인천검단소방서');
    assert.ok(t.members.length > 0, '검단 편성표의 대원');

    // 두 소방서가 진입하면 배지에 소방서 이름이 붙는다
    await page.evaluate(() => {
        const app = window.fieldSafetyTimer;
        app.teams.filter((x) => x.vehicle).forEach((x, i) => Object.assign(x, { status: 'active', entryTime: Date.now() - (9 - i) * 60000, firstEntryAt: Date.now() - (9 - i) * 60000 }));
        app.render();
    });
    const badges = await page.$$eval('.team-card .arrival-badge', (bs) => bs.map((b) => b.textContent));
    assert.ok(badges.includes('1착계양·작전') && badges.includes('2착검단·검단'), badges.join());

    // 편성표에 없는 차량은 직접 입력 (대원 없이도 진입 가능)
    await click(page, '#addTeamBtn');
    await sleep(300);
    await click(page, '[data-manual="on"]');
    await page.type('#manualCenter', '특수대응단');
    await page.type('#manualVehicle', '구조공작차');
    assert.equal(await page.$eval('#teamName', (e) => e.value), '특수대응단 구조공작차');
    await page.type('#assignedFloor', '2');
    await click(page, '#saveTeamBtn');
    await sleep(300);
    const m = await page.evaluate(() => window.fieldSafetyTimer.teams.at(-1));
    assert.deepEqual([m.center, m.vehicle, m.manual], ['특수대응단', '구조공작차', true]);
    const id = m.id;
    await page.$eval(`[data-team-id="${id}"] .btn-start`, (b) => b.click());
    await sleep(300);
    assert.equal(await page.evaluate(() => window.fieldSafetyTimer.teams.at(-1).status), 'active');

    // 편성표 빼기
    await click(page, '#rosterBtn');
    await sleep(300);
    await click(page, '[data-remove-station="인천강화소방서"]');
    await click(page, '#confirmYes');
    await sleep(300);
    assert.equal(await page.evaluate(() => window.fieldSafetyTimer.rosters.length), 5);
    assert.equal(await page.$$eval('#rosterList li', (l) => l.length), 5);
    assert.deepEqual(page.errors, []);
});
