// README 용 화면 캡처 (앱이 실행 중이어야 한다)
//   npm run screenshots  →  docs/screenshots/*.png
const path = require('path');
const fs = require('fs');
const { sleep, launch, openApp, click, startWithDummy, addVehicle, lastCard } = require('./browser');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await launch();
    const shot = (page, name, el) => (el || page).screenshot({ path: path.join(OUT, name) });

    const page = await openApp(browser);
    await sleep(500);
    await shot(page, '01-start.png');

    await startWithDummy(page);
    await sleep(3200); // 알림 사라질 때까지
    await click(page, '#addTeamBtn');
    await sleep(300);
    await click(page, '[data-center="작전119안전센터"]');
    await click(page, '[data-vehicle="펌프차"]');
    await click(page, '[data-toggle-members]');
    await sleep(400);
    await shot(page, '02-pick-vehicle.png', await page.$('#rosterPicker'));
    await page.type('#assignedFloor', '5');
    await click(page, '#saveTeamBtn');

    // 진입 중인 차량 여러 대
    await addVehicle(page, '계산119안전센터', '펌프차', 3);
    await addVehicle(page, '계양119구조대', '구조버스', -1);
    await page.evaluate(() => {
        const app = window.fieldSafetyTimer;
        app.teams = app.teams.filter((t) => t.vehicle);
        const ago = [41, 31, 8]; // 작전 펌프차 위험, 계산 펌프차 경고, 구조버스 진입중
        app.teams.forEach((t, i) => { t.status = 'active'; t.entryTime = Date.now() - ago[i] * 60000; });
        app.saveTeams();
        app.render();
    });
    await sleep(3500);
    const card = await lastCard(page);
    await card.$eval('.btn-members', (b) => b.click());
    await sleep(300);
    await page.setViewport({ width: 1100, height: 900 });
    await sleep(600);
    await shot(page, '03-timers.png');

    await click(page, '#settingsBtn');
    await click(page, '#showLogBtn');
    await sleep(400);
    await page.setViewport({ width: 390, height: 844 });
    await sleep(400);
    await shot(page, '04-log.png', await page.$('#logModal .modal-content'));

    await browser.close();
    console.log('저장:', OUT);
})();
