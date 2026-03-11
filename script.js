// ==================== Audio System ====================
class SoundManager {
    constructor() { this.audioCtx = null; }
    init() {
        if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
    }
    playTone(frequency, duration, type = 'sine', volume = 0.3) {
        this.init();
        const oscillator = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, this.audioCtx.currentTime);
        gainNode.gain.setValueAtTime(volume, this.audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + duration);
        oscillator.start(this.audioCtx.currentTime);
        oscillator.stop(this.audioCtx.currentTime + duration);
    }
    playScore() { this.playTone(523.25, 0.1, 'sine', 0.2); setTimeout(() => this.playTone(659.25, 0.15, 'sine', 0.2), 80); }
    playPenalty() { this.playTone(200, 0.3, 'square', 0.15); setTimeout(() => this.playTone(150, 0.3, 'square', 0.15), 150); }
    playEnd() { this.playTone(392, 0.2, 'sine', 0.25); setTimeout(() => this.playTone(523.25, 0.2, 'sine', 0.25), 200); setTimeout(() => this.playTone(659.25, 0.3, 'sine', 0.25), 400); }
    playUndo() { this.playTone(440, 0.1, 'sine', 0.2); setTimeout(() => this.playTone(330, 0.15, 'sine', 0.2), 100); }
    playPrepStart() { this.playTone(440, 0.2, 'sine', 0.2); }
    playMatchStart() { this.playTone(523.25, 0.15, 'sine', 0.25); setTimeout(() => this.playTone(659.25, 0.15, 'sine', 0.25), 150); setTimeout(() => this.playTone(783.99, 0.3, 'sine', 0.25), 300); }
}
const soundManager = new SoundManager();

// ==================== State ====================
let state = {
    redScore: 0, blueScore: 0,
    redKFS: Array(9).fill(0), blueKFS: Array(9).fill(0),
    redKFSCollection: 0, blueKFSCollection: 0,
    redWeapon: 0, blueWeapon: 0,
    redPenalties: 0, bluePenalties: 0,
    matchNumber: 1, matchHistory: [], scoringLog: [],
    // Prep Timer
    prepTimeRemaining: 60,
    prepTime: 60,
    prepTimerPaused: true,
    prepTimerFinished: false,
    // Match Timer
    matchTimeRemaining: 180,
    matchTime: 180,
    matchTimerPaused: true,
    matchTimerFinished: false,
    // Legacy (for compatibility)
    isPaused: true, gamePhase: 'prepare', selectedTeam: 'red',
    undoStack: [], maxUndoSteps: 10
};
let prepTimerInterval = null;
let matchTimerInterval = null;
const KFS_POINTS = [80, 80, 80, 40, 40, 40, 30, 30, 30];
const WIN_COMBS = [[0,3,6], [1,4,7], [2,5,8], [0,4,8], [2,4,6]];

// ==================== Dual Timer Functions ====================

// Preparation Timer Functions
function updatePrepTimerDisplay() {
    const timerEl = document.getElementById('prepTimer');
    const statusEl = document.getElementById('prepTimerStatus');
    const cardEl = document.getElementById('prepTimerCard');
    const timeRemaining = state.prepTimeRemaining;
    
    const mins = Math.floor(Math.max(0, timeRemaining) / 60);
    const secs = Math.max(0, timeRemaining) % 60;
    timerEl.textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    
    // Update status
    timerEl.classList.remove('warning', 'danger', 'overtime');
    if (state.prepTimerFinished) {
        statusEl.textContent = '準備完成！';
        statusEl.className = 'timer-status finished';
        cardEl.classList.remove('active', 'paused');
    } else if (!state.prepTimerPaused) {
        statusEl.textContent = '準備中...';
        statusEl.className = 'timer-status running';
        cardEl.classList.add('active');
        cardEl.classList.remove('paused');
        if (timeRemaining <= 30) timerEl.classList.add('danger');
        else if (timeRemaining <= 60) timerEl.classList.add('warning');
    } else if (state.prepTimerPaused && timeRemaining < state.prepTime) {
        statusEl.textContent = '已暫停';
        statusEl.className = 'timer-status paused';
        cardEl.classList.add('paused');
        cardEl.classList.remove('active');
    } else {
        statusEl.textContent = '等待開始';
        statusEl.className = 'timer-status waiting';
        cardEl.classList.remove('active', 'paused');
    }
    
    updateCombinedStatusBadge();
}

function startPrepTimer() {
    if (state.prepTimerFinished) return;
    if (!state.prepTimerPaused) return; // Already running
    
    state.prepTimerPaused = false;
    soundManager.playPrepStart();
    
    prepTimerInterval = setInterval(() => {
        if (state.prepTimeRemaining > 0) {
            state.prepTimeRemaining--;
            updatePrepTimerDisplay();
            saveState();
        } else {
            // Prep time finished
            pausePrepTimer();
            state.prepTimerFinished = true;
            updatePrepTimerDisplay();
            soundManager.playMatchStart();
        }
    }, 1000);
    
    updatePrepTimerDisplay();
}

