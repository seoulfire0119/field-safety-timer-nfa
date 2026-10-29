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
        this.init();
    }

    async init() {
        await this.loadData();
        this.setupEventListeners();
        this.render();
        this.startGlobalTimer(); // 1초마다 모든 타이머 업데이트
    }

    // 데이터 로드
    async loadData() {
        try {
            const savedTeams = await loadData('teams', []);
            const savedSettings = await loadData('settings', this.settings);

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

        this.showModal('teamModal');
        nameInput.focus();
    }

    // 팀 저장
    saveTeam() {
        const name = document.getElementById('teamName').value.trim();
        const floor = parseInt(document.getElementById('assignedFloor').value) || null;

        if (!name) {
            this.showToast('대명을 입력해주세요.', 'error');
            return;
        }

        if (this.currentEditingTeam) {
            // 편집
            this.currentEditingTeam.name = name;
            this.currentEditingTeam.floor = floor;
        } else {
            // 새 팀 추가
            const newTeam = {
                id: this.generateId(),
                name: name,
                floor: floor,
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
                        <h3>${team.name}</h3>
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
        const modal = document.getElementById(modalId);
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }

    closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
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
        this.timers.clear();
        clearAllData();
        this.render();
        this.showToast('모든 데이터가 초기화되었습니다.', 'success');
    }
}

// 앱 초기화
document.addEventListener('DOMContentLoaded', () => {
    window.fieldSafetyTimer = new FieldSafetyTimer();
});