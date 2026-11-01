// 편성표 읽기 테스트: 더미데이터 엑셀·한글·PDF 가 모두 같은 결과로 읽히는지
//   npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

globalThis.XLSX = require('xlsx');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const Roster = require('../public/roster.js');

const SAMPLES = path.join(__dirname, '..', 'public', 'samples');
const buf = (name) => {
    const b = fs.readFileSync(path.join(SAMPLES, name));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

const readers = {
    xlsx: async () => Roster.gridsToRoster(await Roster.xlsxToGrids(buf('roster-sample.xlsx'))),
    hwpx: async () => Roster.gridsToRoster(await Roster.hwpxToGrids(buf('roster-sample.hwpx'), JSZip, DOMParser)),
    pdf: async () => Roster.gridsToRoster(await Roster.pdfToGrids(buf('roster-sample.pdf'), pdfjs))
};

const vehicle = (roster, center, name) =>
    roster.centers.find(c => c.name === center).vehicles.find(v => v.name === name);

for (const [format, read] of Object.entries(readers)) {
    test(`${format}: 머리글·출동대·차량 수`, async () => {
        const r = await read();
        assert.equal(r.org, '인천계양소방서[당번1팀]');
        assert.match(r.date, /2026년 10월 28일/);
        assert.equal(r.dutyTeam, '1팀');
        // 센터별 소계 줄("13대 | 당7 …")·범례는 차량이 아니다
        assert.deepEqual(r.centers.map(c => c.name),
            ['작전119안전센터', '계산119안전센터', '장기119안전센터', '효성119안전센터', '계양119구조대']);
        assert.deepEqual(r.centers.map(c => c.vehicles.length), [13, 3, 3, 3, 2]);
        assert.deepEqual(r.centers[1].vehicles.map(v => v.name), ['펌프차', '물탱크차', '구급차']);
        assert.deepEqual(r.centers[4].vehicles.map(v => v.name), ['구조차', '구난차']);
        assert.equal(vehicle(r, '작전119안전센터', '펌프차').equipment, '(물: 3,000L, 폼: 200L) (질식덮개, 관통관창, 상방관창)');
    });

    test(`${format}: 당번팀 운전요원·진압대원과 주간/야간`, async () => {
        const r = await read();
        const pump = vehicle(r, '계산119안전센터', '펌프차');
        assert.deepEqual(pump.driver.day, ['도하늘']);
        assert.deepEqual(pump.crew.day, ['노승현', '유초록', '예다슬']); // 맨 앞이 대장

        // 주)·야) 로 나뉜 칸
        const chem = vehicle(r, '작전119안전센터', '화학차');
        assert.deepEqual(chem.driver.day, ['서파랑']);
        assert.deepEqual(chem.driver.night, ['신하늘']);
        const att = vehicle(r, '작전119안전센터', '펌프차');
        assert.deepEqual(att.crew.night, ['여정훈', '김가람(R)', '최라온(R)', '박다솜']);
        assert.deepEqual(vehicle(r, '계양119구조대', '구조차').crew.night, ['하다미(안전)', '남차돌(R)']);

        // (손차돌) 처럼 괄호로 쓴 겸직, 빈 괄호 () 는 빼기
        const fire = vehicle(r, '작전119안전센터', '산불진화차');
        assert.deepEqual(fire.driver.day, ['손차돌']);

        // 이름 사이 공백(남 결), 비고(대체인력) 유지
        assert.deepEqual(vehicle(r, '작전119안전센터', '굴절차').crew.night, ['남 결']);
        assert.deepEqual(vehicle(r, '작전119안전센터', '구급차').crew.day, ['방새론', '공아린(대체인력)']);

        // 2·3팀(비번) 대원은 들어가지 않는다
        assert.ok(!JSON.stringify(r).includes('맹고운'));
        assert.ok(!JSON.stringify(r).includes('곽마노'));
    });
}
test('주)·야) 나누기 규칙', () => {
    assert.deepEqual(Roster.parseShift('주)김가\n야)이나'), { day: ['김가'], night: ['이나'] });
    assert.deepEqual(Roster.parseShift('(주)김가\n야)이나)'), { day: ['김가'], night: ['이나'] });
    assert.deepEqual(Roster.parseShift('김가, 이나.박다'), { day: ['김가', '이나', '박다'], night: ['김가', '이나', '박다'] });
    assert.deepEqual(Roster.parseShift('()'), { day: [], night: [] });
});

test('응원 출동용 다른 소방서 더미 편성표 5곳', async () => {
    const want = {
        michuhol: ['인천미추홀소방서', ['주안119안전센터', '도화119안전센터', '용현119안전센터', '미추홀119구조대']],
        geomdan: ['인천검단소방서', ['검단119안전센터', '원당119안전센터', '불로119안전센터', '검단119구조대']],
        ganghwa: ['인천강화소방서', ['강화119안전센터', '길상119안전센터', '교동119안전센터', '강화119구조대']],
        seohae: ['인천서해소방서', ['청라119안전센터', '가정119안전센터', '석남119안전센터', '서해119구조대']],
        bupyeong: ['인천부평소방서', ['삼산119안전센터', '부개119안전센터', '십정119안전센터', '부평119구조대']]
    };
    for (const [key, [org, centers]] of Object.entries(want)) {
        const r = Roster.gridsToRoster(await Roster.xlsxToGrids(buf(`roster-${key}.xlsx`)));
        assert.match(r.org, new RegExp(`^${org}`));
        assert.deepEqual(r.centers.map((c) => c.name), centers);
        const pump = vehicle(r, centers[0], '펌프차');
        assert.equal(pump.crew.day.length, 3, `${key} 펌프차 진압대원`);
        assert.equal(pump.driver.day.length, 1);
    }
});
