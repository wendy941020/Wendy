const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const GRID_SIZE = 20;

const gameContainer = document.getElementById('game-container');
const highScoreEl = document.getElementById('high-score-value');
const resumeBtn = document.getElementById('btn-resume');
const loadingScreen = document.getElementById('loading-screen');
let isPaused = false;
let lastScore = 0;
let audioContext = null;
let soundEnabled = false;
let shakeTimeout = null;
let latestGameState = null;
let needsRender = false;
let particles = [];

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// UI 元素
const screens = {
    start: document.getElementById('start-screen'),
    over: document.getElementById('game-over-screen'),
    pause: document.getElementById('pause-screen'),
    settings: document.getElementById('settings-screen'),
    leaderboard: document.getElementById('leaderboard-screen')
};

const btns = {
    start: document.getElementById('btn-start'),
    restart: document.getElementById('btn-restart'),
    googleLogin: document.getElementById('btn-google-login')
};

const userInfoEl = document.getElementById('user-info');
const finalScoreEl = document.getElementById('final-score');

// 隱藏目前多人連線用不到的功能
['btn-resume-save','btn-show-cheat','cheat-text','btn-leaderboard'].forEach(id => {
    let el = document.getElementById(id);
    if(el) el.classList.add('hidden');
});

// 設定按鈕
let settingsOrigin = null;
document.getElementById('btn-settings').addEventListener('click', () => {
    settingsOrigin = Object.values(screens).find(el => !el.classList.contains('hidden')) || null;
    hideAllScreens();
    screens.settings.classList.remove('hidden');
});
document.getElementById('btn-close-settings').addEventListener('click', () => {
    screens.settings.classList.add('hidden');
    if (settingsOrigin) settingsOrigin.classList.remove('hidden');
    settingsOrigin = null;
});

// 主題切換
const savedTheme = localStorage.getItem('theme') || 'retro';
document.getElementById('theme-select').value = savedTheme;
document.documentElement.setAttribute('data-theme', savedTheme);
document.getElementById('theme-select').addEventListener('change', (e) => {
    document.documentElement.setAttribute('data-theme', e.target.value);
    localStorage.setItem('theme', e.target.value);
});

setHighScore(getHighScore());
let currentUser = null;

// 檢查使用者是否已經使用 Google 登入
fetch('/api/me')
    .then(res => res.json())
    .then(data => {
        if(data.loggedIn) {
            currentUser = data.user;
            // 隱藏登入按鈕，顯示開始遊戲按鈕
            btns.googleLogin.style.display = 'none';
            btns.start.classList.remove('hidden');
            // 顯示大頭貼與名字
            let img = currentUser.picture ? `<img src="${currentUser.picture}" style="width:24px; border-radius:50%; vertical-align:middle; margin-right:5px;">` : '';
            userInfoEl.innerHTML = `${img}歡迎, ${currentUser.name}`;
        }
    });

function hideAllScreens() {
    Object.values(screens).forEach(s => { if(s) s.classList.add('hidden'); });
}

function getHighScore() {
    return Number(localStorage.getItem('snakeHighScore') || 0);
}

function setHighScore(value) {
    localStorage.setItem('snakeHighScore', value);
    if (highScoreEl) highScoreEl.textContent = value;
}

function updateHighScore(score) {
    let best = getHighScore();
    if (score > best) {
        setHighScore(score);
    } else if (highScoreEl) {
        highScoreEl.textContent = best;
    }
}

function enableAudio() {
    if (soundEnabled) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    soundEnabled = true;
}

function playTone(frequency, duration = 0.08, type = 'sine', volume = 0.08) {
    if (!soundEnabled || !audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + duration);
    gain.gain.setTargetAtTime(0, audioContext.currentTime + duration * 0.8, 0.01);
}

