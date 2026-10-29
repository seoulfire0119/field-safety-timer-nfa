// 소방관 현장 진입 타이머 앱
console.log('🚨 앱 버전: 2024-12-28-v3 - 일시정지 기능 완료');
class FieldSafetyTimer {
    constructor() {
        this.teams = [];
        this.settings = {
            warningTime: 15, // 분
            dangerTime: 20,  // 분
            soundEnabled: true,
            vibrationEnabled: true
        };
        this.timers = new Map(); // 각 팀별 타이머 저장
        this.alarmIntervals = new Map(); // 각 팀별 알람 반복 인터벌 저장
        this.roster = null; // 불러온 출동대편성표
        this.pick = null;   // 편집 창에서 고른 센터/차량/대원
        this.openMembers = new Set(); // 대원명을 펼친 카드
        this.init();
    }

    async init() {
        await this.loadData();
        this.setupEventListeners();
        this.render();
        this.startGlobalTimer(); // 1초마다 모든 타이머 업데이트

        // 편성표가 없으면 불러오기 전까지 쓸 수 없다
        if (!this.roster) this.showRosterModal();
    }

    // 데이터 로드
    async loadData() {
        try {
            const savedTeams = await loadData('teams', []);
            const savedSettings = await loadData('settings', this.settings);
            this.roster = await loadData('roster', null);

            this.teams = savedTeams;
            this.settings = { ...this.settings, ...savedSettings };

            // 기본 팀들이 없으면 생성
            if (this.teams.length === 0) {
                for (let i = 1; i <= 3; i++) {
                    this.teams.push({
                        id: this.generateId(),
                        name: `${i}착대`,
                        floor: null,
                        status: 'waiting', // waiting, active, warning, danger, paused
                        entryTime: null,
                        withdrawTime: null
                    });
                }
                this.saveTeams();
            }
        } catch (error) {
            console.error('데이터 로드 실패:', error);
        }
    }

    // 데이터 저장
    saveTeams() {
        saveData('teams', this.teams);
    }

