// HoleScene.js — the 3D side of the hole game: the table, the hole that is a REAL opening in a
// physical floor, the items as Havok rigid bodies, the aim dots.
//
// The floor is one polar mesh around the hole center: rings from the hole radius out to
// HOLE_FLOOR_FAR, plus the well — a tube going down from the rim. The same geometry is a Havok
// mesh shape on an ANIMATED body that is TELEPORTED to the hole every frame (teleport — no
// velocity, so items resting on the floor are not dragged along like a tablecloth). An item over
// the rim loses support on one side, tips over the edge, hits the well walls and the other items
// and may be thrown back out — as in All in Hole. An item is eaten when it sinks below
// HOLE_EAT_DEPTH. The kit's terrain is hidden; the floor uses its material (same UVs x/W, y/H).
//
// Game logic (HoleModel) owns the hole's position and radius; this file only shows them and runs
// the item physics.

class HoleScene {
    /** @param {{ location: Location3D }} app */
    constructor(app) {
        this.app = app;
        this.view = app.location.view;
        this.scene = this.view.scene;
        this.ready = false;
        /** @type {any} */
        this.plugin = null;
        this.protos = {};          // kind -> { model, shape, center, rf, height, mass }
        this.items = [];           // { kind, target, rf, proxy, visual, body, eaten }
        this.statics = [];         // { mesh, aggregate }
        this.level = null;
        this.holeR = 0;            // radius the floor was built for
        this.node = null;          // hole transform: floor, well, rim, collider body
        this.floor = null;
        this.well = null;
        this.wellBottom = null;
        this.rim = null;
        this.collider = null;
        this.colliderShape = null;
        this.colliderBody = null;
        this.dots = null;
        this._uvs = null;
        for (const m of app.location.terrain.meshes) m.setEnabled(false);
    }

    static cfg() {
        const U = 'undefined', t = HoleModel.tune;
        const pick = (name, value, dflt) => (t[name] !== undefined ? t[name] : (value !== undefined ? value : dflt));
        return {
            itemScale: typeof ITEM_SCALE !== U ? ITEM_SCALE : 3,
            maxSubsteps: typeof PHYS_MAX_SUBSTEPS !== U ? PHYS_MAX_SUBSTEPS : 6,
            wakeMargin: typeof PHYS_WAKE_MARGIN !== U ? PHYS_WAKE_MARGIN : 30,
            wellShade: typeof HOLE_WELL_SHADE !== U ? HOLE_WELL_SHADE : 0.4,
            gravity: pick('PHYS_GRAVITY', typeof PHYS_GRAVITY !== U ? PHYS_GRAVITY : undefined, 2400),
            itemFriction: pick('ITEM_FRICTION', typeof ITEM_FRICTION !== U ? ITEM_FRICTION : undefined, 0.6),
            itemRestitution: pick('ITEM_RESTITUTION', typeof ITEM_RESTITUTION !== U ? ITEM_RESTITUTION : undefined, 0.2),
            segments: typeof HOLE_SEGMENTS !== U ? HOLE_SEGMENTS : 48,
            rings: typeof HOLE_FLOOR_RINGS !== U ? HOLE_FLOOR_RINGS : 14,
            far: typeof HOLE_FLOOR_FAR !== U ? HOLE_FLOOR_FAR : 5000,
            depth: typeof HOLE_DEPTH !== U ? HOLE_DEPTH : 320,
            eatDepth: typeof HOLE_EAT_DEPTH !== U ? HOLE_EAT_DEPTH : 240,
            wallH: typeof TABLE_WALL_HEIGHT !== U ? TABLE_WALL_HEIGHT : 70,
            wallT: typeof TABLE_WALL_THICK !== U ? TABLE_WALL_THICK : 40,
            dotStep: typeof AIM_DOT_STEP !== U ? AIM_DOT_STEP : 26,
            dotSize: typeof AIM_DOT_SIZE !== U ? AIM_DOT_SIZE : 7
        };
    }

