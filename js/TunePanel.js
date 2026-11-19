// TunePanel.js — dev tool, not HUD: sliders that override the feel numbers live (HoleModel.tune).
// Like Debug3D it builds its own DOM; the HUD button 'tuneButton' (UILayout.js) toggles it.
// Values persist in Store ('hole-tune'); "Сбросить" returns to Constants.js. "Скопировать"
// puts the current values as Constants.js lines on the clipboard.

/** @satisfies {Record<string, any>} */
const TunePanel = {
    /** @type {HTMLElement | null} */
    el: null,
    game: null,
    // [constant, label, min, max, step, applies, cfg field]  applies: 'live' | 'restart';
    // the field is read from HoleModel.cfg() or, for item physics, HoleScene.cfg().
    ROWS: [
        ['HOLE_SPEED_MAX', 'Скорость броска, px/с', 60, 600, 10, 'live', 'speedMax'],
        ['HOLE_FRICTION', 'Трение, px/с²', 1, 80, 1, 'live', 'friction'],
        ['HOLE_RESTITUTION', 'Отскок от борта', 0.3, 1, 0.01, 'live', 'restitution'],
        ['HOLE_GROW_K', 'Скорость роста', 0.05, 2, 0.05, 'live', 'growK'],
        ['HOLE_START_RADIUS', 'Стартовый радиус, px', 20, 90, 1, 'restart', 'startRadius'],
        ['AIM_BOUNCES', 'Пунктир: отскоков', 0, 4, 1, 'live', 'aimBounces'],
        ['PHYS_GRAVITY', 'Гравитация предметов', 500, 6000, 100, 'live', 'gravity'],
        ['ITEM_FRICTION', 'Трение предметов', 0, 1.5, 0.05, 'restart', 'itemFriction']
    ],

    init(game) {
        TunePanel.game = game;
        const saved = Store.getJSON('hole-tune', {});
        for (const k of Object.keys(saved)) if (Number.isFinite(saved[k])) HoleModel.tune[k] = saved[k];
    },

    toggle() {
        if (!TunePanel.el) TunePanel.build();
        const on = TunePanel.el.style.display === 'none';
        TunePanel.el.style.display = on ? 'block' : 'none';
        if (on) TunePanel.refresh();
    },

    value(name) {
        const row = TunePanel.ROWS.find(r => r[0] === name);
        if (!row) return NaN;
        const m = HoleModel.cfg(), s = HoleScene.cfg();
        return Number(row[6] in m ? m[row[6]] : s[row[6]]);
    },

    build() {
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;right:8px;top:8px;width:260px;max-height:90vh;overflow:auto;z-index:50;' +
            'background:rgba(16,24,32,0.92);color:#e8eef2;font:12px system-ui,sans-serif;padding:10px;border-radius:8px;display:none';
        const rows = TunePanel.ROWS.map(([name, label, min, max, step, applies]) =>
            '<label style="display:block;margin:6px 0">' + label + (applies === 'restart' ? ' <i style="opacity:.6">(с рестарта)</i>' : '') +
            ' — <b data-v="' + name + '"></b><br><input type="range" data-k="' + name + '" min="' + min + '" max="' + max +
            '" step="' + step + '" style="width:100%"></label>').join('');
        el.innerHTML = '<b>Крутилки</b><div data-info style="margin:4px 0;opacity:.8"></div>' + rows +
            '<button data-a="reset">Сбросить</button> <button data-a="copy">Скопировать</button> <button data-a="close">×</button>';
        document.body.appendChild(el);
        el.addEventListener('pointerdown', e => e.stopPropagation());
        el.querySelectorAll('input[data-k]').forEach((node) => {
            const input = /** @type {HTMLInputElement} */ (node);
            input.addEventListener('input', () => TunePanel.set(input.dataset.k, Number(input.value)));
        });
        el.querySelector('[data-a="reset"]').addEventListener('click', () => {
            HoleModel.tune = {};
            Store.remove('hole-tune');
            TunePanel.apply();
            TunePanel.refresh();
        });
        el.querySelector('[data-a="copy"]').addEventListener('click', () => {
            const text = TunePanel.ROWS.map(r => 'const ' + r[0] + ' = ' + TunePanel.value(r[0]) + ';').join('\n');
            if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
            console.log(text);
        });
        el.querySelector('[data-a="close"]').addEventListener('click', () => TunePanel.toggle());
        TunePanel.el = el;
    },

    set(name, v) {
        HoleModel.tune[name] = v;
        Store.set('hole-tune', JSON.stringify(HoleModel.tune));
        TunePanel.apply();
        TunePanel.refresh();
    },

    // Live effects outside HoleModel: gravity of the item physics.
    apply() {
        const g = TunePanel.game;
        if (g && g.scene) g.scene.setGravity(HoleScene.cfg().gravity);
    },

    refresh() {
        const el = TunePanel.el;
        if (!el) return;
        for (const r of TunePanel.ROWS) {
            const v = TunePanel.value(r[0]);
            const input = /** @type {HTMLInputElement} */ (el.querySelector('input[data-k="' + r[0] + '"]'));
            if (input) input.value = String(v);
            const out = el.querySelector('[data-v="' + r[0] + '"]');
            if (out) out.textContent = String(Math.round(v * 100) / 100);
        }
        const c = HoleModel.cfg(), d = HoleModel.stopDistance(c, 1);
        const L = TunePanel.game && TunePanel.game.level;
        const info = el.querySelector('[data-info]');
        if (info) info.textContent = 'Полный бросок: путь ' + Math.round(d) + ' px' +
            (L ? ' ≈ ' + (d / L.h).toFixed(1) + ' длины стола' : '') + ', ' + (c.speedMax / c.friction).toFixed(0) + ' с';
    }
};