function pausePrepTimer() {
    if (state.prepTimerFinished) return;
    if (state.prepTimerPaused) return; // Already paused
    
    state.prepTimerPaused = true;
    clearInterval(prepTimerInterval);
    updatePrepTimerDisplay();
    saveState();
}

function resetPrepTimer() {
    showConfirm('重置準備計時器', '確定要重置準備計時器嗎？', () => {
        pausePrepTimer();
        state.prepTimeRemaining = state.prepTime;
        state.prepTimerFinished = false;
        updatePrepTimerDisplay();
        saveState();
    });
}

function updatePrepTimeSetting() {
    const select = document.getElementById('prepTimeSelect');
    state.prepTime = parseInt(select.value);
    if (!state.prepTimerFinished) {
        state.prepTimeRemaining = state.prepTime;
    }
    updatePrepTimerDisplay();
    saveState();
}

// Match Timer Functions
function updateMatchTimerDisplay() {
    const timerEl = document.getElementById('matchTimer');
    const statusEl = document.getElementById('matchTimerStatus');
    const cardEl = document.getElementById('matchTimerCard');
    const timeRemaining = state.matchTimeRemaining;
    
    const mins = Math.floor(Math.max(0, timeRemaining) / 60);
    const secs = Math.max(0, timeRemaining) % 60;
    timerEl.textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    
    // Update status
    timerEl.classList.remove('warning', 'danger', 'overtime');
    if (state.matchTimerFinished) {
        statusEl.textContent = '比賽結束！';
        statusEl.className = 'timer-status finished';
        cardEl.classList.remove('active', 'paused');
    } else if (!state.matchTimerPaused) {
        statusEl.textContent = '比賽中...';
        statusEl.className = 'timer-status running';
        cardEl.classList.add('active');
        cardEl.classList.remove('paused');
        if (timeRemaining <= 0) timerEl.classList.add('overtime');
        else if (timeRemaining <= 30) timerEl.classList.add('danger');
        else if (timeRemaining <= 60) timerEl.classList.add('warning');
    } else if (state.matchTimerPaused && timeRemaining < state.matchTime) {
        statusEl.textContent = '已暫停';
        statusEl.className = 'timer-status paused';
        cardEl.classList.add('paused');
        cardEl.classList.remove('active');
    } else {
        statusEl.textContent = '等待開始';
        statusEl.className = 'timer-status waiting';
        cardEl.classList.remove('active', 'paused');
    }
    
    updateCombinedStatusBadge();
}

function startMatchTimer() {
    if (state.matchTimerFinished) return;
    if (!state.matchTimerPaused) return; // Already running
    
    state.matchTimerPaused = false;
    soundManager.playMatchStart();
    
    matchTimerInterval = setInterval(() => {
        if (state.matchTimeRemaining > 0) {
            state.matchTimeRemaining--;
            updateMatchTimerDisplay();
            saveState();
        } else {
            // Match time finished
            pauseMatchTimer();
            state.matchTimerFinished = true;
            updateMatchTimerDisplay();
            soundManager.playEnd();
        }
    }, 1000);
    
    updateMatchTimerDisplay();
}

function pauseMatchTimer() {
    if (state.matchTimerFinished) return;
    if (state.matchTimerPaused) return; // Already paused
    
    state.matchTimerPaused = true;
    clearInterval(matchTimerInterval);
    updateMatchTimerDisplay();
    saveState();
}

function resetMatchTimer() {
    showConfirm('重置比賽計時器', '確定要重置比賽計時器嗎？', () => {
        pauseMatchTimer();
        state.matchTimeRemaining = state.matchTime;
        state.matchTimerFinished = false;
        updateMatchTimerDisplay();
        saveState();
    });
}

function updateMatchTimeSetting() {
    const select = document.getElementById('matchTimeSelect');
    state.matchTime = parseInt(select.value);
    if (!state.matchTimerFinished) {
        state.matchTimeRemaining = state.matchTime;
    }
    updateMatchTimerDisplay();
    saveState();
}

// Combined status badge (for backward compatibility)
function updateCombinedStatusBadge() {
    const badge = document.getElementById('statusBadge');
    badge.className = 'status-badge';
    
    if (state.matchTimerFinished) {
        badge.textContent = '已結束';
        badge.classList.add('ended');
    } else if (!state.matchTimerPaused) {
        badge.textContent = '比賽中';
        badge.classList.add('playing');
    } else if (!state.prepTimerPaused) {
        badge.textContent = '準備中';
        badge.classList.add('prepare');
    } else if (state.prepTimerFinished && state.matchTimerPaused && !state.matchTimerFinished) {
        badge.textContent = '準備完成';
        badge.classList.add('paused');
    } else {
        badge.textContent = '準備中';
        badge.classList.add('prepare');
    }
}

// Legacy timer functions (for backward compatibility)
function updateTimerDisplay() {
    // Redirect to combined display
    updatePrepTimerDisplay();
    updateMatchTimerDisplay();
    updateCombinedStatusBadge();
}