function playSfx(name) {
    if (!soundEnabled) return;
    switch (name) {
        case 'eat':
            playTone(880, 0.05, 'triangle', 0.08);
            playTone(1320, 0.08, 'sine', 0.05);
            break;
        case 'gold':
            playTone(1040, 0.12, 'square', 0.1);
            playTone(1560, 0.1, 'triangle', 0.06);
            break;
        case 'pause':
            playTone(220, 0.12, 'sine', 0.08);
            break;
        case 'resume':
            playTone(440, 0.08, 'triangle', 0.08);
            break;
        default:
            playTone(660, 0.05, 'sine', 0.06);
    }
}

function triggerScreenShake() {
    if (!gameContainer) return;
    gameContainer.classList.add('shake');
    clearTimeout(shakeTimeout);
    shakeTimeout = setTimeout(() => {
        gameContainer.classList.remove('shake');
    }, 300);
}

function spawnParticles(x, y) {
    for (let i = 0; i < 10; i++) {
        particles.push({
            x: x * GRID_SIZE + GRID_SIZE / 2,
            y: y * GRID_SIZE + GRID_SIZE / 2,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            life: 30,
            color: `hsl(${Math.random() * 360}, 100%, 70%)`
        });
    }
}

function setPaused(paused) {
    if (isPaused === paused) return;
    isPaused = paused;
    if (screens.pause) {
        screens.pause.classList.toggle('hidden', !paused);
    }
    if (paused) {
        playSfx('pause');
    } else {
        playSfx('resume');
    }
}

// 初始化連線
const socket = io();
let myId = null;

function hideLoadingScreen() {
    if (loadingScreen) loadingScreen.classList.add('hidden');
}

socket.on('connect', () => {
    myId = socket.id;
    hideLoadingScreen();
    hideAllScreens();
    screens.start.classList.remove('hidden');
});

// 點擊開始與重新開始按鈕 (送出使用者資料給伺服器)
btns.start.addEventListener('click', () => {
    enableAudio();
    updateHighScore(getHighScore());
    setPaused(false);
    socket.emit('joinGame', currentUser);
});
btns.restart.addEventListener('click', () => {
    enableAudio();
    updateHighScore(getHighScore());
    setPaused(false);
    socket.emit('joinGame', currentUser);
});

// 訪客模式
const guestBtn = document.getElementById('btn-guest');
if(guestBtn) {
    guestBtn.addEventListener('click', () => {
        let guestName = '訪客' + Math.floor(Math.random() * 9000 + 1000);
        currentUser = { name: guestName };
        btns.googleLogin.style.display = 'none';
        guestBtn.style.display = 'none';
        btns.start.classList.remove('hidden');
        userInfoEl.innerHTML = `👤 ${guestName}`;
        // 直接開始遊戲
        enableAudio();
        updateHighScore(getHighScore());
        setPaused(false);
        socket.emit('joinGame', currentUser);
    });
}

socket.on('joined', () => { hideAllScreens(); });
socket.on('serverMessage', (msg) => { alert(msg); });
socket.on('gameOver', (score) => {
    updateHighScore(score);
    // 不 hideAllScreens：讓遊戲畫面繼續在半透明 overlay 後面跑（觀戰模式）
    Object.values(screens).forEach(s => { if (s !== screens.over) s.classList.add('hidden'); });
    finalScoreEl.textContent = score;
    screens.over.classList.remove('hidden');
    // 死亡後自動 focus 聊天輸入框
    const chatInput = document.getElementById('chat-input');
    if (chatInput) setTimeout(() => chatInput.focus(), 200);
});

// 更新分數
const liveScoreboardEl = document.getElementById('live-scoreboard');
socket.on('updateScoreboard', (scores) => {
    if(liveScoreboardEl) {
        liveScoreboardEl.innerHTML = '';
        scores.forEach((s, idx) => {
            let p = document.createElement('div');
            let medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '';
            let superIcon = s.isSuper ? ' ⭐' : '';
            p.textContent = `${medal} ${s.name}: ${s.score} (🐍${s.len})${superIcon}`;
            p.style.color = s.color;
            p.style.textShadow = `0 0 5px ${s.color}`;
            p.style.padding = '3px 0';
            p.style.fontSize = '0.75rem';
            if(s.id === myId) { p.style.fontWeight = 'bold'; p.style.borderLeft = `3px solid ${s.color}`; p.style.paddingLeft = '8px'; }
            liveScoreboardEl.appendChild(p);
        });
    }
});

