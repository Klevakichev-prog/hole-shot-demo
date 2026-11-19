// Game.js — Hole Shot: Smash Fest meets a Hole game. The hole is the projectile: pull back and
// release (slingshot, Monster Strike-like), it slides slowly, bounces off cushions, posts and
// objects too big for it, swallows what fits through and grows. Goal — eat every can within the
// level's shots. Phases: loading -> aim -> move -> settle -> aim | won | lost.
//
// The logic owns the hole (HoleModel); HoleScene shows it and runs the item physics. HUD — UI.get
// by id (UILayout.js); the tuning panel (TunePanel.js) is a dev tool that overrides numbers live.

class Game {
    /** @param {{ location: Location3D, camera: CameraController }} app */
    constructor(app) {
        this.app = app;
        this.phase = 'loading';
        this.levelIndex = Game.startLevel();
        this.level = HOLE_LEVELS[this.levelIndex];
        this.hole = HoleModel.create(0, 0, 40);
        this.shown = { r: 40 };     // displayed radius (eases toward hole.r)
        this.shots = 0;
        this.targets = 0;
        this.targetTotal = 0;
        this.eaten = 0;
        this.settleT = 0;
        this.aim = null;            // { sx, sy, gx, gy, dx, dy, power } while dragging
        this.camTarget = { x: 0, y: 0 };
        this.world = null;
        this.scene = new HoleScene(app);
        this._fpsTimer = 0;

        const cam = app.camera;
        cam.ignorePointer = () => true;     // every press is game input: no pan, no orbit
        cam.follow(this.camTarget);

        this._bindInput();
        this._bindHud();
        TunePanel.init(this);
        this.scene.initPhysics()
            .catch(e => console.error('Havok не поднялся', e))
            .then(() => this.startLevel(this.levelIndex));
    }

    static startLevel() {
        const q = new URLSearchParams(location.search).get('level');
        const n = q !== null ? Number(q) : Number(Store.get('hole-level') || 1);
        return Math.max(0, Math.min(HOLE_LEVELS.length - 1, Number.isFinite(n) ? n : 1));
    }

    async startLevel(index) {
        this.phase = 'loading';
        this.levelIndex = (index + HOLE_LEVELS.length) % HOLE_LEVELS.length;
        this.level = HOLE_LEVELS[this.levelIndex];
        Store.set('hole-level', String(this.levelIndex));
        const c = HoleModel.cfg(), L = this.level;
        this.hole = HoleModel.create(L.start[0], L.start[1], c.startRadius);
        this.shown.r = c.startRadius;
        this.shots = L.shots;
        this.eaten = 0;
        this.aim = null;
        this.world = this.scene.world(L);
        this._show('result', false);
        await this.scene.loadLevel(L, this.hole.x, this.hole.y, this.hole.r);
        this.targets = this.targetTotal = this.scene.items.filter(it => it.target).length;
        this._placeCamera(true);
        this.phase = 'aim';
        this._hud();
    }

    // --- Input: slingshot -------------------------------------------------------------