function startTimer() {
    // Legacy function - redirects to prep timer
    if (!state.prepTimerFinished) {
        startPrepTimer();
    } else {
        startMatchTimer();
    }
}

function pauseTimer() {
    // Pause whichever timer is running
    if (!state.prepTimerPaused && !state.prepTimerFinished) {
        pausePrepTimer();
    } else if (!state.matchTimerPaused && !state.matchTimerFinished) {
        pauseMatchTimer();
    }
}

function resetTimer() {
    // Show options to reset
    showConfirm('重置計時器', '選擇要重置邊個計時器？', () => {
        // Reset both timers
        pausePrepTimer();
        pauseMatchTimer();
        state.prepTimeRemaining = state.prepTime;
        state.prepTimerFinished = false;
        state.matchTimeRemaining = state.matchTime;
        state.matchTimerFinished = false;
        updateTimerDisplay();
        saveState();
    });
}

function updateTimerSettings() {
    // Legacy function
    updatePrepTimeSetting();
    updateMatchTimeSetting();
}

// ==================== KFS Functions ====================
function toggleKFS(team, index) {
    saveUndoState();
    const kfs = team === 'red' ? state.redKFS : state.blueKFS;
    const wasPlaced = kfs[index];
    kfs[index] = kfs[index] ? 0 : 1;
    const isPlaced = kfs[index];
    renderKFS(team);
    calculateKFSScore(team);
    checkKungFuMaster(team);
    if (isPlaced && !wasPlaced) { const rowName = index < 3 ? '上排' : (index < 6 ? '中排' : '下排'); logScore(team, 'KFS', KFS_POINTS[index], `擺放 KFS #${index+1} (${rowName})`); }
    else if (!isPlaced && wasPlaced) logScore(team, 'KFS', -KFS_POINTS[index], `移除 KFS #${index+1}`);
    soundManager.playScore();
}

function calculateKFSScore(team) {
    const kfs = team === 'red' ? state.redKFS : state.blueKFS;
    let placementScore = 0;
    for (let i = 0; i < 9; i++) if (kfs[i] === 1) placementScore += KFS_POINTS[i];
    if (team === 'red') state.redScore = placementScore;
    else state.blueScore = placementScore;
    const total = placementScore + (team === 'red' ? state.redKFSCollection * 10 + state.redWeapon * 10 : state.blueKFSCollection * 10 + state.blueWeapon * 10);
    const scoreEl = document.getElementById(team + 'Score');
    scoreEl.textContent = total;
    scoreEl.classList.add('highlight');
    setTimeout(() => scoreEl.classList.remove('highlight'), 300);
    saveState();
}

function renderKFS(team) {
    const kfs = team === 'red' ? state.redKFS : state.blueKFS;
    const grid = document.getElementById(team + 'KFS');
    const cells = grid.children;
    for (let i = 0; i < 9; i++) {
        cells[i].className = 'kfs-cell';
        if (kfs[i] === 1) { cells[i].classList.add(team); cells[i].textContent = '🎯'; }
        else cells[i].textContent = '';
    }
}

function checkKungFuMaster(team) {
    const kfs = team === 'red' ? state.redKFS : state.blueKFS;
    for (let comb of WIN_COMBS) {
        if (kfs[comb[0]] && kfs[comb[1]] && kfs[comb[2]]) {
            const cells = document.getElementById(team + 'KFS').children;
            comb.forEach(i => cells[i].classList.add('kungfu'));
            const teamName = document.getElementById(team + 'Name').value;
            // Pause both timers
            pausePrepTimer();
            pauseMatchTimer();
            state.matchTimerFinished = true;
            showWinner(teamName + ' - KUNG FU MASTER! 🎯🎯🎯');
            return;
        }
    }
}

// ==================== Score Functions ====================
function addPlacement(team, points) {
    saveUndoState();
    if (team === 'red') state.redScore += points;
    else state.blueScore += points;
    updateScore(team);
    soundManager.playScore();
    showScoreFloat(team, points);
}

function adjustCollection(team, delta) {
    if (delta === 0) return;
    saveUndoState();
    if (team === 'red') { state.redKFSCollection = Math.max(0, state.redKFSCollection + delta); document.getElementById('redKFSCollection').textContent = state.redKFSCollection; }
    else { state.blueKFSCollection = Math.max(0, state.blueKFSCollection + delta); document.getElementById('blueKFSCollection').textContent = state.blueKFSCollection; }
    updateScore(team);
    const action = delta > 0 ? '收集' : '失去';
    logScore(team, 'Collection', delta * 10, `KFS ${action}`);
    soundManager.playScore();
    showScoreFloat(team, delta * 10);
}

function adjustWeapon(team, delta) {
    if (delta === 0) return;
    saveUndoState();
    if (team === 'red') { state.redWeapon = Math.max(0, state.redWeapon + delta); document.getElementById('redWeapon').textContent = state.redWeapon; }
    else { state.blueWeapon = Math.max(0, state.blueWeapon + delta); document.getElementById('blueWeapon').textContent = state.blueWeapon; }
    updateScore(team);
    const action = delta > 0 ? '組裝' : '拆卸';
    logScore(team, 'Weapon', delta * 10, `武器 ${action}`);
    soundManager.playScore();
    showScoreFloat(team, delta * 10);
}

