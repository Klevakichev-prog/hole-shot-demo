// HoleModel.js — the hole as a puck on the table: pure logic, no Babylon (testable in node).
// The hole is a circle (x, y, r) that slides after a slingshot launch with a constant
// deceleration (Monster Strike-like: heavy and slow, low friction — a long path at a low speed,
// so objects have time to tumble in) and bounces off solids: the table border, static boards
// and posts, and objects too big to fall in. Bounce: the normal component is reflected and
// scaled by the restitution, the tangent one is kept (billiard cushion model).
//
// World (2D, map px — x right, y down):
//   { w, h, boxes: [{ x, y, w, h, rot }], circles: [{ x, y, r }] }
//   boxes — oriented rectangles (center, size, rot in degrees); the table border is four boxes.
//   circles — posts and objects too big to fall in (their footprint).

/** @satisfies {Record<string, any>} */
const HoleModel = {
    // Live overrides from the tuning panel (TunePanel.js): name -> number.
    tune: {},

    // All numbers of the model: constants (Constants.js) + tuning overrides.
    cfg() {
        const U = 'undefined', t = HoleModel.tune;
        const pick = (name, value, dflt) => (t[name] !== undefined ? t[name] : (value !== undefined ? value : dflt));
        return {
            startRadius: pick('HOLE_START_RADIUS', typeof HOLE_START_RADIUS !== U ? HOLE_START_RADIUS : undefined, 40),
            speedMax: pick('HOLE_SPEED_MAX', typeof HOLE_SPEED_MAX !== U ? HOLE_SPEED_MAX : undefined, 240),
            friction: pick('HOLE_FRICTION', typeof HOLE_FRICTION !== U ? HOLE_FRICTION : undefined, 15),
            restitution: pick('HOLE_RESTITUTION', typeof HOLE_RESTITUTION !== U ? HOLE_RESTITUTION : undefined, 0.85),
            stopSpeed: pick('HOLE_STOP_SPEED', typeof HOLE_STOP_SPEED !== U ? HOLE_STOP_SPEED : undefined, 8),
            growK: pick('HOLE_GROW_K', typeof HOLE_GROW_K !== U ? HOLE_GROW_K : undefined, 1),
            blockFit: pick('HOLE_BLOCK_FIT', typeof HOLE_BLOCK_FIT !== U ? HOLE_BLOCK_FIT : undefined, 0.9),
            aimBounces: pick('AIM_BOUNCES', typeof AIM_BOUNCES !== U ? AIM_BOUNCES : undefined, 1),
            aimMinPower: pick('AIM_MIN_POWER', typeof AIM_MIN_POWER !== U ? AIM_MIN_POWER : undefined, 0.08)
        };
    },

    /** @param {number} x @param {number} y @param {number} r */
    create(x, y, r) {
        return { x, y, r, vx: 0, vy: 0, moving: false, distance: 0 };
    },

    // Slingshot: direction (any length) and power 0..1 -> velocity. Too weak a pull — no shot.
    launch(hole, dx, dy, power, c) {
        const len = Math.hypot(dx, dy);
        if (!(len > 0) || !(power >= c.aimMinPower)) return false;
        const v = c.speedMax * Math.min(1, power);
        hole.vx = dx / len * v;
        hole.vy = dy / len * v;
        hole.moving = true;
        hole.distance = 0;
        return true;
    },

    // Area growth: the hole gains growK of the eaten footprint's area.
    grow(hole, footprintR, c) {
        hole.r = Math.sqrt(hole.r * hole.r + c.growK * footprintR * footprintR);
        return hole.r;
    },

    // Is an object of this footprint radius a solid for the hole (too big to fall in)?
    blocks(hole, footprintR, c) {
        return footprintR * c.blockFit > hole.r;
    },

    // One frame: friction, motion in substeps (no tunnelling), bounces.
    // Returns the bounces of this frame: [{ x, y, nx, ny, speed }] — for effects.
    step(hole, dt, world, c) {
        const bounces = [];
        if (!hole.moving) return bounces;
        let speed = Math.hypot(hole.vx, hole.vy);
        const slowed = Math.max(0, speed - c.friction * dt);
        if (slowed <= c.stopSpeed) {
            hole.vx = hole.vy = 0;
            hole.moving = false;
            return bounces;
        }
        hole.vx *= slowed / speed;
        hole.vy *= slowed / speed;
        speed = slowed;
        const maxStep = Math.max(1, hole.r * 0.25);
        const n = Math.max(1, Math.ceil(speed * dt / maxStep));
        for (let i = 0; i < n; i++) {
            hole.x += hole.vx * dt / n;
            hole.y += hole.vy * dt / n;
            hole.distance += speed * dt / n;
            const hit = HoleModel.resolve(hole, world, c.restitution);
            if (hit) bounces.push(hit);
        }
        return bounces;
    },

    // Push the hole out of every solid it overlaps; reflect the velocity off the deepest one.
    resolve(hole, world, restitution) {
        let best = null;
        for (let pass = 0; pass < 3; pass++) {
            const contact = HoleModel.deepestContact(hole.x, hole.y, hole.r, world);
            if (!contact) break;
            hole.x += contact.nx * contact.depth;
            hole.y += contact.ny * contact.depth;
            const vn = hole.vx * contact.nx + hole.vy * contact.ny;
            if (vn < 0) {
                hole.vx -= (1 + restitution) * vn * contact.nx;
                hole.vy -= (1 + restitution) * vn * contact.ny;
                best = { x: hole.x - contact.nx * hole.r, y: hole.y - contact.ny * hole.r,
                    nx: contact.nx, ny: contact.ny, speed: -vn };
            }
        }
        return best;
    },

    // The deepest overlap of a circle with the world: { nx, ny, depth } (normal points out of the
    // solid, toward the circle) or null.
    deepestContact(x, y, r, world) {
        let best = null;
        const take = (c) => { if (c && (!best || c.depth > best.depth)) best = c; };
        for (const b of world.boxes || []) take(HoleModel.circleBox(x, y, r, b));
        for (const p of world.circles || []) take(HoleModel.circleCircle(x, y, r, p));
        return best;
    },

    circleCircle(x, y, r, p) {
        const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy), depth = r + p.r - d;
        if (depth <= 0) return null;
        if (d < 1e-6) return { nx: 0, ny: -1, depth };
        return { nx: dx / d, ny: dy / d, depth };
    },

    circleBox(x, y, r, b) {
        const a = (b.rot || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
        // Circle center in the box frame.
        const rx = x - b.x, ry = y - b.y;
        const lx = rx * ca + ry * sa, ly = -rx * sa + ry * ca;
        const hw = b.w / 2, hh = b.h / 2;
        const cx = Math.max(-hw, Math.min(hw, lx)), cy = Math.max(-hh, Math.min(hh, ly));
        let nlx, nly, depth;
        if (cx === lx && cy === ly) {
            // Center inside the box: out through the nearest side.
            const ex = hw - Math.abs(lx), ey = hh - Math.abs(ly);
            if (ex < ey) { nlx = Math.sign(lx) || 1; nly = 0; depth = ex + r; }
            else { nlx = 0; nly = Math.sign(ly) || 1; depth = ey + r; }
        } else {
            const dx = lx - cx, dy = ly - cy, d = Math.hypot(dx, dy);
            depth = r - d;
            if (depth <= 0) return null;
            nlx = dx / d; nly = dy / d;
        }
        return { nx: nlx * ca - nly * sa, ny: nlx * sa + nly * ca, depth };
    },

    // Aim preview: the path of a launch until the hole stops or after maxBounces bounces.
    // Returns [{ x, y }] — the corners of the polyline (start, bounces, end).
    trace(x, y, r, dx, dy, power, world, c, maxBounces) {
        const probe = HoleModel.create(x, y, r);
        const pts = [{ x, y }];
        if (!HoleModel.launch(probe, dx, dy, power, c)) return pts;
        const dt = 1 / 60, limit = 60 * 120;
        let bounces = 0;
        for (let i = 0; i < limit && probe.moving; i++) {
            const hits = HoleModel.step(probe, dt, world, c);
            if (hits.length) {
                pts.push({ x: probe.x, y: probe.y });
                bounces += hits.length;
                if (bounces >= maxBounces) return pts;
            }
        }
        pts.push({ x: probe.x, y: probe.y });
        return pts;
    },

    // Stopping distance of a launch at full power on an empty table (for tuning: v² / 2a).
    stopDistance(c, power) {
        const v = c.speedMax * Math.min(1, power === undefined ? 1 : power);
        return c.friction > 0 ? v * v / (2 * c.friction) : Infinity;
    }
};
