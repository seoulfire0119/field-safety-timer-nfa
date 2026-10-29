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

    await page.evaluate(() => { window.fieldSafetyTimer.teams.at(-1).entryTime = Date.now() - 16 * 60000; });
    await sleep(1500);
    assert.ok(await page.evaluate(() => document.body.classList.contains('flash-warning')));
    await page.evaluate(() => { window.fieldSafetyTimer.teams.at(-1).entryTime = Date.now() - 21 * 60000; });
    await sleep(1500);
    assert.ok(await page.evaluate(() => document.body.classList.contains('flash-danger')));
    assert.match(await page.$eval('#alertFlashBanner', (e) => e.textContent), /계산 펌프차 21분/);
    assert.deepEqual(await page.evaluate(() => window.__spoken), [
        '경고. 계산 펌프차, 15분 경과.',
        '위험. 계산 펌프차, 20분 경과. 즉시 확인하세요.'
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
    assert.match(csv, /^﻿"날짜","시각","출동대","대명","내용"/);
    assert.match(csv, /"계산119안전센터","계산 펌프차","위험","21:00","⭐노승현/);
    assert.deepEqual(page.errors, []);
});