function adjustPenalty(team, delta) {
    if (delta === 0) return;
    saveUndoState();
    if (team === 'red') { state.redPenalties = Math.max(0, state.redPenalties + delta); document.getElementById('redPenalties').textContent = state.redPenalties; }
    else { state.bluePenalties = Math.max(0, state.bluePenalties + delta); document.getElementById('bluePenalties').textContent = state.bluePenalties; }
    updateScore(team);
    const action = delta > 0 ? '犯規' : '取消犯規';
    logScore(team, 'Penalty', 0, `⚠️ ${action}`);
    soundManager.playPenalty();
}

function updateScore(team) {
    const baseScore = team === 'red' ? state.redScore : state.blueScore;
    const coll = team === 'red' ? state.redKFSCollection : state.blueKFSCollection;
    const wep = team === 'red' ? state.redWeapon : state.blueWeapon;
    const pen = team === 'red' ? state.redPenalties : state.bluePenalties;
    const total = baseScore + (coll * 10) + (wep * 10);
    const scoreEl = document.getElementById(team + 'Score');
    scoreEl.textContent = total;
    scoreEl.classList.add('highlight');
    setTimeout(() => scoreEl.classList.remove('highlight'), 300);
    const penaltyEl = document.getElementById(team + 'Penalties');
    penaltyEl.textContent = pen;
    penaltyEl.style.color = pen > 0 ? '#ff6b6b' : 'inherit';
    penaltyEl.style.fontWeight = pen > 0 ? 'bold' : 'normal';
    saveState();
}

// ==================== Visual Effects ====================
function showScoreFloat(team, points) {
    if (points === 0) return;
    const teamCard = document.getElementById('team' + (team === 'red' ? 'Red' : 'Blue'));
    const rect = teamCard.getBoundingClientRect();
    const float = document.createElement('div');
    float.className = 'score-float ' + (points > 0 ? 'positive' : 'negative');
    float.textContent = (points > 0 ? '+' : '') + points;
    float.style.left = (rect.left + rect.width / 2) + 'px';
    float.style.top = rect.top + 'px';
    document.body.appendChild(float);
    setTimeout(() => float.remove(), 1000);
}

// ==================== Logging ====================
function logScore(team, type, points, description) {
    // Use match timer if running, otherwise prep timer
    let timeRemaining;
    if (!state.matchTimerFinished || state.matchTimeRemaining === state.matchTime) {
        timeRemaining = state.matchTimeRemaining;
    } else {
        timeRemaining = state.prepTimeRemaining;
    }
    
    const mins = Math.floor(timeRemaining / 60);
    const secs = timeRemaining % 60;
    const timeStr = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    const logEntry = { time: timeStr, team: team, type: type, points: points, description: description, timestamp: Date.now() };
    state.scoringLog.push(logEntry);
    updateScoringLogDisplay();
    saveState();
}

function updateScoringLogDisplay() {
    const logEl = document.getElementById('scoringLog');
    if (!logEl) return;
    if (state.scoringLog.length === 0) { logEl.innerHTML = '<div style="text-align:center; opacity:0.5; padding:10px;">暫時沒有記錄</div>'; return; }
    logEl.innerHTML = state.scoringLog.map(entry => {
        const teamColor = entry.team === 'red' ? 'var(--red-team)' : 'var(--blue-team)';
        const teamName = entry.team === 'red' ? '火之龍' : '征龍';
        const pointsColor = entry.points > 0 ? 'var(--green)' : 'var(--red-team)';
        return `<div class="log-entry"><span class="log-time">${entry.time}</span><span class="log-team" style="color:${teamColor}">${teamName}</span><span class="log-desc">${entry.description}</span><span class="log-points" style="color:${pointsColor}">${entry.points > 0 ? '+' : ''}${entry.points}</span></div>`;
    }).join('');
}

// ==================== Undo System ====================
function saveUndoState() {
    const undoState = JSON.stringify(state);
    state.undoStack.push(undoState);
    if (state.undoStack.length > state.maxUndoSteps) state.undoStack.shift();
    updateUndoButton();
}

function undo() {
    if (state.undoStack.length === 0) { alert('沒有可以撤回既操作！'); return; }
    const previousState = state.undoStack.pop();
    state = JSON.parse(previousState);
    restoreUI();
    soundManager.playUndo();
    updateUndoButton();
    saveState();
}

function restoreUI() {
    const redTotal = state.redScore + state.redKFSCollection * 10 + state.redWeapon * 10;
    const blueTotal = state.blueScore + state.blueKFSCollection * 10 + state.blueWeapon * 10;
    document.getElementById('redScore').textContent = redTotal;
    document.getElementById('blueScore').textContent = blueTotal;
    document.getElementById('redKFSCollection').textContent = state.redKFSCollection;
    document.getElementById('blueKFSCollection').textContent = state.blueKFSCollection;
    document.getElementById('redWeapon').textContent = state.redWeapon;
    document.getElementById('blueWeapon').textContent = state.blueWeapon;
    document.getElementById('redPenalties').textContent = state.redPenalties;
    document.getElementById('bluePenalties').textContent = state.bluePenalties;
    document.getElementById('matchNumber').value = state.matchNumber;
    renderKFS('red');
    renderKFS('blue');
    updateTimerDisplay();
    updateScoringLogDisplay();
    updateStatusBadge();
    updateUndoButton();
}

