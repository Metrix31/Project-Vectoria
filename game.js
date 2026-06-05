const WIDTH = 40;
const HEIGHT = 24;
const TILE_SIZE = 24;
const TOTAL_TILES = WIDTH * HEIGHT;

const OWNER_NONE = 0;
const OWNER_PLAYER = 1;
const OWNER_BOT = 2;
const OWNER_BOT2 = 3;
const OWNER_BOT3 = 4;
const BOT_OWNERS = [OWNER_BOT, OWNER_BOT2, OWNER_BOT3];

const MAX_STRENGTH = 25;
const TICK_MS = 200;
const BOT_ATTACK_COOLDOWN = 15;
const ATTACK_OVERLAY_MS = 500;
const FOG_RADIUS = 5;

const UNIT_TYPES = {
    infantry: { name: "Infanterie", offense: 12, defense: 14, icon: "NATO_INF" },
    tank: { name: "Panzer", offense: 32, defense: 10, icon: "NATO_ARMOR", penalty: ["mountain", "forest"] },
    artillery: { name: "Artillerie", offense: 26, defense: 6, icon: "NATO_ART", special: "fort_pierce" }
};

const TERRAIN = {
    plains: { name: "Ebene", defense: 0, offense: 0, color: "#4b5320", passable: true },
    forest: { name: "Wald", defense: 3, offense: -1, color: "#228b22", passable: true },
    hills: { name: "Huegel", defense: 2, offense: -2, color: "#8b4513", passable: true },
    mountain: { name: "Gebirge", defense: 6, offense: -5, color: "#708090", passable: true },
    water: { name: "Ozean", defense: 0, offense: 0, color: "#000080", passable: false }
};

const BUILDINGS = {
    barracks: { name: "Zivilfabrik" },
    factory: { name: "Mil-Fabrik" },
    fort: { name: "Befestigung" }
};

const ownerNames = {
    [OWNER_NONE]: "Entmilitarisiert",
    [OWNER_PLAYER]: "Deutsches Reich",
    [OWNER_BOT]: "Sowjetunion",
    [OWNER_BOT2]: "Vereinigtes Koenigreich",
    [OWNER_BOT3]: "USA"
};

const ownerColors = {
    [OWNER_NONE]: "#2a2a2a",
    [OWNER_PLAYER]: "#4682b4",
    [OWNER_BOT]: "#b22222",
    [OWNER_BOT2]: "#556b2f",
    [OWNER_BOT3]: "#c5b358"
};

const PROVINCE_NAMES = ["Brest", "Kiew", "Warschau", "Paris", "Berlin", "Rom", "Wien", "Prag", "Minsk", "Oslo", "Madrid", "London", "Stalingrad", "Moskau", "Zuerich", "Bern"];

const directions = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0]
};

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const minimap = document.getElementById("minimap");
const minimapCtx = minimap.getContext("2d");

canvas.width = WIDTH * TILE_SIZE;
canvas.height = HEIGHT * TILE_SIZE;
minimap.width = WIDTH * 3;
minimap.height = HEIGHT * 3;

// UI Elements
const scenarioSelect = document.getElementById("scenario");
const mapModeSelect = document.getElementById("map-mode");
const logDiv = document.getElementById("log");
const pauseButton = document.getElementById("btn-pause");
const tileInfo = document.getElementById("tile-panel");

let tick = 0;
let running = true;
let gameOver = false;
let accumulator = 0;
let lastFrame = performance.now();
let hoverTile = null;
let selectedTile = null;
let attackOverlay = null;
let provinces = [];
let dirtyTiles = new Set();
let borderCache = new Map();
let capitals = new Map();
let rngState = 1;

// HoI4 Stats
let politicalPower = 100;
let stability = 0.6;
let warSupport = 0.3;
let manpower = 5000;
let worldTension = 0;
let peaceUntilByOwner = new Map();

function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}

