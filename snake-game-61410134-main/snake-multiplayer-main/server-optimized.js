require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    pingInterval: 25000,
    pingTimeout: 5000,
    transports: ['websocket', 'polling']
});
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

// 設定 Session (在 Render 代理後方需要 trust proxy)
app.set('trust proxy', 1);
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false
}));

// 初始化 Passport
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => { done(null, user); });
passport.deserializeUser((user, done) => { done(null, user); });

// 設定 Google OAuth 策略
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback",
    proxy: true
  },
  function(accessToken, refreshToken, profile, cb) {
      return cb(null, {
          id: profile.id,
          name: profile.displayName,
          picture: profile.photos[0] ? profile.photos[0].value : null
      });
  }
));

// 登入相關路由
app.get('/auth/google', passport.authenticate('google', { scope: ['profile'] }));

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/' }),
  function(req, res) {
    req.session.save(() => {
        res.redirect('/');
    });
  }
);

// 讓前端可以取得目前登入者的資訊
app.get('/api/me', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ loggedIn: true, user: req.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// 讓 Express 讀取靜態檔案 (禁止快取，確保玩家拿到最新版)
app.use(express.static(__dirname, {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
}));

let players = {};
let apples = [];
const chatCooldowns = {};
const dirCooldowns = {};
const NUM_APPLES = 15;
const GRID_SIZE = 100;
const MAX_PLAYERS = 10;

const APPLE_LIFETIME = 20000;
const SPECIAL_LIFETIME = 12000;

// 優化：統一管理特殊水果
let specialFruits = {
    specialApple: { chance: 0.3, interval: 15000, lifetime: SPECIAL_LIFETIME },
    goldApple: { chance: 0.5, interval: 22000, lifetime: SPECIAL_LIFETIME },
    shrinkApple: { chance: 0.45, interval: 25000, lifetime: SPECIAL_LIFETIME },
    speedApple: { chance: 0.5, interval: 20000, lifetime: SPECIAL_LIFETIME },
    magnetApple: { chance: 0.5, interval: 18000, lifetime: SPECIAL_LIFETIME },
    poisonApple: { chance: 0.5, interval: 25000, lifetime: SPECIAL_LIFETIME },
    bombApple: { chance: 0.5, interval: 30000, lifetime: SPECIAL_LIFETIME }
};

let specialFruitStates = {};
Object.keys(specialFruits).forEach(key => {
    specialFruitStates[key] = null;
});

function spawnApple() {
    let newApple = {};
    const MAX_ATTEMPTS = 200;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        newApple = { x: Math.floor(Math.random() * GRID_SIZE), y: Math.floor(Math.random() * GRID_SIZE), t: Date.now() };
        let valid = true;
        for (let id in players) {
            for (let segment of players[id].snake) {
                if (segment.x === newApple.x && segment.y === newApple.y) { valid = false; break; }
            }
            if (!valid) break;
        }
        if (valid) {
            for (let a of apples) {
                if (a.x === newApple.x && a.y === newApple.y) { valid = false; break; }
            }
        }
        if (valid) return newApple;
    }
    return newApple;
}

for(let i=0; i<NUM_APPLES; i++) apples.push(spawnApple());

// 統一管理特殊水果生成
setInterval(() => {
    if (Object.keys(players).length === 0) return;
    
    for (let [fruitName, config] of Object.entries(specialFruits)) {
        if (!specialFruitStates[fruitName] && Math.random() < config.chance) {
            specialFruitStates[fruitName] = { ...spawnApple() };
        }
    }
}, 5000);

let mines = [];
let blackHoles = [];
setInterval(() => {
    if (Object.keys(players).length > 0 && Math.random() < 0.3 && blackHoles.length < 2) {
        blackHoles.push({ ...spawnApple(), r: Math.random() * 2 + 2, t: Date.now() });
    }
}, 40000);