function updateUndoButton() {
    const btn = document.getElementById('undoBtn');
    btn.textContent = `↩️ Undo (${state.undoStack.length})`;
    btn.disabled = state.undoStack.length === 0;
}

// ==================== Confirmation Modal ====================
function showConfirm(title, message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const cancelBtn = document.getElementById('confirmCancel');
    const okBtn = document.getElementById('confirmOk');
    titleEl.textContent = title;
    messageEl.textContent = message;
    const handleConfirm = () => { modal.classList.remove('show'); cancelBtn.onclick = null; okBtn.onclick = null; onConfirm(); };
    const handleCancel = () => { modal.classList.remove('show'); cancelBtn.onclick = null; okBtn.onclick = null; };
    cancelBtn.onclick = handleCancel;
    okBtn.onclick = handleConfirm;
    modal.classList.add('show');
}

// ==================== Team Selection ====================
function selectTeam(team) {
    state.selectedTeam = team;
    document.getElementById('teamRed').classList.remove('selected');
    document.getElementById('teamBlue').classList.remove('selected');
    document.getElementById('team' + (team === 'red' ? 'Red' : 'Blue')).classList.add('selected');
}

function toggleTeam() { selectTeam(state.selectedTeam === 'red' ? 'blue' : 'red'); }

// ==================== Keyboard Shortcuts ====================
function handleKeyboard(e) {
    if (e.target.tagName === 'INPUT') return;
    switch (e.key) {
        case ' ': 
            e.preventDefault(); 
            // Pause whichever timer is running
            if (!state.prepTimerPaused && !state.prepTimerFinished) {
                pausePrepTimer();
            } else if (!state.matchTimerPaused && !state.matchTimerFinished) {
                pauseMatchTimer();
            } else {
                // If all paused, resume the first unfinished timer
                if (!state.prepTimerFinished) startPrepTimer();
                else if (!state.matchTimerFinished) startMatchTimer();
            }
            break;
        case 'p': case 'P':
            // Prep timer controls
            if (!state.prepTimerPaused && !state.prepTimerFinished) {
                pausePrepTimer();
            } else if (state.prepTimerPaused && !state.prepTimerFinished) {
                startPrepTimer();
            }
            break;
        case 'm': case 'M':
            // Match timer controls
            if (!state.matchTimerPaused && !state.matchTimerFinished) {
                pauseMatchTimer();
            } else if (state.matchTimerPaused && !state.matchTimerFinished) {
                startMatchTimer();
            }
            break;
        case 'r': case 'R': 
            // Reset timer - show options
            resetTimer(); 
            break;
        case 't': case 'T': 
            toggleTeam(); 
            break;
        case '1': 
            addPlacement(state.selectedTeam, 1); 
            break;
        case '2': 
            addPlacement(state.selectedTeam, 5); 
            break;
        case '3': 
            addPlacement(state.selectedTeam, 10); 
            break;
    }
}

// ==================== Match Control ====================
function declareWinner() {
    showConfirm('宣佈勝者', '確定要宣佈今場比賽既勝者嗎？', () => {
        // Pause all timers
        pausePrepTimer();
        pauseMatchTimer();
        
        const redTotal = parseInt(document.getElementById('redScore').textContent);
        const blueTotal = parseInt(document.getElementById('blueScore').textContent);
        const redName = document.getElementById('redName').value;
        const blueName = document.getElementById('blueName').value;
        let message;
        if (redTotal > blueTotal) message = `🏆 勝利者: ${redName}！(${redTotal} vs ${blueTotal})`;
        else if (blueTotal > redTotal) message = `🏆 勝利者: ${blueName}！(${blueTotal} vs ${redTotal})`;
        else message = '🤝 比賽平手！';
        
        // Mark match as finished
        state.matchTimerFinished = true;
        
        showWinner(message);
        saveToHistory();
        soundManager.playEnd();
        updateCombinedStatusBadge();
    });
}

function showWinner(message) {
    const banner = document.getElementById('winnerBanner');
    banner.textContent = message;
    banner.classList.add('show');
    if (message.includes('紅')) document.getElementById('teamRed').classList.add('winner');
    else if (message.includes('藍')) document.getElementById('teamBlue').classList.add('winner');
}