function seededRandom() {
    let t = rngState += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

function randInt(min, max) {
    return Math.floor(seededRandom() * (max - min + 1)) + min;
}

function initMap() {
    const scenario = scenarioSelect.value;
    rngState = hashString("vectoria-1936");

    provinces = [];
    capitals = new Map();
    borderCache = new Map();

    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            provinces.push(createProvince(x, y, scenario));
        }
    }

    applyScenario(scenario);

    tick = 0;
    politicalPower = 100;
    stability = 0.6;
    warSupport = 0.3;
    manpower = 5000;
    worldTension = 0;
    
    running = true;
    gameOver = false;
    selectedTile = null;
    hoverTile = null;
    clearLog();
    updateStrategicState();
    markAllDirty();
    log(`Zweiter Weltkrieg simuliert. Datum: 1. Jan 1936.`);
    afterAction(true);
}

function createProvince(x, y, scenario) {
    const terrain = generateTerrain(x, y, scenario);
    return {
        owner: OWNER_NONE,
        name: PROVINCE_NAMES[randInt(0, PROVINCE_NAMES.length - 1)] + "-" + randInt(10, 99),
        strength: terrain === "water" ? 0 : randInt(2, 5),
        org: 10,
        terrain,
        building: null,
        buildingLvl: 1,
        unitType: "infantry",
        cooldown: 0,
        supply: 0,
        connected: true,
        visible: false,
        discovered: false
    };
}

function generateTerrain(x, y, scenario) {
    if (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1) return "water";
    const roll = seededRandom();
    if (roll < 0.08) return "water";
    if (roll < 0.20) return "mountain";
    if (roll < 0.35) return "hills";
    if (roll < 0.50) return "forest";
    return "plains";
}

function applyScenario(scenario) {
    placeCountry(OWNER_PLAYER, 18, 10, 5, 5, 12, true);
    placeCountry(OWNER_BOT, 30, 5, 6, 6, 12, true);
    placeCountry(OWNER_BOT2, 5, 5, 4, 4, 10, true);
    placeCountry(OWNER_BOT3, 5, 15, 4, 4, 10, true);
}

function placeCountry(owner, startX, startY, width, height, strength, setCapital = false) {
    let capitalSet = false;
    for (let y = startY; y < startY + height; y++) {
        for (let x = startX; x < startX + width; x++) {
            if (!inBounds(x, y)) continue;
            const p = provinces[idx(x, y)];
            if (p.terrain === "water") continue;
            p.owner = owner;
            p.strength = strength;
            if (setCapital && !capitalSet) {
                capitals.set(owner, idx(x, y));
                p.building = "factory";
                capitalSet = true;
            }
        }
    }
}

function idx(x, y) { return y * WIDTH + x; }
function inBounds(x, y) { return x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT; }
function xy(index) { return { x: index % WIDTH, y: Math.floor(index / WIDTH) }; }

function log(msg) {
    const lines = logDiv.innerText.split("\n").filter(Boolean);
    lines.push(`> ${msg}`);
    logDiv.innerText = lines.slice(-10).join("\n");
    logDiv.scrollTop = logDiv.scrollHeight;
}

function clearLog() { logDiv.innerText = ""; }

function getIncome(owner) {
    const owned = provinces.filter(p => p.owner === owner);
    const civs = owned.filter(p => p.building === "barracks").length + 3;
    const mils = owned.filter(p => p.building === "factory").length + 2;
    return { civs, mils, tiles: owned.length };
}