io.on('connection', (socket) => {
    console.log('連線建立:', socket.id);

    socket.on('joinGame', (userData) => {
        if (Object.keys(players).length >= MAX_PLAYERS) {
            socket.emit('serverMessage', `房間已滿 (最多 ${MAX_PLAYERS} 人)！請稍後再試。`);
            return;
        }

        let playerName = (userData && userData.name ? String(userData.name).trim().slice(0, 20) : '') || 'Guest';

        players[socket.id] = {
            id: socket.id,
            name: playerName,
            snake: [{x: Math.floor(Math.random()*80)+10, y: Math.floor(Math.random()*80)+10}],
            dx: 0, dy: -1,
            color: getRandomColor(),
            score: 0,
            state: 'PLAYING',
            applesEaten: 0,
            speedAccumulator: 0,
            dirBuffer: [],
            speedUntil: 0,
            superUntil: 0,
            magnetUntil: 0,
            reversedUntil: 0
        };
        players[socket.id].snake.push({x: players[socket.id].snake[0].x, y: players[socket.id].snake[0].y + 1});
        players[socket.id].snake.push({x: players[socket.id].snake[0].x, y: players[socket.id].snake[0].y + 2});

        socket.emit('joined');
        io.emit('updateScoreboard', getScoreboard());
    });

    socket.on('direction', (dir) => {
        let p = players[socket.id];
        if(!p || p.state !== 'PLAYING') return;
        const now = Date.now();
        if (dirCooldowns[socket.id] && now - dirCooldowns[socket.id] < 50) return;
        dirCooldowns[socket.id] = now;
        const validValues = [-1, 0, 1];
        if (!validValues.includes(dir.dx) || !validValues.includes(dir.dy)) return;
        if (dir.dx !== 0 && dir.dy !== 0) return;
        if (dir.dx === 0 && dir.dy === 0) return;
        let last = p.dirBuffer[p.dirBuffer.length - 1];
        if (!last || last.dx !== dir.dx || last.dy !== dir.dy) {
            p.dirBuffer.push(dir);
            if (p.dirBuffer.length > 3) p.dirBuffer.shift();
        }
    });

    socket.on('dash', (isDashing) => {
        let p = players[socket.id];
        if (p && p.state === 'PLAYING') p.isDashing = isDashing;
    });

    socket.on('chat', (msg) => {
        if (!msg || typeof msg !== 'string') return;
        msg = msg.trim().slice(0, 60);
        if (!msg) return;
        const now = Date.now();
        if (chatCooldowns[socket.id] && now - chatCooldowns[socket.id] < 1500) return;
        chatCooldowns[socket.id] = now;
        const name = players[socket.id] ? players[socket.id].name : '觀戰者';
        const color = players[socket.id] ? players[socket.id].color : '#aaaaaa';
        io.emit('chatMessage', { name, msg, color, time: now });
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        delete chatCooldowns[socket.id];
        delete dirCooldowns[socket.id];
        io.emit('updateScoreboard', getScoreboard());
    });
});

function getScoreboard() {
    let scores = [];
    for (let id in players) {
        scores.push({
            id: id,
            name: players[id].name,
            score: players[id].score,
            color: players[id].color,
            len: players[id].snake.length,
            isSuper: players[id].isSuper || false
        });
    }
    return scores.sort((a,b) => b.score - a.score);
}

function getRandomColor() {
    return `hsl(${Math.floor(Math.random() * 360)}, 100%, 60%)`;
}