function hardReset() {
    showConfirm('重置所有', '確定要重置所有嘢嗎？呢個會清除所有分數、犯規、同歷史記錄！', () => {
        // Stop all timers
        pausePrepTimer();
        pauseMatchTimer();
        
        state = {
            redScore: 0, blueScore: 0, redKFS: Array(9).fill(0), blueKFS: Array(9).fill(0),
            redKFSCollection: 0, blueKFSCollection: 0, redWeapon: 0, blueWeapon: 0,
            redPenalties: 0, bluePenalties: 0, matchNumber: 1, matchHistory: [], scoringLog: [],
            prepTimeRemaining: state.prepTime, prepTime: state.prepTime,
            prepTimerPaused: true, prepTimerFinished: false,
            matchTimeRemaining: state.matchTime, matchTime: state.matchTime,
            matchTimerPaused: true, matchTimerFinished: false,
            isPaused: true, gamePhase: 'prepare', selectedTeam: 'red',
            undoStack: [], maxUndoSteps: 10
        };
        
        document.getElementById('redScore').textContent = '0';
        document.getElementById('blueScore').textContent = '0';
        document.getElementById('redKFSCollection').textContent = '0';
        document.getElementById('blueKFSCollection').textContent = '0';
        document.getElementById('redWeapon').textContent = '0';
        document.getElementById('blueWeapon').textContent = '0';
        document.getElementById('redPenalties').textContent = '0';
        document.getElementById('bluePenalties').textContent = '0';
        document.getElementById('matchNumber').value = '1';
        document.getElementById('redName').value = '火之龍';
        document.getElementById('blueName').value = '征龍';
        
        updateScoringLogDisplay();
        document.getElementById('teamRed').classList.remove('winner');
        document.getElementById('teamBlue').classList.remove('winner');
        document.getElementById('winnerBanner').classList.remove('show');
        
        renderKFS('red');
        renderKFS('blue');
        updateTimerDisplay();
        updateHistoryDisplay();
        updateUndoButton();
        
        saveState();
        localStorage.removeItem('robocon2026');
        alert('已重置所有嘢！');
    });
}

function newMatch() {
    if (state.redScore > 0 || state.blueScore > 0) showConfirm('新比賽', '確定要開始新比賽嗎？呢個會保存当前比赛记录。', () => { startNewMatch(); });
    else startNewMatch();
}

function startNewMatch() {
    if (state.redScore > 0 || state.blueScore > 0) saveToHistory();
    
    // Stop all timers first
    pausePrepTimer();
    pauseMatchTimer();
    
    state.redScore = 0; state.blueScore = 0;
    state.redKFS = Array(9).fill(0); state.blueKFS = Array(9).fill(0);
    state.redKFSCollection = 0; state.blueKFSCollection = 0;
    state.redWeapon = 0; state.blueWeapon = 0;
    state.redPenalties = 0; state.bluePenalties = 0;
    state.scoringLog = []; state.undoStack = [];
    
    document.getElementById('redScore').textContent = '0';
    document.getElementById('blueScore').textContent = '0';
    document.getElementById('redKFSCollection').textContent = '0';
    document.getElementById('blueKFSCollection').textContent = '0';
    document.getElementById('redWeapon').textContent = '0';
    document.getElementById('blueWeapon').textContent = '0';
    document.getElementById('matchNumber').value = state.matchNumber + 1;
    state.matchNumber++;
    
    // Reset both timers
    state.prepTimeRemaining = state.prepTime;
    state.prepTimerPaused = true;
    state.prepTimerFinished = false;
    state.matchTimeRemaining = state.matchTime;
    state.matchTimerPaused = true;
    state.matchTimerFinished = false;
    
    renderKFS('red');
    renderKFS('blue');
    updateTimerDisplay();
    
    document.getElementById('teamRed').classList.remove('winner');
    document.getElementById('teamBlue').classList.remove('winner');
    document.getElementById('winnerBanner').classList.remove('show');
    
    updateUndoButton();
    saveState();
    soundManager.playPrepStart();
}

// ==================== History ====================
function saveToHistory() {
    const redName = document.getElementById('redName').value;
    const blueName = document.getElementById('blueName').value;
    const redTotal = parseInt(document.getElementById('redScore').textContent);
    const blueTotal = parseInt(document.getElementById('blueScore').textContent);
    state.matchHistory.push({
        match: state.matchNumber, red: redName, blue: blueName,
        redScore: redTotal, blueScore: blueTotal,
        redPenalties: state.redPenalties || 0, bluePenalties: state.bluePenalties || 0,
        winner: redTotal > blueTotal ? 'red' : (blueTotal > redTotal ? 'blue' : 'draw'),
        time: new Date().toLocaleString('zh-HK')
    });
    updateHistoryDisplay();
}

function updateHistoryDisplay() {
    const el = document.getElementById('historyList');
    if (state.matchHistory.length === 0) { el.innerHTML = '<div style="text-align:center; opacity:0.5;">暫時沒有比賽記錄</div>'; return; }
    el.innerHTML = state.matchHistory.slice().reverse().map(m => `<div class="history-item"><span>#${m.match} ${m.red} vs ${m.blue}</span><span>${m.redScore} - ${m.blueScore} ${m.winner === 'red' ? '🔴' : (m.winner === 'blue' ? '🔵' : '🤝')} ${m.redPenalties > 0 ? '(⚠️'+m.redPenalties+')' : ''} ${m.bluePenalties > 0 ? '(⚠️'+m.bluePenalties+')' : ''}</span></div>`).join('');
}

