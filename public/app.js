// 소방관 현장 진입 타이머 앱

// 카드 정렬 방식. preview: 미리 보기 막대의 착순 색 (0=1착 센터, 1=2착 센터)
const CARD_ORDERS = [
    { id: 'registered', name: '등록 순서', desc: '대를 추가한 순서 그대로', preview: [0, 1, 0] },
    { id: 'center', name: '센터별 묶기', desc: '착순대로 같은 센터끼리', preview: [0, 0, 1] },
    { id: 'elapsed', name: '오래된 순', desc: '오래 들어가 있는 대가 위', preview: [1, 0, 0] }
];

class FieldSafetyTimer {
    constructor() {
        this.teams = [];
        this.settings = {
            warningTime: 30, // 분
            dangerTime: 40,  // 분
            soundEnabled: true,
            vibrationEnabled: true,
            voiceEnabled: true,  // 음성 안내
            flashEnabled: true,  // 경고·위험 시 화면 깜빡임
            theme: 'graphite',   // 압력계 톤 (gauge.js THEMES)
            cardOrder: 'registered' // 카드 정렬 (CARD_ORDERS)
        };
        this.timers = new Map(); // 각 팀별 타이머 저장
        this.alarmIntervals = new Map(); // 경보가 울리는 대 (소리는 alarmLoop 하나로 묶어서)
        this.alarmLoop = null;
        this.rosters = []; // 불러온 출동대편성표 (소방서마다 하나, 응원 출동이면 여러 개)
        this.pick = null;   // 편집 창에서 고른 센터/차량/대원
        this.logs = [];               // 활동 기록 (진입·일시정지·경고 등)
        this.wakeLock = null;         // 화면 꺼짐 방지
        this.lastSpoken = new Map();  // 팀별 마지막 음성 안내 시각
        this.tapBlockUntil = 0;       // 카드 자리가 바뀐 직후 누름을 막는 시각
        this.cardTapAt = new Map();   // 카드별 마지막 버튼 누름 (두 번 누름 방지)
        this.arrivals = [];           // 착순: 처음 진입을 시작한 센터 순서
        this.arrivalPop = new Map();  // 센터별 착순 배지가 막 생긴 시각 (튀어나오는 효과)
        this.ringFlash = new Map();   // 팀별 경고·위험이 된 시각 (압력계 링 번쩍임)
        this.filter = null;           // 상황판에서 누른 상태만 보기 (null 이면 전체)
        this.init();
    }

    async init() {
        await this.loadData();
        this.setupEventListeners();
        this.render();
        this.startGlobalTimer(); // 1초마다 모든 타이머 업데이트

        // 편성표가 없으면 불러오기 전까지 쓸 수 없다
        if (!this.hasRoster()) this.showRosterModal();
        else if (this.resumePending) this.showResumeDialog();
    }

    // 데이터 로드
    async loadData() {
        try {
            const savedTeams = await loadData('teams', []);
            const savedSettings = await loadData('settings', this.settings);
            // 예전에는 편성표를 하나만 담았다 ('roster')
            const oldRoster = await loadData('roster', null);
            this.rosters = await loadData('rosters', oldRoster ? [oldRoster] : []);
            this.rosters.forEach(r => { r.station = r.station || this.stationOf(r); });
            this.logs = await loadData('logs', []);
            this.arrivals = await loadData('arrivals', []);

            this.teams = savedTeams;
            this.settings = { ...this.settings, ...savedSettings };
            // 예전 기본값(15/20분)을 그대로 쓰던 기기는 새 기본값(30/40분)으로
            if (savedSettings && savedSettings.warningTime === 15 && savedSettings.dangerTime === 20) {
                this.settings.warningTime = 30;
                this.settings.dangerTime = 40;
                this.saveSettings();
            }
            this.applyTheme();

            // 새로고침·다시 열기는 새 현장이다: 대 목록·활동 기록·착순을 비운다 (편성표·설정은 그대로).
            // 다만 진입 중인 대가 남아 있으면 실수로 새로고침했을 수 있으므로 init 에서 물어본다.
            this.resumePending = this.teams.some(t => t.entryTime && t.status !== 'waiting');
            if (!this.resumePending) this.clearIncident();

            // 기본 팀들이 없으면 생성
            if (this.teams.length === 0) {
                this.teams = this.defaultTeams();
                this.saveTeams();
            }
        } catch (error) {
            console.error('데이터 로드 실패:', error);
        }
    }

    defaultTeams() {
        return [1, 2, 3].map(i => ({
            id: this.generateId(),
            name: `${i}착대`,
            floor: null,
            status: 'waiting', // waiting, active, warning, danger, paused
            entryTime: null
        }));
    }

    // 현장 기록 비우기: 대 목록(기본 3개로)·활동 기록·착순
    clearIncident() {
        this.stopAllAlarms();
        this.timers.clear();
        this.teams = this.defaultTeams();
        this.logs = [];
        this.arrivals = [];
        this.filter = null;
        this.saveTeams();
        saveData('logs', this.logs);
        saveData('arrivals', this.arrivals);
    }

    showResumeDialog() {
        const inside = this.teams.filter(t => t.entryTime && t.status !== 'waiting');
        document.getElementById('resumeMessage').textContent =
            `${inside.map(t => `${t.name} ${Math.floor(this.teamElapsed(t) / 60000)}분`).join(', ')}
같은 현장이면 '이어서 하기'를 누르세요. 시간은 그대로 이어집니다.
새 현장이면 '새 현장 시작'을 누르면 대 목록과 활동 기록이 모두 지워집니다.`;
        document.getElementById('resumeContinueBtn').onclick = () => this.closeModal('resumeDialog');
        document.getElementById('resumeExportBtn').onclick = () => this.exportLogs();
        document.getElementById('resumeNewBtn').onclick = () => {
            this.clearIncident();
            this.render();
            this.closeModal('resumeDialog');
            this.showToast('새 현장을 시작합니다.', 'success');
        };
        this.showModal('resumeDialog');
    }

    // 데이터 저장
    saveTeams() {
        saveData('teams', this.teams);
    }

    saveSettings() {
        saveData('settings', this.settings);
    }

    applyTheme() {
        document.documentElement.dataset.gauge = Gauge.theme(this.settings.theme).id;
    }

    // 착순: 센터마다 처음 진입을 시작한 순서. 한 번 정해지면 그 센터 대가 모두 지워질 때까지 바뀌지 않는다
    // (초기화·일시정지를 해도 그대로라서 색이 중간에 바뀌지 않는다)
    arrivalOrder() {
        const first = new Map();
        this.teams.forEach(t => {
            const at = t.firstEntryAt || t.entryTime;
            if (!t.center || !at) return;
            if (!first.has(t.center) || at < first.get(t.center)) first.set(t.center, at);
        });
        // 진입 중·일시정지인 대가 하나도 없으면 현장이 끝난 것으로 보고 착순을 새로 센다
        const kept = first.size ? this.arrivals.filter(c => this.teams.some(t => t.center === c)) : [];
        const added = [...first.keys()].filter(c => !kept.includes(c)).sort((a, b) => first.get(a) - first.get(b));
        const order = [...kept, ...added];
        added.forEach(c => this.arrivalPop.set(c, Date.now()));
        if (order.join('|') !== this.arrivals.join('|')) {
            this.arrivals = order;
            saveData('arrivals', order);
        }
        return order;
    }

    // "1착" (착순이 없으면 빈 문자열) — 음성·기록·보고에 쓴다
    arrivalLabel(team) {
        const n = team.center ? this.arrivalOrder().indexOf(team.center) : -1;
        return n >= 0 ? `${n + 1}착` : '';
    }

    // 여러 소방서가 함께 출동했는지 (그러면 배지·보고에 소방서 이름을 붙인다)
    multiStation() {
        return new Set(this.teams.filter(t => t.station && this.isUnit(t)).map(t => t.station)).size > 1;
    }

    // 배지에 쓰는 소속: "작전" 또는 여러 소방서면 "부평·삼산"
    unitLabel(team) {
        const center = this.shortCenter(team.center);
        return this.multiStation() && team.station ? `${this.shortStation(team.station)}·${center}` : center;
    }

    shortCenter(name) {
        return name.replace(/119안전센터$|안전센터$/, '').replace(/119구조대$/, '구조대');
    }

