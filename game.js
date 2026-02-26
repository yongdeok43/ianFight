(() => {
  "use strict";

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySubtitle = document.getElementById("overlay-subtitle");
  const startBtn = document.getElementById("start-btn");

  const WORLD_WIDTH = canvas.width;
  const WORLD_HEIGHT = canvas.height;
  const FIXED_DT = 1 / 60;
  const ITEM_DROP_CHANCE = 0.14;
  const ITEM_TTL_MIN = 10;
  const ITEM_TTL_MAX = 14;
  const SPEED_BONUS_PER_LEVEL = 12;
  const WEAPON_DAMAGE_BONUS_PER_LEVEL = 6;
  const WEAPON_INTERVAL_STEP = 0.012;
  const WEAPON_INTERVAL_FLOOR = 0.12;

  const keys = new Set();
  let mouseX = WORLD_WIDTH * 0.5;
  let mouseY = WORLD_HEIGHT * 0.5;
  let mouseDown = false;

  const state = {
    mode: "start",
    score: 0,
    wave: 0,
    waveCooldown: 0,
    enemySpawnPlan: 0,
    player: null,
    enemies: [],
    projectiles: [],
    enemyProjectiles: [],
    drops: [],
    explosions: [],
    blastParticles: [],
    smokeParticles: [],
    launchFlashes: [],
    killPops: [],
    contactDamageCooldown: 0,
    hitFlash: 0,
    hudPulseTime: 0,
    pendingBossWave: false,
    rngSeed: 1337,
    rngState: 1337,
    nextEnemyId: 1,
    nextDropId: 1,
  };

  const ENEMY_ARCHETYPE_BASE = {
    rusher: { radius: 10, canShoot: false, fireInterval: 0, scoreValue: 8 },
    shooter: { radius: 12, canShoot: true, fireInterval: 1.55, scoreValue: 10 },
    tank: { radius: 16, canShoot: false, fireInterval: 0, scoreValue: 16 },
    sniper: { radius: 11, canShoot: true, fireInterval: 2.05, scoreValue: 14 },
    splitter: { radius: 13, canShoot: false, fireInterval: 0, scoreValue: 12 },
    mini_rusher: { radius: 7, canShoot: false, fireInterval: 0, scoreValue: 3 },
    boss: { radius: 26, canShoot: true, fireInterval: 1.05, scoreValue: 120 },
  };

  function createPlayer() {
    return {
      x: WORLD_WIDTH * 0.5,
      y: WORLD_HEIGHT * 0.5,
      vx: 0,
      vy: 0,
      radius: 14,
      hp: 100,
      maxHp: 100,
      moveSpeed: 240,
      missileSpeed: 260,
      missileDamage: 52,
      missileBlastRadius: 70,
      missileLockRange: 210,
      missileTurnRate: 2.1,
      shootCooldown: 0,
      shootInterval: 0.24,
      baseMoveSpeed: 240,
      baseMissileDamage: 52,
      baseShootInterval: 0.24,
      speedLevel: 0,
      weaponLevel: 0,
      weaponMode: "homing",
      angle: 0,
    };
  }

  function applyRunUpgrades(player) {
    player.moveSpeed = player.baseMoveSpeed + player.speedLevel * SPEED_BONUS_PER_LEVEL;
    player.missileDamage = player.baseMissileDamage + player.weaponLevel * WEAPON_DAMAGE_BONUS_PER_LEVEL;
    player.shootInterval = Math.max(
      WEAPON_INTERVAL_FLOOR,
      player.baseShootInterval - player.weaponLevel * WEAPON_INTERVAL_STEP
    );
  }

  function resetRun() {
    state.mode = "playing";
    state.score = 0;
    state.wave = 0;
    state.waveCooldown = 0;
    state.enemySpawnPlan = 0;
    state.player = createPlayer();
    state.enemies = [];
    state.projectiles = [];
    state.enemyProjectiles = [];
    state.drops = [];
    state.explosions = [];
    state.blastParticles = [];
    state.smokeParticles = [];
    state.launchFlashes = [];
    state.killPops = [];
    state.contactDamageCooldown = 0;
    state.hitFlash = 0;
    state.hudPulseTime = 0;
    state.pendingBossWave = false;
    state.rngState = state.rngSeed;
    state.nextEnemyId = 1;
    state.nextDropId = 1;
    applyRunUpgrades(state.player);
    beginNextWave();
    setOverlay(false);
  }

  function beginNextWave() {
    state.wave += 1;
    state.waveCooldown = 1.2;
    state.pendingBossWave = state.wave % 5 === 0;
    state.enemySpawnPlan = state.pendingBossWave ? 1 : 4 + Math.floor(state.wave * 1.5);
  }

  function setOverlay(visible, title, subtitle, btnText) {
    if (visible) {
      overlay.classList.remove("hidden");
      if (title !== undefined) overlayTitle.textContent = title;
      if (subtitle !== undefined) overlaySubtitle.textContent = subtitle;
      if (btnText !== undefined) startBtn.textContent = btnText;
    } else {
      overlay.classList.add("hidden");
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function length(x, y) {
    return Math.hypot(x, y);
  }

  function roundRect(x, y, w, h, r) {
    const radius = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function normalize(x, y) {
    const len = length(x, y);
    if (len < 0.0001) return { x: 0, y: 0 };
    return { x: x / len, y: y / len };
  }

  function circleHit(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const rr = a.radius + b.radius;
    return dx * dx + dy * dy <= rr * rr;
  }

  function random() {
    state.rngState = (1664525 * state.rngState + 1013904223) >>> 0;
    return state.rngState / 4294967296;
  }

  function randomSpawnOutside() {
    const margin = 50;
    const side = Math.floor(random() * 4);
    if (side === 0) return { x: -margin, y: random() * WORLD_HEIGHT };
    if (side === 1) return { x: WORLD_WIDTH + margin, y: random() * WORLD_HEIGHT };
    if (side === 2) return { x: random() * WORLD_WIDTH, y: -margin };
    return { x: random() * WORLD_WIDTH, y: WORLD_HEIGHT + margin };
  }

  function pickEnemyTypeForWave() {
    const w = state.wave;
    const weights = [
      { type: "rusher", weight: Math.max(0.2, 0.46 - w * 0.015) },
      { type: "shooter", weight: 0.26 + Math.min(0.06, w * 0.004) },
      { type: "tank", weight: 0.12 + Math.min(0.14, w * 0.01) },
      { type: "sniper", weight: w >= 2 ? 0.08 + Math.min(0.1, (w - 2) * 0.012) : 0 },
      { type: "splitter", weight: w >= 3 ? 0.08 + Math.min(0.12, (w - 3) * 0.01) : 0 },
    ];

    let total = 0;
    for (const entry of weights) total += entry.weight;
    let roll = random() * total;
    for (const entry of weights) {
      roll -= entry.weight;
      if (roll <= 0) return entry.type;
    }
    return "rusher";
  }

  function createEnemy(type, x, y, subtype) {
    const mini = subtype === "mini";
    const selected = mini ? ENEMY_ARCHETYPE_BASE.mini_rusher : ENEMY_ARCHETYPE_BASE[type];
    const maxHp = mini
      ? 10 + state.wave * 1.4
      : type === "rusher"
        ? 20 + state.wave * 3
        : type === "shooter"
          ? 38 + state.wave * 6
          : type === "tank"
            ? 92 + state.wave * 11
            : type === "sniper"
              ? 34 + state.wave * 5.3
              : type === "splitter"
                ? 52 + state.wave * 7.5
                : 420 + state.wave * 35;
    const touchDamage = mini
      ? 5 + Math.floor(state.wave * 0.7)
      : type === "rusher"
        ? 9 + Math.floor(state.wave * 1)
        : type === "shooter"
          ? 8 + Math.floor(state.wave * 0.8)
          : type === "tank"
            ? 17 + Math.floor(state.wave * 1.25)
            : type === "sniper"
              ? 10 + Math.floor(state.wave * 0.9)
              : type === "splitter"
                ? 11 + Math.floor(state.wave * 1)
                : 22 + Math.floor(state.wave * 1.2);
    const speedBase = mini
      ? 212 + Math.min(120, state.wave * 6)
      : type === "rusher"
        ? 158 + Math.min(150, state.wave * 7)
        : type === "shooter"
          ? 92 + Math.min(120, state.wave * 5)
          : type === "tank"
            ? 56 + Math.min(80, state.wave * 2.3)
            : type === "sniper"
              ? 80 + Math.min(95, state.wave * 3.7)
              : type === "splitter"
                ? 112 + Math.min(120, state.wave * 4.8)
                : 70 + Math.min(70, state.wave * 1.8);
    const fireInterval = mini
      ? selected.fireInterval
      : type === "shooter"
        ? Math.max(0.65, ENEMY_ARCHETYPE_BASE.shooter.fireInterval - state.wave * 0.03)
        : type === "sniper"
          ? Math.max(1.05, ENEMY_ARCHETYPE_BASE.sniper.fireInterval - state.wave * 0.02)
          : type === "boss"
            ? Math.max(0.58, ENEMY_ARCHETYPE_BASE.boss.fireInterval - state.wave * 0.01)
          : selected.fireInterval;
    return {
      id: state.nextEnemyId++,
      x,
      y,
      vx: 0,
      vy: 0,
      type,
      subtype: subtype || "base",
      radius: selected.radius,
      hp: maxHp,
      maxHp,
      touchDamage,
      speed: speedBase + random() * 14,
      strafeSign: random() < 0.5 ? -1 : 1,
      canShoot: selected.canShoot,
      fireCooldown: 0.8 + random() * 1.3,
      fireInterval,
      scoreValue: selected.scoreValue,
    };
  }

  function spawnEnemy() {
    const p = randomSpawnOutside();
    const type = pickEnemyTypeForWave();
    state.enemies.push(createEnemy(type, p.x, p.y));
  }

  function spawnBoss() {
    const p = randomSpawnOutside();
    state.enemies.push(createEnemy("boss", p.x, p.y));
  }

  function spawnPlayerProjectile() {
    const p = state.player;
    const dir = normalize(mouseX - p.x, mouseY - p.y);
    if (dir.x === 0 && dir.y === 0) return;
    const isNova = p.weaponMode === "nova";

    state.projectiles.push({
      x: p.x + dir.x * (p.radius + 8),
      y: p.y + dir.y * (p.radius + 8),
      prevX: p.x + dir.x * (p.radius + 8),
      prevY: p.y + dir.y * (p.radius + 8),
      vx: dir.x * (isNova ? p.missileSpeed * 1.14 : p.missileSpeed),
      vy: dir.y * (isNova ? p.missileSpeed * 1.14 : p.missileSpeed),
      radius: isNova ? 12 : 10,
      angle: Math.atan2(dir.y, dir.x),
      thrustPhase: random() * Math.PI * 2,
      smokeTick: 0,
      damage: isNova ? Math.round(p.missileDamage * 0.92) : p.missileDamage,
      blastRadius: isNova ? Math.round(p.missileBlastRadius * 0.8) : p.missileBlastRadius,
      ttl: isNova ? 1.35 : 1.7,
      lockRange: isNova ? 0 : p.missileLockRange,
      turnRate: isNova ? 0 : p.missileTurnRate,
      targetEnemyId: null,
      mode: p.weaponMode,
    });

    state.launchFlashes.push({
      x: p.x + dir.x * (p.radius + 16),
      y: p.y + dir.y * (p.radius + 16),
      angle: Math.atan2(dir.y, dir.x),
      ttl: 0.1,
      maxTtl: 0.1,
      radius: 10,
      mode: p.weaponMode,
    });
  }

  function spawnSplitterChildren(enemy) {
    const splitCount = 2;
    const ring = enemy.radius + 10;
    for (let i = 0; i < splitCount; i += 1) {
      const angle = (Math.PI * 2 * i) / splitCount + random() * 0.55;
      const child = createEnemy("rusher", enemy.x + Math.cos(angle) * ring, enemy.y + Math.sin(angle) * ring, "mini");
      child.hp = Math.min(child.hp, child.maxHp);
      state.enemies.push(child);
    }
  }

  function trySpawnDrop(enemy) {
    if (random() > ITEM_DROP_CHANCE) return;
    const roll = random();
    const type = roll < 0.34 ? "speed" : roll < 0.62 ? "weapon" : roll < 0.84 ? "heal" : "weapon_mod";
    const ttl = ITEM_TTL_MIN + random() * (ITEM_TTL_MAX - ITEM_TTL_MIN);
    state.drops.push({
      id: state.nextDropId++,
      type,
      x: enemy.x,
      y: enemy.y,
      radius: 10,
      ttl,
      maxTtl: ttl,
      pulse: random() * Math.PI * 2,
    });
  }

  function applyDropPickup(drop) {
    const p = state.player;
    if (drop.type === "speed") {
      p.speedLevel += 1;
    } else if (drop.type === "weapon") {
      p.weaponLevel += 1;
    } else if (drop.type === "heal") {
      p.hp = Math.min(p.maxHp, p.hp + 28);
    } else if (drop.type === "weapon_mod") {
      p.weaponMode = p.weaponMode === "homing" ? "nova" : "homing";
      state.killPops.push({
        x: p.x,
        y: p.y - p.radius - 10,
        text: p.weaponMode === "nova" ? "MODE: NOVA" : "MODE: HOMING",
        ttl: 0.9,
        maxTtl: 0.9,
        vy: -26,
      });
    }
    applyRunUpgrades(p);
  }

  function removeEnemyAt(index) {
    const enemy = state.enemies[index];
    if (!enemy) return;
    state.score += enemy.scoreValue;
    state.killPops.push({
      x: enemy.x,
      y: enemy.y - enemy.radius,
      text: `+${enemy.scoreValue}`,
      ttl: 0.7,
      maxTtl: 0.7,
      vy: -32,
    });
    state.enemies.splice(index, 1);
    trySpawnDrop(enemy);
    if (enemy.type === "splitter" && enemy.subtype !== "mini") {
      spawnSplitterChildren(enemy);
    }
  }

  function triggerMissileExplosion(x, y, damage, blastRadius) {
    state.explosions.push({
      x,
      y,
      radius: blastRadius,
      ttl: 0.42,
      maxTtl: 0.42,
      ringCount: 2,
    });
    state.hitFlash = Math.max(state.hitFlash, 0.32);

    for (let i = 0; i < 18; i += 1) {
      const angle = random() * Math.PI * 2;
      const speed = 70 + random() * 180;
      state.blastParticles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 1.5 + random() * 2.8,
        ttl: 0.16 + random() * 0.2,
        maxTtl: 0.36,
      });
    }

    for (let j = state.enemies.length - 1; j >= 0; j -= 1) {
      const enemy = state.enemies[j];
      const dist = length(enemy.x - x, enemy.y - y);
      if (dist > blastRadius + enemy.radius) continue;

      const falloff = clamp(1 - dist / blastRadius, 0.35, 1);
      enemy.hp -= damage * falloff;
      if (enemy.hp <= 0) {
        removeEnemyAt(j);
      }
    }
  }

  function spawnEnemyProjectile(enemy) {
    const p = state.player;
    const dir = normalize(p.x - enemy.x, p.y - enemy.y);
    if (dir.x === 0 && dir.y === 0) return;
    const isSniper = enemy.type === "sniper";
    const isBoss = enemy.type === "boss";
    if (isBoss) {
      const baseAngle = Math.atan2(dir.y, dir.x);
      const spread = [-0.24, 0, 0.24];
      for (const offset of spread) {
        const angle = baseAngle + offset;
        const speed = 250 + Math.min(120, state.wave * 4);
        state.enemyProjectiles.push({
          x: enemy.x + Math.cos(angle) * (enemy.radius + 8),
          y: enemy.y + Math.sin(angle) * (enemy.radius + 8),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: 5,
          damage: 12 + Math.floor(state.wave * 0.9),
          ttl: 2.6,
          type: "boss",
        });
      }
      return;
    }
    const speed = isSniper ? 300 + Math.min(150, state.wave * 6) : 220 + Math.min(120, state.wave * 5);
    state.enemyProjectiles.push({
      x: enemy.x + dir.x * (enemy.radius + 6),
      y: enemy.y + dir.y * (enemy.radius + 6),
      vx: dir.x * speed,
      vy: dir.y * speed,
      radius: isSniper ? 3 : 4,
      damage: isSniper ? 18 + Math.floor(state.wave * 0.85) : 9 + Math.floor(state.wave * 0.7),
      ttl: isSniper ? 2.8 : 2.4,
      type: isSniper ? "sniper" : "normal",
    });
  }

  function updatePlayer(dt) {
    const p = state.player;
    let moveX = 0;
    let moveY = 0;

    if (keys.has("w") || keys.has("arrowup")) moveY -= 1;
    if (keys.has("s") || keys.has("arrowdown")) moveY += 1;
    if (keys.has("a") || keys.has("arrowleft")) moveX -= 1;
    if (keys.has("d") || keys.has("arrowright")) moveX += 1;

    const n = normalize(moveX, moveY);
    p.vx = n.x * p.moveSpeed;
    p.vy = n.y * p.moveSpeed;
    p.x = clamp(p.x + p.vx * dt, p.radius, WORLD_WIDTH - p.radius);
    p.y = clamp(p.y + p.vy * dt, p.radius, WORLD_HEIGHT - p.radius);

    p.angle = Math.atan2(mouseY - p.y, mouseX - p.x);
    p.shootCooldown = Math.max(0, p.shootCooldown - dt);

    if ((mouseDown || keys.has(" ")) && p.shootCooldown <= 0) {
      spawnPlayerProjectile();
      p.shootCooldown = p.shootInterval;
    }
  }

  function updateEnemies(dt) {
    const p = state.player;

    for (const enemy of state.enemies) {
      const toPlayer = normalize(p.x - enemy.x, p.y - enemy.y);
      const strafe = { x: -toPlayer.y * enemy.strafeSign, y: toPlayer.x * enemy.strafeSign };
      const distToPlayer = length(p.x - enemy.x, p.y - enemy.y);
      let move = { x: 0, y: 0 };
      if (enemy.type === "rusher") {
        move = normalize(toPlayer.x * 0.95 + strafe.x * 0.05, toPlayer.y * 0.95 + strafe.y * 0.05);
      } else if (enemy.type === "tank") {
        move = normalize(toPlayer.x * 0.995 + strafe.x * 0.005, toPlayer.y * 0.995 + strafe.y * 0.005);
      } else if (enemy.type === "shooter") {
        move = normalize(toPlayer.x * 0.72 + strafe.x * 0.28, toPlayer.y * 0.72 + strafe.y * 0.28);
      } else if (enemy.type === "sniper") {
        const preferredDist = 270;
        const retreatSign = distToPlayer < preferredDist ? -1 : distToPlayer > preferredDist + 55 ? 1 : 0;
        move = normalize(toPlayer.x * retreatSign * 0.66 + strafe.x * 0.34, toPlayer.y * retreatSign * 0.66 + strafe.y * 0.34);
      } else if (enemy.type === "splitter") {
        move = normalize(toPlayer.x * 0.83 + strafe.x * 0.17, toPlayer.y * 0.83 + strafe.y * 0.17);
      } else if (enemy.type === "boss") {
        const preferredDist = 170;
        const approachSign = distToPlayer < preferredDist - 20 ? -1 : distToPlayer > preferredDist + 20 ? 1 : 0;
        move = normalize(toPlayer.x * approachSign * 0.72 + strafe.x * 0.28, toPlayer.y * approachSign * 0.72 + strafe.y * 0.28);
      }
      enemy.vx = move.x * enemy.speed;
      enemy.vy = move.y * enemy.speed;
      enemy.x += enemy.vx * dt;
      enemy.y += enemy.vy * dt;

      enemy.fireCooldown -= dt;
      if (enemy.canShoot && enemy.fireCooldown <= 0) {
        spawnEnemyProjectile(enemy);
        enemy.fireCooldown = enemy.fireInterval + random() * 0.4;
      }
    }

    if (state.contactDamageCooldown > 0) {
      state.contactDamageCooldown -= dt;
    }

    if (state.contactDamageCooldown <= 0) {
      for (const enemy of state.enemies) {
        if (circleHit(enemy, p)) {
          p.hp -= enemy.touchDamage;
          state.contactDamageCooldown = 0.35;
          break;
        }
      }
    }
  }

  function findHomingTarget(shot) {
    let best = null;
    let bestDistSq = shot.lockRange * shot.lockRange;
    for (const enemy of state.enemies) {
      const dx = enemy.x - shot.x;
      const dy = enemy.y - shot.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestDistSq) {
        best = enemy;
        bestDistSq = distSq;
      }
    }
    return best;
  }

  function rotateToward(currentX, currentY, targetX, targetY, maxTurnRadians) {
    const curAngle = Math.atan2(currentY, currentX);
    const targetAngle = Math.atan2(targetY, targetX);
    let delta = targetAngle - curAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const clampedDelta = clamp(delta, -maxTurnRadians, maxTurnRadians);
    const nextAngle = curAngle + clampedDelta;
    const speed = length(currentX, currentY);
    return {
      x: Math.cos(nextAngle) * speed,
      y: Math.sin(nextAngle) * speed,
    };
  }

  function updateProjectiles(dt) {
    for (let i = state.projectiles.length - 1; i >= 0; i -= 1) {
      const shot = state.projectiles[i];
      const target = shot.lockRange > 0 ? findHomingTarget(shot) : null;
      shot.targetEnemyId = target ? target.id : null;
      if (target) {
        const aim = normalize(target.x - shot.x, target.y - shot.y);
        const rotated = rotateToward(shot.vx, shot.vy, aim.x, aim.y, shot.turnRate * dt);
        shot.vx = rotated.x;
        shot.vy = rotated.y;
      }
      shot.prevX = shot.x;
      shot.prevY = shot.y;
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.ttl -= dt;
      shot.angle = Math.atan2(shot.vy, shot.vx);
      shot.thrustPhase += dt * 24;
      shot.smokeTick += dt;
      if (shot.smokeTick >= 0.028) {
        shot.smokeTick = 0;
        state.smokeParticles.push({
          x: shot.x - Math.cos(shot.angle) * 10,
          y: shot.y - Math.sin(shot.angle) * 10,
          vx: -Math.cos(shot.angle) * 35 + (random() - 0.5) * 18,
          vy: -Math.sin(shot.angle) * 35 + (random() - 0.5) * 18,
          radius: 2 + random() * 3,
          ttl: 0.34 + random() * 0.2,
          maxTtl: 0.54,
        });
      }

      if (
        shot.ttl <= 0 ||
        shot.x < -20 ||
        shot.y < -20 ||
        shot.x > WORLD_WIDTH + 20 ||
        shot.y > WORLD_HEIGHT + 20
      ) {
        if (shot.ttl <= 0) {
          triggerMissileExplosion(shot.x, shot.y, shot.damage, shot.blastRadius);
        }
        state.projectiles.splice(i, 1);
        continue;
      }

      let hit = false;
      for (let j = state.enemies.length - 1; j >= 0; j -= 1) {
        const enemy = state.enemies[j];
        if (circleHit(shot, enemy)) {
          triggerMissileExplosion(shot.x, shot.y, shot.damage, shot.blastRadius);
          hit = true;
          break;
        }
      }

      if (hit) {
        state.projectiles.splice(i, 1);
      }
    }

    const p = state.player;
    for (let i = state.enemyProjectiles.length - 1; i >= 0; i -= 1) {
      const shot = state.enemyProjectiles[i];
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.ttl -= dt;

      if (
        shot.ttl <= 0 ||
        shot.x < -20 ||
        shot.y < -20 ||
        shot.x > WORLD_WIDTH + 20 ||
        shot.y > WORLD_HEIGHT + 20
      ) {
        state.enemyProjectiles.splice(i, 1);
        continue;
      }

      if (circleHit(shot, p)) {
        p.hp -= shot.damage;
        state.enemyProjectiles.splice(i, 1);
      }
    }

    for (let i = state.explosions.length - 1; i >= 0; i -= 1) {
      state.explosions[i].ttl -= dt;
      if (state.explosions[i].ttl <= 0) {
        state.explosions.splice(i, 1);
      }
    }

    for (let i = state.blastParticles.length - 1; i >= 0; i -= 1) {
      const spark = state.blastParticles[i];
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.vx *= 0.92;
      spark.vy *= 0.92;
      spark.ttl -= dt;
      if (spark.ttl <= 0) {
        state.blastParticles.splice(i, 1);
      }
    }

    for (let i = state.smokeParticles.length - 1; i >= 0; i -= 1) {
      const puff = state.smokeParticles[i];
      puff.x += puff.vx * dt;
      puff.y += puff.vy * dt;
      puff.vx *= 0.94;
      puff.vy *= 0.94;
      puff.ttl -= dt;
      if (puff.ttl <= 0) {
        state.smokeParticles.splice(i, 1);
      }
    }

    for (let i = state.launchFlashes.length - 1; i >= 0; i -= 1) {
      const flash = state.launchFlashes[i];
      flash.ttl -= dt;
      if (flash.ttl <= 0) {
        state.launchFlashes.splice(i, 1);
      }
    }

    for (let i = state.killPops.length - 1; i >= 0; i -= 1) {
      const pop = state.killPops[i];
      pop.y += pop.vy * dt;
      pop.ttl -= dt;
      if (pop.ttl <= 0) {
        state.killPops.splice(i, 1);
      }
    }
  }

  function updateDrops(dt) {
    const p = state.player;
    for (let i = state.drops.length - 1; i >= 0; i -= 1) {
      const drop = state.drops[i];
      drop.ttl -= dt;
      drop.pulse += dt * 4.4;
      if (drop.ttl <= 0) {
        state.drops.splice(i, 1);
        continue;
      }
      if (circleHit(drop, p)) {
        applyDropPickup(drop);
        state.drops.splice(i, 1);
      }
    }
  }

  function updateWave(dt) {
    if (state.waveCooldown > 0) {
      state.waveCooldown -= dt;
      if (state.waveCooldown <= 0) {
        if (state.pendingBossWave) {
          spawnBoss();
          state.pendingBossWave = false;
        } else {
          for (let i = 0; i < state.enemySpawnPlan; i += 1) {
            spawnEnemy();
          }
        }
      }
      return;
    }

    if (state.enemies.length === 0 && state.enemyProjectiles.length === 0) {
      beginNextWave();
    }
  }

  function update(dt) {
    if (state.mode !== "playing") return;

    state.hudPulseTime += dt;
    updatePlayer(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    updateDrops(dt);
    updateWave(dt);

    if (state.hitFlash > 0) state.hitFlash = Math.max(0, state.hitFlash - dt * 1.9);

    if (state.player.hp <= 0) {
      state.mode = "gameover";
      state.player.hp = 0;
      setOverlay(true, "Defeated", `Final score: ${state.score} • Reached wave ${state.wave}`, "Restart");
    }
  }

  function drawArenaBackground() {
    const grad = ctx.createLinearGradient(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    grad.addColorStop(0, "#0f1d3d");
    grad.addColorStop(0.55, "#1a2f5d");
    grad.addColorStop(1, "#18284f");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    const blobs = [
      { x: 130, y: 120, r: 180, color: "rgba(44, 248, 255, 0.18)" },
      { x: WORLD_WIDTH - 160, y: 88, r: 210, color: "rgba(166, 98, 255, 0.18)" },
      { x: WORLD_WIDTH * 0.52, y: WORLD_HEIGHT - 90, r: 250, color: "rgba(30, 224, 194, 0.16)" },
    ];
    for (const blob of blobs) {
      const radial = ctx.createRadialGradient(blob.x, blob.y, 5, blob.x, blob.y, blob.r);
      radial.addColorStop(0, blob.color);
      radial.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = radial;
      ctx.beginPath();
      ctx.arc(blob.x, blob.y, blob.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < 5; i += 1) {
      const y = 80 + i * 95;
      const band = ctx.createLinearGradient(0, y - 24, WORLD_WIDTH, y + 24);
      band.addColorStop(0, "rgba(255,255,255,0)");
      band.addColorStop(0.2, "rgba(98,248,255,0.2)");
      band.addColorStop(0.8, "rgba(188,114,255,0.14)");
      band.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = band;
      ctx.fillRect(0, y - 22, WORLD_WIDTH, 44);
    }

    for (let i = 0; i < 28; i += 1) {
      const angle = (i / 28) * Math.PI * 2;
      const cx = WORLD_WIDTH * 0.5 + Math.cos(angle) * 265;
      const cy = WORLD_HEIGHT * 0.5 + Math.sin(angle) * 160;
      ctx.strokeStyle = "rgba(80, 236, 255, 0.25)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, angle - 0.8, angle + 0.8);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(199, 110, 255, 0.3)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.5, 180, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(90, 230, 255, 0.24)";
    ctx.lineWidth = 1;
    const cell = 48;
    for (let x = 0; x <= WORLD_WIDTH; x += cell) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += cell) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD_WIDTH, y);
      ctx.stroke();
    }

    for (let y = 8; y < WORLD_HEIGHT; y += 10) {
      for (let x = 6; x < WORLD_WIDTH; x += 10) {
        const n = (Math.sin(x * 0.13 + y * 0.07) + Math.cos(x * 0.11 - y * 0.09)) * 0.5;
        const a = 0.01 + (n + 1) * 0.007;
        ctx.fillStyle = `rgba(150, 255, 255, ${a})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    ctx.strokeStyle = "rgba(84, 228, 255, 0.72)";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, WORLD_WIDTH - 4, WORLD_HEIGHT - 4);
  }

  function drawHud() {
    const p = state.player;
    const hpRatio = p.hp / p.maxHp;
    const cardX = 12;
    const cardY = 12;
    const cardW = 356;
    const cardH = 114;
    const lowHpPulse = hpRatio < 0.35 ? (Math.sin(state.hudPulseTime * 10) * 0.5 + 0.5) : 0;

    ctx.save();
    ctx.shadowColor = "rgba(4, 20, 40, 0.5)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 5;
    const hudBg = ctx.createLinearGradient(cardX, cardY, cardX, cardY + cardH);
    hudBg.addColorStop(0, "rgba(12, 25, 52, 0.9)");
    hudBg.addColorStop(1, "rgba(24, 42, 80, 0.9)");
    ctx.fillStyle = hudBg;
    roundRect(cardX, cardY, cardW, cardH, 14);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(96, 236, 255, 0.85)";
    ctx.lineWidth = 2;
    roundRect(cardX, cardY, cardW, cardH, 14);
    ctx.stroke();

    ctx.fillStyle = "#86f2ff";
    ctx.font = "700 14px Trebuchet MS";
    ctx.fillText("COMBAT STATUS", cardX + 14, cardY + 22);

    ctx.fillStyle = "#f0f8ff";
    ctx.font = "bold 19px Trebuchet MS";
    ctx.fillText(`Wave ${state.wave}`, cardX + 14, cardY + 48);
    ctx.fillText(`Score ${state.score}`, cardX + 136, cardY + 48);

    const barX = cardX + 14;
    const barY = cardY + 58;
    const barW = 232;
    const barH = 22;
    ctx.fillStyle = "rgba(22, 44, 84, 0.95)";
    roundRect(barX, barY, barW, barH, 8);
    ctx.fill();

    const hpColor = hpRatio > 0.35 ? "#1ff5c2" : `rgba(255, 82, 129, ${0.84 + lowHpPulse * 0.16})`;
    ctx.fillStyle = hpColor;
    roundRect(barX, barY, barW * hpRatio, barH, 8);
    ctx.fill();

    if (hpRatio < 0.35) {
      ctx.strokeStyle = `rgba(255, 96, 150, ${0.48 + lowHpPulse * 0.45})`;
      ctx.lineWidth = 2 + lowHpPulse * 2;
      roundRect(barX - 2, barY - 2, barW + 4, barH + 4, 10);
      ctx.stroke();
    }

    ctx.fillStyle = "#d9ebff";
    ctx.font = "bold 14px Trebuchet MS";
    ctx.fillText(`HP ${Math.ceil(p.hp)} / ${p.maxHp}`, cardX + 258, cardY + 74);
    ctx.fillStyle = "#9bf5ff";
    ctx.font = "bold 13px Trebuchet MS";
    ctx.fillText(
      `SPD Lv${p.speedLevel} (${Math.round(p.moveSpeed)})  WPN Lv${p.weaponLevel} (${p.missileDamage} dmg / ${(1 / p.shootInterval).toFixed(1)} rps)`,
      cardX + 14,
      cardY + 102
    );
    ctx.fillStyle = p.weaponMode === "nova" ? "#ff79e8" : "#8ef8ff";
    ctx.font = "bold 12px Trebuchet MS";
    ctx.fillText(`WEAPON MODE: ${p.weaponMode === "nova" ? "NOVA BURST" : "HOMING MISSILE"}`, cardX + 14, cardY + 118);

    const boss = state.enemies.find((enemy) => enemy.type === "boss");
    if (boss) {
      const bx = WORLD_WIDTH * 0.5 - 220;
      const by = 12;
      const bw = 440;
      const bh = 18;
      const ratio = clamp(boss.hp / boss.maxHp, 0, 1);
      ctx.fillStyle = "rgba(27, 18, 56, 0.92)";
      roundRect(bx, by, bw, bh, 8);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 85, 188, 0.95)";
      roundRect(bx, by, bw * ratio, bh, 8);
      ctx.fill();
      ctx.strokeStyle = "rgba(114, 255, 247, 0.86)";
      ctx.lineWidth = 2;
      roundRect(bx, by, bw, bh, 8);
      ctx.stroke();
      ctx.fillStyle = "#f6e7ff";
      ctx.font = "bold 13px Trebuchet MS";
      ctx.textAlign = "center";
      ctx.fillText(`BOSS WAVE ${state.wave}`, WORLD_WIDTH * 0.5, by - 4);
      ctx.textAlign = "left";
    }

    if (state.waveCooldown > 0) {
      ctx.fillStyle = "#8ef8ff";
      ctx.font = "bold 16px Trebuchet MS";
      ctx.fillText("Incoming wave...", 20, 124);
    }
  }

  function drawPlayer() {
    const p = state.player;
    ctx.fillStyle = "rgba(18, 41, 58, 0.24)";
    ctx.beginPath();
    ctx.ellipse(p.x + 3, p.y + p.radius + 7, p.radius * 0.95, p.radius * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.strokeStyle = "#9df9ff";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(7, 35, 54, 0.28)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;

    ctx.fillStyle = "#19b4ff";
    ctx.beginPath();
    ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#1f2f5d";
    ctx.fillRect(0, -5, p.radius + 12, 10);
    ctx.strokeStyle = "#81efff";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(0, -5, p.radius + 12, 10);
    ctx.fillStyle = p.weaponMode === "nova" ? "#ff7fe9" : "#32ffd4";
    ctx.fillRect(p.radius + 8, -3, 6, 6);

    ctx.fillStyle = "#e9f7ff";
    ctx.beginPath();
    ctx.arc(-4, -4, 3, 0, Math.PI * 2);
    ctx.arc(-4, 4, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawEnemies() {
    for (const e of state.enemies) {
      ctx.fillStyle = "rgba(18, 42, 55, 0.24)";
      ctx.beginPath();
      ctx.ellipse(e.x + 2, e.y + e.radius + 6, e.radius * 0.92, e.radius * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();

      if (e.type === "rusher") {
        if (e.subtype === "mini") {
          ctx.fillStyle = "#c7ff57";
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#f3ffd1";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.strokeStyle = "#5e8e20";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(e.x - e.radius * 0.7, e.y);
          ctx.lineTo(e.x + e.radius * 0.7, e.y);
          ctx.stroke();
        } else {
          ctx.fillStyle = "#ff4fb6";
          ctx.beginPath();
          ctx.moveTo(e.x + e.radius + 2, e.y);
          ctx.lineTo(e.x - e.radius, e.y - e.radius);
          ctx.lineTo(e.x - e.radius, e.y + e.radius);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "#ffd3f4";
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
      } else if (e.type === "tank") {
        ctx.fillStyle = "#20d6c7";
        ctx.fillRect(e.x - e.radius, e.y - e.radius, e.radius * 2, e.radius * 2);
        ctx.strokeStyle = "#bbfff8";
        ctx.lineWidth = 1.8;
        ctx.strokeRect(e.x - e.radius, e.y - e.radius, e.radius * 2, e.radius * 2);
        ctx.fillStyle = "#8cfff1";
        ctx.fillRect(e.x - e.radius * 0.45, e.y - 3, e.radius * 0.9, 6);
      } else if (e.type === "sniper") {
        ctx.fillStyle = "#a869ff";
        ctx.beginPath();
        ctx.moveTo(e.x, e.y - e.radius - 2);
        ctx.lineTo(e.x + e.radius + 1, e.y);
        ctx.lineTo(e.x, e.y + e.radius + 2);
        ctx.lineTo(e.x - e.radius - 1, e.y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#f3e5ff";
        ctx.lineWidth = 1.7;
        ctx.stroke();
        ctx.fillStyle = "#dbc6ff";
        ctx.fillRect(e.x - 2, e.y - e.radius - 6, 4, e.radius + 4);
      } else if (e.type === "splitter") {
        ctx.fillStyle = "#24f0a8";
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#dbffef";
        ctx.lineWidth = 1.7;
        ctx.stroke();
        ctx.strokeStyle = "#dbffef";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x - e.radius * 0.35, e.y, e.radius * 0.48, -Math.PI * 0.45, Math.PI * 0.45);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(e.x + e.radius * 0.35, e.y, e.radius * 0.48, Math.PI * 0.55, Math.PI * 1.45);
        ctx.stroke();
      } else if (e.type === "boss") {
        ctx.fillStyle = "#ff4ccf";
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#b8fff6";
        ctx.lineWidth = 2.6;
        ctx.stroke();
        ctx.fillStyle = "#8ffff0";
        ctx.beginPath();
        ctx.arc(e.x - e.radius * 0.35, e.y - 2, 5, 0, Math.PI * 2);
        ctx.arc(e.x + e.radius * 0.35, e.y - 2, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#8ffff0";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.x - e.radius * 0.4, e.y + e.radius * 0.36);
        ctx.lineTo(e.x + e.radius * 0.4, e.y + e.radius * 0.36);
        ctx.stroke();
      } else {
        ctx.fillStyle = "#4dd2ff";
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#d6f6ff";
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(e.x - 14, e.y - e.radius - 12, 28, 4);
      const hpRatio = clamp(e.hp / e.maxHp, 0, 1);
      ctx.fillStyle = "#ff5d9f";
      ctx.fillRect(e.x - 14, e.y - e.radius - 12, 28 * hpRatio, 4);
    }
  }

  function drawProjectiles() {
    for (const spark of state.blastParticles) {
      const alpha = clamp(spark.ttl / spark.maxTtl, 0, 1);
      ctx.fillStyle = `rgba(120, 255, 255, ${alpha * 0.95})`;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const puff of state.smokeParticles) {
      const alpha = clamp(puff.ttl / puff.maxTtl, 0, 1) * 0.45;
      ctx.fillStyle = `rgba(122, 88, 162, ${alpha})`;
      ctx.beginPath();
      ctx.arc(puff.x, puff.y, puff.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const flash of state.launchFlashes) {
      const t = 1 - flash.ttl / flash.maxTtl;
      const alpha = (1 - t) * 0.85;
      const radius = flash.radius * (0.65 + t * 1.4);
      ctx.save();
      ctx.translate(flash.x, flash.y);
      ctx.rotate(flash.angle);
      ctx.fillStyle = flash.mode === "nova" ? `rgba(255, 128, 232, ${alpha})` : `rgba(116, 255, 245, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(radius, 0);
      ctx.lineTo(-radius * 0.3, -radius * 0.35);
      ctx.lineTo(-radius * 0.5, 0);
      ctx.lineTo(-radius * 0.3, radius * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    for (const shot of state.projectiles) {
      const nova = shot.mode === "nova";
      ctx.strokeStyle = nova ? "rgba(255, 133, 232, 0.95)" : "rgba(124, 255, 247, 0.95)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(shot.prevX, shot.prevY);
      ctx.lineTo(shot.x, shot.y);
      ctx.stroke();

      ctx.strokeStyle = nova ? "rgba(119, 215, 255, 0.75)" : "rgba(255, 86, 201, 0.7)";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(shot.prevX, shot.prevY);
      ctx.lineTo(shot.x, shot.y);
      ctx.stroke();

      const flameLength = 8 + (Math.sin(shot.thrustPhase) * 0.5 + 0.5) * 8;
      ctx.save();
      ctx.translate(shot.x, shot.y);
      ctx.rotate(shot.angle);

      ctx.fillStyle = nova ? "rgba(255, 141, 235, 0.88)" : "rgba(116, 255, 245, 0.82)";
      ctx.beginPath();
      ctx.moveTo(-shot.radius - flameLength, 0);
      ctx.lineTo(-shot.radius - 2, -3);
      ctx.lineTo(-shot.radius - 2, 3);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = nova ? "#ffe3fb" : "#d6e1ff";
      ctx.fillRect(-shot.radius, -3.8, shot.radius * 1.9, 7.6);

      ctx.fillStyle = nova ? "#8d5fb8" : "#5e67aa";
      ctx.fillRect(-shot.radius - 2, -2.4, 3.2, 4.8);
      ctx.fillRect(-2, -6, 5, 2.4);
      ctx.fillRect(-2, 3.6, 5, 2.4);

      ctx.fillStyle = nova ? "#72d6ff" : "#ff57bf";
      ctx.beginPath();
      ctx.moveTo(shot.radius * 1.9, 0);
      ctx.lineTo(shot.radius * 1.35, -4.1);
      ctx.lineTo(shot.radius * 1.35, 4.1);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = nova ? "#ffd5f6" : "#b2fdff";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-shot.radius, -3.8, shot.radius * 1.9, 7.6);
      ctx.restore();
    }

    for (const boom of state.explosions) {
      const t = 1 - boom.ttl / boom.maxTtl;
      const ringRadius = boom.radius * (0.18 + t * 0.82);
      ctx.fillStyle = `rgba(255, 79, 196, ${0.42 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(boom.x, boom.y, ringRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(127, 255, 248, ${0.65 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(boom.x, boom.y, ringRadius * 0.36, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(171, 255, 251, ${0.95 * (1 - t)})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(boom.x, boom.y, ringRadius * 0.8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255, 111, 219, ${0.85 * (1 - t)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(boom.x, boom.y, ringRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const shot of state.enemyProjectiles) {
      ctx.fillStyle = shot.type === "sniper" ? "#b56bff" : "#ff4fa0";
      ctx.beginPath();
      ctx.arc(shot.x, shot.y, shot.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawDrops() {
    for (const drop of state.drops) {
      const ttlRatio = clamp(drop.ttl / drop.maxTtl, 0, 1);
      const pulse = Math.sin(drop.pulse) * 0.5 + 0.5;
      const radius = drop.radius + pulse * 2.5;
      const auraColor =
        drop.type === "speed"
          ? "120, 255, 214"
          : drop.type === "weapon"
            ? "255, 110, 226"
            : drop.type === "heal"
              ? "122, 255, 122"
              : "120, 186, 255";
      const aura = ctx.createRadialGradient(drop.x, drop.y, 2, drop.x, drop.y, radius * 2.2);
      aura.addColorStop(0, `rgba(${auraColor}, ${0.35 * ttlRatio})`);
      aura.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(drop.x, drop.y, radius * 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle =
        drop.type === "speed" ? "#37ffd0" : drop.type === "weapon" ? "#ff72e6" : drop.type === "heal" ? "#74ff7a" : "#70b7ff";
      ctx.strokeStyle = "#d9f9ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(drop.x, drop.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (drop.type === "speed") {
        ctx.strokeStyle = "#063f36";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(drop.x - 4, drop.y + 3);
        ctx.lineTo(drop.x + 1, drop.y - 2);
        ctx.lineTo(drop.x - 1, drop.y - 2);
        ctx.lineTo(drop.x + 4, drop.y - 7);
        ctx.stroke();
      } else if (drop.type === "weapon") {
        ctx.fillStyle = "#4f1448";
        ctx.fillRect(drop.x - 4, drop.y - 1.5, 8, 3);
        ctx.fillRect(drop.x - 1.5, drop.y - 4, 3, 8);
      } else if (drop.type === "heal") {
        ctx.fillStyle = "#115220";
        ctx.fillRect(drop.x - 4.2, drop.y - 1.5, 8.4, 3);
        ctx.fillRect(drop.x - 1.5, drop.y - 4.2, 3, 8.4);
      } else {
        ctx.strokeStyle = "#14325f";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(drop.x - 4, drop.y - 4);
        ctx.lineTo(drop.x + 4, drop.y + 4);
        ctx.moveTo(drop.x + 4, drop.y - 4);
        ctx.lineTo(drop.x - 4, drop.y + 4);
        ctx.stroke();
      }
    }
  }

  function drawKillPops() {
    for (const pop of state.killPops) {
      const alpha = clamp(pop.ttl / pop.maxTtl, 0, 1);
      ctx.fillStyle = `rgba(133, 255, 245, ${alpha})`;
      ctx.strokeStyle = `rgba(32, 16, 60, ${alpha * 0.9})`;
      ctx.lineWidth = 3;
      ctx.font = "bold 15px Trebuchet MS";
      ctx.strokeText(pop.text, pop.x, pop.y);
      ctx.fillText(pop.text, pop.x, pop.y);
    }
  }

  function drawCrosshair() {
    if (state.mode !== "playing") return;
    const r = 10;
    ctx.strokeStyle = "rgba(8, 14, 28, 0.92)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(mouseX, mouseY, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(112, 255, 248, 0.98)";
    ctx.shadowColor = "rgba(112, 255, 248, 0.85)";
    ctx.shadowBlur = 11;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(mouseX, mouseY, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 95, 216, 0.92)";
    ctx.shadowColor = "rgba(255, 95, 216, 0.55)";
    ctx.shadowBlur = 7;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(mouseX, mouseY, r + 3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(mouseX - 15, mouseY);
    ctx.lineTo(mouseX + 15, mouseY);
    ctx.moveTo(mouseX, mouseY - 15);
    ctx.lineTo(mouseX, mouseY + 15);
    ctx.strokeStyle = "rgba(8, 14, 28, 0.92)";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(mouseX - 15, mouseY);
    ctx.lineTo(mouseX + 15, mouseY);
    ctx.moveTo(mouseX, mouseY - 15);
    ctx.lineTo(mouseX, mouseY + 15);
    ctx.strokeStyle = "rgba(112, 255, 248, 0.98)";
    ctx.lineWidth = 2.4;
    ctx.shadowColor = "rgba(112, 255, 248, 0.82)";
    ctx.shadowBlur = 10;
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255, 95, 216, 0.95)";
    ctx.beginPath();
    ctx.arc(mouseX, mouseY, 2.7, 0, Math.PI * 2);
    ctx.fill();
  }

  function render() {
    drawArenaBackground();

    if (state.mode === "playing" || state.mode === "gameover") {
      drawProjectiles();
      drawDrops();
      drawEnemies();
      drawPlayer();
      drawKillPops();
      drawCrosshair();
    }
    if (state.mode === "playing" || state.mode === "gameover") drawHud();

    if (state.mode === "start") {
      ctx.fillStyle = "#a0f5ff";
      ctx.font = "bold 36px Trebuchet MS";
      ctx.textAlign = "center";
      ctx.fillText("Arena Solo Shooter", WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.45);
      ctx.font = "20px Trebuchet MS";
      ctx.fillText("Press Start to begin", WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.52);
      ctx.textAlign = "left";
    }

    if (state.hitFlash > 0) {
      ctx.fillStyle = `rgba(116, 244, 255, ${state.hitFlash * 0.22})`;
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    }
  }

  function step(ms) {
    let remaining = Math.max(0, ms);
    let guard = 0;
    while (remaining >= FIXED_DT * 1000 && guard < 6000) {
      update(FIXED_DT);
      remaining -= FIXED_DT * 1000;
      guard += 1;
    }
    render();
  }

  function renderGameToText() {
    const p = state.player;
    const enemiesById = new Map(state.enemies.map((enemy) => [enemy.id, enemy]));
    const payload = {
      coordinate_system: "origin=(0,0) top-left; +x right; +y down; units are canvas pixels",
      mode: state.mode,
      player: p
        ? {
            x: Number(p.x.toFixed(2)),
            y: Number(p.y.toFixed(2)),
            vx: Number(p.vx.toFixed(2)),
            vy: Number(p.vy.toFixed(2)),
            hp: Number(p.hp.toFixed(2)),
            max_hp: p.maxHp,
            shoot_cooldown: Number(p.shootCooldown.toFixed(3)),
            upgrades: {
              speed_level: p.speedLevel,
              weapon_level: p.weaponLevel,
              weapon_mode: p.weaponMode,
              move_speed: Number(p.moveSpeed.toFixed(2)),
              missile_damage: Number(p.missileDamage.toFixed(2)),
              shoot_interval: Number(p.shootInterval.toFixed(3)),
            },
          }
        : null,
      enemies: state.enemies.slice(0, 30).map((e) => ({
        id: e.id,
        type: e.type,
        subtype: e.subtype,
        x: Number(e.x.toFixed(2)),
        y: Number(e.y.toFixed(2)),
        vx: Number(e.vx.toFixed(2)),
        vy: Number(e.vy.toFixed(2)),
        hp: Number(e.hp.toFixed(2)),
      })),
      player_projectiles: state.projectiles.slice(0, 40).map((s) => ({
        kind: "missile",
        mode: s.mode || "homing",
        x: Number(s.x.toFixed(2)),
        y: Number(s.y.toFixed(2)),
        vx: Number(s.vx.toFixed(2)),
        vy: Number(s.vy.toFixed(2)),
        angle: Number(s.angle.toFixed(3)),
        blast_radius: Number(s.blastRadius.toFixed(2)),
        lock_range: Number(s.lockRange.toFixed(2)),
        homing_turn_rate: Number(s.turnRate.toFixed(2)),
        homing_active: Boolean(s.targetEnemyId),
        homing_target_id: s.targetEnemyId,
        homing_target_type: s.targetEnemyId && enemiesById.get(s.targetEnemyId) ? enemiesById.get(s.targetEnemyId).type : null,
        homing_target_subtype: s.targetEnemyId && enemiesById.get(s.targetEnemyId) ? enemiesById.get(s.targetEnemyId).subtype : null,
        ttl: Number(s.ttl.toFixed(2)),
      })),
      explosions: state.explosions.slice(0, 20).map((boom) => ({
        x: Number(boom.x.toFixed(2)),
        y: Number(boom.y.toFixed(2)),
        radius: Number(boom.radius.toFixed(2)),
        ttl: Number(boom.ttl.toFixed(2)),
      })),
      enemy_projectiles: state.enemyProjectiles.slice(0, 40).map((s) => ({
        type: s.type || "normal",
        x: Number(s.x.toFixed(2)),
        y: Number(s.y.toFixed(2)),
        vx: Number(s.vx.toFixed(2)),
        vy: Number(s.vy.toFixed(2)),
        ttl: Number(s.ttl.toFixed(2)),
      })),
      drops: state.drops.slice(0, 40).map((drop) => ({
        id: drop.id,
        type: drop.type,
        x: Number(drop.x.toFixed(2)),
        y: Number(drop.y.toFixed(2)),
        ttl: Number(drop.ttl.toFixed(2)),
      })),
      score: state.score,
      wave: state.wave,
      pending_boss_wave: state.pendingBossWave,
      wave_cooldown: Number(state.waveCooldown.toFixed(3)),
      contact_damage_cooldown: Number(Math.max(0, state.contactDamageCooldown).toFixed(3)),
      input: {
        keys: Array.from(keys).sort(),
        mouse: {
          x: Number(mouseX.toFixed(2)),
          y: Number(mouseY.toFixed(2)),
          down: mouseDown,
        },
        fullscreen: Boolean(document.fullscreenElement),
      },
      rng_state: state.rngState,
    };

    return JSON.stringify(payload);
  }

  function toCanvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const scaleX = WORLD_WIDTH / rect.width;
    const scaleY = WORLD_HEIGHT / rect.height;
    mouseX = clamp((clientX - rect.left) * scaleX, 0, WORLD_WIDTH);
    mouseY = clamp((clientY - rect.top) * scaleY, 0, WORLD_HEIGHT);
  }

  function clearInputState() {
    keys.clear();
    mouseDown = false;
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  document.addEventListener("mousemove", (event) => {
    toCanvasCoords(event.clientX, event.clientY);
  });

  document.addEventListener("mousedown", (event) => {
    if (event.button === 0) mouseDown = true;
  });

  document.addEventListener("mouseup", (event) => {
    if (event.button === 0) mouseDown = false;
  });

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      event.preventDefault();
    }

    keys.add(key);

    if (key === "f") {
      event.preventDefault();
      toggleFullscreen();
    }
  });

  document.addEventListener("keyup", (event) => {
    keys.delete(event.key.toLowerCase());
  });

  window.addEventListener("blur", clearInputState);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") clearInputState();
  });

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  startBtn.addEventListener("click", () => {
    resetRun();
  });

  document.addEventListener("fullscreenchange", () => {
    render();
  });

  let lastTime = performance.now();
  let frameAccumulator = 0;
  function frame(now) {
    const elapsed = clamp((now - lastTime) / 1000, 0, 0.05);
    lastTime = now;

    if (state.mode === "playing") {
      frameAccumulator += elapsed;
      let updates = 0;
      while (frameAccumulator >= FIXED_DT && updates < 8) {
        update(FIXED_DT);
        frameAccumulator -= FIXED_DT;
        updates += 1;
      }
      if (updates === 8) frameAccumulator = 0;
    }

    render();
    requestAnimationFrame(frame);
  }

  window.render_game_to_text = renderGameToText;
  window.advanceTime = (ms) => {
    step(ms);
  };

  setOverlay(true, "Arena Solo Shooter", "Single-player top-down wave survival.", "Start Game");
  state.player = createPlayer();
  render();
  requestAnimationFrame(frame);
})();