// ==================== Export/Import ====================
function exportScore() {
    const redName = document.getElementById('redName').value;
    const blueName = document.getElementById('blueName').value;
    let text = `🤖 Robocon 2026 比分\n====================\n場次: ${state.matchNumber}\n狀態: ${document.getElementById('statusBadge').textContent}\n時間: ${document.getElementById('timer').textContent}\n\n${redName}: ${document.getElementById('redScore').textContent} 分\n  - KFS Collection: ${state.redKFSCollection}\n  - Weapon: ${state.redWeapon}\n  - 犯規: ${state.redPenalties || 0}\n\n${blueName}: ${document.getElementById('blueScore').textContent} 分\n  - KFS Collection: ${state.blueKFSCollection}\n  - Weapon: ${state.blueWeapon}\n  - 犯規: ${state.bluePenalties || 0}\n`;
    navigator.clipboard.writeText(text).then(() => { alert('比分已複製到剪貼簿！'); });
}

function exportScoringLog() {
    if (state.scoringLog.length === 0) { alert('暫時沒有得分記錄！'); return; }
    let text = `🤖 Robocon 2026 得分記錄\n========================\n場次: ${state.matchNumber}\n\n`;
    state.scoringLog.forEach(entry => { const teamName = entry.team === 'red' ? '火之龍' : '征龍'; text += `[${entry.time}] ${teamName} ${entry.description} ${entry.points > 0 ? '+' : ''}${entry.points}\n`; });
    text += `\n========================\n火之龍總分: ${document.getElementById('redScore').textContent}\n征龍總分: ${document.getElementById('blueScore').textContent}\n`;
    navigator.clipboard.writeText(text).then(() => { alert('得分記錄已複製到剪貼簿！'); });
}

function importScoringLog() {
    const text = prompt('請貼上得分記錄 (JSON format):');
    if (!text) return;
    try { const data = JSON.parse(text); if (Array.isArray(data)) { state.scoringLog = data; updateScoringLogDisplay(); saveState(); alert('得分記錄已匯入！'); } else { alert('格式錯誤！'); } } catch (e) { alert('匯入失敗，請確認格式正確！'); }
}

function clearScoringLog() { showConfirm('清除記錄', '確定要清除得分記錄嗎？', () => { state.scoringLog = []; updateScoringLogDisplay(); saveState(); }); }

// ==================== Analysis ====================
function showAnalysis() { document.getElementById('analysisPanel').classList.add('show'); runAnalysis(); }
function closeAnalysis() { document.getElementById('analysisPanel').classList.remove('show'); }
function importForAnalysis() { const text = prompt('請貼上得分記錄 (JSON format):'); if (!text) return; try { const data = JSON.parse(text); if (Array.isArray(data)) analyzeData(data); else alert('格式錯誤！'); } catch (e) { alert('匯入失敗，請確認格式正確！'); } }
function runAnalysis() { if (state.scoringLog.length === 0) { document.getElementById('analysisContent').innerHTML = '<div style="text-align:center; opacity:0.5; padding:20px;">暫時沒有數據，請先記錄或匯入數據</div>'; return; } analyzeData(state.scoringLog); }