// 擊殺通知
let killFeedMessages = [];
socket.on('killFeed', (data) => {
    killFeedMessages.push({ ...data, time: Date.now() });
    if(killFeedMessages.length > 5) killFeedMessages.shift();
});

// UI 顯示切換
const btnToggleUi = document.getElementById('btn-toggle-ui');
const controlsHint = document.getElementById('controls-hint');
if (btnToggleUi && controlsHint) {
    btnToggleUi.addEventListener('click', () => {
        if (controlsHint.style.display === 'none') {
            controlsHint.style.display = 'block';
            btnToggleUi.innerText = '👁️ 隱藏';
        } else {
            controlsHint.style.display = 'none';
            btnToggleUi.innerText = '👁️ 顯示';
        }
    });
}

if (resumeBtn) {
    resumeBtn.addEventListener('click', () => setPaused(false));
}

// 鍵盤監聽（聊天框 focus 時不攔截）
document.addEventListener('keydown', (e) => {
    if (document.activeElement && document.activeElement.id === 'chat-input') return;
    if (e.key === ' ') {
        e.preventDefault();
        if (isPaused) {
            setPaused(false);
        } else {
            setPaused(true);
        }
        return;
    }
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight", "Shift"].includes(e.key)) e.preventDefault();
    if (isPaused) return;
    if (e.key === 'Shift' || e.key === 'ShiftLeft' || e.key === 'ShiftRight') {
        socket.emit('dash', true);
        return;
    }
    let dir = null;
    switch (e.key) {
        case 'ArrowUp': case 'w': case 'W': dir = { dx: 0, dy: -1 }; break;
        case 'ArrowDown': case 's': case 'S': dir = { dx: 0, dy: 1 }; break;
        case 'ArrowLeft': case 'a': case 'A': dir = { dx: -1, dy: 0 }; break;
        case 'ArrowRight': case 'd': case 'D': dir = { dx: 1, dy: 0 }; break;
    }
    if (dir) socket.emit('direction', dir);
});
document.addEventListener('keyup', (e) => {
    if (document.activeElement && document.activeElement.id === 'chat-input') return;
    if (e.key === 'Shift' || e.key === 'ShiftLeft' || e.key === 'ShiftRight') socket.emit('dash', false);
});

// 手機滑動控制
let touchStartX = 0, touchStartY = 0;
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    if (isPaused) return;
    e.preventDefault();
    let dx = e.changedTouches[0].clientX - touchStartX;
    let dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return; // 太短不算
    let dir = null;
    if (Math.abs(dx) > Math.abs(dy)) {
        dir = dx > 0 ? { dx: 1, dy: 0 } : { dx: -1, dy: 0 };
    } else {
        dir = dy > 0 ? { dx: 0, dy: 1 } : { dx: 0, dy: -1 };
    }
    if (dir) socket.emit('direction', dir);
}, { passive: false });

// 虛擬方向鍵
['up','down','left','right'].forEach(d => {
    let btn = document.getElementById('dpad-' + d);
    if (!btn) return;
    let dir = d === 'up' ? {dx:0,dy:-1} : d === 'down' ? {dx:0,dy:1} : d === 'left' ? {dx:-1,dy:0} : {dx:1,dy:0};
    btn.addEventListener('touchstart', (e) => { if (isPaused) return; e.preventDefault(); socket.emit('direction', dir); }, { passive: false });
    btn.addEventListener('mousedown', (e) => { if (isPaused) return; e.preventDefault(); socket.emit('direction', dir); });
});