    // Havok (libs/HavokPhysics_umd.js + .wasm) and the gravity. Physics missing — items stand still.
    async initPhysics() {
        if (typeof HavokPhysics === 'undefined') { console.warn('HoleScene: нет libs/HavokPhysics_umd.js'); return false; }
        const hk = await HavokPhysics({ locateFile: (f) => 'libs/' + f });
        this.plugin = new BABYLON.HavokPlugin(true, hk);
        this.scene.enablePhysics(new BABYLON.Vector3(0, -HoleScene.cfg().gravity, 0), this.plugin);
        // Fixed substeps: Babylon steps the world once per frame (up to 0.1 s), and a long step
        // knocks the can pyramids down on a slow frame. Split the frame into steps of <= 1/60 s.
        const pe = this.scene.getPhysicsEngine(), single = pe._step.bind(pe);
        const maxSub = HoleScene.cfg().maxSubsteps;
        pe._step = (delta) => {
            const d = Math.min(0.1, Math.max(0, delta));
            const n = Math.max(1, Math.min(maxSub, Math.ceil(d * 60 - 1e-3)));
            for (let i = 0; i < n; i++) single(d / n);
        };
        return true;
    }

    setGravity(g) {
        const pe = this.scene.getPhysicsEngine();
        if (pe) pe.setGravity(new BABYLON.Vector3(0, -g, 0));
    }

    // --- Item prototypes ---------------------------------------------------------------