function updateStats() {
    const p = getIncome(OWNER_PLAYER);
    const bTiles = BOT_OWNERS.reduce((s, o) => s + provinces.filter(pr => pr.owner === o).length, 0);

    document.getElementById("pp-val").textContent = Math.floor(politicalPower);
    document.getElementById("stability-val").textContent = Math.floor(stability * 100) + "%";
    document.getElementById("war-support-val").textContent = Math.floor(warSupport * 100) + "%";
    document.getElementById("manpower-val").textContent = (manpower / 1000).toFixed(1) + "k";
    document.getElementById("civ-factories-val").textContent = p.civs;
    document.getElementById("mil-factories-val").textContent = p.mils;
    document.getElementById("tension-val").textContent = Math.floor(worldTension * 100) + "%";
    
    const day = (tick % 30) + 1;
    const month = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"][Math.floor(tick / 30) % 12];
    const year = 1936 + Math.floor(tick / 360);
    document.getElementById("game-date").textContent = `${day}. ${month} ${year}`;

    document.getElementById("tiles").textContent = p.tiles;
    document.getElementById("bot-tiles").textContent = bTiles;
}

function updateStrategicState() {
    provinces.forEach(p => p.visible = false);
    provinces.forEach((p, i) => {
        if (p.owner === OWNER_PLAYER) revealAround(xy(i).x, xy(i).y);
    });
    invalidateBorderCache();
}

function revealAround(ox, oy) {
    for (let dy = -FOG_RADIUS; dy <= FOG_RADIUS; dy++) {
        for (let dx = -FOG_RADIUS; dx <= FOG_RADIUS; dx++) {
            const x = ox + dx, y = oy + dy;
            if (inBounds(x, y) && Math.abs(dx) + Math.abs(dy) <= FOG_RADIUS) provinces[idx(x, y)].visible = true;
        }
    }
}

function stepGame() {
    tick++;
    politicalPower += 0.2 + (stability * 0.1);
    if (manpower < 100000) manpower += 20 + Math.floor(warSupport * 50);

    if (tick % 5 === 0) reinforce(OWNER_PLAYER);
    if (tick % 6 === 0) BOT_OWNERS.forEach(reinforce);
    if (tick % 10 === 0) BOT_OWNERS.forEach(botStep);
    
    provinces.forEach(p => { if (p.org < 10) p.org = Math.min(10, p.org + 0.4); });
    if (tick % 50 === 0) worldTension = Math.max(0, worldTension - 0.002);

    afterAction();
}

function reinforce(owner) {
    const stats = getIncome(owner);
    let equipment = stats.mils * 2;
    const border = getBorderTiles(owner).sort((a, b) => a.province.strength - b.province.strength);
    if (border.length === 0) return;

    let cursor = 0;
    while (equipment > 0 && cursor < border.length) {
        const target = border[cursor];
        if (target.province.strength < MAX_STRENGTH) {
            if (owner === OWNER_PLAYER) {
                if (manpower < 50) break;
                manpower -= 50;
            }
            target.province.strength++;
            equipment--;
            markDirtyTile(target.x, target.y);
        }
        cursor++;
    }
}

function getOffensePower(p) {
    const u = UNIT_TYPES[p.unitType];
    const t = TERRAIN[p.terrain];
    let off = u.offense;
    
    // Tank penalty in rough terrain
    if (u.penalty && u.penalty.includes(p.terrain)) {
        off *= 0.4; // Slightly harsher penalty
    }
    
    // Base = (strength * 1.0) + unit_offense + terrain_mod
    return (p.strength * 1.2) + off + t.offense + randInt(-3, 3);
}

function getDefensePower(p, attackerUnitType = null) {
    const u = UNIT_TYPES[p.unitType];
    const t = TERRAIN[p.terrain];
    let fortBonus = p.building === "fort" ? 12 : 0;
    
    // Artillery pierces forts
    if (attackerUnitType && UNIT_TYPES[attackerUnitType].special === "fort_pierce") {
        fortBonus *= 0.4;
    }
    
    return (p.strength * 1.2) + u.defense + t.defense + fortBonus + randInt(-3, 3);
}

function getMaxStrength(p) { return MAX_STRENGTH; }