let tickCount = 0;
setInterval(() => {
    tickCount++;
    let now = Date.now();
    let scoreboardChanged = false;

    // 果實過期檢查
    for (let i = apples.length - 1; i >= 0; i--) {
        if (now - apples[i].t > APPLE_LIFETIME) {
            apples.splice(i, 1);
            apples.push(spawnApple());
        }
    }
    
    // 檢查特殊水果過期
    for (let [fruitName, state] of Object.entries(specialFruitStates)) {
        if (state && now - state.t > SPECIAL_LIFETIME) {
            specialFruitStates[fruitName] = null;
        }
    }

    mines = mines.filter(m => now - m.t < 15000);
    blackHoles = blackHoles.filter(b => now - b.t < 20000);

    // 移動蛇與吃蘋果判定
    for (let id in players) {
        let p = players[id];
        if (p.state !== 'PLAYING') continue;

        const speedFactor = 0.5 * (1 + Math.floor(p.applesEaten / 5) * 0.05);
        let isFast = (p.isDashing && p.snake.length > 5) || (p.speedUntil && p.speedUntil > now);
        if (p.isDashing && p.snake.length <= 5) p.isDashing = false;

        p.speedAccumulator += speedFactor;
        if (isFast) p.speedAccumulator += 0.6;
        if (!isFast && p.speedAccumulator < 1) continue;
        p.speedAccumulator -= 1;

        if (p.isDashing && tickCount % 4 === 0) {
            let tail = p.snake.pop();
            if (apples.length < 100) apples.push({x: tail.x, y: tail.y, t: Date.now()});
            p.score = Math.max(0, p.score - 5);
            scoreboardChanged = true;
        }

        // 磁鐵效果
        if (p.magnetUntil && p.magnetUntil > now) {
            let head = p.snake[0];
            apples.forEach(a => {
                if (Math.abs(a.x - head.x) < 6 && Math.abs(a.y - head.y) < 6) {
                    if (a.x < head.x) a.x++; else if (a.x > head.x) a.x--;
                    if (a.y < head.y) a.y++; else if (a.y > head.y) a.y--;
                }
            });
        }

        // 處理方向佇列
        while (p.dirBuffer.length > 0) {
            let candidate = p.dirBuffer[0];
            let finalDir = { dx: candidate.dx, dy: candidate.dy };
            if (p.reversedUntil && p.reversedUntil > now) {
                finalDir.dx = -finalDir.dx;
                finalDir.dy = -finalDir.dy;
            }
            let neck = p.snake.length > 1 ? p.snake[1] : null;
            let futureHead = { x: p.snake[0].x + finalDir.dx, y: p.snake[0].y + finalDir.dy };
            if (!neck || futureHead.x !== neck.x || futureHead.y !== neck.y) {
                p.dx = finalDir.dx;
                p.dy = finalDir.dy;
                p.dirBuffer.shift();
                break;
            }
            p.dirBuffer.shift();
        }
        let head = { x: p.snake[0].x + p.dx, y: p.snake[0].y + p.dy };

        // 黑洞引力與死亡判定
        let inBlackHole = false;
        for (let bh of blackHoles) {
            let dist = Math.sqrt(Math.pow(head.x - bh.x, 2) + Math.pow(head.y - bh.y, 2));
            if (dist < bh.r) inBlackHole = true;
            if (dist < bh.r + 6 && tickCount % 2 === 0) {
                if (head.x < bh.x) p.dx = 1; else if (head.x > bh.x) p.dx = -1;
                if (head.y < bh.y) p.dy = 1; else if (head.y > bh.y) p.dy = -1;
            }
        }

        if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE || inBlackHole) {
            p.state = 'DEAD';
            io.to(id).emit('gameOver', p.score);
            continue;
        }

        p.snake.unshift(head);

        // 吃一般蘋果
        let ateIndex = apples.findIndex(a => head.x === a.x && head.y === a.y);
        if (ateIndex !== -1) {
            p.score += 10;
            p.applesEaten += 1;
            scoreboardChanged = true;
            apples.splice(ateIndex, 1);
            apples.push(spawnApple());
        } else {
            // 檢查特殊水果
            let ateFruit = false;
            
            if (specialFruitStates.goldApple && head.x === specialFruitStates.goldApple.x && head.y === specialFruitStates.goldApple.y) {
                p.score += 30;
                p.applesEaten += 1;
                specialFruitStates.goldApple = null;
                scoreboardChanged = true;
                io.emit('killFeed', { msg: `✨ ${p.name} 吃到金蘋果，獲得三倍分數！`, color: '#ffdd55' });
                ateFruit = true;
            } else if (specialFruitStates.shrinkApple && head.x === specialFruitStates.shrinkApple.x && head.y === specialFruitStates.shrinkApple.y) {
                let removeCount = Math.min(3, Math.max(0, p.snake.length - 4));
                for (let j = 0; j < removeCount; j++) p.snake.pop();
                p.score += 5;
                specialFruitStates.shrinkApple = null;
                scoreboardChanged = true;
                io.emit('killFeed', { msg: `🧪 ${p.name} 吃到縮蛇藥水，蛇身縮短！`, color: '#66ccff' });
                ateFruit = true;
            } else if (specialFruitStates.specialApple && head.x === specialFruitStates.specialApple.x && head.y === specialFruitStates.specialApple.y) {
                p.score += 50; 
                p.superUntil = now + 10000; 
                specialFruitStates.specialApple = null; 
                scoreboardChanged = true;
                io.emit('killFeed', { msg: `⭐ ${p.name} 獲得無敵狀態！`, color: '#ffd700' });
                ateFruit = true;
            } else if (specialFruitStates.speedApple && head.x === specialFruitStates.speedApple.x && head.y === specialFruitStates.speedApple.y) {
                p.score += 30; 
                p.speedUntil = now + 8000; 
                specialFruitStates.speedApple = null; 
                scoreboardChanged = true;
                io.emit('killFeed', { msg: `💨 ${p.name} 獲得加速狀態！`, color: '#00ff88' });
                ateFruit = true;
            } else if (specialFruitStates.poisonApple && head.x === specialFruitStates.poisonApple.x && head.y === specialFruitStates.poisonApple.y) {
                p.reversedUntil = now + 5000; 
                specialFruitStates.poisonApple = null;
                io.emit('killFeed', { msg: `☠️ ${p.name} 中毒了 (方向反轉)！`, color: '#800080' });
                ateFruit = true;
            } else if (specialFruitStates.magnetApple && head.x === specialFruitStates.magnetApple.x && head.y === specialFruitStates.magnetApple.y) {
                p.score += 20; 
                p.magnetUntil = now + 10000; 
                specialFruitStates.magnetApple = null; 
                scoreboardChanged = true;
                io.emit('killFeed', { msg: `🧲 ${p.name} 獲得磁鐵能力！`, color: '#0088ff' });
                ateFruit = true;
            } else if (specialFruitStates.bombApple && head.x === specialFruitStates.bombApple.x && head.y === specialFruitStates.bombApple.y) {
                let tail = p.snake[p.snake.length - 1];
                mines.push({ x: tail.x, y: tail.y, t: Date.now(), owner: p.name });
                specialFruitStates.bombApple = null;
                io.emit('killFeed', { msg: `💣 ${p.name} 排出了地雷！`, color: '#555555' });
                ateFruit = true;
            }
            
            if (!ateFruit) {
                p.snake.pop();
            }
        }
    }

    // 蛇撞蛇判定 (複雜吃人機制)
    let deaths = new Set();
    let eats = {};

    for (let id1 in players) {
        let p1 = players[id1];
        if(p1.state !== 'PLAYING') continue;
        let head = p1.snake[0];
        let p1Super = p1.superUntil && p1.superUntil > now;

        // 觸雷判定
        for(let i=0; i<mines.length; i++) {
            if(head.x === mines[i].x && head.y === mines[i].y) {
                deaths.add(id1);
                io.emit('killFeed', { msg: `💥 ${p1.name} 踩到了地雷！`, color: '#ff0000' });
            }
        }

        for (let id2 in players) {
            let p2 = players[id2];
            if(p2.state !== 'PLAYING') continue;

            if (id1 === id2) {
                for(let i=1; i<p1.snake.length; i++) {
                    if(head.x === p1.snake[i].x && head.y === p1.snake[i].y) deaths.add(id1);
                }
                continue;
            }

            let p2Super = p2.superUntil && p2.superUntil > now;

            for(let i=0; i<p2.snake.length; i++) {
                if(head.x === p2.snake[i].x && head.y === p2.snake[i].y) {
                    if (i === 0) {
                        if (id1 < id2) {
                            if (p1Super && !p2Super) {
                                deaths.add(id2); eats[id1] = (eats[id1]||0) + Math.floor(p2.score/2) + 50;
                            } else if (!p1Super && p2Super) {
                                deaths.add(id1); eats[id2] = (eats[id2]||0) + Math.floor(p1.score/2) + 50;
                            } else {
                                if (p1.snake.length > p2.snake.length) {
                                    deaths.add(id2); eats[id1] = (eats[id1]||0) + Math.floor(p2.score/2) + 50;
                                } else if (p2.snake.length > p1.snake.length) {
                                    deaths.add(id1); eats[id2] = (eats[id2]||0) + Math.floor(p1.score/2) + 50;
                                } else {
                                    deaths.add(id1); deaths.add(id2);
                                }
                            }
                        }
                    } else {
                        if (p1Super) {
                            deaths.add(id2); eats[id1] = (eats[id1]||0) + Math.floor(p2.score/2) + 50;
                        } else {
                            deaths.add(id1);
                        }
                    }
                }
            }
        }
    }

    // 結算死亡與吃人獎勵
    for (let id in eats) {
        if (!deaths.has(id) && players[id]) {
            players[id].score += eats[id];
            for(let k=0; k<3; k++) players[id].snake.push({...players[id].snake[players[id].snake.length-1]});
            scoreboardChanged = true;
        }
    }

    // 死亡掉落果實
    for (let id of deaths) {
        if (players[id]) {
            let deadSnake = players[id].snake;
            for (let i = 0; i < deadSnake.length; i += 3) {
                if (apples.length < 80) {
                    apples.push({ x: deadSnake[i].x, y: deadSnake[i].y, t: Date.now() });
                }
            }
        }
    }

    for (let id of deaths) {
        if (players[id]) {
            let killerName = null;
            for (let eid in eats) {
                if (!deaths.has(eid) && players[eid]) killerName = players[eid].name;
            }
            if (killerName) {
                io.emit('killFeed', { msg: `🐍 ${killerName} 吞噬了 ${players[id].name}！`, color: '#ff4444' });
            }
            players[id].state = 'DEAD';
            io.to(id).emit('gameOver', players[id].score);
        }
    }

    for (let id in players) {
        if(players[id].state === 'DEAD') {
            delete players[id];
            scoreboardChanged = true;
        }
    }

    // 標記 isSuper 給前端特效使用
    let highestScore = -1;
    let kingId = null;
    for (let id in players) {
        players[id].isSuper = players[id].superUntil && players[id].superUntil > now;
        players[id].isKing = false;
        if (players[id].score > highestScore && players[id].snake.length > 3) {
            highestScore = players[id].score;
            kingId = id;
        }
    }
    if (kingId) players[kingId].isKing = true;

    if(scoreboardChanged) {
        io.emit('updateScoreboard', getScoreboard());
    }

    // 優化：只發送必要的信息
    io.emit('gameState', { 
        players, 
        apples, 
        specialApple: specialFruitStates.specialApple,
        goldApple: specialFruitStates.goldApple,
        shrinkApple: specialFruitStates.shrinkApple,
        speedApple: specialFruitStates.speedApple,
        poisonApple: specialFruitStates.poisonApple,
        magnetApple: specialFruitStates.magnetApple,
        bombApple: specialFruitStates.bombApple,
        mines, 
        blackHoles 
    });

}, 60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`伺服器已啟動於 http://localhost:${PORT}`);
});