    // One build per kind: hull points in the item's own frame (origin — bounds center), the
    // shared convex hull shape, the footprint radius and the height.
    async proto(kind) {
        if (this.protos[kind]) return this.protos[kind];
        const def = HOLE_ITEMS[kind];
        if (!def) throw new Error('unknown item ' + kind);
        const model = await Model3D.load(def.model, this.scene);
        const s = HoleScene.cfg().itemScale * (def.scale || 1);
        const root = Model3D.build(model, this.scene, { name: 'proto-' + kind });
        root.scaling.setAll(s);
        root.computeWorldMatrix(true);
        const pts = [];
        const v = new BABYLON.Vector3();
        for (const m of root.getChildMeshes()) {
            const pos = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
            if (!pos) continue;
            const wm = m.computeWorldMatrix(true);
            for (let i = 0; i < pos.length; i += 3) {
                BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], wm, v);
                pts.push(v.x, v.y, v.z);
            }
        }
        Model3D.dispose(this.view, root);
        let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
        for (let i = 0; i < pts.length; i += 3) {
            mnx = Math.min(mnx, pts[i]); mxx = Math.max(mxx, pts[i]);
            mny = Math.min(mny, pts[i + 1]); mxy = Math.max(mxy, pts[i + 1]);
            mnz = Math.min(mnz, pts[i + 2]); mxz = Math.max(mxz, pts[i + 2]);
        }
        const center = new BABYLON.Vector3((mnx + mxx) / 2, (mny + mxy) / 2, (mnz + mxz) / 2);
        let rf = 0;
        for (let i = 0; i < pts.length; i += 3) {
            pts[i] -= center.x; pts[i + 1] -= center.y; pts[i + 2] -= center.z;
            rf = Math.max(rf, Math.hypot(pts[i], pts[i + 2]));
        }
        // The hull is built from a hidden mesh that only carries the points.
        const hullMesh = new BABYLON.Mesh('hull-' + kind, this.scene);
        const vd = new BABYLON.VertexData();
        vd.positions = pts;
        vd.indices = [0, 1, 2];
        vd.applyToMesh(hullMesh, false);
        hullMesh.setEnabled(false);
        // Cans stand on an exact cylinder: the model's tapered lid makes a hull pyramid slide apart.
        const size = [mxx - mnx, mxy - mny, mxz - mnz];
        const half = new BABYLON.Vector3(0, size[1] / 2, 0);
        const shape = !this.plugin ? null : def.shape === 'cylinder'
            ? new BABYLON.PhysicsShapeCylinder(half.scale(-1), half, rf, this.scene)
            : new BABYLON.PhysicsShapeConvexHull(hullMesh, this.scene);
        const c = HoleScene.cfg();
        if (shape) shape.material = { friction: c.itemFriction, restitution: c.itemRestitution };
        const proto = {
            model, shape, center, rf, height: size[1], scale: s,
            mass: Math.max(0.05, size[0] * size[1] * size[2] * 1e-5)
        };
        this.protos[kind] = proto;
        return proto;
    }

    // --- Level --------------------------------------------------------------------------

    // Build a level: table walls, boards, posts, items. Returns when every model is in place.
    async loadLevel(level, holeX, holeY, holeR) {
        this.clear();
        this.level = level;
        const kinds = new Set();
        for (const it of level.items || []) kinds.add(it[0]);
        for (const st of level.stacks || []) kinds.add(st[0]);
        for (const sc of level.scatter || []) {
            (HOLE_POOLS[sc[0]] || [sc[0]]).forEach(k => kinds.add(k));
        }
        await Promise.all(Array.from(kinds).map(k => this.proto(k)));
        const c = HoleScene.cfg();
        for (const k of Object.keys(this.protos)) {
            const shape = this.protos[k].shape;
            if (shape) shape.material = { friction: c.itemFriction, restitution: c.itemRestitution };
        }
        this.buildTable(level);
        this.buildHole(holeX, holeY, holeR);
        for (const it of level.items || []) this.spawn(it[0], it[1], it[2], it[3] || 0, false, 0);
        for (const st of level.stacks || []) this.spawnStack(st[0], st[1], st[2], st[3], st[4] || 0, !!st[5]);
        for (const sc of level.scatter || []) this.spawnScatter(sc);
    }

    clear() {
        for (const it of this.items) this.removeItem(it);
        this.items = [];
        for (const s of this.statics) {
            if (s.aggregate) s.aggregate.dispose();
            World3D.removeObject(this.view, s.mesh);
            s.mesh.dispose();
        }
        this.statics = [];
    }

    // Walls around the table, boards and posts: static boxes and cylinders, wooden.
    buildTable(level) {
        const c = HoleScene.cfg(), W = level.w, H = level.h, T = c.wallT;
        const wood = this._material('wood', 0x9a6a3c);
        const dark = this._material('board', 0x7b5230);
        const box = (x, y, w, d, rot, h, mat) => {
            const m = BABYLON.MeshBuilder.CreateBox('wall', { width: w, depth: d, height: h }, this.scene);
            m.position.set(x, h / 2, y);
            m.rotation.y = -(rot || 0) * Math.PI / 180;
            m.material = mat;
            this._static(m, BABYLON.PhysicsShapeType.BOX);
        };
        box(-T / 2, H / 2, T, H + 2 * T, 0, c.wallH, wood);
        box(W + T / 2, H / 2, T, H + 2 * T, 0, c.wallH, wood);
        box(W / 2, -T / 2, W, T, 0, c.wallH, wood);
        box(W / 2, H + T / 2, W, T, 0, c.wallH, wood);
        for (const b of level.boards || []) box(b[0], b[1], b[2], b[3], b[4], c.wallH * 0.8, dark);
        for (const p of level.posts || []) {
            const m = BABYLON.MeshBuilder.CreateCylinder('post', { diameter: p[2] * 2, height: c.wallH * 1.2, tessellation: 24 }, this.scene);
            m.position.set(p[0], c.wallH * 0.6, p[1]);
            m.material = dark;
            this._static(m, BABYLON.PhysicsShapeType.CYLINDER);
        }
    }

    // The solids of the table for HoleModel: the border and the boards as boxes, posts as circles.
    world(level) {
        const T = HoleScene.cfg().wallT, W = level.w, H = level.h;
        const boxes = [
            { x: -T / 2, y: H / 2, w: T, h: H + 2 * T, rot: 0 },
            { x: W + T / 2, y: H / 2, w: T, h: H + 2 * T, rot: 0 },
            { x: W / 2, y: -T / 2, w: W + 2 * T, h: T, rot: 0 },
            { x: W / 2, y: H + T / 2, w: W + 2 * T, h: T, rot: 0 }
        ];
        for (const b of level.boards || []) boxes.push({ x: b[0], y: b[1], w: b[2], h: b[3], rot: b[4] || 0 });
        const circles = (level.posts || []).map(p => ({ x: p[0], y: p[1], r: p[2] }));
        return { w: W, h: H, boxes, circles };
    }

    _static(mesh, type) {
        World3D.addObject(this.view, mesh, 'prop');
        mesh.receiveShadows = true;
        const aggregate = this.plugin ? new BABYLON.PhysicsAggregate(mesh, type, { mass: 0, friction: 0.5, restitution: 0.3 }, this.scene) : null;
        this.statics.push({ mesh, aggregate });
    }

    _material(name, hex) {
        const key = '_mat_' + name;
        if (this[key]) return this[key];
        const m = new BABYLON.StandardMaterial(name, this.scene);
        m.diffuseColor = World3D.hexColor3(hex);
        World3D.applyMaterialConstants(m);
        this[key] = m;
        return m;
    }

    // --- Items --------------------------------------------------------------------------

    // One item: an invisible proxy carries the body, the model is its child.
    spawn(kind, x, y, rotDeg, target, lift) {
        const p = this.protos[kind];
        if (!p) return null;
        const proxy = new BABYLON.Mesh('item-' + kind, this.scene);
        proxy.position.set(x, p.height / 2 + (lift || 0), y);
        proxy.rotationQuaternion = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, -(rotDeg || 0) * Math.PI / 180);
        const visual = Model3D.build(p.model, this.scene, { name: kind });
        visual.scaling.setAll(p.scale);
        visual.position.copyFrom(p.center).scaleInPlace(-1);
        visual.parent = proxy;
        World3D.addObject(this.view, visual, 'prop');
        for (const m of visual.getChildMeshes()) m.receiveShadows = true;
        let body = null;
        if (this.plugin && p.shape) {
            body = new BABYLON.PhysicsBody(proxy, BABYLON.PhysicsMotionType.DYNAMIC, false, this.scene);
            body.shape = p.shape;
            body.setMassProperties({ mass: p.mass });     // Havok keeps the inertia per unit mass
            body.setAngularDamping(0.3);
        }
        const item = { kind, target: !!target, rf: p.rf, height: p.height, proxy, visual, body, eaten: false, awake: false };
        this.items.push(item);
        return item;
    }

    // A can wall: `rows` cans at the bottom, one fewer on each row up, across the heading.
    spawnStack(kind, x, y, rows, rotDeg, target) {
        const p = this.protos[kind];
        if (!p) return;
        const a = rotDeg * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
        const step = p.rf * 2.04;
        for (let row = 0; row < rows; row++) {
            const n = rows - row;
            for (let i = 0; i < n; i++) {
                const off = (i - (n - 1) / 2) * step;
                this.spawn(kind, x + ux * off, y + uy * off, rotDeg, target, row * (p.height + 0.5) + 0.5);
            }
        }
    }

    // Items scattered over a rectangle, deterministic by seed, without overlaps where possible.
    spawnScatter(sc) {
        const [kind, x0, y0, w, h, count, seed] = sc;
        const rnd = HoleScene.rng(seed || 1);
        const placed = this.items.map(it => ({ x: it.proxy.position.x, y: it.proxy.position.z, r: it.rf }));
        for (let n = 0; n < count; n++) {
            const pool = HOLE_POOLS[kind], k = pool ? pool[Math.floor(rnd() * pool.length)] : kind;
            const p = this.protos[k];
            if (!p) continue;
            let best = null;
            for (let tries = 0; tries < 30; tries++) {
                const x = x0 + rnd() * w, y = y0 + rnd() * h;
                const free = placed.every(q => Math.hypot(q.x - x, q.y - y) > q.r + p.rf + 4);
                best = { x, y };
                if (free) break;
            }
            placed.push({ x: best.x, y: best.y, r: p.rf });
            this.spawn(k, best.x, best.y, rnd() * 360, false, 0);
        }
    }

    removeItem(it) {
        if (it.body) it.body.dispose();
        World3D.removeObject(this.view, it.visual);
        Model3D.dispose(this.view, it.visual);
        it.proxy.dispose();
        it.body = null;
    }

    // Every frame after the physics: items that sank below the eat depth leave the scene.
    // Returns them: [{ kind, target, rf }].
    collectEaten() {
        const c = HoleScene.cfg(), out = [];
        for (const it of this.items) {
            if (it.eaten) continue;
            if (it.proxy.position.y < -c.eatDepth) {
                it.eaten = true;
                this.removeItem(it);
                out.push(it);
            }
        }
        if (out.length) this.items = this.items.filter(it => !it.eaten);
        return out;
    }

    // Items that are falling right now (below the floor, not yet eaten): the shot is not over.
    fallingCount() {
        let n = 0;
        for (const it of this.items) if (it.proxy.position.y < -2) n++;
        return n;
    }

    // Solid footprints for HoleModel: items resting on the floor that are too big to fall in.
    blockers(hole, c) {
        const out = [];
        for (const it of this.items) {
            const pos = it.proxy.position;
            if (pos.y < 0) continue;
            if (HoleModel.blocks(hole, it.rf, c)) out.push({ x: pos.x, y: pos.z, r: it.rf });
        }
        return out;
    }

    // --- The hole: floor with an opening, the well, the rim, the collider -------------------

    buildHole(x, y, r) {
        if (!this.node) {
            this.node = new BABYLON.TransformNode('hole', this.scene);
            const ground = this.app.location.terrain.material;
            this.floor = new BABYLON.Mesh('holeFloor', this.scene);
            this.floor.parent = this.node;
            this.floor.material = ground;
            this.floor.receiveShadows = true;
            this.floor.isPickable = false;
            this.well = BABYLON.MeshBuilder.CreateCylinder('holeWell', {
                diameter: 2, height: 1, tessellation: HoleScene.cfg().segments, cap: BABYLON.Mesh.NO_CAP,
                sideOrientation: BABYLON.Mesh.BACKSIDE, faceColors: undefined
            }, this.scene);
            this.well.parent = this.node;
            this.well.material = this._wellMaterial();
            this.wellBottom = BABYLON.MeshBuilder.CreateDisc('holeBottom', { radius: 1, tessellation: 32 }, this.scene);
            this.wellBottom.parent = this.node;
            this.wellBottom.rotation.x = Math.PI / 2;
            this.wellBottom.material = this._flatMaterial('holeBottomMat', 0x05070a);
            this.rim = BABYLON.MeshBuilder.CreateTorus('holeRim', { diameter: 2, thickness: 0.06, tessellation: 64 }, this.scene);
            this.rim.parent = this.node;
            this.rim.material = this._flatMaterial('holeRimMat', 0x2a1d3a);
            this.collider = new BABYLON.Mesh('holeCollider', this.scene);
            this.collider.parent = this.node;
            this.collider.setEnabled(false);
        }
        this.holeR = 0;
        this.setHole(x, y, r);
    }

    _flatMaterial(name, hex) {
        const m = new BABYLON.StandardMaterial(name, this.scene);
        m.disableLighting = true;
        m.emissiveColor = World3D.hexColor3(hex);
        m.metadata = { toon: false };
        return m;
    }

    // The well: dark at the rim, black at the bottom (vertex colors on an unlit material).
    _wellMaterial() {
        const m = new BABYLON.StandardMaterial('holeWellMat', this.scene);
        m.disableLighting = true;
        m.emissiveColor = new BABYLON.Color3(1, 1, 1);
        m.metadata = { toon: false };
        m.backFaceCulling = false;
        const pos = this.well.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const cols = [];
        for (let i = 0; i < pos.length; i += 3) {
            const k = pos[i + 1] > 0 ? HoleScene.cfg().wellShade : 0.0;
            cols.push(k * 0.8, k * 0.75, k, 1);
        }
        this.well.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols);
        return m;
    }

    // Move the hole; a new radius rebuilds the floor geometry and the collider.
    setHole(x, y, r) {
        const c = HoleScene.cfg();
        this.node.position.set(x, 0, y);
        if (Math.abs(r - this.holeR) > 0.25) {
            this.holeR = r;
            this._buildFloor(r);
            this.well.scaling.set(r, c.depth, r);
            this.well.position.y = -c.depth / 2;
            this.wellBottom.scaling.set(r, r, 1);
            this.wellBottom.position.y = -c.depth;
            this.rim.scaling.set(r, r * 0.6, r);
            this.rim.position.y = 0.6;
        }
        this._updateUVs(x, y);
        this._wakeNear(x, y, r);
    }

    // Havok puts resting items to sleep, and moving the floor (a teleported animated body) does
    // not wake them: a can the opening slid under would hang over the void. Items over or next
    // to the opening are kept awake, the rest sleep as the simulation decides.
    _wakeNear(x, y, r) {
        if (!this.plugin) return;
        const margin = HoleScene.cfg().wakeMargin, A = BABYLON.PhysicsActivationControl;
        for (const it of this.items) {
            if (!it.body) continue;
            const p = it.proxy.position;
            const near = Math.hypot(p.x - x, p.z - y) < r + it.rf + margin;
            if (near === it.awake) continue;
            it.awake = near;
            this.plugin.setActivationControl(it.body, near ? A.ALWAYS_ACTIVE : A.SIMULATION_CONTROLLED);
        }
    }

    // Polar floor around the opening + the well walls for the collider. Local frame: the hole
    // center at the origin. Ring radii grow geometrically: fine near the rim, coarse far away.
    _buildFloor(r) {
        const c = HoleScene.cfg(), S = c.segments, K = c.rings, far = Math.max(c.far, r * 4);
        const pos = [], idx = [];
        for (let k = 0; k <= K; k++) {
            const rho = r * Math.pow(far / r, k / K);
            for (let j = 0; j < S; j++) {
                const a = j / S * Math.PI * 2;
                pos.push(Math.cos(a) * rho, 0, Math.sin(a) * rho);
            }
        }
        for (let k = 0; k < K; k++) {
            for (let j = 0; j < S; j++) {
                const a = k * S + j, b = k * S + (j + 1) % S, d = (k + 1) * S + j, e = (k + 1) * S + (j + 1) % S;
                idx.push(a, d, b, b, d, e);
            }
        }
        // Normal check (+Y), as in Terrain3D: flip the winding if the engine sees it the other way.
        let normals = new Float32Array(pos.length);
        BABYLON.VertexData.ComputeNormals(pos, idx, normals);
        if (normals[1] < 0) {
            for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
            BABYLON.VertexData.ComputeNormals(pos, idx, normals);
        }
        const vd = new BABYLON.VertexData();
        vd.positions = pos;
        vd.indices = idx;
        vd.normals = normals;
        this._uvs = new Float32Array(pos.length / 3 * 2);
        vd.uvs = this._uvs;
        vd.applyToMesh(this.floor, true);
        this._floorPos = pos;
        this._lastUV = null;

        // Collider: the floor + the well walls (two rings: rim and bottom) as one triangle mesh.
        const cpos = pos.slice(), cidx = idx.slice(), base = cpos.length / 3;
        for (let j = 0; j < S; j++) {
            const a = j / S * Math.PI * 2;
            cpos.push(Math.cos(a) * r, -c.depth, Math.sin(a) * r);
        }
        for (let j = 0; j < S; j++) {
            const top = j, top2 = (j + 1) % S, bot = base + j, bot2 = base + (j + 1) % S;
            cidx.push(top, top2, bot, top2, bot2, bot);
        }
        const cvd = new BABYLON.VertexData();
        cvd.positions = cpos;
        cvd.indices = cidx;
        cvd.applyToMesh(this.collider, true);
        if (this.plugin) {
            const old = this.colliderShape;
            this.colliderShape = new BABYLON.PhysicsShapeMesh(this.collider, this.scene);
            this.colliderShape.material = { friction: 0.6, restitution: 0.2 };
            if (!this.colliderBody) {
                this.colliderBody = new BABYLON.PhysicsBody(this.node, BABYLON.PhysicsMotionType.ANIMATED, false, this.scene);
                this.colliderBody.setPrestepType(BABYLON.PhysicsPrestepType.TELEPORT);
            }
            this.colliderBody.shape = this.colliderShape;
            if (old) old.dispose();
        }
    }

    // UV = world position / location size (the terrain's own mapping, its texture tiles by itself).
    _updateUVs(x, y) {
        if (this._lastUV && this._lastUV.x === x && this._lastUV.y === y) return;
        this._lastUV = { x, y };
        const W = this.app.location.width, H = this.app.location.height, pos = this._floorPos, uv = this._uvs;
        for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
            uv[j] = (pos[i] + x) / W;
            uv[j + 1] = (pos[i + 2] + y) / H;
        }
        this.floor.updateVerticesData(BABYLON.VertexBuffer.UVKind, uv);
    }

    // --- Aim dots -------------------------------------------------------------------------

    // Dots along the polyline [{x, y}]; empty — hidden.
    showAim(points) {
        const c = HoleScene.cfg();
        if (!this.dots) {
            this.dots = BABYLON.MeshBuilder.CreateDisc('aimDot', { radius: 1, tessellation: 12 }, this.scene);
            this.dots.rotation.x = Math.PI / 2;
            this.dots.bakeCurrentTransformIntoVertices();
            this.dots.material = this._flatMaterial('aimDotMat', 0xffffff);
            this.dots.isPickable = false;
            this.dots.alwaysSelectAsActiveMesh = true;
        }
        const mats = [];
        let carry = 0;
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i], len = Math.hypot(b.x - a.x, b.y - a.y);
            for (let d = carry; d < len; d += c.dotStep) {
                const t = d / len;
                mats.push(BABYLON.Matrix.Scaling(c.dotSize, 1, c.dotSize).multiply(
                    BABYLON.Matrix.Translation(a.x + (b.x - a.x) * t, 1.5, a.y + (b.y - a.y) * t)));
            }
            carry = (carry + Math.ceil((len - carry) / c.dotStep) * c.dotStep) - len;
        }
        if (!mats.length) { this.dots.setEnabled(false); return; }
        const buf = new Float32Array(mats.length * 16);
        mats.forEach((m, i) => m.copyToArray(buf, i * 16));
        this.dots.thinInstanceSetBuffer('matrix', buf, 16, false);
        this.dots.setEnabled(true);
    }

    // Seeded random 0..1 (mulberry32): the same scatter on every run.
    static rng(seed) {
        let a = seed >>> 0;
        return () => {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
}