function resolveAttack(fx, fy, tx, ty, owner) {
    if (!inBounds(fx, fy) || !inBounds(tx, ty)) return false;
    const from = provinces[idx(fx, fy)], to = provinces[idx(tx, ty)];
    if (from.owner !== owner || to.owner === owner || from.org < 3) return false;

    const atk = getOffensePower(from) * (from.org / 10);
    const def = getDefensePower(to, from.unitType);

    if (owner === OWNER_PLAYER) worldTension = Math.min(1, worldTension + 0.005);

    if (atk > def) {
        to.owner = owner;
        to.strength = Math.max(2, Math.floor(from.strength / 2));
        to.org = 2;
        from.strength = Math.max(1, Math.floor(from.strength / 2));
        from.org = Math.max(0, from.org - 4);
        if (owner === OWNER_PLAYER) {
            log(`Provinz ${to.name} gesichert!`);
            worldTension = Math.min(1, worldTension + 0.01);
        }
        markDirtyWithNeighbors(fx, fy); markDirtyWithNeighbors(tx, ty);
        updateStrategicState();
        return true;
    }

    from.strength = Math.max(1, from.strength - 1);
    from.org = Math.max(0, from.org - 2);
    to.org = Math.max(0, to.org - 1);
    markDirtyWithNeighbors(fx, fy); markDirtyWithNeighbors(tx, ty);
    return false;
}

function botStep(owner) {
    const border = getBorderTiles(owner).filter(t => t.province.org > 5);
    if (border.length === 0) return;
    const start = border[randInt(0, border.length - 1)];
    const neighbors = getNeighbors(start.x, start.y).filter(n => n.owner !== owner && TERRAIN[n.terrain].passable);
    if (neighbors.length > 0) {
        const target = neighbors[0];
        resolveAttack(start.x, start.y, target.x, target.y, owner);
    }
}

function getNeighbors(x, y) {
    const n = [];
    if (x > 0) n.push({ x: x - 1, y, ...provinces[idx(x - 1, y)] });
    if (x < WIDTH - 1) n.push({ x: x + 1, y, ...provinces[idx(x + 1, y)] });
    if (y > 0) n.push({ x, y: y - 1, ...provinces[idx(x, y - 1)] });
    if (y < HEIGHT - 1) n.push({ x, y: y + 1, ...provinces[idx(x, y + 1)] });
    return n;
}

function getBorderTiles(owner) {
    if (borderCache.has(owner)) return borderCache.get(owner);
    const b = [];
    for (let i = 0; i < TOTAL_TILES; i++) {
        const p = provinces[i], t = xy(i);
        if (p.owner === owner && getNeighbors(t.x, t.y).some(n => n.owner !== owner)) b.push({ ...t, province: p });
    }
    borderCache.set(owner, b);
    return b;
}
function invalidateBorderCache() { borderCache.clear(); }

function render(full = false) {
    if (full || attackOverlay) {
        ctx.fillStyle = "#050a0e"; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < TOTAL_TILES; i++) { 
            const t = xy(i); 
            drawTile(t.x, t.y); 
        }
    } else {
        dirtyTiles.forEach(k => { 
            const [x, y] = k.split(":").map(Number); 
            drawTile(x, y); 
        });
    }
    dirtyTiles.clear();
    drawOverlays();
    drawMinimap();
}

function drawBuildingIcon(px, py, p) {
    if (!p.building) return;

    ctx.save();
    // Position at top right
    ctx.translate(px + TILE_SIZE - 12, py + 2);
    
    // Background plate for visibility
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(0, 0, 10, 10);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(0, 0, 10, 10);

    // Icon Color based on type
    if (p.building === "barracks") ctx.fillStyle = "#4682b4"; // Blue for Civ
    else if (p.building === "factory") ctx.fillStyle = "#b22222"; // Red for Mil
    else ctx.fillStyle = "#ffd700"; // Gold for Fort

    if (p.building === "barracks") {
        // Civ Factory icon
        ctx.fillRect(2, 6, 6, 2);
        ctx.fillRect(4, 2, 2, 6);
    } else if (p.building === "factory") {
        // Mil Factory icon
        ctx.beginPath();
        ctx.moveTo(2, 8); ctx.lineTo(4, 2); ctx.lineTo(6, 2); ctx.lineTo(8, 8);
        ctx.fill();
    } else if (p.building === "fort") {
        // Fort icon
        ctx.fillRect(2, 4, 6, 4);
        ctx.fillRect(2, 2, 2, 2);
        ctx.fillRect(6, 2, 2, 2);
    }
    ctx.restore();
}