    saveSettings() {
        saveData('settings', this.settings);
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
        rosterFile.addEventListener('change', () => {
            const file = rosterFile.files[0];
            rosterFile.value = '';
            if (file) this.importRoster(file);
        });

        // 모달 관련 이벤트
        this.setupModalEvents();

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

        // 편성표에서 센터 → 차량 → 대원 고르기
        const picker = document.getElementById('rosterPicker');
        picker.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-center], button[data-vehicle], button[data-shift], button[data-toggle-members]');
            if (!btn) return;
            if (btn.dataset.toggleMembers !== undefined) {
                this.pick.showMembers = !this.pick.showMembers;
                this.renderRosterPicker();
            } else if (btn.dataset.center !== undefined) this.pickCenter(btn.dataset.center);
            else if (btn.dataset.vehicle !== undefined) this.pickVehicle(btn.dataset.vehicle);
            else this.pickShift(btn.dataset.shift);
        });
        picker.addEventListener('change', (e) => {
            const box = e.target.closest('input[data-member]');
            if (!box) return;
            if (box.checked) this.pick.checked.add(box.dataset.member);
            else this.pick.checked.delete(box.dataset.member);
            this.renderRosterPicker();
        });

        // 확인 다이얼로그
        document.getElementById('confirmNo').addEventListener('click', () => {
            this.closeModal('confirmDialog');
        });

        // 설정 변경 이벤트
        ['warningTime', 'dangerTime', 'soundEnabled', 'vibrationEnabled'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => {
                    this.updateSettings();
                });
            }
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
        const modal = document.getElementById('teamModal');
        const title = document.getElementById('teamModalTitle');
        const nameInput = document.getElementById('teamName');
        const floorInput = document.getElementById('assignedFloor');
        const deleteBtn = document.getElementById('deleteTeamBtn');

        if (team) {
            title.textContent = '대 편집';
            nameInput.value = team.name;
            floorInput.value = team.floor || '';
            deleteBtn.style.display = 'block';
            this.currentEditingTeam = team;
        } else {
            title.textContent = '대 추가';
            nameInput.value = '';
            floorInput.value = '';
            deleteBtn.style.display = 'none';
            this.currentEditingTeam = null;
        }

        this.pick = {
            center: team ? team.center || null : null,
            vehicle: team ? team.vehicle || null : null,
            shift: (team && team.shift) || this.currentShift(),
            checked: new Set(team && team.members ? team.members.map(m => m.name) : []),
            showMembers: false, // 대원명은 '대원명 알아보기'를 눌러야 보인다
            error: null         // 'center' | 'vehicle': 저장하려는데 고르지 않은 단계
        };
        this.renderRosterPicker();

        this.showModal('teamModal');
        if (!this.roster) nameInput.focus();
    }

    // ---------------------------------------------------------- 출동대편성표
    async importRoster(file) {
        this.showToast('편성표를 읽는 중입니다...', 'info');
        try {
            const roster = await Roster.parseRosterFile(file);
            this.roster = roster;
            saveData('roster', roster);
            const vehicles = roster.centers.reduce((n, c) => n + c.vehicles.length, 0);
            this.showToast(`${roster.centers.map(c => c.name).join(', ')} · 차량 ${vehicles}대를 불러왔습니다.`, 'success');
            this.closeModal('rosterModal');
        } catch (error) {
            console.error('편성표 읽기 실패:', error);
            this.showToast(error.message || '편성표를 읽지 못했습니다.', 'error');
        }
    }

    // 더미데이터(가짜 이름) 편성표로 시작
    async loadSampleRoster() {
        try {
            const res = await fetch('samples/roster-sample.xlsx');
            if (!res.ok) throw new Error();
            const blob = await res.blob();
            await this.importRoster(new File([blob], '출동대편성표(더미).xlsx'));
        } catch (error) {
            this.showToast('더미데이터를 불러오지 못했습니다.', 'error');
        }
    }

    // 편성표 불러오기 창: 편성표가 없으면 닫을 수 없다
    showRosterModal() {
        const r = this.roster;
        const current = document.getElementById('rosterCurrent');
        document.getElementById('closeRosterModalBtn').hidden = !r;
        current.hidden = !r;
        if (r) {
            const vehicles = r.centers.reduce((n, c) => n + c.vehicles.length, 0);
            current.textContent = `현재: ${r.fileName} · ${r.centers.length}개 출동대 · 차량 ${vehicles}대`;
        }
        this.showModal('rosterModal');
    }

    // 09~18시는 주간, 나머지는 야간
    currentShift() {
        const h = new Date().getHours();
        return h >= 9 && h < 18 ? 'day' : 'night';
    }

    findVehicle(centerName, vehicleName) {
        if (!this.roster || !centerName || !vehicleName) return null;
        const center = this.roster.centers.find(c => c.name === centerName);
        return center ? center.vehicles.find(v => v.name === vehicleName) || null : null;
    }

    // 고른 차량·근무조의 탑승 대원
    // 편성표에는 직책이 따로 없으므로 진압대원 칸 맨 앞 사람을 대장(선착대장·진압대장)으로 본다.
    // 진압대원이 없으면 운전요원이 대장이다.
    pickMembers() {
        const p = this.pick;
        const vehicle = this.findVehicle(p.center, p.vehicle);
        if (!vehicle) {
            // 편성표가 바뀌어 차량이 없으면 저장된 대원을 그대로 보여 준다
            const team = this.currentEditingTeam;
            return team && team.vehicle === p.vehicle && team.members ? team.members : [];
        }
        const list = [];
        vehicle.crew[p.shift].forEach(name => list.push({ name, role: '진압' }));
        vehicle.driver[p.shift].forEach(name => list.push({ name, role: '운전' }));
        const members = list.filter((m, i) => list.findIndex(x => x.name === m.name) === i);
        if (members.length) members[0] = { ...members[0], role: '대장' };
        return members;
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
            const short = p.center.replace(/119안전센터$|안전센터$/, '').replace(/119구조대$/, '구조대');
            document.getElementById('teamName').value = `${short} ${name}`.trim();
        }
        this.renderRosterPicker();
    }

    pickShift(shift) {
        this.pick.shift = shift;
        this.pick.checked = new Set(this.pickMembers().map(m => m.name));
        this.renderRosterPicker();
    }

    renderRosterPicker() {
        const r = this.roster;
        const p = this.pick;
        const info = document.getElementById('rosterInfo');
        const centersEl = document.getElementById('rosterCenters');
        const vehiclesEl = document.getElementById('rosterVehicles');
        const membersEl = document.getElementById('rosterMembers');

        if (!r) {
            info.textContent = '편성표를 먼저 불러와 주세요. (상단 📋 버튼)';
            centersEl.innerHTML = vehiclesEl.innerHTML = membersEl.innerHTML = '';
            return;
        }

        info.textContent = [r.org, r.date].filter(Boolean).join(' · ') || r.fileName;
        centersEl.innerHTML = `<div class="center-chips">${r.centers.map(c => `
            <button type="button" class="chip chip-center ${p.center === c.name ? 'active' : ''}" data-center="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button>
        `).join('')}</div>
            <div class="shift-toggle">
                <button type="button" class="${p.shift === 'day' ? 'active' : ''}" data-shift="day" title="주간">☀️<span class="shift-label"> 주간</span></button>
                <button type="button" class="${p.shift === 'night' ? 'active' : ''}" data-shift="night" title="야간">🌙<span class="shift-label"> 야간</span></button>
            </div>
        `;

        const center = r.centers.find(c => c.name === p.center);
        vehiclesEl.innerHTML = center ? center.vehicles.map(v => `
            <button type="button" class="chip ${p.vehicle === v.name ? 'active' : ''}" data-vehicle="${escapeHtml(v.name)}">${escapeHtml(v.name)}</button>
        `).join('') : '<p class="roster-hint">위에서 ① 안전센터를 누르면 차량이 나옵니다.</p>';

        // 고르지 않은 단계에 빨간 테두리
        document.getElementById('stepCenter').classList.toggle('step-error', p.error === 'center');
        document.getElementById('stepVehicle').classList.toggle('step-error', p.error === 'vehicle');

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
            <p class="roster-hint">진입하는 대원을 체크하세요.</p>
            <div class="member-list">
                ${members.length ? members.map(m => `
                    <label class="member-check">
                        <input type="checkbox" data-member="${escapeHtml(m.name)}" ${p.checked.has(m.name) ? 'checked' : ''}>
                        <span>${escapeHtml(m.name)}</span>
                        ${m.role === '대장' ? '<em class="leader">대장</em>' : m.role === '운전' ? '<em>운전</em>' : ''}
                    </label>
                `).join('') : '<p class="roster-hint">편성표에 이 근무조 탑승 대원이 없습니다.</p>'}
            </div>
        `;
    }

    // 팀 저장
    saveTeam() {
        const name = document.getElementById('teamName').value.trim();
        const floor = parseInt(document.getElementById('assignedFloor').value) || null;

        // 편성표에서 고른 차량과 진입 대원
        const p = this.pick;

        // 차량을 고르지 않으면 저장하지 않는다
        if (this.roster && !p.vehicle) {
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
        const vehicleInfo = {
            center: p.vehicle ? p.center : null,
            vehicle: p.vehicle || null,
            shift: p.vehicle ? p.shift : null,
            members: p.vehicle ? this.pickMembers().filter(m => p.checked.has(m.name)) : []
        };

        if (this.currentEditingTeam) {
            // 편집
            this.currentEditingTeam.name = name;
            this.currentEditingTeam.floor = floor;
            Object.assign(this.currentEditingTeam, vehicleInfo);
        } else {
            // 새 팀 추가
            const newTeam = {
                id: this.generateId(),
                name: name,
                floor: floor,
                ...vehicleInfo,
                status: 'waiting',
                entryTime: null,
                withdrawTime: null
            };
            this.teams.push(newTeam);
        }

        this.saveTeams();
        this.render();
        this.closeModal('teamModal');
        this.showToast('저장되었습니다.', 'success');
    }

    // 팀 삭제
    deleteCurrentTeam() {
        if (!this.currentEditingTeam) return;

        this.showConfirmDialog(`"${this.currentEditingTeam.name}"을(를) 삭제하시겠습니까?`, () => {
            this.teams = this.teams.filter(team => team.id !== this.currentEditingTeam.id);
            this.timers.delete(this.currentEditingTeam.id);
            this.stopAlarm(this.currentEditingTeam.id);
            this.saveTeams();
            this.render();
            this.closeModal('teamModal');
            this.showToast('삭제되었습니다.', 'success');
        });
    }

    // 설정 모달 표시
    showSettingsModal() {
        document.getElementById('warningTime').value = this.settings.warningTime;
        document.getElementById('dangerTime').value = this.settings.dangerTime;
        document.getElementById('soundEnabled').checked = this.settings.soundEnabled;
        document.getElementById('vibrationEnabled').checked = this.settings.vibrationEnabled;

        this.showModal('settingsModal');
    }

    // 설정 업데이트
    updateSettings() {
        this.settings.warningTime = parseInt(document.getElementById('warningTime').value) || 15;
        this.settings.dangerTime = parseInt(document.getElementById('dangerTime').value) || 20;
        this.settings.soundEnabled = document.getElementById('soundEnabled').checked;
        this.settings.vibrationEnabled = document.getElementById('vibrationEnabled').checked;

        this.saveSettings();
    }

    // 진입 시작
    startEntry(teamId) {
        const team = this.teams.find(t => t.id === teamId);
        if (!team) return;

        team.status = 'active';
        team.entryTime = Date.now();
        team.withdrawTime = null;
        team.pausedElapsed = null;
        team.pausedAt = null;

        this.saveTeams();
        this.updateSingleTeamCard(team); // 해당 팀만 업데이트
        this.updateStatusOverview();
        this.showToast(`${team.name} 진입 시작`, 'success');
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

        console.log(`일시정지: ${team.name}, 이전 상태: ${team.pausedFromStatus}, 경과시간: ${team.pausedElapsed}ms (${Math.floor(team.pausedElapsed / 60000)}:${Math.floor((team.pausedElapsed % 60000) / 1000)})`);

        // 알람 중지
        this.stopAlarm(teamId);

        this.saveTeams();
        this.updateSingleTeamCard(team); // 해당 팀만 업데이트
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
            console.log(`이어서 시작: ${team.name}, 저장된 경과시간: ${team.pausedElapsed}ms, 새로운 entryTime 설정`);
        } else {
            team.entryTime = Date.now();
            console.log(`이어서 시작: ${team.name}, 경과시간 없음, 새로 시작`);
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
        // pausedElapsed는 유지 (다음 일시정지를 위해)

        console.log(`이어서 시작: ${team.name}, 복원된 상태: ${team.status}`);

        this.saveTeams();
        this.updateSingleTeamCard(team); // 해당 팀만 업데이트
        this.updateStatusOverview();
        this.showToast(`${team.name} 이어서 시작`, 'success');
    }

    // 리셋
    resetTeam(teamId) {
        const team = this.teams.find(t => t.id === teamId);
        if (!team) return;

        team.status = 'waiting';
        team.entryTime = null;
        team.withdrawTime = null;
        team.pausedElapsed = null;
        team.pausedAt = null;
        team.pausedFromStatus = null;

        // 알람 중지
        this.stopAlarm(teamId);

        this.saveTeams();
        this.updateSingleTeamCard(team); // 해당 팀만 업데이트
        this.updateStatusOverview();
        this.showToast(`${team.name} 초기화 완료`, 'success');
    }

    // 전역 타이머 (1초마다 실행)
    startGlobalTimer() {
        console.log('전역 타이머 시작');
        setInterval(() => {
            console.log('타이머 업데이트 실행');
            this.updateTimers();
        }, 1000);
    }

    // 타이머 업데이트
    updateTimers() {
        console.log('updateTimers 함수 실행');
        let needsRerender = false;
        let activeTeamsCount = 0;

        // 각 팀을 독립적으로 처리
        for (let i = 0; i < this.teams.length; i++) {
            const team = this.teams[i];
            console.log(`팀 ${team.name}: 상태=${team.status}, entryTime=${team.entryTime}, withdrawTime=${team.withdrawTime}`);

            // 현재 활성 상태인 팀만 처리 (일시정지가 아닌 상태)
            const isCurrentlyActive = team.entryTime &&
                (team.status === 'active' || team.status === 'warning' || team.status === 'danger');

            if (isCurrentlyActive) {
                activeTeamsCount++;
                const elapsed = Date.now() - team.entryTime;
                const elapsedMinutes = elapsed / (1000 * 60);
                console.log(`팀 ${team.name}: 경과시간=${elapsedMinutes.toFixed(2)}분`);

                const oldStatus = team.status;

                // 상태 결정
                if (elapsedMinutes >= this.settings.dangerTime) {
                    team.status = 'danger';
                } else if (elapsedMinutes >= this.settings.warningTime) {
                    team.status = 'warning';
                } else {
                    team.status = 'active';
                }

                if (oldStatus !== team.status) {
                    console.log(`팀 ${team.name}: 상태 변경 ${oldStatus} -> ${team.status}`);
                }

                // 상태 변경시 알림
                if (oldStatus !== team.status) {
                    this.triggerAlert(team, team.status);
                    needsRerender = true;
                }

                // 경고나 위험 상태일 때 지속적인 알람 (아직 울리고 있지 않다면 시작)
                if ((team.status === 'warning' || team.status === 'danger') && !this.alarmIntervals.has(team.id)) {
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

        console.log(`활성 팀 수: ${activeTeamsCount}`);

        // 모든 active 팀의 UI 업데이트 (별도 루프로 분리)
        this.teams.forEach(team => {
            const isCurrentlyActive = team.entryTime &&
                (team.status === 'active' || team.status === 'warning' || team.status === 'danger');

            if (isCurrentlyActive) {
                console.log(`UI 업데이트: 팀 ${team.name}`);
                this.updateTeamTimerDisplay(team);
            } else if (team.status === 'paused') {
                // 일시정지된 팀도 UI 업데이트 (시간은 고정)
                console.log(`일시정지 UI 업데이트: 팀 ${team.name}`);
                this.updatePausedTeamDisplay(team);
            }
        });

        if (needsRerender) {
            this.updateStatusOverview();
        }
    }

    // 팀별 타이머 디스플레이 업데이트
    updateTeamTimerDisplay(team) {
        const teamCard = document.querySelector(`[data-team-id="${team.id}"]`);
        if (!teamCard) {
            console.log(`팀 카드를 찾을 수 없음: ${team.id}`);
            return;
        }

        const elapsed = Date.now() - team.entryTime;
        const minutes = Math.floor(elapsed / (1000 * 60));
        const seconds = Math.floor((elapsed % (1000 * 60)) / 1000);
        console.log(`팀 ${team.name} 디스플레이 업데이트: ${minutes}:${seconds}`);

        const timerText = teamCard.querySelector('.timer-text');
        const progressRing = teamCard.querySelector('.progress-ring-progress');
        const statusBadge = teamCard.querySelector('.status-badge');

        if (timerText) {
            const newText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            console.log(`타이머 텍스트 업데이트: ${timerText.textContent} -> ${newText}`);
            timerText.textContent = newText;
            timerText.className = `timer-text status-${team.status}`;
        } else {
            console.log(`타이머 텍스트 요소를 찾을 수 없음`);
        }

        // 진행률 계산 (위험 시간 기준)
        const maxMinutes = this.settings.dangerTime;
        const progress = Math.min(minutes / maxMinutes, 1);
        const circumference = 2 * Math.PI * 52; // r=52
        const offset = circumference - (progress * circumference);

        if (progressRing) {
            progressRing.style.strokeDashoffset = offset;
            progressRing.setAttribute('class', `progress-ring-progress status-${team.status}`);
        }

        if (statusBadge) {
            statusBadge.textContent = this.getStatusText(team.status);
            statusBadge.className = `status-badge status-${team.status}`;
        }

        // 팀 카드 클래스 업데이트
        teamCard.className = `team-card status-${team.status}`;
    }

    // 일시정지된 팀 디스플레이 업데이트
    updatePausedTeamDisplay(team) {
        const teamCard = document.querySelector(`[data-team-id="${team.id}"]`);
        if (!teamCard) {
            console.log(`팀 카드를 찾을 수 없음: ${team.id}`);
            return;
        }

        // 일시정지된 시간을 표시 (pausedElapsed 사용)
        const elapsed = team.pausedElapsed || 0;
        const minutes = Math.floor(elapsed / (1000 * 60));
        const seconds = Math.floor((elapsed % (1000 * 60)) / 1000);

        // 일시정지 전 상태에 따라 색깔 결정
        const displayStatus = team.pausedFromStatus || 'active';

        const timerText = teamCard.querySelector('.timer-text');
        const progressRing = teamCard.querySelector('.progress-ring-progress');
        const statusBadge = teamCard.querySelector('.status-badge');

        if (timerText) {
            const newText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            timerText.textContent = newText;
            timerText.className = `timer-text status-${displayStatus}`; // 이전 상태 색깔 사용
        }

        // 진행률 계산
        const maxMinutes = this.settings.dangerTime;
        const progress = Math.min(minutes / maxMinutes, 1);
        const circumference = 2 * Math.PI * 52;
        const offset = circumference - (progress * circumference);

        if (progressRing) {
            progressRing.style.strokeDashoffset = offset;
            progressRing.setAttribute('class', `progress-ring-progress status-${displayStatus}`); // 이전 상태 색깔 사용
        }

        if (statusBadge) {
            statusBadge.textContent = '일시정지';
            statusBadge.className = `status-badge status-${displayStatus}`; // 이전 상태 색깔 사용
        }

        // 팀 카드 클래스 업데이트 (이전 상태 색깔 사용)
        teamCard.className = `team-card status-${displayStatus}`;
    }

    // 개별 팀 카드 업데이트 (다른 팀에 영향 없이)
    updateSingleTeamCard(team) {
        const teamCard = document.querySelector(`[data-team-id="${team.id}"]`);
        if (!teamCard) {
            console.log(`팀 카드를 찾을 수 없음: ${team.id}`);
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
        // 대원명 알아보기
        const membersBtn = card.querySelector('.btn-members');
        if (membersBtn) {
            membersBtn.addEventListener('click', () => {
                if (this.openMembers.has(team.id)) this.openMembers.delete(team.id);
                else this.openMembers.add(team.id);
                this.updateSingleTeamCard(team);
            });
        }

        // 편집 버튼
        const editBtn = card.querySelector('.btn-edit');
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                this.showTeamModal(team);
            });
        }

        // 삭제 버튼
        const deleteBtn = card.querySelector('.btn-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                this.showConfirmDialog(`"${team.name}"을(를) 삭제하시겠습니까?`, () => {
                    this.teams = this.teams.filter(t => t.id !== team.id);
                    this.timers.delete(team.id);
                    this.stopAlarm(team.id);
                    this.saveTeams();
                    this.render();
                    this.showToast('삭제되었습니다.', 'success');
                });
            });
        }

        // 제어 버튼들
        const startBtn = card.querySelector('.btn-start');
        const pauseBtn = card.querySelector('.btn-pause');
        const resumeBtn = card.querySelector('.btn-resume');
        const resetBtn = card.querySelector('.btn-reset');

        if (startBtn) {
            startBtn.addEventListener('click', () => this.startEntry(team.id));
        }
        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => this.pauseTimer(team.id));
        }
        if (resumeBtn) {
            resumeBtn.addEventListener('click', () => this.resumeTimer(team.id));
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
        const messages = {
            warning: `${team.name} - 15분 경과 (경고)`,
            danger: `${team.name} - 20분 경과 (위험!)`
        };

        const message = messages[alertType];
        if (!message) return;

        // 토스트 알림
        this.showToast(message, alertType === 'danger' ? 'error' : 'warning');

        // 브라우저 알림
        if (this.settings.soundEnabled && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('소방관 현장 진입 타이머', {
                body: message,
                icon: 'icon-192x192.png',
                badge: 'icon-192x192.png',
                tag: `timer-${team.id}`,
                requireInteraction: true
            });
        }

        // 진동
        if (this.settings.vibrationEnabled && 'vibrate' in navigator) {
            const pattern = alertType === 'danger' ? [200, 100, 200, 100, 200] : [300, 200, 300];
            navigator.vibrate(pattern);
        }

        // 소리 (가능하면)
        if (this.settings.soundEnabled) {
            this.playAlertSound(alertType);
        }
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

    // 연속 알람 시작
    startContinuousAlarm(team) {
        // 이미 울리고 있다면 중복 방지
        if (this.alarmIntervals.has(team.id)) {
            return;
        }

        const teamId = team.id;
        console.log(`알람 시작: ${team.name} (${team.status})`);

        // 첫 번째 알람 즉시 실행
        if (this.settings.vibrationEnabled && 'vibrate' in navigator) {
            const pattern = team.status === 'danger' ? [200, 100, 200, 100, 200] : [300, 200, 300];
            navigator.vibrate(pattern);
        }
        if (this.settings.soundEnabled) {
            this.playAlertSound(team.status);
        }

        const intervalId = setInterval(() => {
            // 현재 팀 상태를 다시 확인
            const currentTeam = this.teams.find(t => t.id === teamId);
            if (!currentTeam || (currentTeam.status !== 'warning' && currentTeam.status !== 'danger')) {
                console.log(`알람 중지: ${currentTeam ? currentTeam.name : 'Unknown'} (${currentTeam ? currentTeam.status : 'Not found'})`);
                this.stopAlarm(teamId);
                return;
            }

            console.log(`알람 반복: ${currentTeam.name} (${currentTeam.status})`);

            // 진동
            if (this.settings.vibrationEnabled && 'vibrate' in navigator) {
                const pattern = currentTeam.status === 'danger' ? [200, 100, 200, 100, 200] : [300, 200, 300];
                navigator.vibrate(pattern);
            }

            // 소리
            if (this.settings.soundEnabled) {
                this.playAlertSound(currentTeam.status);
            }
        }, 3000); // 3초마다 반복

        this.alarmIntervals.set(teamId, intervalId);
    }

    // 알람 중지
    stopAlarm(teamId) {
        if (this.alarmIntervals.has(teamId)) {
            console.log(`알람 완전 중지: ${teamId}`);
            clearInterval(this.alarmIntervals.get(teamId));
            this.alarmIntervals.delete(teamId);
        }
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

        container.innerHTML = this.teams.map(team => this.renderTeamCard(team)).join('');

        // 이벤트 리스너 추가
        this.teams.forEach(team => {
            const card = document.querySelector(`[data-team-id="${team.id}"]`);
            if (!card) return;

            this.addTeamCardEventListeners(team, card);
        });
    }

    // 팀 카드 렌더링
    renderTeamCard(team) {
        let elapsed, minutes, seconds, timerDisplay;

        if (team.status === 'paused' && team.pausedElapsed) {
            // 일시정지된 경우 저장된 경과 시간 사용
            elapsed = team.pausedElapsed;
        } else if (team.entryTime) {
            // 활성 상태인 경우 현재 시간 기준으로 계산
            elapsed = Date.now() - team.entryTime;
        } else {
            elapsed = 0;
        }

        minutes = Math.floor(elapsed / (1000 * 60));
        seconds = Math.floor((elapsed % (1000 * 60)) / 1000);
        timerDisplay = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        // 진행률 계산
        const maxMinutes = this.settings.dangerTime;
        const progress = elapsed > 0 ? Math.min(minutes / maxMinutes, 1) : 0;
        const circumference = 2 * Math.PI * 52;
        const offset = circumference - (progress * circumference);

        return `
            <div class="team-card status-${team.status === 'paused' ? (team.pausedFromStatus || 'active') : team.status}" data-team-id="${team.id}">
                <div class="team-header">
                    <div class="team-info">
                        ${team.center ? `<div class="team-center">🚒 ${escapeHtml(team.center)}</div>` : ''}
                        <h3>${escapeHtml(team.name)}</h3>
                        <div class="team-floor">
                            <span>🏢</span>
                            <span>${team.floor ? team.floor + '층' : '배정층 없음'}</span>
                        </div>
                    </div>
                    <div class="team-actions">
                        <button class="btn-small btn-edit" title="편집">✏️</button>
                        <button class="btn-small btn-delete" title="삭제">🗑️</button>
                    </div>
                </div>

                ${this.renderTeamMembers(team)}

                <div class="timer-display">
                    <div class="timer-text status-${team.status === 'paused' ? (team.pausedFromStatus || 'active') : team.status}">${timerDisplay}</div>

                    <div class="progress-ring">
                        <svg viewBox="0 0 120 120">
                            <circle class="progress-ring-circle" cx="60" cy="60" r="52"></circle>
                            <circle class="progress-ring-progress status-${team.status === 'paused' ? (team.pausedFromStatus || 'active') : team.status}" cx="60" cy="60" r="52"
                                    style="stroke-dashoffset: ${offset}"></circle>
                        </svg>
                    </div>

                    <div class="status-badge status-${team.status === 'paused' ? (team.pausedFromStatus || 'active') : team.status}">
                        ${team.status === 'paused' ? '일시정지' : this.getStatusText(team.status)}
                    </div>
                </div>

                <div class="team-controls">
                    ${this.renderTeamControls(team)}
                </div>
            </div>
        `;
    }

    // 진입 대원 표시
    renderTeamMembers(team) {
        if (!team.members || !team.members.length) return '';
        const open = this.openMembers.has(team.id);
        return `
            <div class="team-members">
                <button type="button" class="btn-members ${open ? 'open' : ''}">
                    👥 ${team.members.length}명 진입 · ${open ? '대원명 숨기기' : '대원명 알아보기'}
                </button>
                ${open ? team.members.map(m => m.role === '대장'
                    ? `<span class="member-chip leader">⭐ ${escapeHtml(m.name)}</span>`
                    : `<span class="member-chip">${escapeHtml(m.name)}</span>`).join('') : ''}
            </div>
        `;
    }

    // 팀 제어 버튼 렌더링
    renderTeamControls(team) {
        console.log(`팀 ${team.name} 버튼 렌더링: 상태=${team.status}`);

        if (team.status === 'waiting') {
            console.log(`팀 ${team.name}: 대기 상태 - 진입시작 버튼 표시`);
            return `
                <button class="btn btn-primary btn-start">
                    ▶️ 진입 시작
                </button>
                <button class="btn btn-secondary btn-reset">
                    🔄 초기화
                </button>
            `;
        } else if (team.status === 'paused') {
            console.log(`팀 ${team.name}: 일시정지 상태 - 이어서 시작 버튼 표시`);
            return `
                <button class="btn btn-primary btn-resume">
                    ▶️ 이어서 시작
                </button>
                <button class="btn btn-secondary btn-reset">
                    🔄 초기화
                </button>
            `;
        } else {
            console.log(`팀 ${team.name}: 활성 상태 (${team.status}) - 일시정지 버튼 표시`);
            return `
                <button class="btn btn-warning btn-pause">
                    ⏸️ 일시정지
                </button>
                <button class="btn btn-secondary btn-reset">
                    🔄 초기화
                </button>
            `;
        }
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

        this.teams.forEach(team => {
            if (counts.hasOwnProperty(team.status)) {
                counts[team.status]++;
            }
        });

        document.getElementById('statusWaiting').textContent = counts.waiting;
        document.getElementById('statusActive').textContent = counts.active;
        document.getElementById('statusWarning').textContent = counts.warning;
        document.getElementById('statusDanger').textContent = counts.danger;
    }

    // 모달 관련 메서드
    showModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    closeModal(modalId) {
        if (modalId === 'rosterModal' && !this.roster) return; // 편성표 없이는 닫지 않는다
        const modal = document.getElementById(modalId);
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }

    closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            if (modal.id === 'rosterModal' && !this.roster) return;
            modal.classList.remove('show');
        });
        document.body.style.overflow = '';
    }

    // 확인 다이얼로그
    showConfirmDialog(message, callback) {
        document.getElementById('confirmMessage').textContent = message;

        const yesBtn = document.getElementById('confirmYes');
        yesBtn.onclick = () => {
            callback();
            this.closeModal('confirmDialog');
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
        // 모든 알람 중지
        this.alarmIntervals.forEach((intervalId, teamId) => {
            clearInterval(intervalId);
        });
        this.alarmIntervals.clear();

        this.teams = [];
        this.roster = null;
        this.timers.clear();
        clearAllData();
        this.render();
        this.showToast('모든 데이터가 초기화되었습니다.', 'success');
        this.closeAllModals();
        this.showRosterModal();
    }
}

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