const dpadDash = document.getElementById('dpad-dash');
if (dpadDash) {
    dpadDash.addEventListener('touchstart', (e) => { if (isPaused) return; e.preventDefault(); socket.emit('dash', true); }, { passive: false });
    dpadDash.addEventListener('touchend', (e) => { if (isPaused) return; e.preventDefault(); socket.emit('dash', false); }, { passive: false });
    dpadDash.addEventListener('mousedown', (e) => { if (isPaused) return; e.preventDefault(); socket.emit('dash', true); });
    dpadDash.addEventListener('mouseup', (e) => { if (isPaused) return; e.preventDefault(); socket.emit('dash', false); });
    dpadDash.addEventListener('mouseleave', (e) => { if (isPaused) return; e.preventDefault(); socket.emit('dash', false); });
}

// 聊天
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const msg = chatInput.value.trim();
            if (msg) {
                socket.emit('chat', msg);
                chatInput.value = '';
            }
        }
        // Escape：取消 focus，回到遊戲控制
        if (e.key === 'Escape') chatInput.blur();
    });
}

socket.on('chatMessage', (data) => {
    if (!chatMessages) return;
    const div = document.createElement('div');
    div.className = 'chat-msg';
    const t = new Date(data.time);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    div.innerHTML = `<span style="color:#666;font-size:0.5rem">${hh}:${mm}</span> `
        + `<b style="color:${escapeHtml(data.color)}">${escapeHtml(data.name)}</b>`
        + `<span style="color:#ddd">: ${escapeHtml(data.msg)}</span>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    // 保留最新 60 則
    while (chatMessages.children.length > 60) chatMessages.removeChild(chatMessages.firstChild);
});

// 初始化星星背景
let stars = [];
for (let i = 0; i < 300; i++) {
    stars.push({
        x: Math.random() * 2000,
        y: Math.random() * 2000,
        r: Math.random() * 1.5,
        alpha: Math.random()
    });
}

// 繪製遊戲畫面
function drawGameState(state) {
    const myState = myId ? state.players[myId] : null;
    if (myState && myState.score > lastScore) {
        playSfx('eat');
        triggerScreenShake();
        if (myState.snake && myState.snake.length > 0) {
            spawnParticles(myState.snake[0].x, myState.snake[0].y);
        }
    }
    if (myState) lastScore = myState.score;

    const SERVER_GRID_SIZE = 100; // 對應後端的新尺寸

    let camX = 0;
    let camY = 0;
    if (myId && state.players[myId] && state.players[myId].state === 'PLAYING') {
        let mySnake = state.players[myId].snake[0];
        let targetX = mySnake.x * GRID_SIZE + GRID_SIZE / 2;
        let targetY = mySnake.y * GRID_SIZE + GRID_SIZE / 2;
        camX = canvas.width / 2 - targetX;
        camY = canvas.height / 2 - targetY;
    } else {
        camX = canvas.width / 2 - (SERVER_GRID_SIZE * GRID_SIZE) / 2;
        camY = canvas.height / 2 - (SERVER_GRID_SIZE * GRID_SIZE) / 2;
    }

    camX = Math.min(0, Math.max(canvas.width - SERVER_GRID_SIZE * GRID_SIZE, camX));
    camY = Math.min(0, Math.max(canvas.height - SERVER_GRID_SIZE * GRID_SIZE, camY));

    // 動態背景顏色變化
    let hue = 210 + Math.sin(Date.now() / 10000) * 10;
    ctx.fillStyle = `hsl(${hue}, 20%, 5%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(camX, camY);

    stars.forEach(star => {
        ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
        star.alpha += (Math.random() - 0.5) * 0.1;
        if(star.alpha > 1) star.alpha = 1;
        if(star.alpha < 0) star.alpha = 0;
    });

    // 更新和渲染粒子
    particles = particles.filter(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.1; // 重力
        p.life--;
        if (p.life > 0) {
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.life / 30;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
            return true;
        }
        return false;
    });
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, SERVER_GRID_SIZE * GRID_SIZE, SERVER_GRID_SIZE * GRID_SIZE);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for(let i = 0; i <= SERVER_GRID_SIZE; i++) {
        ctx.beginPath(); ctx.moveTo(i * GRID_SIZE, 0); ctx.lineTo(i * GRID_SIZE, SERVER_GRID_SIZE * GRID_SIZE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * GRID_SIZE); ctx.lineTo(SERVER_GRID_SIZE * GRID_SIZE, i * GRID_SIZE); ctx.stroke();
    }

    if(state.apples) {
        let now = Date.now();
        state.apples.forEach(apple => {
            let age = now - apple.t;
            let alpha = 1;
            if (age > 15000) {
                alpha = 0.3 + Math.abs(Math.sin(now / 150)) * 0.7;
            }
            ctx.globalAlpha = alpha;
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#ff2a2a';
            ctx.fillStyle = '#ff2a2a';
            ctx.fillRect(apple.x * GRID_SIZE + 2, apple.y * GRID_SIZE + 2, GRID_SIZE - 4, GRID_SIZE - 4);
            ctx.shadowBlur = 0;
        });
        ctx.globalAlpha = 1;
    }

    if(state.specialApple) {
        ctx.shadowBlur = 25;
        ctx.shadowColor = '#ffd700';
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(state.specialApple.x * GRID_SIZE, state.specialApple.y * GRID_SIZE, GRID_SIZE, GRID_SIZE);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(state.specialApple.x * GRID_SIZE + 5, state.specialApple.y * GRID_SIZE + 5, GRID_SIZE - 10, GRID_SIZE - 10);
        ctx.shadowBlur = 0;
    }

    if (state.goldApple) {
        let pulse = 0.4 + Math.abs(Math.sin(Date.now() / 220)) * 0.6;
        ctx.globalAlpha = pulse;
        ctx.shadowBlur = 28;
        ctx.shadowColor = '#ffd700';
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.arc(state.goldApple.x * GRID_SIZE + GRID_SIZE / 2, state.goldApple.y * GRID_SIZE + GRID_SIZE / 2, GRID_SIZE / 2 - 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('★', state.goldApple.x * GRID_SIZE + GRID_SIZE / 2, state.goldApple.y * GRID_SIZE + GRID_SIZE / 2 + 8);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
    }

    if (state.shrinkApple) {
        ctx.shadowBlur = 16;
        ctx.shadowColor = '#66ccff';
        ctx.fillStyle = '#66ccff';
        let x = state.shrinkApple.x * GRID_SIZE;
        let y = state.shrinkApple.y * GRID_SIZE;
        ctx.fillRect(x + 6, y + 4, GRID_SIZE - 12, GRID_SIZE - 10);
        ctx.fillRect(x + GRID_SIZE/2 - 4, y, 8, 8);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + GRID_SIZE/2 - 2, y + 6, 4, 10);
        ctx.fillRect(x + GRID_SIZE/2 - 6, y + 12, 12, 4);
        ctx.shadowBlur = 0;
    }

    if(state.speedApple) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#00ff88';
        ctx.fillStyle = '#00ff88';
        ctx.beginPath();
        ctx.moveTo(state.speedApple.x * GRID_SIZE + GRID_SIZE/2, state.speedApple.y * GRID_SIZE);
        ctx.lineTo(state.speedApple.x * GRID_SIZE + GRID_SIZE, state.speedApple.y * GRID_SIZE + GRID_SIZE);
        ctx.lineTo(state.speedApple.x * GRID_SIZE, state.speedApple.y * GRID_SIZE + GRID_SIZE);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    if(state.poisonApple) {
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#800080';
        ctx.fillStyle = '#800080';
        ctx.fillRect(state.poisonApple.x * GRID_SIZE + 2, state.poisonApple.y * GRID_SIZE + 2, GRID_SIZE - 4, GRID_SIZE - 4);
        ctx.shadowBlur = 0;
    }

    if(state.magnetApple) {
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#0088ff';
        ctx.fillStyle = '#0088ff';
        ctx.beginPath();
        ctx.arc(state.magnetApple.x * GRID_SIZE + GRID_SIZE/2, state.magnetApple.y * GRID_SIZE + GRID_SIZE/2, GRID_SIZE/2 - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    if(state.bombApple) {
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#555555';
        ctx.fillStyle = '#333333';
        ctx.beginPath();
        ctx.arc(state.bombApple.x * GRID_SIZE + GRID_SIZE/2, state.bombApple.y * GRID_SIZE + GRID_SIZE/2, GRID_SIZE/2 - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(state.bombApple.x * GRID_SIZE + GRID_SIZE/2 - 2, state.bombApple.y * GRID_SIZE, 4, 4);
        ctx.shadowBlur = 0;
    }

    if (state.mines) {
        let now = Date.now();
        state.mines.forEach(mine => {
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#ff0000';
            ctx.fillStyle = (Math.floor(now / 200) % 2 === 0) ? '#ff0000' : '#550000';
            ctx.beginPath();
            ctx.arc(mine.x * GRID_SIZE + GRID_SIZE/2, mine.y * GRID_SIZE + GRID_SIZE/2, GRID_SIZE/2 - 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        });
    }

    if (state.blackHoles) {
        let now = Date.now();
        state.blackHoles.forEach(bh => {
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#6a0dad';
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.arc(bh.x * GRID_SIZE + GRID_SIZE/2, bh.y * GRID_SIZE + GRID_SIZE/2, bh.r * GRID_SIZE, 0, Math.PI * 2);
            ctx.fill();
            ctx.save();
            ctx.translate(bh.x * GRID_SIZE + GRID_SIZE/2, bh.y * GRID_SIZE + GRID_SIZE/2);
            ctx.rotate(now / 500);
            ctx.strokeStyle = `rgba(138, 43, 226, ${0.5 + Math.sin(now/200)*0.5})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, bh.r * GRID_SIZE + 5, 0, Math.PI * 1.5);
            ctx.stroke();
            ctx.restore();
            ctx.shadowBlur = 0;
        });
    }

    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";

    for (let id in state.players) {
        let p = state.players[id];
        p.snake.forEach((segment, index) => {
            let color = p.color;
            if (p.isSuper) {
                color = `hsl(${Math.random() * 360}, 100%, 70%)`;
            }
            ctx.fillStyle = index === 0 ? '#FFFFFF' : color;
            ctx.shadowBlur = index === 0 || p.isSuper ? 15 : 5;
            ctx.shadowColor = color;
            // 添加身體波動動畫
            let wave = index > 0 ? Math.sin(Date.now() / 200 + index * 0.5) * 1 : 0;
            ctx.fillRect(segment.x * GRID_SIZE + 1 + wave, segment.y * GRID_SIZE + 1, GRID_SIZE - 2, GRID_SIZE - 2);
            if (index === 0) {
                ctx.shadowBlur = 0;
                ctx.fillStyle = '#ffffff';
                let ox = segment.x * GRID_SIZE;
                let oy = segment.y * GRID_SIZE;
                let eyes = [];
                if (p.dx === 1) {
                    eyes = [{ x: ox + GRID_SIZE - 6, y: oy + 6 }, { x: ox + GRID_SIZE - 6, y: oy + GRID_SIZE - 10 }];
                } else if (p.dx === -1) {
                    eyes = [{ x: ox + 6, y: oy + 6 }, { x: ox + 6, y: oy + GRID_SIZE - 10 }];
                } else if (p.dy === 1) {
                    eyes = [{ x: ox + 7, y: oy + GRID_SIZE - 6 }, { x: ox + GRID_SIZE - 7, y: oy + GRID_SIZE - 6 }];
                } else {
                    eyes = [{ x: ox + 7, y: oy + 7 }, { x: ox + GRID_SIZE - 7, y: oy + 7 }];
                }
                eyes.forEach(pos => {
                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, 2.3, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#000000';
                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, 1, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#ffffff';
                });
            }
            if (index === 0) {
                ctx.shadowBlur = 0;
                if (p.isKing) {
                    ctx.font = "16px sans-serif";
                    ctx.fillText("👑", segment.x * GRID_SIZE + GRID_SIZE/2, segment.y * GRID_SIZE - 5);
                    ctx.font = "bold 16px sans-serif";
                }
                ctx.fillStyle = p.isSuper ? '#ffd700' : p.color;
                ctx.fillText(p.name, segment.x * GRID_SIZE + GRID_SIZE / 2, segment.y * GRID_SIZE - (p.isKing ? 25 : 10));
            }
        });
        ctx.shadowBlur = 0;
    }

    ctx.restore();

    let now = Date.now();
    killFeedMessages = killFeedMessages.filter(m => now - m.time < 4000);
    killFeedMessages.forEach((msg, i) => {
        let alpha = Math.max(0, 1 - (now - msg.time) / 4000);
        ctx.fillStyle = msg.color;
        ctx.globalAlpha = alpha;
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(msg.msg, canvas.width - 15, 30 + i * 22);
    });
    ctx.globalAlpha = 1;

    if(myId && state.players[myId] && state.players[myId].state === 'PLAYING') {
        let mySnake = state.players[myId].snake[0];
        let myScreenX = mySnake.x * GRID_SIZE + GRID_SIZE / 2 + camX;
        let myScreenY = mySnake.y * GRID_SIZE + GRID_SIZE / 2 + camY;

        for (let id in state.players) {
            if (id === myId) continue;
            let other = state.players[id];
            if (other.state !== 'PLAYING') continue;

            let otherHead = other.snake[0];
            let targetX = otherHead.x * GRID_SIZE + GRID_SIZE / 2 + camX;
            let targetY = otherHead.y * GRID_SIZE + GRID_SIZE / 2 + camY;

            if (targetX < 0 || targetX > canvas.width || targetY < 0 || targetY > canvas.height) {
                let dx = targetX - myScreenX;
                let dy = targetY - myScreenY;
                let angle = Math.atan2(dy, dx);
                let dist = Math.min(canvas.width, canvas.height) / 2 - 25;
                let arrowX = canvas.width / 2 + Math.cos(angle) * dist;
                let arrowY = canvas.height / 2 + Math.sin(angle) * dist;
                ctx.save();
                ctx.translate(arrowX, arrowY);
                ctx.rotate(angle);
                ctx.fillStyle = other.color;
                ctx.shadowBlur = 10;
                ctx.shadowColor = other.color;
                ctx.beginPath();
                ctx.moveTo(10, 0);
                ctx.lineTo(-10, -8);
                ctx.lineTo(-10, 8);
                ctx.closePath();
                ctx.fill();
                ctx.rotate(-angle);
                ctx.fillStyle = '#fff';
                ctx.shadowBlur = 0;
                ctx.font = 'bold 12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(other.name, 0, 22);
                ctx.restore();
            }
        }
    }

    if (myId && state.players[myId] && state.players[myId].state === 'PLAYING') {
        const p = state.players[myId];
        const effects = [];
        if (p.superUntil    && p.superUntil    > now) effects.push({ icon: '⭐', label: '無敵', secs: Math.ceil((p.superUntil    - now) / 1000), color: '#ffd700' });
        if (p.speedUntil    && p.speedUntil    > now) effects.push({ icon: '💨', label: '加速', secs: Math.ceil((p.speedUntil    - now) / 1000), color: '#00ff88' });
        if (p.magnetUntil   && p.magnetUntil   > now) effects.push({ icon: '🧲', label: '磁鐵', secs: Math.ceil((p.magnetUntil   - now) / 1000), color: '#0088ff' });
        if (p.reversedUntil && p.reversedUntil > now) effects.push({ icon: '☠️', label: '中毒', secs: Math.ceil((p.reversedUntil - now) / 1000), color: '#cc44cc' });
        effects.forEach((ef, i) => {
            ctx.font = 'bold 13px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillStyle = ef.color;
            ctx.shadowBlur = 8;
            ctx.shadowColor = ef.color;
            ctx.fillText(`${ef.icon} ${ef.label} ${ef.secs}s`, 10, canvas.height - 12 - i * 20);
        });
        ctx.shadowBlur = 0;
    }
}

socket.on('gameState', (state) => {
    latestGameState = state;
    needsRender = true;
});

function renderLoop() {
    if (latestGameState) {
        drawGameState(latestGameState);
    }
    requestAnimationFrame(renderLoop);
}
renderLoop();