function drawTile(x, y) {
    const p = provinces[idx(x, y)], px = x * TILE_SIZE, py = y * TILE_SIZE;
    if (!p.visible) {
        ctx.fillStyle = p.discovered ? "#1a1a1a" : "#000";
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        return;
    }
    ctx.fillStyle = TERRAIN[p.terrain].color;
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    
    if (p.owner !== OWNER_NONE) {
        ctx.fillStyle = ownerColors[p.owner];
        ctx.globalAlpha = 0.3;
        ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
        ctx.globalAlpha = 1.0;
        drawUnitIcon(px, py, p);
        drawBuildingIcon(px, py, p);
    }
    
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
}
function drawUnitIcon(px, py, p) {
    ctx.save();
    ctx.translate(px + 4, py + 6);
    ctx.fillStyle = ownerColors[p.owner];
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.fillRect(0, 0, 16, 10);
    ctx.strokeRect(0, 0, 16, 10);
    
    ctx.strokeStyle = "#fff";
    const type = p.unitType;
    ctx.beginPath();
    if (type === "infantry") { ctx.moveTo(0,0); ctx.lineTo(16,10); ctx.moveTo(16,0); ctx.lineTo(0,10); }
    else if (type === "tank") { ctx.ellipse(8, 5, 5, 3, 0, 0, Math.PI*2); }
    else { ctx.arc(8, 5, 2, 0, Math.PI*2); ctx.fillStyle="#fff"; ctx.fill(); }
    ctx.stroke();

    ctx.fillStyle = "#333"; ctx.fillRect(0, 11, 16, 2);
    ctx.fillStyle = "#0f0"; ctx.fillRect(0, 11, 16 * (p.org / 10), 2);
    ctx.restore();
}

function drawOverlays() {
    if (selectedTile) {
        ctx.strokeStyle = "#ffd700"; ctx.lineWidth = 2;
        ctx.strokeRect(selectedTile.x * TILE_SIZE + 1, selectedTile.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    }
    if (hoverTile && (!selectedTile || hoverTile.x !== selectedTile.x || hoverTile.y !== selectedTile.y)) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.5)"; ctx.lineWidth = 1;
        ctx.strokeRect(hoverTile.x * TILE_SIZE + 0.5, hoverTile.y * TILE_SIZE + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    }
    if (attackOverlay) {
        const time = Date.now() / 200;
        const pulse = Math.sin(time) * 0.2 + 0.8;
        ctx.save();
        ctx.translate(canvas.width/2, canvas.height/2);
        ctx.rotate(Math.atan2(attackOverlay.dy, attackOverlay.dx));
        ctx.fillStyle = "rgba(255, 69, 0, 0.6)";
        ctx.beginPath();
        ctx.moveTo(0, -10 * pulse); ctx.lineTo(50 * pulse, 0); ctx.lineTo(0, 10 * pulse);
        ctx.fill();
        ctx.restore();
    }
}

function drawMinimap() {
    for (let i = 0; i < TOTAL_TILES; i++) {
        const p = provinces[i], t = xy(i);
        minimapCtx.fillStyle = p.visible ? ownerColors[p.owner] : "#000";
        minimapCtx.fillRect(t.x * 3, t.y * 3, 3, 3);
    }
}

function markDirtyTile(x, y) { if (inBounds(x, y)) dirtyTiles.add(`${x}:${y}`); }
function markDirtyWithNeighbors(x, y) {
    markDirtyTile(x, y);
    getNeighbors(x, y).forEach(n => markDirtyTile(n.x, n.y));
}
function markAllDirty() { for (let i = 0; i < TOTAL_TILES; i++) { const t = xy(i); markDirtyTile(t.x, t.y); } }

