// UILayout.js — the game's UI layout: every HUD element, placed and styled in the editor (UI tab).
// The editor rewrites the whole file (POST /api/save-ui) — keep the format. Drawn by js/UI.js;
// game code takes an element by id: UI.get('score').setText('10') — and never positions HUD itself.
//   kind — 'text' | 'panel' | 'bar' | 'button'; anchor — one of 9 screen points ('top-left' …
//   'bottom-right'): x, y go from it to the same point of the element (inward from an edge,
//   signed from the center); w, h — px; numbers are px of a screen UI_REF_HEIGHT tall;
//   parent (optional) — id of the element this one sits in: anchor, x, y then count from the
//   parent's box, the parent clips it and hides it together with itself;
//   stretch (optional) — 'h' | 'v' | 'both': fills the container on that axis, x (y) — the inset
//   from both edges, w (h) is ignored;
//   colors — '#rrggbb', '' — none; visible: 0 — hidden until the game calls show().
//   Records go in drawing order: later — on top.
const UI_LAYOUT = [
    { id: 'topPanel', kind: 'panel', anchor: 'top-center', x: 0, y: 0, w: 405, h: 58, stretch: 'h', fill: '#10202c', border: '', radius: 0, alpha: 0.55, visible: 1 },
    { id: 'levelName', kind: 'text', anchor: 'top-left', parent: 'topPanel', x: 12, y: 6, text: "Пикник", fontSize: 15, color: '#ffffff', shadow: '#0b1a24', alpha: 1, visible: 1 },
    { id: 'cans', kind: 'text', anchor: 'bottom-left', parent: 'topPanel', x: 12, y: 8, text: "Банки: 0 / 12", fontSize: 17, color: '#ffe27a', shadow: '#0b1a24', alpha: 1, visible: 1 },
    { id: 'shots', kind: 'text', anchor: 'bottom-right', parent: 'topPanel', x: 12, y: 8, text: "Выстрелы: 3", fontSize: 17, color: '#ffffff', shadow: '#0b1a24', alpha: 1, visible: 1 },
    { id: 'fps', kind: 'text', anchor: 'top-right', parent: 'topPanel', x: 12, y: 6, text: "60 fps", fontSize: 10, color: '#ffffff', shadow: '#0b1a24', alpha: 0.5, visible: 1 },
    { id: 'power', kind: 'text', anchor: 'middle-center', x: 0, y: 120, text: "", fontSize: 22, color: '#ffffff', shadow: '#0b1a24', alpha: 0.9, visible: 1 },
    { id: 'hint', kind: 'text', anchor: 'bottom-center', x: 0, y: 64, text: "Тяни назад и отпусти", fontSize: 14, color: '#ffffff', shadow: '#0b1a24', alpha: 0.85, visible: 1 },
    { id: 'restart', kind: 'button', anchor: 'bottom-left', x: 10, y: 12, w: 44, h: 40, text: "↺", fontSize: 22, color: '#ffffff', fill: '#24465c', border: '#ffffff', radius: 10, alpha: 0.9, visible: 1 },
    { id: 'prevLevel', kind: 'button', anchor: 'bottom-center', x: -40, y: 12, w: 44, h: 40, text: "◀", fontSize: 18, color: '#ffffff', fill: '#24465c', border: '#ffffff', radius: 10, alpha: 0.9, visible: 1 },
    { id: 'nextLevel', kind: 'button', anchor: 'bottom-center', x: 40, y: 12, w: 44, h: 40, text: "▶", fontSize: 18, color: '#ffffff', fill: '#24465c', border: '#ffffff', radius: 10, alpha: 0.9, visible: 1 },
    { id: 'tuneButton', kind: 'button', anchor: 'bottom-right', x: 10, y: 12, w: 96, h: 40, text: "Крутилки", fontSize: 14, color: '#ffffff', fill: '#24465c', border: '#ffffff', radius: 10, alpha: 0.9, visible: 1 },
    { id: 'result', kind: 'panel', anchor: 'top-left', x: 0, y: 0, w: 405, h: 720, stretch: 'both', fill: '#000000', border: '', radius: 0, alpha: 0.45, visible: 0 },
    { id: 'resultBox', kind: 'panel', anchor: 'middle-center', parent: 'result', x: 0, y: 0, w: 300, h: 190, fill: '#10202c', border: '#ffffff', radius: 16, alpha: 1, visible: 1 },
    { id: 'resultText', kind: 'text', anchor: 'top-center', parent: 'resultBox', x: 0, y: 22, text: "Все банки съедены!", fontSize: 22, color: '#ffe27a', shadow: '', alpha: 1, visible: 1 },
    { id: 'resultSub', kind: 'text', anchor: 'top-center', parent: 'resultBox', x: 0, y: 62, text: "", fontSize: 15, color: '#ffffff', shadow: '', alpha: 1, visible: 1 },
    { id: 'resultRetry', kind: 'button', anchor: 'bottom-left', parent: 'resultBox', x: 22, y: 22, w: 118, h: 46, text: "Заново", fontSize: 17, color: '#ffffff', fill: '#24465c', border: '#ffffff', radius: 12, alpha: 1, visible: 1 },
    { id: 'resultNext', kind: 'button', anchor: 'bottom-right', parent: 'resultBox', x: 22, y: 22, w: 118, h: 46, text: "Дальше", fontSize: 17, color: '#10202c', fill: '#ffe27a', border: '', radius: 12, alpha: 1, visible: 1 },
];