function analyzeData(log) {
    let redTotal = 0, blueTotal = 0, redEvents = 0, blueEvents = 0, redKFS = 0, blueKFS = 0, redCollection = 0, blueCollection = 0, redWeapon = 0, blueWeapon = 0;
    let timeline = []; let redScore = 0; let blueScore = 0;
    log.forEach(entry => {
        if (entry.team === 'red') {
            redScore += entry.points;
            redEvents++;
            if (entry.type === 'KFS') redKFS += Math.abs(entry.points);
            if (entry.type === 'Collection') redCollection += Math.abs(entry.points);
            if (entry.type === 'Weapon') redWeapon += Math.abs(entry.points);
        } else {
            blueScore += entry.points;
            blueEvents++;
            if (entry.type === 'KFS') blueKFS += Math.abs(entry.points);
            if (entry.type === 'Collection') blueCollection += Math.abs(entry.points);
            if (entry.type === 'Weapon') blueWeapon += Math.abs(entry.points);
        }
        timeline.push({...entry, redScore, blueScore});
    });
    redTotal = redScore;
    blueTotal = blueScore;
    const maxScore = Math.max(redTotal, blueTotal, 1);
    let html = `<div class="stats-grid"><div class="stat-card"><div class="stat-value" style="color:var(--red-team)">${redTotal}</div><div class="stat-label">火之龍 總分</div></div><div class="stat-card"><div class="stat-value" style="color:var(--blue-team)">${blueTotal}</div><div class="stat-label">征龍 總分</div></div><div class="stat-card"><div class="stat-value">${redEvents + blueEvents}</div><div class="stat-label">總事件數</div></div><div class="stat-card"><div class="stat-value">${log.length}</div><div class="stat-label">記錄條數</div></div></div>`;
    html += `<div class="chart-container"><div class="chart-title">📊 比分對比</div><div class="bar-chart"><div class="bar-group"><div class="bar red" style="height:${(redTotal/maxScore)*180}px"><span class="bar-value" style="color:var(--red-team)">${redTotal}</span></div><div class="bar-label">火之龍</div></div><div class="bar-group"><div class="bar blue" style="height:${(blueTotal/maxScore)*180}px"><span class="bar-value" style="color:var(--blue-team)">${blueTotal}</span></div><div class="bar-label">征龍</div></div></div></div>`;
    html += `<div class="chart-container"><div class="chart-title">📈 分類得分</div><div class="stats-grid"><div class="stat-card"><div class="stat-value" style="color:var(--red-team)">${redKFS}</div><div class="stat-label">火之龍 KFS</div></div><div class="stat-card"><div class="stat-value" style="color:var(--blue-team)">${blueKFS}</div><div class="stat-label">征龍 KFS</div></div><div class="stat-card"><div class="stat-value" style="color:var(--red-team)">${redCollection}</div><div class="stat-label">火之龍 Collection</div></div><div class="stat-card"><div class="stat-value" style="color:var(--blue-team)">${blueCollection}</div><div class="stat-label">征龍 Collection</div></div><div class="stat-card"><div class="stat-value" style="color:var(--red-team)">${redWeapon}</div><div class="stat-label">火之龍 Weapon</div></div><div class="stat-card"><div class="stat-value" style="color:var(--blue-team)">${blueWeapon}</div><div class="stat-label">征龍 Weapon</div></div></div></div>`;
    if (redTotal > blueTotal) html += `<div style="text-align:center; margin-top:20px; font-size:1.5rem; color:var(--gold)">🏆 勝利者: 火之龍！</div>`;
    else if (blueTotal > redTotal) html += `<div style="text-align:center; margin-top:20px; font-size:1.5rem; color:var(--gold)">🏆 勝利者: 征龍！</div>`;
    else html += `<div style="text-align:center; margin-top:20px; font-size:1.5rem; color:var(--gold)">🤝 平手！</div>`;
    document.getElementById('analysisContent').innerHTML = html;
}

// ==================== Storage ====================
function saveState() { localStorage.setItem('robocon2026', JSON.stringify(state)); }

function loadState() {
    const saved = localStorage.getItem('robocon2026');
    if (saved) {
        state = JSON.parse(saved);
        
        // Handle legacy state migration
        if (state.timeRemaining !== undefined) {
            // Old format - migrate to new format
            state.matchTimeRemaining = state.timeRemaining;
            state.matchTimerPaused = state.isPaused;
            state.matchTimerFinished = state.gamePhase === 'ended';
            state.prepTimerPaused = state.isPaused;
            state.prepTimerFinished = state.gamePhase === 'playing' || state.gamePhase === 'ended';
            delete state.timeRemaining;
        }
        
        // Ensure new fields exist
        if (state.prepTimerPaused === undefined) state.prepTimerPaused = true;
        if (state.prepTimerFinished === undefined) state.prepTimerFinished = false;
        if (state.matchTimerPaused === undefined) state.matchTimerPaused = true;
        if (state.matchTimerFinished === undefined) state.matchTimerFinished = false;
        
        const redTotal = state.redScore + (state.redKFSCollection*10) + (state.redWeapon*10);
        const blueTotal = state.blueScore + (state.blueKFSCollection*10) + (state.blueWeapon*10);
        document.getElementById('redScore').textContent = redTotal;
        document.getElementById('blueScore').textContent = blueTotal;
        document.getElementById('redKFSCollection').textContent = state.redKFSCollection;
        document.getElementById('blueKFSCollection').textContent = state.blueKFSCollection;
        document.getElementById('redWeapon').textContent = state.redWeapon;
        document.getElementById('blueWeapon').textContent = state.blueWeapon;
        document.getElementById('redPenalties').textContent = state.redPenalties || 0;
        document.getElementById('bluePenalties').textContent = state.bluePenalties || 0;
        document.getElementById('matchNumber').value = state.matchNumber;
        document.getElementById('redName').value = state.redName || '火之龍';
        document.getElementById('blueName').value = state.blueName || '征龍';
        
        // Update timer settings dropdowns
        document.getElementById('prepTimeSelect').value = state.prepTime;
        document.getElementById('matchTimeSelect').value = state.matchTime;
        
        renderKFS('red');
        renderKFS('blue');
        updateHistoryDisplay();
        updateScoringLogDisplay();
        updateTimerDisplay();
        updateUndoButton();
        selectTeam(state.selectedTeam || 'red');
    }
}

// ==================== Initialize ====================
document.addEventListener('keydown', handleKeyboard);
loadState();
setInterval(saveState, 5000);

// Add any missing legacy function stubs for compatibility
function toggleTotalTimer() {
    // This was a planned feature - show a simple alert for now
    const totalTime = (state.matchTime - state.matchTimeRemaining) + (state.prepTime - state.prepTimeRemaining);
    const mins = Math.floor(totalTime / 60);
    const secs = totalTime % 60;
    alert(`總已用時間: ${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`);
}