function afterAction(full = false) {
    updateStrategicState();
    updateStats();
    updateTileInfo();
    render(full);
}

function updateTileInfo() {
    const t = selectedTile || hoverTile;
    if (!t) { 
        tileInfo.innerHTML = "Waehle eine Provinz..."; 
        document.querySelectorAll(".unit, .build").forEach(b => b.classList.remove("active"));
        return; 
    }
    const p = provinces[idx(t.x, t.y)];
    if (!p.visible) { tileInfo.innerHTML = "Unbekanntes Gebiet"; return; }
    
    // Update button states for selected tile
    if (selectedTile && t.x === selectedTile.x && t.y === selectedTile.y) {
        document.querySelectorAll(".unit").forEach(btn => {
            btn.classList.toggle("active", p.unitType === btn.dataset.unit);
        });
        document.querySelectorAll(".build").forEach(btn => {
            btn.classList.toggle("active", p.building === btn.dataset.building);
        });
    }

    const u = UNIT_TYPES[p.unitType];
    const terrain = TERRAIN[p.terrain];
    let tacticalNote = "";
    if (p.unitType === "tank" && (p.terrain === "mountain" || p.terrain === "forest")) {
        tacticalNote = `<div style="color:#ff6b4a; font-size:9px">MALUS: Panzer im Gelände (-60% Atk)</div>`;
    } else if (p.unitType === "artillery") {
        tacticalNote = `<div style="color:#48d084; font-size:9px">BONUS: Belagerungsexperte (Ignoriert Forts)</div>`;
    }

    tileInfo.innerHTML = `
        <div style="color:var(--accent); font-weight:bold; font-family:var(--font-header)">${p.name}</div>
        <div style="font-size:10px; margin-bottom:4px">${terrain.name.toUpperCase()}</div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px">
            <span>Stärke: <strong>${p.strength}</strong></span>
            <span>Org: <strong>${Math.floor(p.org*10)}%</strong></span>
        </div>
        <div style="background:rgba(255,255,255,0.1); padding:4px; border-radius:2px">
            <span style="color:var(--muted)">Typ:</span> ${u.name}
            ${tacticalNote}
        </div>
        <div style="margin-top:4px; font-size:10px">Besitzer: ${ownerNames[p.owner]}</div>
    `;
}

let lastAttackActive = false;

function gameLoop(now) {
    const delta = now - lastFrame; 
    lastFrame = now;

    if (running && !gameOver) {
        accumulator += delta;
        while (accumulator >= TICK_MS) { 
            stepGame(); 
            accumulator -= TICK_MS; 
        }
    }

    // Full render if overlay is active OR was active in last frame (to clear it)
    if (attackOverlay || lastAttackActive) {
        render(true);
    } else {
        render();
    }
    
    lastAttackActive = !!attackOverlay;
    requestAnimationFrame(gameLoop);
}

function attackInDirection(dx, dy) {
    const attacks = getBorderTiles(OWNER_PLAYER).map(t => ({ fx: t.x, fy: t.y, tx: t.x + dx, ty: t.y + dy }))
        .filter(a => inBounds(a.tx, a.ty) && provinces[idx(a.tx, a.ty)].owner !== OWNER_PLAYER);
    attacks.forEach(a => resolveAttack(a.fx, a.fy, a.tx, a.ty, OWNER_PLAYER));
    attackOverlay = { dx, dy, expires: Date.now() + ATTACK_OVERLAY_MS };
    setTimeout(() => attackOverlay = null, ATTACK_OVERLAY_MS);
    afterAction();
}

// Event Listeners
canvas.addEventListener("mousemove", e => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / (rect.width / WIDTH));
    const y = Math.floor((e.clientY - rect.top) / (rect.height / HEIGHT));
    
    if (!hoverTile || hoverTile.x !== x || hoverTile.y !== y) {
        if (hoverTile) markDirtyTile(hoverTile.x, hoverTile.y);
        hoverTile = inBounds(x, y) ? { x, y } : null;
        if (hoverTile) markDirtyTile(hoverTile.x, hoverTile.y);
        updateTileInfo();
        // If not redrawing everything, we need to call render manually for hover
        if (!attackOverlay) render();
    }
});

