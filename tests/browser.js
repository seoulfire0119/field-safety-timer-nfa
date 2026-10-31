// 브라우저 테스트·화면 캡처 공통: 실행 중인 앱(docker compose up)에 크롬으로 접속한다
//   APP_URL     기본 http://localhost:8080/
//   CHROME_PATH 기본 Windows 크롬 경로
const puppeteer = require('puppeteer-core');

const APP_URL = process.env.APP_URL || 'http://localhost:8080/';
const CHROME_PATH = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
    return puppeteer.launch({ executablePath: CHROME_PATH, headless: 'new' });
}

// 새 사용자로 앱을 연다. 음성·화면 꺼짐 방지는 기록만 남기도록 바꿔 둔다(헤드리스에서는 동작하지 않음)
async function openApp(browser, { width = 390, height = 844 } = {}) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
        window.__spoken = [];
        window.__wake = 0;
        window.__csv = null;
        window.speechSynthesis.speak = (u) => window.__spoken.push(u.text);
        Object.defineProperty(navigator, 'wakeLock', {
            value: {
                request: async () => {
                    window.__wake++;
                    return { addEventListener() {}, release: async () => { window.__wake--; } };
                }
            }
        });
        const orig = URL.createObjectURL;
        URL.createObjectURL = (b) => {
            // text() 는 맨 앞 BOM 을 지우므로 바이트로 따로 확인한다
            b.arrayBuffer().then((buf) => {
                window.__csvBom = Array.from(new Uint8Array(buf.slice(0, 3))).join(',');
                window.__csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf);
            });
            return orig(b);
        };
    });
    await page.setViewport({ width, height });
    await page.goto(APP_URL, { waitUntil: 'networkidle0' });
    return page;
}

const click = (page, selector) => page.$eval(selector, (b) => b.click());
const isShown = (page, id) => page.$eval(`#${id}`, (m) => m.classList.contains('show'));

async function startWithDummy(page) {
    await click(page, '#rosterDummyBtn');
    await page.waitForFunction(() => !document.querySelector('#rosterModal.show'));
}

// 대 추가 창에서 센터·차량을 골라 저장
async function addVehicle(page, center, vehicle, floor) {
    await click(page, '#addTeamBtn');
    await sleep(300);
    await click(page, `[data-center="${center}"]`);
    await click(page, `[data-vehicle="${vehicle}"]`);
    if (floor) await page.type('#assignedFloor', String(floor));
    await click(page, '#saveTeamBtn');
    await sleep(300);
}

// 마지막으로 추가한 대의 카드 (카드는 상태 순으로 정렬되므로 화면 순서가 아니라 id 로 찾는다)
const lastCard = async (page) => {
    const id = await page.evaluate(() => window.fieldSafetyTimer.teams.at(-1).id);
    return page.$(`[data-team-id="${id}"]`);
};

module.exports = { APP_URL, sleep, launch, openApp, click, isShown, startWithDummy, addVehicle, lastCard };