    // 이벤트 리스너 설정
    setupEventListeners() {
        // 설정 버튼
        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.showSettingsModal();
        });

        // 팀 추가 버튼
        document.getElementById('addTeamBtn').addEventListener('click', () => {
            this.showTeamModal();
        });

        document.getElementById('addFirstTeamBtn').addEventListener('click', () => {
            this.showTeamModal();
        });

        // 출동대편성표 불러오기
        const rosterFile = document.getElementById('rosterFile');
        document.getElementById('rosterBtn').addEventListener('click', () => this.showRosterModal());
        document.getElementById('rosterUploadBtn').addEventListener('click', () => rosterFile.click());
        document.getElementById('rosterDummyBtn').addEventListener('click', () => this.loadSampleRoster());
        document.getElementById('closeRosterModalBtn').addEventListener('click', () => this.closeModal('rosterModal'));
        document.getElementById('rosterList').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-remove-station]');
            if (btn) this.removeRoster(btn.dataset.removeStation);
        });
        rosterFile.addEventListener('change', () => {
            const file = rosterFile.files[0];
            rosterFile.value = '';
            if (file) this.importRoster(file);
        });

        // 모달 관련 이벤트
        this.setupModalEvents();

        // 활동 기록
        document.getElementById('showLogBtn').addEventListener('click', () => this.showLogModal());
        document.getElementById('closeLogModalBtn').addEventListener('click', () => this.closeModal('logModal'));
        document.getElementById('exportLogBtn').addEventListener('click', () => this.exportLogs());
        document.getElementById('clearLogBtn').addEventListener('click', () => {
            this.showConfirmDialog('활동 기록을 모두 지우시겠습니까?', () => {
                this.logs = [];
                saveData('logs', this.logs);
                this.renderLogs();
            });
        });

        // 다른 앱에 갔다 돌아오면 화면 꺼짐 방지를 다시 건다
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') this.updateWakeLock();
        });

        // 키보드 이벤트
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
        });

        // 알림 권한 요청
        this.requestNotificationPermission();
    }

    setupModalEvents() {
        // 설정 모달
        document.getElementById('closeSettingsBtn').addEventListener('click', () => {
            this.closeModal('settingsModal');
        });
        document.getElementById('cancelSettingsBtn').addEventListener('click', () => {
            this.closeModal('settingsModal');
        });
        document.getElementById('saveSettingsBtn').addEventListener('click', () => this.updateSettings());

        document.getElementById('clearDataBtn').addEventListener('click', () => {
            this.showConfirmDialog('모든 데이터를 초기화하시겠습니까?', () => {
                this.clearAllData();
            });
        });

        // 팀 모달
        document.getElementById('closeTeamModalBtn').addEventListener('click', () => {
            this.closeModal('teamModal');
        });

        document.getElementById('saveTeamBtn').addEventListener('click', () => {
            this.saveTeam();
        });

        document.getElementById('cancelTeamBtn').addEventListener('click', () => {
            this.closeModal('teamModal');
        });

        document.getElementById('deleteTeamBtn').addEventListener('click', () => {
            this.deleteCurrentTeam();
        });

        // 조 나누기
        document.getElementById('splitTeamBtn').addEventListener('click', () => {
            const team = this.currentEditingTeam;
            if (!team) return;
            this.closeModal('teamModal');
            this.showSplitModal(team);
        });
        document.getElementById('closeSplitModalBtn').addEventListener('click', () => this.closeModal('splitModal'));
        document.getElementById('splitCancelBtn').addEventListener('click', () => this.closeModal('splitModal'));
        document.getElementById('splitApplyBtn').addEventListener('click', () => this.applySplit());
        document.getElementById('splitMembers').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-member]');
            if (!btn || !this.split) return;
            const name = btn.dataset.member;
            if (this.split.members.has(name)) this.split.members.delete(name);
            else this.split.members.add(name);
            btn.classList.toggle('active', this.split.members.has(name));
        });
        document.getElementById('splitSideChips').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-side]');
            if (!btn || !this.split) return;
            this.split.side = btn.dataset.side || null;
            this.markSide('splitSideChips', this.split.side);
        });
        document.getElementById('splitFloorGrid').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-floor]');
            if (!btn || !this.split) return;
            this.split.floor = parseInt(btn.dataset.floor, 10);
            document.getElementById('splitFloorInput').value = '';
            document.querySelectorAll('#splitFloorGrid button').forEach(b => b.classList.toggle('active', b === btn));
        });
        document.getElementById('splitFloorInput').addEventListener('input', (e) => {
            if (!this.split) return;
            this.split.floor = parseInt(e.target.value, 10) || null;
            document.querySelectorAll('#splitFloorGrid button').forEach(b => b.classList.remove('active'));
        });

        // 위치 바꾸기 창: 층·구역 하나 누르면 바로 바뀌고 닫힌다
        document.getElementById('closeLocModalBtn').addEventListener('click', () => this.closeModal('locModal'));
        document.getElementById('locPickToggle').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-loc]');
            if (btn) this.setLocPickMode(btn.dataset.loc);
        });
        document.getElementById('locFloorGrid').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-floor]');
            if (btn) this.applyLocation(parseInt(btn.dataset.floor, 10), null);
        });
        document.getElementById('locSideChips').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-side]');
            if (btn) this.pickLocSide(btn.dataset.side);
        });
        document.getElementById('locZoneGrid').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-zone]');
            if (btn) this.applyLocation(null, btn.dataset.zone);
        });
        const applyFloorInput = () => this.applyLocation(parseInt(document.getElementById('locFloorInput').value, 10) || null, null);
        const applyZoneInput = () => this.applyLocation(null, document.getElementById('locZoneInput').value.trim() || null);
        document.getElementById('locFloorApply').addEventListener('click', applyFloorInput);
        document.getElementById('locZoneApply').addEventListener('click', applyZoneInput);
        document.getElementById('locFloorInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFloorInput(); });
        document.getElementById('locZoneInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyZoneInput(); });

        // 배정 위치: 층 / 구역
        document.getElementById('locToggle').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-loc]');
            if (btn) this.setLocMode(btn.dataset.loc);
        });
        document.getElementById('zoneChips').addEventListener('click', (e) => {
            const chip = e.target.closest('button[data-zone]');
            if (!chip) return;
            document.getElementById('assignedZone').value = chip.dataset.zone;
            this.markZoneChip();
        });
        document.getElementById('assignedZone').addEventListener('input', () => this.markZoneChip());
        document.getElementById('sideChips').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-side]');
            if (!btn) return;
            this.editSide = btn.dataset.side || null;
            this.markSide('sideChips', this.editSide);
        });

        // 편성표에서 센터 → 차량 → 대원 고르기
        const picker = document.getElementById('rosterPicker');
        picker.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-station], button[data-more], button[data-manual], button[data-center], button[data-vehicle], button[data-shift], button[data-toggle-members], button[data-leader]');
            if (!btn) return;
            if (btn.dataset.station !== undefined) this.pickStation(btn.dataset.station);
            else if (btn.dataset.more !== undefined) {
                this.pick.showMore = !this.pick.showMore;
                this.renderRosterPicker();
            } else if (btn.dataset.manual !== undefined) this.setManual(btn.dataset.manual === 'on');
            else if (btn.dataset.leader !== undefined) {
                // 대장 바꾸기: 대장은 진입 대원이어야 하므로 체크도 함께
                this.pick.leader = btn.dataset.leader;
                this.pick.checked.add(btn.dataset.leader);
                this.renderRosterPicker();
            } else if (btn.dataset.toggleMembers !== undefined) {
                this.pick.showMembers = !this.pick.showMembers;
                this.renderRosterPicker();
            } else if (btn.dataset.center !== undefined) this.pickCenter(btn.dataset.center);
            else if (btn.dataset.vehicle !== undefined) this.pickVehicle(btn.dataset.vehicle);
            else this.pickShift(btn.dataset.shift);
        });
        // 직접 입력: 다시 그리지 않고 값만 받는다 (입력 중 글자가 끊기지 않게)
        picker.addEventListener('input', (e) => {
            const p = this.pick;
            if (!p.manual || !['manualCenter', 'manualVehicle'].includes(e.target.id)) return;
            p.manual[e.target.id === 'manualCenter' ? 'center' : 'vehicle'] = e.target.value;
            document.getElementById('teamName').value = `${p.manual.center.trim()} ${p.manual.vehicle.trim()}`.trim();
        });
        picker.addEventListener('change', (e) => {
            const box = e.target.closest('input[data-member]');
            if (!box) return;
            if (box.checked) this.pick.checked.add(box.dataset.member);
            else this.pick.checked.delete(box.dataset.member);
            this.renderRosterPicker();
        });

        document.getElementById('unitRequiredClose').addEventListener('click', () => this.closeModal('unitRequiredDialog'));

        // 확인 다이얼로그
        document.getElementById('confirmNo').addEventListener('click', () => {
            this.closeModal('confirmDialog');
        });

        // 상황판: 상태를 누르면 그 상태인 대만, 다시 누르면 전체
        document.getElementById('statusOverview').addEventListener('click', (e) => {
            const card = e.target.closest('.status-card');
            if (card) this.setFilter(this.filter === card.dataset.filter ? null : card.dataset.filter);
        });
        document.getElementById('filterInfo').addEventListener('click', (e) => {
            if (e.target.closest('button')) this.setFilter(null);
        });

        // 현황 보고
        document.getElementById('reportBtn').addEventListener('click', () => this.showReport());
        document.getElementById('closeReportModalBtn').addEventListener('click', () => this.closeModal('reportModal'));
        document.getElementById('reportCopyBtn').addEventListener('click', () => this.copyReport());
        document.getElementById('reportSpeakBtn').addEventListener('click', () => this.speak(document.getElementById('reportText').textContent));

        document.getElementById('themePicks').addEventListener('click', (e) => {
            const btn = e.target.closest('.theme-pick');
            if (btn) this.pickTheme(btn.dataset.theme);
        });
        document.getElementById('orderPicks').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-order]');
            if (btn) this.pickCardOrder(btn.dataset.order);
        });

        // 모달 외부 클릭시 닫기
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal.id);
                }
            });
        });
    }

    // ID 생성
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // 팀 추가/편집 모달 표시
    showTeamModal(team = null) {
        document.getElementById('stepLocation').classList.remove('step-error');
        const modal = document.getElementById('teamModal');
        const title = document.getElementById('teamModalTitle');
        const nameInput = document.getElementById('teamName');
        const floorInput = document.getElementById('assignedFloor');
        const deleteZone = document.getElementById('deleteTeamZone');

        // 구역 버튼은 이 현장에서 이미 쓴 구역 이름들
        document.getElementById('zoneChips').innerHTML = this.recentZones()
            .map(z => `<button type="button" class="chip" data-zone="${escapeHtml(z)}">${escapeHtml(z)}</button>`).join('');

        if (team) {
            title.textContent = '대 편집';
            nameInput.value = team.name;
            floorInput.value = team.floor || '';
            document.getElementById('assignedZone').value = team.zone || '';
            this.editSide = team.zone ? null : team.side || null;
            this.setLocMode(team.zone ? 'zone' : 'floor');
            deleteZone.hidden = false;
            document.getElementById('splitTeamZone').hidden = false;
            this.currentEditingTeam = team;
        } else {
            title.textContent = '대 추가';
            nameInput.value = '';
            floorInput.value = '';
            document.getElementById('assignedZone').value = '';
            this.editSide = null;
            this.setLocMode('floor');
            deleteZone.hidden = true;
            document.getElementById('splitTeamZone').hidden = true;
            this.currentEditingTeam = null;
        }
        this.markSide('sideChips', this.editSide);

        const manual = team && team.manual;
        this.pick = {
            station: (team && (team.station || this.stationOfCenter(team.center))) || (this.rosters[0] || {}).station || null,
            manual: manual ? { center: team.center || '', vehicle: team.vehicle || '' } : null, // 편성표에 없는 차량 직접 입력
            showMore: false,    // 진입 차량이 아닌 것(고가·굴절 등) 펼치기
            center: team && !manual ? team.center || null : null,
            vehicle: team && !manual ? team.vehicle || null : null,
            shift: (team && team.shift) || this.currentShift(),
            checked: new Set(team && team.members ? team.members.map(m => m.name) : []),
            leader: team && team.members ? (team.members.find(m => m.role === '대장') || {}).name || null : null,
            showMembers: false, // 대원명은 '대원명 알아보기'를 눌러야 보인다
            error: null         // 'center' | 'vehicle': 저장하려는데 고르지 않은 단계
        };
        this.renderRosterPicker();

        this.showModal('teamModal');
        if (!this.hasRoster()) nameInput.focus();
    }

    // ---------------------------------------------------------- 출동대편성표
    async importRoster(file, { sample = false } = {}) {
        this.showToast('편성표를 읽는 중입니다...', 'info');
        let roster;
        try {
            roster = await Roster.parseRosterFile(file);
        } catch (error) {
            console.error('편성표 읽기 실패:', error);
            this.showToast(error.message || '편성표를 읽지 못했습니다.', 'error');
            return;
        }

        // 더미데이터는 날짜 확인을 하지 않는다
        if (sample || this.isRosterToday(roster)) {
            this.applyRoster(roster);
            return;
        }
        const cancel = () => this.showToast('편성표를 불러오지 않았습니다.', 'warning');
        this.showConfirmDialog(
            `편성표 날짜(${roster.date})가 오늘(${this.todayText()})과 다릅니다.\n그래도 이 편성표를 사용하시겠습니까?`,
            () => this.showConfirmDialog(
                '⚠️ 다른 날의 편성표를 쓰면 출동 대원이 실제와 다를 수 있습니다.\n정말 사용하시겠습니까?',
                () => this.applyRoster(roster),
                cancel
            ),
            cancel
        );
    }

    // 소방서마다 편성표 하나. 같은 소방서 편성표를 다시 올리면 바꾸고, 다른 소방서면 더한다 (응원 출동)
    applyRoster(roster, { quiet = false } = {}) {
        const first = !this.hasRoster();
        roster.station = this.stationOf(roster);
        const i = this.rosters.findIndex(r => r.station === roster.station);
        if (i >= 0) this.rosters[i] = roster;
        else this.rosters.push(roster);
        saveData('rosters', this.rosters);
        deleteData('roster');
        if (quiet) return;
        const vehicles = roster.centers.reduce((n, c) => n + c.vehicles.length, 0);
        this.showToast(`${roster.station} 편성표를 ${i >= 0 ? '새 파일로 바꿨습니다' : '불러왔습니다'} · 센터 ${roster.centers.length}곳 · 차량 ${vehicles}대`, 'success');
        // 처음이면 닫고, 응원 소방서를 더하는 중이면 목록을 보여 준다
        if (first) this.closeModal('rosterModal');
        else this.showRosterModal();
    }

    removeRoster(station) {
        this.showConfirmDialog(`${station} 편성표를 뺄까요?\n이미 등록한 대와 대원 이름은 그대로 남습니다.`, () => {
            this.rosters = this.rosters.filter(r => r.station !== station);
            saveData('rosters', this.rosters);
            this.showRosterModal();
        });
    }

    // "인천계양소방서[당번(3팀)]" → "인천계양소방서". 소방서 이름이 없으면 파일 이름
    stationOf(roster) {
        const m = String(roster.org || '').match(/([가-힣]+소방서)/);
        return m ? m[1] : String(roster.fileName || '편성표').replace(/\.[^.]+$/, '');
    }

    // "인천계양소방서" → "계양"
    shortStation(name) {
        return String(name || '')
            .replace(/^(인천|서울|부산|대구|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?=[가-힣]{2})/, '')
            .replace(/소방서$/, '');
    }

    hasRoster() {
        return this.rosters.length > 0;
    }

    rosterOf(station) {
        return this.rosters.find(r => r.station === station) || null;
    }

    // 예전에 저장한 대처럼 소방서가 없으면 센터 이름으로 찾는다
    stationOfCenter(center) {
        const r = this.rosters.find(x => x.centers.some(c => c.name === center));
        return r ? r.station : null;
    }

    // 편성표에서 날짜를 못 찾으면 확인하지 않는다
    isRosterToday(roster) {
        const m = String(roster.date || '').match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
        if (!m) return true;
        const d = new Date();
        return +m[1] === d.getFullYear() && +m[2] === d.getMonth() + 1 && +m[3] === d.getDate();
    }

    todayText() {
        const d = new Date();
        return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
    }

    // 더미데이터(가짜 이름) 편성표로 시작: 계양(내 소방서) + 응원 소방서 5곳
    async loadSampleRoster() {
        const files = [['sample', '계양'], ['michuhol', '미추홀'], ['geomdan', '검단'], ['ganghwa', '강화'], ['seohae', '서해'], ['bupyeong', '부평']];
        try {
            for (const [key, name] of files) {
                const res = await fetch(`samples/roster-${key}.xlsx`);
                if (!res.ok) throw new Error();
                const roster = await Roster.parseRosterFile(new File([await res.blob()], `출동대편성표_${name}(더미).xlsx`));
                this.applyRoster(roster, { quiet: true });
            }
        } catch (error) {
            console.error('더미데이터 읽기 실패:', error);
            this.showToast('더미데이터를 불러오지 못했습니다.', 'error');
            return;
        }
        this.showToast(`더미 편성표 ${this.rosters.length}곳을 불러왔습니다: ${this.rosters.map(r => this.shortStation(r.station)).join('·')}`, 'success');
        this.closeModal('rosterModal');
    }

    // 편성표 불러오기 창: 편성표가 없으면 닫을 수 없다
    showRosterModal() {
        const has = this.hasRoster();
        const list = document.getElementById('rosterList');
        document.getElementById('closeRosterModalBtn').hidden = !has;
        list.hidden = !has;
        list.innerHTML = this.rosters.map((r, i) => {
            const vehicles = r.centers.reduce((n, c) => n + c.vehicles.length, 0);
            return `<li>
                <div><b>${escapeHtml(r.station)}</b>${i === 0 ? ' <em>내 소방서</em>' : ''}
                    <span>${escapeHtml([r.date, `센터 ${r.centers.length}곳 · 차량 ${vehicles}대`].filter(Boolean).join(' · '))}</span></div>
                <button type="button" class="btn-small" data-remove-station="${escapeHtml(r.station)}" aria-label="${escapeHtml(r.station)} 편성표 빼기" title="빼기">✕</button>
            </li>`;
        }).join('');
        document.getElementById('rosterUploadBtn').textContent = has ? '응원 소방서 편성표 추가' : '편성표 파일 올리기';
        document.querySelector('.roster-modal-lead').innerHTML = has
            ? '응원 출동이 오면 <b>그 소방서 편성표도 추가</b>하세요. 같은 소방서는 새 파일로 바뀝니다.'
            : '먼저 <b>오늘의 출동대편성표</b>를 불러와 주세요.';
        this.showModal('rosterModal');
        this.playRosterHero();
    }

    // 편성표 창 위쪽 압력계: 바늘이 0분에서 위험까지 올라가는 모습을 되풀이해 보여 준다
    playRosterHero() {
        const hero = document.getElementById('rosterHero');
        const demo = { warningTime: 30, dangerTime: 40 };
        if (!hero.firstElementChild) hero.innerHTML = Gauge.svg(demo, 0, '진입중');
        if (this.heroPlaying) return;
        this.heroPlaying = true;

        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const cycle = 7000; // 7초에 45분
        const t0 = performance.now();
        const step = (t) => {
            if (!document.getElementById('rosterModal').classList.contains('show')) {
                this.heroPlaying = false;
                return;
            }
            const minutes = still ? 33 : Math.min(45, ((t - t0) % (cycle + 1500)) / cycle * 45);
            const status = minutes >= 40 ? 'danger' : minutes >= 30 ? 'warning' : 'active';
            hero.className = `roster-hero from-${status}`;
            // 시연에서는 진입 시각 대신 바늘이 지나는 구간 이름을 보여 준다
            Gauge.update(hero, demo, minutes * 60000, { active: '진입중', warning: '경고', danger: '위험' }[status]);
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    // 편집 창의 주간/야간 기본값.
    // 최근 12시간 안에 직접 고른 근무조가 있으면 그것(야간조가 일찍 출근한 경우 등),
    // 없으면 시계 기준(09~18시 주간, 나머지 야간)
    currentShift() {
        try {
            const last = JSON.parse(localStorage.getItem('lastShift') || 'null');
            if (last && Date.now() - last.at < 12 * 60 * 60 * 1000) return last.shift;
        } catch (e) {}
        const h = new Date().getHours();
        return h >= 9 && h < 18 ? 'day' : 'night';
    }

    findVehicle(station, centerName, vehicleName) {
        if (!centerName || !vehicleName) return null;
        for (const r of station ? this.rosters.filter(x => x.station === station) : this.rosters) {
            const center = r.centers.find(c => c.name === centerName);
            const vehicle = center && center.vehicles.find(v => v.name === vehicleName);
            if (vehicle) return vehicle;
        }
        return null;
    }

    // 대원이 건물 안에 들어가는 차량은 앞에, 고가·굴절·산불진화·구급 등은 '더보기'로
    isEntryVehicle(name) {
        return /펌프|탱크|구조|화학/.test(name);
    }

    // 고른 차량·근무조의 탑승 대원
    // 편성표에는 직책이 따로 없으므로 진압대원 칸 맨 앞 사람을 대장(선착대장·진압대장)으로 본다.
    // 진압대원이 없으면 운전요원이 대장이다.
    pickMembers() {
        const p = this.pick;
        const vehicle = this.findVehicle(p.station, p.center, p.vehicle);
        if (!vehicle) {
            // 편성표가 바뀌어 차량이 없으면 저장된 대원을 그대로 보여 준다
            const team = this.currentEditingTeam;
            const saved = team && team.vehicle === p.vehicle && team.members ? team.members : [];
            return saved.map(m => (m.role === '대장' ? { ...m, role: m.baseRole || '진압' } : m));
        }
        const list = [];
        vehicle.crew[p.shift].forEach(name => list.push({ name, role: '진압' }));
        vehicle.driver[p.shift].forEach(name => list.push({ name, role: '운전' }));
        return list.filter((m, i) => list.findIndex(x => x.name === m.name) === i);
    }

    // 처음 대장은 맨 앞 사람 (편집 창에서 '대장 지정'으로 바꿀 수 있다)
    resetLeader() {
        const first = this.pickMembers()[0];
        this.pick.leader = first ? first.name : null;
    }

    // 저장할 진입 대원: 체크한 사람만, 대장을 맨 앞에
    pickedMembers() {
        const p = this.pick;
        return this.pickMembers()
            .filter(m => p.checked.has(m.name))
            .map(m => (m.name === p.leader ? { name: m.name, role: '대장', baseRole: m.role } : m))
            .sort((a, b) => (b.role === '대장') - (a.role === '대장'));
    }

    pickStation(station) {
        const p = this.pick;
        if (p.station === station) return;
        Object.assign(p, { station, center: null, vehicle: null, showMore: false });
        p.checked.clear();
        this.renderRosterPicker();
    }

    setManual(on) {
        const p = this.pick;
        p.manual = on ? { center: '', vehicle: '' } : null;
        Object.assign(p, { center: null, vehicle: null, error: null });
        p.checked.clear();
        this.renderRosterPicker();
        if (on) document.getElementById('manualCenter').focus();
    }

    pickCenter(name) {
        this.pick.center = this.pick.center === name ? null : name;
        this.pick.vehicle = null;
        if (this.pick.error === 'center' && this.pick.center) this.pick.error = 'vehicle';
        this.pick.checked.clear();
        this.renderRosterPicker();
    }

    pickVehicle(name) {
        const p = this.pick;
        if (p.vehicle === name) {
            p.vehicle = null;
            p.checked.clear();
        } else {
            p.vehicle = name;
            p.error = null;
            p.showMembers = false;
            p.checked = new Set(this.pickMembers().map(m => m.name));
            this.resetLeader();
            const short = this.shortCenter(p.center);
            document.getElementById('teamName').value = `${short} ${name}`.trim();
        }
        this.renderRosterPicker();
    }

    pickShift(shift) {
        this.pick.shift = shift;
        try {
            localStorage.setItem('lastShift', JSON.stringify({ shift, at: Date.now() }));
        } catch (e) {}
        this.pick.checked = new Set(this.pickMembers().map(m => m.name));
        this.resetLeader();
        this.renderRosterPicker();
    }

    renderRosterPicker() {
        const p = this.pick;
        const r = this.rosterOf(p.station) || this.rosters[0];
        if (r && !p.station) p.station = r.station;
        const info = document.getElementById('rosterInfo');
        const stationsEl = document.getElementById('rosterStations');
        const centersEl = document.getElementById('rosterCenters');
        const vehiclesEl = document.getElementById('rosterVehicles');
        const membersEl = document.getElementById('rosterMembers');

        if (!r) {
            info.textContent = '편성표를 먼저 불러와 주세요. (상단 편성표 버튼)';
            stationsEl.innerHTML = centersEl.innerHTML = vehiclesEl.innerHTML = membersEl.innerHTML = '';
            return;
        }

        info.textContent = this.rosters.length > 1
            ? `편성표 ${this.rosters.length}곳 · 출동한 소방서를 먼저 고르세요`
            : [r.org, r.date].filter(Boolean).join(' · ') || r.fileName;
        document.getElementById('stepCenter').classList.toggle('step-error', p.error === 'center');
        document.getElementById('stepVehicle').classList.toggle('step-error', p.error === 'vehicle');
        document.getElementById('stepCenter').hidden = !!p.manual;

        // 편성표에 없는 차량: 소속·차량 이름을 직접 적는다 (대원은 고르지 않음)
        if (p.manual) {
            stationsEl.innerHTML = centersEl.innerHTML = membersEl.innerHTML = '';
            vehiclesEl.innerHTML = `
                <div class="manual-entry">
                    <p class="roster-hint">편성표에 없는 차량입니다. 소속과 차량 이름을 적어 주세요.</p>
                    <label for="manualCenter">소속</label>
                    <input type="text" id="manualCenter" maxlength="30" placeholder="예: 부평 삼산119안전센터, 특수대응단" value="${escapeHtml(p.manual.center)}">
                    <label for="manualVehicle">차량</label>
                    <input type="text" id="manualVehicle" maxlength="20" placeholder="예: 펌프차" value="${escapeHtml(p.manual.vehicle)}">
                    <button type="button" class="btn-link" data-manual="off">← 편성표 목록에서 고르기</button>
                </div>`;
            return;
        }

        stationsEl.innerHTML = this.rosters.length > 1 ? `
            <div class="station-tabs">${this.rosters.map(x => `
                <button type="button" class="station-tab ${x.station === p.station ? 'active' : ''}" data-station="${escapeHtml(x.station)}">${escapeHtml(this.shortStation(x.station))}</button>
            `).join('')}</div>` : '';
        centersEl.innerHTML = `<div class="center-chips">${r.centers.map(c => `
            <button type="button" class="chip chip-center ${p.center === c.name ? 'active' : ''}" data-center="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button>
        `).join('')}</div>
            <div class="shift-toggle">
                <button type="button" class="${p.shift === 'day' ? 'active' : ''}" data-shift="day" title="주간">☀️<span class="shift-label"> 주간</span></button>
                <button type="button" class="${p.shift === 'night' ? 'active' : ''}" data-shift="night" title="야간">🌙<span class="shift-label"> 야간</span></button>
            </div>
        `;

        const center = r.centers.find(c => c.name === p.center);
        const chip = (v) => `<button type="button" class="chip ${p.vehicle === v.name ? 'active' : ''}" data-vehicle="${escapeHtml(v.name)}">${escapeHtml(v.name)}</button>`;
        const manualLink = '<button type="button" class="btn-link manual-link" data-manual="on">목록에 없는 차량 직접 입력</button>';
        if (center) {
            const entry = center.vehicles.filter(v => this.isEntryVehicle(v.name));
            const others = center.vehicles.filter(v => !this.isEntryVehicle(v.name));
            const open = p.showMore || others.some(v => v.name === p.vehicle);
            vehiclesEl.innerHTML = entry.map(chip).join('')
                + (others.length ? `<button type="button" class="chip chip-more" data-more aria-expanded="${open}">${open ? '접기' : `더보기 ${others.length}`}</button>` : '')
                + (open ? `<div class="more-vehicles">${others.map(chip).join('')}</div>` : '')
                + manualLink;
        } else {
            vehiclesEl.innerHTML = '<p class="roster-hint">위에서 ① 안전센터를 누르면 차량이 나옵니다.</p>' + manualLink;
        }

        if (!p.vehicle) {
            membersEl.innerHTML = '';
            return;
        }

        const members = this.pickMembers();
        const toggle = `
            <button type="button" class="btn-members ${p.showMembers ? 'open' : ''}" data-toggle-members>
                👥 ${p.checked.size}/${members.length}명 진입 · ${p.showMembers ? '대원명 숨기기' : '대원명 알아보기'}
            </button>
        `;
        if (!p.showMembers) {
            membersEl.innerHTML = toggle;
            return;
        }
        membersEl.innerHTML = `
            ${toggle}
            <p class="roster-hint">진입하는 대원을 체크하세요. 대장이 다르면 <b>대장 지정</b>을 누르세요.</p>
            <div class="member-list">
                ${members.length ? members.map(m => `
                    <div class="member-check ${m.name === p.leader ? 'is-leader' : ''}">
                        <label>
                            <input type="checkbox" data-member="${escapeHtml(m.name)}" ${p.checked.has(m.name) ? 'checked' : ''}>
                            <span>${escapeHtml(m.name)}</span>
                            ${m.role === '운전' ? '<em>운전</em>' : ''}
                        </label>
                        ${m.name === p.leader
                            ? '<em class="leader">⭐ 대장</em>'
                            : `<button type="button" class="btn-set-leader" data-leader="${escapeHtml(m.name)}">대장 지정</button>`}
                    </div>
                `).join('') : '<p class="roster-hint">편성표에 이 근무조 탑승 대원이 없습니다.</p>'}
            </div>
        `;
    }

    // 팀 저장
    saveTeam() {
        const name = document.getElementById('teamName').value.trim();
        // 배정 위치는 층(+방면) 또는 구역 중 하나만 저장한다
        const zoneMode = this.locMode === 'zone';
        const floor = zoneMode ? null : parseInt(document.getElementById('assignedFloor').value, 10) || null; // 지하는 음수
        const zone = zoneMode ? document.getElementById('assignedZone').value.trim() || null : null;
        const side = zoneMode ? null : this.editSide || null;

        // 편성표에서 고른 차량과 진입 대원
        const p = this.pick;

        // 차량을 고르지 않으면 저장하지 않는다
        if (p.manual && (!p.manual.center.trim() || !p.manual.vehicle.trim())) {
            p.error = 'vehicle';
            this.renderRosterPicker();
            this.showToast('소속과 차량 이름을 모두 적어 주세요.', 'error');
            return;
        }
        if (this.hasRoster() && !p.vehicle && !p.manual) {
            p.error = p.center ? 'vehicle' : 'center';
            this.renderRosterPicker();
            const step = document.getElementById(p.error === 'center' ? 'stepCenter' : 'stepVehicle');
            step.scrollIntoView({ block: 'center', behavior: 'smooth' });
            this.showToast(p.error === 'center'
                ? '① 안전센터를 누른 뒤 ② 차량을 눌러 주세요.'
                : '② 차량을 눌러 주세요. 차량을 골라야 저장됩니다.', 'error');
            return;
        }

        if (!name) {
            this.showToast('대명을 입력해주세요.', 'error');
            return;
        }
        // 어디에 들어가는지 모르면 현황 보고·위치 이동을 할 수 없으므로 위치 없이는 저장하지 않는다
        const locStep = document.getElementById('stepLocation');
        if (!floor && !zone) {
            locStep.classList.remove('step-error');
            void locStep.offsetWidth; // 다시 흔들리게
            locStep.classList.add('step-error');
            locStep.scrollIntoView({ block: 'center', behavior: 'smooth' });
            this.showToast(zoneMode ? '구역을 고르거나 입력해 주세요.' : '배정층을 입력해 주세요. 지하는 -2 처럼.', 'error');
            return;
        }
        locStep.classList.remove('step-error');
        if (floor && (floor < -10 || floor > 200)) {
            this.showToast('배정층은 지하10층 ~ 200층 사이로 입력해 주세요.', 'error');
            return;
        }
        const vehicleInfo = p.manual ? {
            station: null,
            center: p.manual.center.trim(),
            vehicle: p.manual.vehicle.trim(),
            manual: true,
            shift: null,
            members: []
        } : {
            station: p.vehicle ? p.station : null,
            center: p.vehicle ? p.center : null,
            vehicle: p.vehicle || null,
            manual: false,
            shift: p.vehicle ? p.shift : null,
            members: p.vehicle ? this.pickedMembers() : []
        };

        if (this.currentEditingTeam) {
            // 편집
            const team = this.currentEditingTeam;
            const before = this.locationText(team);
            team.name = name;
            team.floor = floor;
            team.zone = zone;
            team.side = side;
            Object.assign(team, vehicleInfo);
            // 진입한 대가 위치를 바꾸면 '옮겨 간 것'으로 본다: 한 대는 한 곳에만 있다.
            // 공기호흡기는 계속 쓰고 있으므로 시간은 끊기지 않고 이어진다.
            const after = this.locationText(team);
            if (team.status !== 'waiting' && team.entryTime && before !== after) {
                const elapsed = team.status === 'paused' ? team.pausedElapsed : Date.now() - team.entryTime;
                team.moves = [...(team.moves || []), { from: before, to: after, at: Date.now() }];
                this.addLog(team, `위치 이동 (${before} → ${after})`, elapsed);
                this.saveTeams();
                this.render();
                this.closeModal('teamModal');
                this.showToast(`${team.name} ${before} → ${after} 이동 · 시간은 이어서 잽니다`, 'success');
                return;
            }
        } else {
            // 새 팀 추가
            const newTeam = {
                id: this.generateId(),
                name: name,
                floor: floor,
                zone: zone,
                side: side,
                ...vehicleInfo,
                status: 'waiting',
                entryTime: null
            };
            this.teams.push(newTeam);
        }

        this.saveTeams();
        this.render();
        this.closeModal('teamModal');
        this.showToast('저장되었습니다.', 'success');
    }

    // ---------------------------------------------------------- 위치(층·구역) 바꾸기
    // 카드의 층 버튼 → 지금 층 근처의 층을 크게 늘어놓고, 한 번 누르면 바뀌고 닫힌다
    showLocModal(team) {
        this.locTeam = team;
        document.getElementById('locModalTitle').textContent = `${team.name} 위치`;
        const inside = team.status !== 'waiting' && team.entryTime;
        document.getElementById('locModalNow').innerHTML = team.floor || team.zone
            ? `지금 <b>${escapeHtml(this.locationText(team))}</b>${inside ? ' · 바꾸면 옮겨 간 것으로 기록하고 시간은 이어집니다' : ''}`
            : '배정 위치를 골라 주세요.';
        document.getElementById('locFloorInput').value = '';
        document.getElementById('locZoneInput').value = '';
        this.locSide = team.zone ? null : team.side || null;
        this.markSide('locSideChips', this.locSide);
        this.renderLocPicks();
        this.setLocPickMode(team.zone ? 'zone' : 'floor');
        this.showModal('locModal');
    }

    // 지금 층(없으면 1층)을 가운데로 위아래 층 (0층은 없다, 지하10층 ~ 200층)
    nearbyFloors(floor) {
        const center = floor || 1;
        const below = [], above = [];
        for (let f = center - 1; f >= -10 && below.length < 4; f--) if (f !== 0) below.unshift(f);
        for (let f = center + 1; f <= 200 && above.length < 4; f++) if (f !== 0) above.push(f);
        return [...below, center, ...above].reverse(); // 높은 층이 위
    }

    renderLocPicks() {
        const team = this.locTeam;
        document.getElementById('locFloorGrid').innerHTML = this.nearbyFloors(team.floor).map(f => `
            <button type="button" class="loc-pick ${!team.zone && team.floor === f ? 'active' : ''} ${f < 0 ? 'below' : ''}" data-floor="${f}">${this.floorText(f)}</button>`).join('');
        // 구역은 이 현장에서 이미 쓴 이름들 (처음이면 직접 입력)
        document.getElementById('locZoneGrid').innerHTML = this.recentZones().map(z => `
            <button type="button" class="loc-pick ${team.zone === z ? 'active' : ''}" data-zone="${escapeHtml(z)}">${escapeHtml(z)}</button>`).join('');
    }

    setLocPickMode(mode) {
        document.querySelectorAll('#locPickToggle button').forEach(b => b.classList.toggle('active', b.dataset.loc === mode));
        document.getElementById('locPickFloor').hidden = mode !== 'floor';
        document.getElementById('locPickZone').hidden = mode !== 'zone';
    }

    // 방면 버튼: 층이 이미 있으면 그 층 그대로 방면만 바로 바꾸고, 없으면 골라 두었다가 층을 누를 때 함께
    pickLocSide(side) {
        this.locSide = side || null;
        this.markSide('locSideChips', this.locSide);
        const team = this.locTeam;
        if (team && team.floor && !team.zone) this.applyLocation(team.floor, null);
    }

    // 위치를 바꾼다. 진입한 대라면 '옮겨 간 것'으로 기록하고 시간은 끊지 않는다 (saveTeam 과 같은 규칙)
    // 층에는 고른 방면(locSide)이 함께 붙는다
    applyLocation(floor, zone) {
        const team = this.locTeam;
        if (!team) return;
        if (floor && (floor < -10 || floor > 200)) {
            this.showToast('배정층은 지하10층 ~ 200층 사이로 입력해 주세요.', 'error');
            return;
        }
        if (!floor && !zone) {
            this.showToast(document.getElementById('locPickZone').hidden ? '층을 골라 주세요.' : '구역을 골라 주세요.', 'error');
            return;
        }
        const had = team.floor || team.zone;
        const before = this.locationText(team);
        team.floor = floor || null;
        team.zone = zone || null;
        team.side = team.zone ? null : this.locSide || null;
        const after = this.locationText(team);
        this.closeModal('locModal');
        this.locTeam = null;
        if (before === after) return;
        if (had && team.status !== 'waiting' && team.entryTime) {
            const elapsed = team.status === 'paused' ? team.pausedElapsed : Date.now() - team.entryTime;
            team.moves = [...(team.moves || []), { from: before, to: after, at: Date.now() }];
            this.addLog(team, `위치 이동 (${before} → ${after})`, elapsed);
            this.showToast(`${team.name} ${before} → ${after} 이동 · 시간은 이어서 잽니다`, 'success');
        } else {
            this.showToast(`${team.name} 위치: ${after}`, 'success');
        }
        this.saveTeams();
        this.render();
    }

    // ---------------------------------------------------------- 조 나누기 (2인1조)
    // 한 대를 1조·2조로 나눈다. 같이 들어간 대원은 같은 시각부터 공기를 썼으므로
    // 2조는 진입 시각·경과 시간·상태를 그대로 이어받는다 (처음부터 다시 세지 않는다)
    showSplitModal(team) {
        const base = this.splitBaseName(team.name);
        this.split = { team, members: new Set(), floor: null, side: null };
        document.getElementById('splitModalTitle').textContent = `${base} 조 나누기`;
        const inside = team.status !== 'waiting' && team.entryTime;
        document.getElementById('splitLead').innerHTML =
            `지금 <b>${escapeHtml(this.locationText(team))}</b>${inside ? ` · 2조도 같은 진입 시각(${this.clockText(team.firstEntryAt || team.entryTime)})부터 이어서 잽니다` : ''}`;
        const members = team.members || [];
        document.getElementById('splitMembers').innerHTML = members.length
            ? members.map(m => `<button type="button" class="loc-pick" data-member="${escapeHtml(m.name)}">${m.role === '대장' ? '⭐ ' : ''}${escapeHtml(m.name)}</button>`).join('')
            : '<p class="roster-hint">이 대에는 대원 명단이 없습니다. 위치만 골라서 나눌 수 있습니다.</p>';
        document.getElementById('splitFloorGrid').innerHTML = this.nearbyFloors(team.floor).map(f => `
            <button type="button" class="loc-pick ${f < 0 ? 'below' : ''}" data-floor="${f}">${this.floorText(f)}</button>`).join('');
        document.getElementById('splitFloorInput').value = '';
        this.markSide('splitSideChips', null);
        this.showModal('splitModal');
    }

    // "작전 펌프차 1조" → "작전 펌프차"
    splitBaseName(name) {
        return String(name).replace(/\s*\d+조$/, '');
    }

    applySplit() {
        const s = this.split;
        if (!s) return;
        const team = s.team;
        const members = team.members || [];
        const moving = members.filter(m => s.members.has(m.name));
        const staying = members.filter(m => !s.members.has(m.name));
        if (members.length && !moving.length) {
            this.showToast('2조로 갈 대원을 골라 주세요.', 'error');
            return;
        }
        if (members.length && !staying.length) {
            this.showToast('1조에 남을 대원이 있어야 합니다. 모두 옮기려면 위치만 바꾸세요.', 'error');
            return;
        }
        if (!s.floor) {
            this.showToast('2조 위치(층)를 골라 주세요.', 'error');
            return;
        }
        if (s.floor < -10 || s.floor > 200) {
            this.showToast('배정층은 지하10층 ~ 200층 사이로 입력해 주세요.', 'error');
            return;
        }

        // 대장이 없는 쪽은 맨 앞 사람이 대장
        const withLeader = (list) => list.some(m => m.role === '대장')
            ? list.map(m => ({ ...m }))
            : list.map((m, i) => ({ ...m, role: i === 0 ? '대장' : (m.role === '대장' ? '진압' : m.role) }));

        // 이름: 처음 나누면 원래 대가 1조, 새 대가 2조. 이미 조가 있으면 다음 번호
        const base = this.splitBaseName(team.name);
        const used = this.teams.map(t => t.name.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(\\d+)조$`)))
            .filter(Boolean).map(m => parseInt(m[1], 10));
        if (!/\d+조$/.test(team.name)) {
            team.name = `${base} 1조`;
            used.push(1);
        }
        const next = Math.max(1, ...used) + 1;

        const newTeam = {
            ...team,
            id: this.generateId(),
            name: `${base} ${next}조`,
            members: withLeader(moving),
            floor: s.floor,
            zone: null,
            side: s.side || null,
            moves: []
        };
        team.members = withLeader(staying);
        const i = this.teams.indexOf(team);
        this.teams.splice(i + 1, 0, newTeam);

        const elapsed = team.entryTime && team.status !== 'waiting' ? this.teamElapsed(team) : null;
        const where = this.locationText(newTeam);
        this.addLog(team, `조 나누기 → ${next}조 (${where})`, elapsed);
        this.addLog(newTeam, `${next}조 분리 (${where})`, elapsed);

        this.split = null;
        this.closeModal('splitModal');
        this.saveTeams();
        this.render();
        this.showToast(`${team.name} / ${newTeam.name}(${where})로 나눴습니다${elapsed != null ? ' · 시간은 이어서 잽니다' : ''}`, 'success');
    }

    // 팀 삭제
    deleteCurrentTeam() {
        if (!this.currentEditingTeam) return;

        this.confirmDeleteTeam(this.currentEditingTeam, () => this.closeModal('teamModal'));
    }

    // 진입 중인 대를 지우면 타이머와 경보가 사라지므로 한 번 더 분명히 묻고, 기록을 남긴다
    confirmDeleteTeam(team, after) {
        const inside = team.entryTime && team.status !== 'waiting';
        const message = inside
            ? `"${team.name}"은(는) 아직 진입 중입니다 (${Math.floor(this.teamElapsed(team) / 60000)}분).\n삭제하면 타이머와 경보가 사라집니다. 대원이 모두 나왔을 때만 삭제하세요.\n삭제하시겠습니까?`
            : `"${team.name}"을(를) 삭제하시겠습니까?`;
        this.showConfirmDialog(message, () => {
            if (inside) this.addLog(team, '삭제 (진입 중)', this.teamElapsed(team));
            this.teams = this.teams.filter(t => t.id !== team.id);
            this.timers.delete(team.id);
            this.stopAlarm(team.id);
            this.saveTeams();
            this.render();
            if (after) after();
            this.showToast('삭제되었습니다.', 'success');
        });
    }

    // 설정 모달 표시
    showSettingsModal() {
        document.getElementById('warningTime').value = this.settings.warningTime;
        document.getElementById('dangerTime').value = this.settings.dangerTime;
        document.getElementById('soundEnabled').checked = this.settings.soundEnabled;
        document.getElementById('vibrationEnabled').checked = this.settings.vibrationEnabled;
        document.getElementById('voiceEnabled').checked = this.settings.voiceEnabled;
        document.getElementById('flashEnabled').checked = this.settings.flashEnabled;
        document.getElementById('showLogBtn').textContent = `활동 기록 보기 (${this.logs.length}건)`;
        // 설정 창에서 고른 것은 '저장'을 눌러야 적용된다. 그 전까지는 초안에만 담는다
        this.settingsDraft = { ...this.settings };
        this.renderThemePicks();
        this.renderOrderPicks();

        this.showModal('settingsModal');
    }

    // 설정 창 안에서 바꾼 값 (초안 + 아직 읽지 않은 입력칸)
    readSettingsForm() {
        return {
            ...this.settingsDraft,
            warningTime: parseInt(document.getElementById('warningTime').value, 10),
            dangerTime: parseInt(document.getElementById('dangerTime').value, 10),
            soundEnabled: document.getElementById('soundEnabled').checked,
            vibrationEnabled: document.getElementById('vibrationEnabled').checked,
            voiceEnabled: document.getElementById('voiceEnabled').checked,
            flashEnabled: document.getElementById('flashEnabled').checked
        };
    }

    // 설정 창에서 바꾼 것이 있는지 (저장 전)
    settingsChanged() {
        if (!this.settingsDraft) return false;
        const form = this.readSettingsForm();
        return Object.keys(form).some(k => form[k] !== this.settings[k]);
    }

    // 설정: 카드 정렬 (어느 방식이든 위험·경고인 대는 맨 위)
    renderOrderPicks() {
        const s = this.settingsDraft || this.settings;
        const current = CARD_ORDERS.some(o => o.id === s.cardOrder) ? s.cardOrder : 'registered';
        document.getElementById('orderPicks').innerHTML = CARD_ORDERS.map(o => `
            <button type="button" class="theme-pick order-pick" data-order="${o.id}" aria-pressed="${o.id === current}">
                <span class="order-preview">${o.preview.map(c => `<i style="--c: ${Gauge.centerColor(s.theme, c)}"></i>`).join('')}</span>
                <strong>${o.name}</strong>
                <span>${o.desc}</span>
            </button>`).join('');
    }

    pickCardOrder(id) {
        if (!this.settingsDraft) return;
        this.settingsDraft.cardOrder = id;
        this.renderOrderPicks();
    }

    // 설정: 압력계 톤 5가지 (작은 압력계로 미리 보기)
    renderThemePicks() {
        const s = this.settingsDraft || this.settings;
        const sample = { warningTime: this.settings.warningTime, dangerTime: this.settings.dangerTime };
        const minutes = Math.min(this.settings.warningTime, this.settings.dangerTime) * 0.6;
        document.getElementById('themePicks').innerHTML = Gauge.THEMES.map(t => `
            <button type="button" class="theme-pick" data-theme="${t.id}" aria-pressed="${Gauge.theme(s.theme).id === t.id}">
                <span class="theme-preview" data-gauge-preview="${t.id}">${Gauge.svg(sample, minutes * 60000, '', t.colors[0])}</span>
                <strong>${t.name}</strong>
                <span>${t.desc}</span>
            </button>`).join('');
    }

    pickTheme(id) {
        if (!this.settingsDraft) return;
        this.settingsDraft.theme = Gauge.theme(id).id;
        this.renderThemePicks();
        this.renderOrderPicks(); // 정렬 미리 보기 색도 톤을 따른다
    }

    // 설정 저장 ('저장' 버튼)
    updateSettings() {
        const next = this.readSettingsForm();
        // 경고는 위험보다 먼저 와야 한다. 잘못 넣으면 저장하지 않고 창을 열어 둔다
        if (!(next.warningTime >= 1 && next.dangerTime >= 2 && next.warningTime < next.dangerTime && next.dangerTime <= 120)) {
            this.showToast('경고 시간은 1분 이상, 위험 시간보다 짧아야 합니다. (위험은 120분 이하)', 'error');
            return;
        }
        this.settings = next;
        this.settingsDraft = null;

        this.saveSettings();
        this.applyTheme();
        this.renderTeams(); // 압력계 눈금·톤·정렬을 새 설정으로
        this.updateAlertFlash();
        this.closeModal('settingsModal');
        this.showToast('설정을 저장했습니다.', 'success');
    }

    // 진입 시작
    startEntry(teamId) {
        const team = this.teams.find(t => t.id === teamId);
        if (!team) return;

        if (this.showUnitRequired(team)) return;

        team.status = 'active';
        team.entryTime = Date.now();
        team.firstEntryAt = team.entryTime; // 이어서 시작하면 entryTime 이 바뀌므로 실제 진입 시각은 따로
        team.moves = [];
        team.pausedElapsed = null;
        team.pausedAt = null;
        team.alarmMuted = null;
        this.addLog(team, '진입 시작', 0);

        this.saveTeams();
        this.renderTeams(); // 카드 다시 그리기 (자리는 그대로, 경고·위험만 위로)
        this.updateStatusOverview();
        this.showToast(`${team.name} 진입 시작`, 'success');
    }

    // 진입하려면 누가(소속·차량·대원) 어디에(층·구역) 들어갔는지 알아야 한다. 빠진 것 목록
    missingForEntry(team) {
        const missing = [];
        if (!team.vehicle) missing.push('소속(안전센터)·차량');
        if (!team.floor && !team.zone) missing.push('배정 위치(층 또는 구역)');
        // 편성표에 이 근무조 탑승 대원이 있는데 아무도 체크하지 않았으면 누가 들어갔는지 모른다
        const vehicle = this.findVehicle(team.station, team.center, team.vehicle);
        const shift = team.shift || this.currentShift();
        const crew = vehicle ? [...(vehicle.crew[shift] || []), ...(vehicle.driver[shift] || [])] : [];
        if (team.vehicle && crew.length && !(team.members || []).length) missing.push('진입 대원');
        return missing;
    }

    // 빠진 것이 있으면 안내 창을 띄우고 true
    showUnitRequired(team) {
        const missing = this.missingForEntry(team);
        if (!missing.length) return false;
        document.getElementById('unitRequiredMessage').textContent =
            `"${team.name}"은(는) 아래 항목이 없어 진입 시작을 할 수 없습니다.
${missing.map(m => `· ${m}`).join('\n')}
입력한 뒤 다시 눌러 주세요.`;
        document.getElementById('unitRequiredPick').onclick = () => {
            this.closeModal('unitRequiredDialog');
            this.showTeamModal(team);
        };
        this.showModal('unitRequiredDialog');
        if (this.settings.vibrationEnabled && 'vibrate' in navigator) navigator.vibrate(200);
        return true;
    }

    // 일시정지
    pauseTimer(teamId) {
        const team = this.teams.find(t => t.id === teamId);
        if (!team) return;

        // 현재까지의 총 경과 시간을 계산하여 저장
        if (team.entryTime) {
            const currentElapsed = Date.now() - team.entryTime;
            team.pausedElapsed = currentElapsed; // 항상 현재 경과 시간으로 업데이트
        }

        // 일시정지 전 상태를 저장 (색깔 유지를 위해)
        team.pausedFromStatus = team.status;
        team.status = 'paused';
        team.pausedAt = Date.now();
        this.addLog(team, '일시정지', team.pausedElapsed);


        // 알람 중지
        this.stopAlarm(teamId);

        this.saveTeams();
        this.renderTeams(); // 카드 다시 그리기 (자리는 그대로, 경고·위험만 위로)
        this.updateStatusOverview();
        this.showToast(`${team.name} 일시정지`, 'warning');
    }

    // 이어서 시작
    resumeTimer(teamId) {
        const team = this.teams.find(t => t.id === teamId);
        if (!team) return;

        // 이전 경과 시간을 고려하여 새로운 entryTime 설정
        if (team.pausedElapsed) {
            team.entryTime = Date.now() - team.pausedElapsed;
        } else {
            team.entryTime = Date.now();
        }

        // 일시정지 전 상태로 복원하되, 시간에 따라 다시 계산
        const elapsedMinutes = team.pausedElapsed / (1000 * 60);
        if (elapsedMinutes >= this.settings.dangerTime) {
            team.status = 'danger';
        } else if (elapsedMinutes >= this.settings.warningTime) {
            team.status = 'warning';
        } else {
            team.status = 'active';
        }

        team.pausedAt = null;
        team.pausedFromStatus = null;
        this.addLog(team, '이어서 시작', team.pausedElapsed || 0);
        // pausedElapsed는 유지 (다음 일시정지를 위해)


        this.saveTeams();
        this.renderTeams(); // 카드 다시 그리기 (자리는 그대로, 경고·위험만 위로)
        this.updateStatusOverview();
        this.showToast(`${team.name} 이어서 시작`, 'success');
    }

    // 리셋
    resetTeam(teamId) {
        const team = this.teams.find(t => t.id === teamId);
        if (!team) return;

        if (team.entryTime) {
            const elapsed = team.status === 'paused' ? team.pausedElapsed : Date.now() - team.entryTime;
            this.addLog(team, '초기화', elapsed);
        }
        team.status = 'waiting';
        team.entryTime = null;
        team.firstEntryAt = null;
        team.moves = [];
        team.pausedElapsed = null;
        team.pausedAt = null;
        team.pausedFromStatus = null;
        team.alarmMuted = null;

        // 알람 중지
        this.stopAlarm(teamId);

        this.saveTeams();
        this.renderTeams(); // 카드 다시 그리기 (자리는 그대로, 경고·위험만 위로)
        this.updateStatusOverview();
        this.showToast(`${team.name} 초기화 완료`, 'success');
    }

    // 전역 타이머 (1초마다 실행)
    startGlobalTimer() {
        setInterval(() => {
            this.updateTimers();
        }, 1000);
    }

    // 타이머 업데이트
    updateTimers() {
        let needsRerender = false;

        // 각 팀을 독립적으로 처리
        for (let i = 0; i < this.teams.length; i++) {
            const team = this.teams[i];

            // 현재 활성 상태인 팀만 처리 (일시정지가 아닌 상태)
            const isCurrentlyActive = team.entryTime &&
                (team.status === 'active' || team.status === 'warning' || team.status === 'danger');

            if (isCurrentlyActive) {
                const elapsed = Date.now() - team.entryTime;
                const elapsedMinutes = elapsed / (1000 * 60);

                const oldStatus = team.status;

                // 상태 결정
                if (elapsedMinutes >= this.settings.dangerTime) {
                    team.status = 'danger';
                } else if (elapsedMinutes >= this.settings.warningTime) {
                    team.status = 'warning';
                } else {
                    team.status = 'active';
                }


                // 상태 변경시 알림. 알림(소리·기기 알림)이 실패해도 카드 색은 반드시 바뀌어야 한다
                if (oldStatus !== team.status) {
                    needsRerender = true;
                    // 경보 정지는 그 단계에만: 경고에서 껐어도 위험이 되면 다시 울린다
                    if (team.alarmMuted && team.alarmMuted !== team.status) team.alarmMuted = null;
                    try {
                        this.triggerAlert(team, team.status);
                    } catch (error) {
                        console.warn('알림 실패:', error);
                    }
                }

                // 경고나 위험 상태일 때 지속적인 알람 (아직 울리고 있지 않고, 경보 정지를 누르지 않았다면 시작)
                if ((team.status === 'warning' || team.status === 'danger') && !this.alarmIntervals.has(team.id)
                    && team.alarmMuted !== team.status) {
                    this.startContinuousAlarm(team);
                }

                // active 상태로 돌아가면 알람 중지
                if (team.status === 'active' && this.alarmIntervals.has(team.id)) {
                    this.stopAlarm(team.id);
                }
            } else if (team.status === 'waiting') {
                // 대기 상태일 때는 알람 중지
                this.stopAlarm(team.id);
            }
        }


        // 경고·위험이 되면 그 대가 위로 오도록 다시 그린다
        // 거르기로 숨겨 둔 대가 경고·위험이 되면 거르기를 풀어서 놓치지 않게 한다
        if (needsRerender && this.filter && this.teams.some(t => ['warning', 'danger'].includes(t.status) && t.status !== this.filter)) {
            this.filter = null;
        }
        if (needsRerender) {
            this.renderTeams();
        }

        // 모든 active 팀의 UI 업데이트 (별도 루프로 분리)
        this.teams.forEach(team => {
            const isCurrentlyActive = team.entryTime &&
                (team.status === 'active' || team.status === 'warning' || team.status === 'danger');

            if (isCurrentlyActive) {
                this.updateTeamTimerDisplay(team);
            } else if (team.status === 'paused') {
                // 일시정지된 팀도 UI 업데이트 (시간은 고정)
                this.updatePausedTeamDisplay(team);
            }
        });

        if (needsRerender) {
            this.updateStatusOverview();
        }
        this.updateAlertFlash();
    }

    // 팀별 타이머 디스플레이 업데이트 (바늘과 숫자만, 카드는 그대로)
    updateTeamTimerDisplay(team) {
        const teamCard = document.querySelector(`[data-team-id="${team.id}"]`);
        if (!teamCard) {
            return;
        }
        Gauge.update(teamCard, this.settings, Date.now() - team.entryTime);
    }

    // 일시정지된 팀 디스플레이 업데이트 (멈춘 시간 그대로)
    updatePausedTeamDisplay(team) {
        const teamCard = document.querySelector(`[data-team-id="${team.id}"]`);
        if (!teamCard) {
            return;
        }
        Gauge.update(teamCard, this.settings, team.pausedElapsed || 0);
    }

    // 개별 팀 카드 업데이트 (다른 팀에 영향 없이)
    updateSingleTeamCard(team) {
        const teamCard = document.querySelector(`[data-team-id="${team.id}"]`);
        if (!teamCard) {
            return;
        }

        // 기존 카드의 HTML을 새로 생성된 HTML로 교체
        const newCardHTML = this.renderTeamCard(team);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newCardHTML;
        const newCard = tempDiv.firstElementChild;

        // 기존 카드를 새 카드로 교체
        teamCard.parentNode.replaceChild(newCard, teamCard);

        // 새 카드에 이벤트 리스너 다시 추가
        this.addTeamCardEventListeners(team, newCard);
    }

    // 개별 팀 카드에 이벤트 리스너 추가
    addTeamCardEventListeners(team, card) {
        // 편집 버튼
        const editBtn = card.querySelector('.btn-edit');
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                this.showTeamModal(team);
            });
        }

        // 위치(층·구역) 버튼
        const floorBtn = card.querySelector('.btn-floor');
        if (floorBtn) {
            floorBtn.addEventListener('click', () => this.showLocModal(team));
        }

        // 제어 버튼들
        const startBtn = card.querySelector('.btn-start');
        const pauseBtn = card.querySelector('.btn-pause');
        const resumeBtn = card.querySelector('.btn-resume');
        const resetBtn = card.querySelector('.btn-reset');

        // 버튼을 누르면 그 자리에 다른 버튼(진입 시작 → 일시정지)이 생기고, 카드가 자리를 옮기기도 한다.
        // 장갑 낀 손의 두 번 누름이 엉뚱한 버튼에 들어가지 않도록 잠깐 동안 다음 누름을 받지 않는다.
        // (다른 카드는 바로 누를 수 있다. 카드가 자리를 옮긴 직후에는 모든 카드를 잠깐 막는다)
        const guarded = (action) => () => {
            const now = Date.now();
            if (now < this.tapBlockUntil || now < (this.cardTapAt.get(team.id) || 0) + 600) return;
            this.cardTapAt.set(team.id, now);
            action();
        };
        if (startBtn) {
            startBtn.addEventListener('click', guarded(() => this.startEntry(team.id)));
        }
        if (pauseBtn) {
            pauseBtn.addEventListener('click', guarded(() => this.pauseTimer(team.id)));
        }
        if (resumeBtn) {
            resumeBtn.addEventListener('click', guarded(() => this.resumeTimer(team.id)));
        }
        const muteBtn = card.querySelector('.btn-mute');
        if (muteBtn) {
            muteBtn.addEventListener('click', guarded(() => this.toggleAlarmMute(team.id)));
        }
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.showConfirmDialog(`"${team.name}"을(를) 초기화하시겠습니까?`, () => {
                    this.resetTeam(team.id);
                });
            });
        }
    }

    // 상태 텍스트 반환
    getStatusText(status) {
        const statusTexts = {
            waiting: '대기',
            active: '진입중',
            warning: '경고',
            danger: '위험',
            paused: '일시정지'
        };
        return statusTexts[status] || '대기';
    }

    // 알림 트리거
    triggerAlert(team, alertType) {
        const minutes = alertType === 'danger' ? this.settings.dangerTime : this.settings.warningTime;
        const messages = {
            warning: `${team.name} - ${minutes}분 경과 (경고)`,
            danger: `${team.name} - ${minutes}분 경과 (위험!)`
        };

        const message = messages[alertType];
        if (!message) return;

        this.addLog(team, alertType === 'danger' ? '위험' : '경고', Date.now() - team.entryTime);
        this.ringFlash.set(team.id, Date.now()); // 다시 그릴 때 압력계 링이 번쩍인다

        // 음성 안내 (소음 속에서도 알아듣도록)
        const who = `${this.arrivalLabel(team)} ${team.name}`.trim();
        this.speak(alertType === 'danger'
            ? `위험. ${who}, ${minutes}분 경과. 즉시 확인하세요.`
            : `경고. ${who}, ${minutes}분 경과.`);
        this.lastSpoken.set(team.id, Date.now());

        // 경고는 한 번 깜빡, 위험은 해제될 때까지 계속 깜빡 (updateAlertFlash)
        if (alertType === 'warning') this.flashOnce();

        // 토스트 알림
        this.showToast(message, alertType === 'danger' ? 'error' : 'warning');

        // 브라우저 알림
        if (this.settings.soundEnabled) this.notify(message, `timer-${team.id}`);

        // 소리·진동 (같은 순간 여러 대가 바뀌어도 한 번만)
        this.ringAlarm(alertType);
    }

    // 기기 알림. 안드로이드 크롬(태블릿·휴대폰)은 new Notification() 을 막고 오류를 내므로
    // 서비스워커로 띄우고, 어떤 경우에도 오류가 화면 갱신을 멈추지 않게 한다
    notify(body, tag) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        const options = { body, icon: 'icon-192x192.png', badge: 'icon-192x192.png', tag, requireInteraction: true };
        const fallback = () => {
            try {
                new Notification('소방관 현장 진입 타이머', options);
            } catch (error) {
                console.warn('알림 표시 실패:', error);
            }
        };
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.ready
                .then(reg => reg.showNotification('소방관 현장 진입 타이머', options))
                .catch(fallback);
        } else {
            fallback();
        }
    }

    // 음성 안내
    speak(text) {
        if (!this.settings.voiceEnabled || !('speechSynthesis' in window)) return;
        try {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'ko-KR';
            u.rate = 1;
            u.volume = 1;
            window.speechSynthesis.speak(u);
        } catch (error) {
            console.warn('음성 안내 실패:', error);
        }
    }

    // 경고: 화면을 한 번 주황색으로 깜빡
    flashOnce() {
        if (!this.settings.flashEnabled) return;
        document.body.classList.remove('flash-warning');
        void document.body.offsetWidth; // 애니메이션 다시 시작
        document.body.classList.add('flash-warning');
        clearTimeout(this.flashTimer);
        this.flashTimer = setTimeout(() => document.body.classList.remove('flash-warning'), 3000);
    }

    // 위험: 위험 상태인 대가 있으면 화면 전체를 빨갛게 깜빡이고 위쪽에 대 이름을 띄운다
    updateAlertFlash() {
        const danger = this.teams.filter(t => t.status === 'danger' && t.entryTime && !this.isAlarmMuted(t));
        const banner = document.getElementById('alertFlashBanner');
        document.body.classList.toggle('flash-danger', danger.length > 0 && this.settings.flashEnabled);
        banner.hidden = danger.length === 0;
        banner.textContent = danger.length
            ? '⚠ 위험 · ' + danger.map(t => `${t.name} ${Math.floor((Date.now() - t.entryTime) / 60000)}분`).join(' · ')
            : '';
    }

    // 진입 중인 대가 있으면 화면이 꺼지지 않게 한다 (꺼지면 알람이 늦거나 안 울릴 수 있음)
    async updateWakeLock() {
        if (!('wakeLock' in navigator)) return;
        const need = this.teams.some(t => ['active', 'warning', 'danger'].includes(t.status));
        try {
            if (need && !this.wakeLock && document.visibilityState === 'visible') {
                this.wakeLock = await navigator.wakeLock.request('screen');
                this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
            } else if (!need && this.wakeLock) {
                await this.wakeLock.release();
                this.wakeLock = null;
            }
        } catch (error) {
            console.warn('화면 꺼짐 방지 실패:', error);
        }
    }

    // ---------------------------------------------------------- 활동 기록
    addLog(team, type, elapsed) {
        this.logs.push({
            at: Date.now(),
            team: team.name,
            station: team.station || '',
            center: team.center || '',
            arrival: this.arrivalLabel(team),
            location: team.zone || team.floor ? this.locationText(team) : '',
            type,
            elapsed: elapsed == null ? null : Math.max(0, elapsed),
            members: (team.members || []).map(m => (m.role === '대장' ? '⭐' : '') + m.name).join(', ')
        });
        if (this.logs.length > 2000) this.logs = this.logs.slice(-2000);
        saveData('logs', this.logs);
        if (document.getElementById('logModal').classList.contains('show')) this.renderLogs();
    }

    showLogModal() {
        this.renderLogs();
        this.showModal('logModal');
    }

    renderLogs() {
        const list = document.getElementById('logList');
        if (!this.logs.length) {
            list.innerHTML = '<p class="roster-hint">아직 기록이 없습니다. 진입 시작·일시정지·경고·위험·초기화가 자동으로 기록됩니다.</p>';
            return;
        }
        list.innerHTML = [...this.logs].reverse().map(l => `
            <div class="log-item log-${{ '진입 시작': 'start', '경고': 'warning', '위험': 'danger' }[l.type] || 'etc'}">
                <span class="log-time">${this.timeText(l.at)}</span>
                <span class="log-team">${l.arrival ? `<b class="log-arrival">${escapeHtml(l.arrival)}</b> ` : ''}${escapeHtml(l.team)}${l.location ? ` · ${escapeHtml(l.location)}` : ''}</span>
                <span class="log-type">${escapeHtml(l.type)}${l.elapsed != null ? ` · ${this.elapsedText(l.elapsed)}` : ''}</span>
                ${l.members ? `<span class="log-members">${escapeHtml(l.members)}</span>` : ''}
            </div>
        `).join('');
    }

    // 엑셀에서 바로 열리는 CSV 로 내보낸다
    exportLogs() {
        if (!this.logs.length) {
            this.showToast('내보낼 기록이 없습니다.', 'warning');
            return;
        }
        const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
        const rows = [['날짜', '시각', '소방서', '출동대', '착순', '대명', '내용', '경과(분:초)', '진입 대원(⭐대장)', '배정 위치']]
            .concat(this.logs.map(l => {
                const d = new Date(l.at);
                return [
                    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
                    this.timeText(l.at), l.station || '', l.center, l.arrival || '', l.team, l.type,
                    l.elapsed != null ? this.elapsedText(l.elapsed) : '', l.members, l.location || ''
                ];
            }));
        const csv = '\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n');
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `현장진입기록_${stamp}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    timeText(ms) {
        const d = new Date(ms);
        return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
    }

    // 진입 시각: 경과 시간(분:초)과 헷갈리지 않게 "01시 16분"
    clockText(ms) {
        const d = new Date(ms);
        return `${String(d.getHours()).padStart(2, '0')}시 ${String(d.getMinutes()).padStart(2, '0')}분`;
    }

    elapsedText(ms) {
        const sec = Math.floor(ms / 1000);
        return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    }

    // 배정 위치: 구역이 있으면 구역, 없으면 층
    // "3층 C방면" / "B동". 방면은 층에만 붙는다
    locationText(team) {
        const side = !team.zone && team.side ? ` ${team.side}방면` : '';
        return this.placeText(team) + side;
    }

    // 방면을 뺀 곳: 현황 보고는 층(또는 구역)별로 묶는다
    placeText(team) {
        return team.zone || this.floorText(team.floor);
    }

    // 최근에 쓴 구역 이름 (지금 대 목록에서)
    recentZones() {
        return [...new Set(this.teams.map(t => t.zone).filter(Boolean))];
    }

    // 방면 버튼들 중 하나를 눌린 상태로
    markSide(containerId, side) {
        document.querySelectorAll(`#${containerId} button[data-side]`)
            .forEach(b => b.classList.toggle('active', b.dataset.side === (side || '')));
    }

    setLocMode(mode) {
        this.locMode = mode;
        document.querySelectorAll('#locToggle button').forEach(b => b.classList.toggle('active', b.dataset.loc === mode));
        document.getElementById('locFloor').hidden = mode !== 'floor';
        document.getElementById('locZone').hidden = mode !== 'zone';
        this.markZoneChip();
    }

    markZoneChip() {
        const value = document.getElementById('assignedZone').value.trim();
        document.querySelectorAll('#zoneChips .chip').forEach(c => c.classList.toggle('active', c.dataset.zone === value));
    }

    // 배정층: 지하는 음수로 저장 (-2 → 지하2층)
    floorText(floor) {
        if (!floor) return '배정층 없음';
        return floor < 0 ? `지하${-floor}층` : `${floor}층`;
    }

    // 알림 소리 재생
    playAlertSound(alertType) {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            // 위험은 더 높은 주파수, 경고는 중간 주파수
            oscillator.frequency.setValueAtTime(alertType === 'danger' ? 1000 : 800, audioContext.currentTime);
            oscillator.type = 'square';

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (error) {
            console.warn('소리 재생 실패:', error);
        }
    }

    // 연속 알람: 경보 중인 대를 alarmIntervals 에 담고, 소리·진동은 하나의 반복(3초)으로 묶는다.
    // 대가 여럿이어도 소리가 겹치지 않게, 가장 심한 단계(위험 > 경고)로 한 번만 울린다
    startContinuousAlarm(team) {
        if (this.alarmIntervals.has(team.id)) return;
        this.alarmIntervals.set(team.id, true);
        this.ringAlarm(team.status); // 첫 번째는 바로
        if (!this.alarmLoop) this.alarmLoop = setInterval(() => this.alarmTick(), 3000);
    }

    alarmTick() {
        const alarming = [];
        for (const teamId of [...this.alarmIntervals.keys()]) {
            const t = this.teams.find(x => x.id === teamId);
            if (!t || (t.status !== 'warning' && t.status !== 'danger') || t.alarmMuted === t.status) {
                this.stopAlarm(teamId);
            } else {
                alarming.push(t);
            }
        }
        if (!alarming.length) return;
        this.ringAlarm(alarming.some(t => t.status === 'danger') ? 'danger' : 'warning');

        // 위험 상태는 1분마다 음성으로 다시 알린다 (대마다)
        alarming.filter(t => t.status === 'danger' && Date.now() - (this.lastSpoken.get(t.id) || 0) >= 60000).forEach(t => {
            const min = Math.floor((Date.now() - t.entryTime) / 60000);
            this.speak(`위험. ${`${this.arrivalLabel(t)} ${t.name}`.trim()}, ${min}분 경과.`);
            this.lastSpoken.set(t.id, Date.now());
        });
    }

    // 소리·진동 한 번. 같은 순간(1초 안)에 여러 대가 경보가 되어도 한 번만
    ringAlarm(level) {
        const now = Date.now();
        if (now - (this.lastRingAt || 0) < 1000) return;
        this.lastRingAt = now;
        if (this.settings.vibrationEnabled && 'vibrate' in navigator) {
            navigator.vibrate(level === 'danger' ? [200, 100, 200, 100, 200] : [300, 200, 300]);
        }
        if (this.settings.soundEnabled) this.playAlertSound(level);
    }

    // 경보 정지: 타이머·카드 색은 그대로 두고 소리·진동·음성만 끈다 (다음 단계가 되면 다시 울림)
    toggleAlarmMute(teamId) {
        const team = this.teams.find(t => t.id === teamId);
        if (!team || !['warning', 'danger'].includes(team.status)) return;
        if (team.alarmMuted === team.status) {
            team.alarmMuted = null;
            this.addLog(team, '경보 다시 켬', this.teamElapsed(team));
            this.startContinuousAlarm(team);
            this.showToast(`${team.name} 경보를 다시 켰습니다`, 'success');
        } else {
            team.alarmMuted = team.status;
            this.stopAlarm(teamId);
            if ('speechSynthesis' in window) window.speechSynthesis.cancel();
            if ('vibrate' in navigator) navigator.vibrate(0);
            this.addLog(team, '경보 정지', this.teamElapsed(team));
            document.body.classList.remove('flash-warning');
            this.showToast(`${team.name} 경보 정지 (타이머는 계속)`, 'warning');
        }
        this.saveTeams();
        this.renderTeams();
        this.updateAlertFlash();
    }

    // 알람 중지
    stopAlarm(teamId) {
        this.alarmIntervals.delete(teamId);
        if (!this.alarmIntervals.size && this.alarmLoop) {
            clearInterval(this.alarmLoop);
            this.alarmLoop = null;
        }
    }

    stopAllAlarms() {
        [...this.alarmIntervals.keys()].forEach(id => this.stopAlarm(id));
    }

    // 알림 권한 요청
    async requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            try {
                await Notification.requestPermission();
            } catch (error) {
                console.warn('알림 권한 요청 실패:', error);
            }
        }
    }

    // 렌더링
    render() {
        this.renderTeams();
        this.updateStatusOverview();
    }

    // 카드 순서: 위험 → 경고 → 나머지(설정의 카드 정렬)
    // 등록 순서·센터별 묶기는 진입 시작·일시정지·이어서 시작을 눌러도 카드가 움직이지 않게,
    // 시간이 지나 경고·위험이 될 때만 위로 올린다. 일시정지한 대는 멈추기 전 상태 자리에 그대로 둔다.
    sortedTeams() {
        const rank = (t) => {
            const status = t.status === 'paused' ? (t.pausedFromStatus || 'active') : t.status;
            return status === 'danger' ? 0 : status === 'warning' ? 1 : 2;
        };
        const items = this.teams.map((team, i) => ({ team, i }));
        let key = (x) => x.i;
        if (this.settings.cardOrder === 'center') {
            // 착순대로 같은 센터끼리. 착순 전 센터는 처음 등록한 자리, 소속이 없는 대는 제자리
            const arrivals = this.arrivalOrder();
            const first = new Map();
            items.forEach(x => { if (x.team.center && !first.has(x.team.center)) first.set(x.team.center, x.i); });
            const group = (x) => {
                if (!x.team.center) return 1000 + x.i;
                const a = arrivals.indexOf(x.team.center);
                return a >= 0 ? a : 1000 + first.get(x.team.center);
            };
            key = (x) => group(x) * 10000 + x.i;
        } else if (this.settings.cardOrder === 'elapsed') {
            // 오래 들어가 있는 대가 위, 진입 전인 대는 아래(등록한 순서)
            const inside = (t) => ['active', 'warning', 'danger', 'paused'].includes(t.status);
            key = (x) => inside(x.team) ? -this.teamElapsed(x.team) : 1e15 + x.i;
        }
        return items
            .sort((a, b) => rank(a.team) - rank(b.team) || key(a) - key(b))
            .map(x => x.team);
    }

    // 팀 목록 렌더링
    renderTeams() {
        const container = document.getElementById('teamsList');
        const emptyState = document.getElementById('emptyState');

        if (this.teams.length === 0) {
            container.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }

        container.style.display = 'grid';
        emptyState.style.display = 'none';

        // 자리가 바뀌는 카드는 옛 자리에서 미끄러져 가게 해서, 어느 카드가 어디로 갔는지 눈으로 따라갈 수 있게 한다
        const before = new Map([...container.querySelectorAll('.team-card')]
            .map(card => [card.dataset.teamId, card.getBoundingClientRect()]));

        const order = this.sortedTeams().filter(t => !this.filter || (t.status === this.filter && this.isUnit(t)));
        // 목록 끝의 '+' 칸: 위쪽 '대 추가' 버튼과 같다 (손이 닿는 화면에서 바로 추가)
        const addTile = this.filter ? '' : `
            <button type="button" class="add-tile" aria-label="대 추가">
                <span class="add-tile-plus" aria-hidden="true">+</span>
                <span class="add-tile-text">대 추가</span>
            </button>`;
        container.innerHTML = order.length
            ? order.map(team => this.renderTeamCard(team)).join('') + addTile
            : `<p class="filter-empty">${this.getStatusText(this.filter)} 상태인 대가 없습니다.</p>`;
        const tile = container.querySelector('.add-tile');
        if (tile) tile.addEventListener('click', () => this.showTeamModal());
        // 경고·위험이 되어 있던 카드끼리 자리가 바뀐 직후에는 누름을 잠깐 막는다 (옮겨 온 카드를 잘못 누르지 않게)
        // 대를 추가·삭제한 것만으로는 막지 않는다
        const kept = (ids) => ids.filter(id => before.has(id) && order.some(t => t.id === id)).join();
        if (kept([...before.keys()]) !== kept(order.map(t => t.id))) {
            this.tapBlockUntil = Math.max(this.tapBlockUntil, Date.now() + 600);
            // 막혀 있는 동안 버튼을 흐리게 보여 준다 (고장 난 것처럼 보이지 않게)
            container.classList.add('tap-blocked');
            clearTimeout(this.tapBlockTimer);
            this.tapBlockTimer = setTimeout(() => container.classList.remove('tap-blocked'), this.tapBlockUntil - Date.now());
        }

        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            container.querySelectorAll('.team-card').forEach(card => {
                const old = before.get(card.dataset.teamId);
                if (!old) return;
                const now = card.getBoundingClientRect();
                const dx = old.left - now.left;
                const dy = old.top - now.top;
                if (!dx && !dy) return;
                card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
                    { duration: 450, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
            });
        }

        // 이벤트 리스너 추가
        this.teams.forEach(team => {
            const card = document.querySelector(`[data-team-id="${team.id}"]`);
            if (!card) return;

            this.addTeamCardEventListeners(team, card);
        });
    }

    // 팀 카드 렌더링: 압력계 + 상태 + 대장 + 버튼
    renderTeamCard(team) {
        let elapsed = 0;
        if (team.status === 'paused') {
            elapsed = team.pausedElapsed || 0;
        } else if (team.entryTime) {
            elapsed = Date.now() - team.entryTime;
        }

        const paused = team.status === 'paused';
        const shown = paused ? (team.pausedFromStatus || 'active') : team.status;
        const enteredAt = team.firstEntryAt || team.entryTime;
        // 일시정지 중에도 진입 시각을 보여 준다 (일시정지는 압력계 가운데 팻말로 알 수 있다)
        const sub = team.status === 'waiting' ? '진입 전' : `${this.clockText(enteredAt)} 진입`;
        const arrival = team.center ? this.arrivalOrder().indexOf(team.center) : -1;
        const ring = Gauge.centerColor(this.settings.theme, arrival);
        const recent = (map, key, ms) => Date.now() - (map.get(key) || 0) < ms;
        const pop = arrival >= 0 && recent(this.arrivalPop, team.center, 1500) ? ' arrival-pop' : '';
        const flash = recent(this.ringFlash, team.id, 3000) ? ' ring-flash' : '';
        // 일시정지해도 멈추기 전 상태 색(tone)은 그대로. 경보 정지하면 깜빡임 없이 색만
        const muted = this.isAlarmMuted(team) ? ' alarm-muted' : '';
        const badge = !team.center ? ''
            : arrival >= 0 ? `<span class="arrival-badge${pop}" style="--c: ${ring}"><b>${arrival + 1}착</b>${escapeHtml(this.unitLabel(team))}</span>`
                : `<span class="arrival-badge arrival-none">착순 전 · ${escapeHtml(this.unitLabel(team))}</span>`;

        return `
            <article class="team-card status-${paused ? 'paused' : team.status} from-${shown} tone-${shown}${muted}${flash}" data-team-id="${team.id}">
                ${this.renderTeamHead(team, badge)}

                <div class="team-gauge">
                    ${Gauge.svg(this.settings, elapsed, sub, ring)}
                    ${paused ? '<span class="paused-sign" role="status">일시정지</span>' : ''}
                </div>

                <div class="team-controls">
                    ${this.renderTeamControls(team)}
                </div>
            </article>
        `;
    }

    // 카드 윗부분.
    // 진입 전: 착순 배지·대 이름·위치를 모두 왼쪽에 모아 둔다 (입력할 것이 한눈에)
    // 진입 후: [착순 배지 ··· 연필·휴지통] / [대 이름 ··· 위치] 로 양쪽에 나눈다
    renderTeamHead(team, badge) {
        // 삭제는 편집 창 맨 아래에만 둔다 (카드에서 실수로 누르지 않게)
        const actions = `
            <div class="team-actions">
                <button class="btn-small btn-edit" title="편집" aria-label="${escapeHtml(team.name)} 편집">${ICONS.edit}</button>
            </div>`;
        // 위치는 누르면 바로 바꿀 수 있는 버튼 (진입 중이면 '옮겨 감'으로 기록)
        const hasLoc = team.floor || team.zone;
        const where = hasLoc
            ? `<button type="button" class="btn-floor" aria-label="${escapeHtml(team.name)} 위치 ${escapeHtml(this.locationText(team))} 바꾸기">
                   <span class="team-floor">${escapeHtml(this.locationText(team))}</span><span class="btn-floor-chev" aria-hidden="true">▾</span></button>`
            : `<button type="button" class="btn-floor btn-floor-missing" aria-label="${escapeHtml(team.name)} 위치 입력">
                   <span>위치 입력</span><span class="btn-floor-chev" aria-hidden="true">▾</span></button>`;
        const noUnit = team.vehicle ? '' : '<span class="team-nounit">소속·차량 미선택</span>';

        // 진입 전에 위치가 없으면 아무것도 띄우지 않는다 (진입 시작 때 빠진 것을 알려 준다)
        if (team.status === 'waiting') {
            return `
                ${badge}
                <div class="team-header">
                    <div class="team-info">
                        <h3>${escapeHtml(team.name)}</h3>
                        ${noUnit}
                        ${hasLoc ? `<div class="team-sub">${where}</div>` : ''}
                    </div>
                    ${actions}
                </div>`;
        }
        return `
            <div class="team-top">
                <div class="team-top-left">${badge}</div>
                ${actions}
            </div>
            <div class="team-title">
                <div class="team-info">
                    <h3>${escapeHtml(team.name)}</h3>
                    ${noUnit}
                </div>
                <div class="team-where">${where}</div>
            </div>`;
    }

    // 팀 제어 버튼 렌더링: 큰 버튼 하나 + 초기화
    // 초기화는 일시정지한 뒤에만 (진입 중에 잘못 눌러 시간이 사라지지 않게)
    renderTeamControls(team) {
        const reset = `<button class="btn btn-secondary btn-reset" title="초기화" aria-label="초기화">${ICONS.reset}</button>`;

        if (team.status === 'waiting') {
            return `<button class="btn btn-primary btn-start">${ICONS.play} 진입 시작</button>`;
        } else if (team.status === 'paused') {
            return `<button class="btn btn-primary btn-resume">${ICONS.play} 이어서 시작</button>${reset}`;
        }
        const alarming = team.status === 'warning' || team.status === 'danger';
        const mute = !alarming ? ''
            : this.isAlarmMuted(team) ? `<button class="btn btn-mute muted" aria-pressed="true">${ICONS.bell} 경보 켜기</button>`
                : `<button class="btn btn-mute" aria-pressed="false">${ICONS.bellOff} 경보 정지</button>`;
        return `<button class="btn btn-pause">${ICONS.pause} 일시정지</button>${mute}`;
    }

    // 지금 단계의 경보를 껐는지 (경고에서 껐어도 위험이 되면 다시 울린다)
    isAlarmMuted(team) {
        return ['warning', 'danger'].includes(team.status) && team.alarmMuted === team.status;
    }

    setFilter(status) {
        this.filter = status;
        this.renderTeams();
        this.updateStatusOverview();
    }

    // ---------------------------------------------------------- 현황 보고
    // "지금 어디에 어느 대가 얼마나 들어가 있나"를 층별로 묶는다. 높은 층부터, 구역은 그 뒤, 지하는 맨 아래
    reportGroups() {
        const inside = this.teams.filter(t => t.entryTime && t.status !== 'waiting');
        const groups = new Map();
        inside.forEach(t => {
            const key = this.placeText(t); // 같은 층이면 방면이 달라도 한 묶음 (방면은 대마다 표시)
            if (!groups.has(key)) groups.set(key, { key, floor: t.zone ? null : t.floor, zone: t.zone, teams: [] });
            groups.get(key).teams.push(t);
        });
        const rank = (g) => g.zone ? 1 : g.floor == null ? 3 : g.floor > 0 ? 0 : 2;
        return [...groups.values()].sort((a, b) => rank(a) - rank(b)
            || (rank(a) === 0 ? b.floor - a.floor : rank(a) === 2 ? a.floor - b.floor : a.key.localeCompare(b.key, 'ko')));
    }

    // 실제 출동대인지: 소속·차량을 고른 대 (진입한 대는 모두 차량이 있다)
    isUnit(team) {
        return !!team.vehicle;
    }

    teamElapsed(team) {
        return team.status === 'paused' ? team.pausedElapsed || 0 : Date.now() - team.entryTime;
    }

    showReport() {
        const now = Date.now();
        const groups = this.reportGroups();
        const waiting = this.teams.filter(t => t.status === 'waiting' && this.isUnit(t));
        const people = groups.reduce((n, g) => n + g.teams.reduce((m, t) => m + (t.members || []).length, 0), 0);
        document.getElementById('reportTitle').textContent = `현황 보고 · ${this.clockText(now)} 현재`;

        const row = (t) => {
            const leader = (t.members || []).find(m => m.role === '대장');
            const moves = (t.moves || []).map(m => `${escapeHtml(m.from)}에서 ${this.clockText(m.at)} 이동`).join(' · ');
            const arrival = this.arrivalLabel(t);
            return `
                <li class="report-team status-${t.status === 'paused' ? 'paused' : t.status}">
                    <div class="report-team-main">
                        ${arrival ? `<span class="arrival-badge" style="--c: ${Gauge.centerColor(this.settings.theme, this.arrivalOrder().indexOf(t.center))}"><b>${arrival}</b>${escapeHtml(this.unitLabel(t))}</span>` : ''}
                        <strong>${escapeHtml(t.name)}</strong>
                        ${t.side && !t.zone ? `<span class="report-side">${t.side}방면</span>` : ''}
                        <span class="report-min">${Math.floor(this.teamElapsed(t) / 60000)}분</span>
                        <span class="status-badge status-${t.status}">${this.getStatusText(t.status)}</span>
                    </div>
                    <div class="report-team-sub">
                        ${this.clockText(t.firstEntryAt || t.entryTime)} 진입${leader ? ` · 대장 ${escapeHtml(leader.name)}` : ''}${(t.members || []).length ? ` · ${t.members.length}명` : ''}
                        ${moves ? `<br>${moves}` : ''}
                    </div>
                </li>`;
        };

        document.getElementById('reportBody').innerHTML = groups.length ? `
            <p class="report-summary">진입 <b>${groups.reduce((n, g) => n + g.teams.length, 0)}개 대</b>${people ? ` · <b>${people}명</b>` : ''} · 대기 ${waiting.length}개 대</p>
            ${groups.map(g => `
                <section class="report-floor">
                    <h3>${escapeHtml(g.key)}</h3>
                    <ul>${g.teams.sort((a, b) => this.teamElapsed(b) - this.teamElapsed(a)).map(row).join('')}</ul>
                </section>`).join('')}
            ${waiting.length ? `<p class="report-waiting">대기: ${waiting.map(t => escapeHtml(t.name)).join(', ')}</p>` : ''}
        ` : '<p class="roster-hint">지금 진입해 있는 대가 없습니다.</p>';

        // 그대로 읽으면 되는 보고 문장
        const say = (t) => {
            const leader = (t.members || []).find(m => m.role === '대장');
            const status = { danger: ', 위험', warning: ', 경고', paused: ', 일시정지' }[t.status] || '';
            const station = this.multiStation() && t.station ? `${this.shortStation(t.station)} ` : '';
            const side = t.side && !t.zone ? ` ${t.side}방면` : '';
            return `${`${this.arrivalLabel(t)} ${station}${t.name}`.trim()}${side}${leader ? `(대장 ${leader.name})` : ''} ${Math.floor(this.teamElapsed(t) / 60000)}분 경과${status}`;
        };
        document.getElementById('reportText').textContent = groups.length
            ? [`${this.clockText(now)} 현재 진입 ${groups.reduce((n, g) => n + g.teams.length, 0)}개 대${people ? ` ${people}명` : ''}입니다.`]
                .concat(groups.map(g => `${g.key}에 ${g.teams.map(say).join(', ')}.`))
                .concat(waiting.length ? [`대기 ${waiting.length}개 대.`] : [])
                .join(' ')
            : `${this.clockText(now)} 현재 진입해 있는 대가 없습니다.`;

        this.showModal('reportModal');
    }

    async copyReport() {
        const text = document.getElementById('reportText').textContent;
        try {
            await navigator.clipboard.writeText(text);
        } catch (error) {
            // http 주소 등 클립보드를 못 쓰면 글자를 선택해 두어 길게 눌러 복사하게 한다
            const range = document.createRange();
            range.selectNodeContents(document.getElementById('reportText'));
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            this.showToast('문장을 선택해 두었습니다. 길게 눌러 복사하세요.', 'warning');
            return;
        }
        this.showToast('보고 문장을 복사했습니다.', 'success');
    }

    // 상황판 업데이트
    updateStatusOverview() {
        const counts = {
            waiting: 0,
            active: 0,
            warning: 0,
            danger: 0,
            paused: 0
        };

        // 소속·차량을 정하지 않은 빈 칸(처음의 1착대·2착대·3착대)은 대로 세지 않는다
        this.teams.filter(team => this.isUnit(team)).forEach(team => {
            if (counts.hasOwnProperty(team.status)) {
                counts[team.status]++;
            }
        });

        document.getElementById('statusWaiting').textContent = counts.waiting;
        document.getElementById('statusActive').textContent = counts.active;
        document.getElementById('statusPaused').textContent = counts.paused;
        document.getElementById('statusWarning').textContent = counts.warning;
        document.getElementById('statusDanger').textContent = counts.danger;
        // 경고·위험인 대가 있으면 칸 전체를 그 색으로
        document.getElementById('statusWarning').closest('.status-card').classList.toggle('has', counts.warning > 0);
        document.getElementById('statusDanger').closest('.status-card').classList.toggle('has', counts.danger > 0);
        // 0인 칸은 숫자를 흐리게 (숫자가 있는 칸이 바로 보이게)
        document.querySelectorAll('#statusOverview .status-card').forEach(c => c.classList.toggle('zero', !counts[c.dataset.filter]));
        document.querySelectorAll('#statusOverview .status-card').forEach(c => c.setAttribute('aria-pressed', c.dataset.filter === this.filter));
        const info = document.getElementById('filterInfo');
        info.hidden = !this.filter;
        if (this.filter) {
            info.innerHTML = `<span><b>${this.getStatusText(this.filter)}</b>만 보는 중 (${counts[this.filter]}/${this.teams.filter(t => this.isUnit(t)).length})</span><button type="button">전체 보기</button>`;
        }

        this.updateAlertFlash();
        this.updateWakeLock();
    }

    // 모달 관련 메서드
    showModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    closeModal(modalId, force = false) {
        if (modalId === 'rosterModal' && !this.hasRoster()) return; // 편성표 없이는 닫지 않는다
        if (modalId === 'settingsModal' && this.settingsDraft) {
            // 바꾼 설정을 저장하지 않고 닫으려 하면 한 번 묻는다
            if (!force && this.settingsChanged()) {
                this.showConfirmDialog('바꾼 설정을 저장하지 않았습니다.\n저장하지 않고 닫을까요?', () => this.closeModal('settingsModal', true));
                return;
            }
            this.settingsDraft = null;
        }
        const modal = document.getElementById(modalId);
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }

    closeAllModals() {
        const shown = (id) => document.getElementById(id).classList.contains('show');
        // Esc: 확인 창이 떠 있으면 그것만 닫는다 (아니요와 같다)
        if (shown('confirmDialog')) {
            this.closeModal('confirmDialog');
            return;
        }
        // 저장하지 않은 설정이 있으면 먼저 묻는다
        if (shown('settingsModal') && this.settingsChanged()) {
            this.closeModal('settingsModal');
            return;
        }
        this.settingsDraft = null;
        document.querySelectorAll('.modal').forEach(modal => {
            if (modal.id === 'rosterModal' && !this.hasRoster()) return;
            modal.classList.remove('show');
        });
        document.body.style.overflow = '';
    }

    // 확인 다이얼로그
    showConfirmDialog(message, callback, onNo) {
        document.getElementById('confirmMessage').textContent = message;

        const yesBtn = document.getElementById('confirmYes');
        yesBtn.onclick = () => {
            this.closeModal('confirmDialog');
            callback();
        };
        document.getElementById('confirmNo').onclick = () => {
            if (onNo) onNo();
        };

        this.showModal('confirmDialog');
    }

    // 토스트 알림
    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        const messageEl = document.getElementById('toastMessage');

        messageEl.textContent = message;
        toast.className = `toast ${type}`;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    // 전체 데이터 초기화
    clearAllData() {
        this.stopAllAlarms();

        this.teams = [];
        this.rosters = [];
        this.logs = [];
        this.arrivals = [];
        this.timers.clear();
        clearAllData();
        this.render();
        this.showToast('모든 데이터가 초기화되었습니다.', 'success');
        this.settingsDraft = null; // 설정 창에서 눌렀으므로 저장 여부는 묻지 않는다
        this.closeAllModals();
        this.showRosterModal();
    }
}

// 카드 버튼 아이콘 (장갑 낀 손으로도 알아보게 단순한 선 그림)
const icon = (d) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICONS = {
    play: icon('<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>'),
    pause: icon('<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>'),
    reset: icon('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
    edit: icon('<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
    bell: icon('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'),
    bellOff: icon('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'),
    trash: icon('<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>')
};

// 편성표 등 파일에서 온 글자를 화면에 넣을 때
function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 앱 초기화
document.addEventListener('DOMContentLoaded', () => {
    window.fieldSafetyTimer = new FieldSafetyTimer();
});