canvas.addEventListener("mouseleave", () => {
    if (hoverTile) markDirtyTile(hoverTile.x, hoverTile.y);
    hoverTile = null;
    updateTileInfo();
    render();
});

canvas.addEventListener("click", e => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / (rect.width / WIDTH));
    const y = Math.floor((e.clientY - rect.top) / (rect.height / HEIGHT));
    
    // Mark previous selection as dirty to clear outline
    if (selectedTile) markDirtyTile(selectedTile.x, selectedTile.y);

    if (selectedTile && selectedTile.x === x && selectedTile.y === y) {
        selectedTile = null;
    } else {
        selectedTile = { x, y };
        // Mark new selection as dirty to draw outline
        markDirtyTile(x, y);
    }
    afterAction();
});

document.addEventListener("keydown", e => {
    if (e.key === "ArrowUp" || e.key === "w") attackInDirection(0, -1);
    if (e.key === "ArrowDown" || e.key === "s") attackInDirection(0, 1);
    if (e.key === "ArrowLeft" || e.key === "a") attackInDirection(-1, 0);
    if (e.key === "ArrowRight" || e.key === "d") attackInDirection(1, 0);
});

document.querySelectorAll(".dir").forEach(btn => {
    btn.addEventListener("click", () => {
        const dir = btn.dataset.dir;
        if (dir === "up") attackInDirection(0, -1);
        if (dir === "down") attackInDirection(0, 1);
        if (dir === "left") attackInDirection(-1, 0);
        if (dir === "right") attackInDirection(1, 0);
    });
});

document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn, .tab-content").forEach(el => el.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
});

document.querySelectorAll(".unit").forEach(btn => {
    btn.addEventListener("click", () => {
        if (!selectedTile) return;
        const p = provinces[idx(selectedTile.x, selectedTile.y)];
        if (p.owner === OWNER_PLAYER) {
            p.unitType = btn.dataset.unit;
            document.querySelectorAll(".unit").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            markDirtyTile(selectedTile.x, selectedTile.y);
        }
    });
});

document.querySelectorAll(".build").forEach(btn => {
    btn.addEventListener("click", () => {
        if (!selectedTile) return;
        const p = provinces[idx(selectedTile.x, selectedTile.y)];
        if (p.owner === OWNER_PLAYER) {
            const cost = 25;
            if (politicalPower >= cost) {
                p.building = btn.dataset.building === "barracks" ? "barracks" : btn.dataset.building === "factory" ? "factory" : "fort";
                politicalPower -= cost;
                log(`${BUILDINGS[p.building].name} in ${p.name} gebaut.`);
                markDirtyTile(selectedTile.x, selectedTile.y);
            } else {
                log("Nicht genug Politische Macht!");
            }
        }
    });
});

pauseButton.addEventListener("click", () => { running = !running; pauseButton.textContent = running ? "Pause" : "Weiter"; });
document.getElementById("btn-reset").addEventListener("click", initMap);

const sidebar = document.getElementById("sidebar");
const menuToggle = document.getElementById("menu-toggle");

menuToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    sidebar.classList.toggle("open");
});

// Close sidebar when clicking on the game or anywhere else
document.addEventListener("click", (e) => {
    if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && e.target !== menuToggle) {
        sidebar.classList.remove("open");
    }
});

// Close sidebar after selecting a unit or building (common mobile actions)
document.querySelectorAll(".unit, .build, .dir").forEach(btn => {
    btn.addEventListener("click", () => {
        if (window.innerWidth <= 1200) {
            sidebar.classList.remove("open");
        }
    });
});

initMap();
requestAnimationFrame(gameLoop);