    _bindInput() {
        const canvas = this.app.location.view.world.canvas;
        const local = (e) => {
            const r = canvas.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        };
        canvas.addEventListener('pointerdown', (e) => {
            if (this.phase !== 'aim' || (e.pointerType === 'mouse' && e.button !== 0)) return;
            const p = local(e);
            this.aim = { sx: p.x, sy: p.y, dx: 0, dy: 0, power: 0 };
            try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!this.aim) return;
            const p = local(e);
            this._updateAim(p.x, p.y);
        });
        const up = () => {
            if (!this.aim) return;
            const a = this.aim;
            this.aim = null;
            this.scene.showAim([]);
            if (this.phase === 'aim') this.shoot(a.dx, a.dy, a.power);
        };
        canvas.addEventListener('pointerup', up);
        canvas.addEventListener('pointercancel', () => { this.aim = null; this.scene.showAim([]); });
    }

    // Pull vector on the ground (perspective-correct): launch goes the opposite way.
    _updateAim(px, py) {
        const a = this.aim, view = this.app.location.view, canvas = view.world.canvas;
        const g0 = view.pointerToGround(a.sx, a.sy, 0), g1 = view.pointerToGround(px, py, 0);
        if (!g0 || !g1) return;
        const c = Game.cfg();
        a.dx = g0.x - g1.x;
        a.dy = g0.y - g1.y;
        a.power = Math.min(1, Math.hypot(px - a.sx, py - a.sy) / (canvas.clientHeight * c.dragFull));
        const mc = HoleModel.cfg();
        const pts = a.power >= mc.aimMinPower
            ? HoleModel.trace(this.hole.x, this.hole.y, this.hole.r, a.dx, a.dy, a.power, this._solids(), mc, mc.aimBounces)
            : [];
        this.scene.showAim(pts);
        this._text('power', a.power >= mc.aimMinPower ? Math.round(a.power * 100) + '%' : '');
    }

    // A launch (also from the console / tests): direction on the map, power 0..1.
    shoot(dx, dy, power) {
        if (this.phase !== 'aim' || this.shots <= 0) return false;
        if (!HoleModel.launch(this.hole, dx, dy, power, HoleModel.cfg())) return false;
        this.shots--;
        this.phase = 'move';
        this._text('power', '');
        this._hud();
        return true;
    }

    // Dev / headless checks: fast-forward `sec` of game time without rendering — the logic and
    // the item physics in 1/60 s steps (the VM renders ~2 fps, real time would take minutes).
    advance(sec) {
        const dt = 1 / 60, scene = this.scene.scene;
        for (let i = 0, n = Math.round(sec / dt); i < n && this.phase !== 'loading'; i++) {
            this.update(dt);
            if (scene.getPhysicsEngine()) scene._advancePhysicsEngineStep(dt * 1000);
        }
        return { phase: this.phase, shots: this.shots, eaten: this.eaten, targets: this.targets,
            x: Math.round(this.hole.x), y: Math.round(this.hole.y), r: +this.hole.r.toFixed(1) };
    }

    _solids() {
        const c = HoleModel.cfg();
        return { w: this.world.w, h: this.world.h, boxes: this.world.boxes,
            circles: this.world.circles.concat(this.scene.blockers(this.hole, c)) };
    }

    // --- Frame ----------------------------------------------------------------------------

    update(dt) {
        this._fps(dt);
        if (this.phase === 'loading') return;
        const c = HoleModel.cfg(), g = Game.cfg();
        if (this.phase === 'move') {
            HoleModel.step(this.hole, dt, this._solids(), c);
            if (!this.hole.moving) { this.phase = 'settle'; this.settleT = g.settleSec; }
        }
        // Growth eases in: the opening widens over a moment, items at the rim tip in.
        this.shown.r += (this.hole.r - this.shown.r) * Math.min(1, dt * g.growEase);
        this.scene.setHole(this.hole.x, this.hole.y, this.shown.r);

        for (const it of this.scene.collectEaten()) {
            HoleModel.grow(this.hole, it.rf, c);
            this.eaten++;
            if (it.target) this.targets--;
            this._hud();
        }

        if (this.phase === 'settle') {
            this.settleT -= dt;
            if (this.settleT <= 0 && this.scene.fallingCount() === 0) this._afterShot();
        }
        if ((this.phase === 'move' || this.phase === 'settle') && this.targets <= 0) {
            this.settleT = Math.min(this.settleT, g.settleSec);
            if (this.phase === 'move') { this.hole.moving = false; this.hole.vx = this.hole.vy = 0; this.phase = 'settle'; }
        }
        this._placeCamera(false);
    }

    _afterShot() {
        if (this.targets <= 0) return this._finish(true);
        if (this.shots <= 0) return this._finish(false);
        this.phase = 'aim';
        this._hud();
    }

    _finish(won) {
        this.phase = won ? 'won' : 'lost';
        this._text('resultText', won ? 'Все банки съедены!' : 'Выстрелы кончились');
        this._text('resultSub', won ? 'Осталось выстрелов: ' + this.shots : 'Банок осталось: ' + this.targets);
        const next = UI.get('resultNext');
        if (next) next.show(won);
        this._show('result', true);
        this._hud();
    }

    // Camera: north up, follows the hole along the table with a lead upward while aiming;
    // zooms out as the hole grows so the frame keeps a similar number of hole sizes.
    _placeCamera(snap) {
        const g = Game.cfg(), L = this.level, cam = this.app.camera, canvas = this.app.location.view.world.canvas;
        const grow = Math.pow(this.shown.r / HoleModel.cfg().startRadius, g.camGrowPow);
        const viewW = g.camViewW * Math.max(1, grow);
        cam.zoomTarget = Math.max(0.05, (canvas.clientWidth || 400) / viewW);
        const lead = this.phase === 'aim' || this.phase === 'loading' ? g.camLead : 0;
        this.camTarget.x = L.w / 2 + (this.hole.x - L.w / 2) * g.camFollowX;
        this.camTarget.y = Math.max(g.camTopY, Math.min(L.h - g.camBottomY, this.hole.y - lead));
        if (snap) {
            cam.zoom = cam.zoomTarget;
            cam.lookAt(this.camTarget.x, this.camTarget.y);
        }
    }

    // --- HUD ------------------------------------------------------------------------------

    _bindHud() {
        const click = (id, fn) => { const b = UI.get(id); if (b) b.onClick(fn); };
        click('restart', () => this.startLevel(this.levelIndex));
        click('resultRetry', () => this.startLevel(this.levelIndex));
        click('resultNext', () => this.startLevel(this.levelIndex + 1));
        click('prevLevel', () => this.startLevel(this.levelIndex - 1));
        click('nextLevel', () => this.startLevel(this.levelIndex + 1));
        click('tuneButton', () => TunePanel.toggle());
    }

    _hud() {
        const L = this.level, total = this.targetTotal;
        this._text('levelName', (this.levelIndex === 0 ? '' : this.levelIndex + '. ') + L.name);
        this._text('shots', 'Выстрелы: ' + this.shots);
        this._text('cans', 'Банки: ' + (total - this.targets) + ' / ' + total);
        this._text('hint', this.phase === 'aim' ? 'Тяни назад и отпусти' : '');
    }

    _text(id, s) { const e = UI.get(id); if (e) e.setText(s); }
    _show(id, on) { const e = UI.get(id); if (e) e.show(on); }

    _fps(dt) {
        this._fpsTimer -= dt;
        if (this._fpsTimer > 0) return;
        this._fpsTimer = 0.5;
        this._text('fps', Math.round(World3D.engine.getFps()) + ' fps');
    }

    static cfg() {
        const U = 'undefined';
        return {
            dragFull: typeof AIM_DRAG_FULL !== U ? AIM_DRAG_FULL : 0.3,
            settleSec: typeof GAME_SETTLE_SEC !== U ? GAME_SETTLE_SEC : 0.8,
            growEase: typeof HOLE_GROW_EASE !== U ? HOLE_GROW_EASE : 6,
            camViewW: typeof CAM_VIEW_W !== U ? CAM_VIEW_W : 760,
            camGrowPow: typeof CAM_GROW_POW !== U ? CAM_GROW_POW : 0.6,
            camLead: typeof CAM_LEAD !== U ? CAM_LEAD : 260,
            camFollowX: typeof CAM_FOLLOW_X !== U ? CAM_FOLLOW_X : 0.3,
            camTopY: typeof CAM_TOP_Y !== U ? CAM_TOP_Y : 380,
            camBottomY: typeof CAM_BOTTOM_Y !== U ? CAM_BOTTOM_Y : 480
        };
    }
}
