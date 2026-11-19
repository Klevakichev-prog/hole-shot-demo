// HoleLevels.js — content: the item catalog (models) and the levels. Map px: x right, y down;
// the hole starts at `start` and the player shoots up the table. Every item is a physical body;
// items with `target: true` are the goal (cans) — eat them all within `shots` launches.
//
// Level record:
//   { id, name, w, h, shots, start: [x, y],
//     boards: [[x, y, w, h, rot]]  — static walls inside the table (never eaten, the hole bounces),
//     posts:  [[x, y, r]]          — static round posts,
//     items:  [[kind, x, y, rot]]  — single items,
//     scatter: [[kind, x, y, w, h, count, seed]] — items scattered over a rectangle (kind or a
//                  HOLE_POOLS name),
//     stacks: [[kind, x, y, rows, rot, target]] — a can wall: rows on rows, one fewer per row }

// scale — on top of ITEM_SCALE (the kit's models come in real-world meters); shape: 'cylinder' —
// an exact cylinder body instead of the convex hull (cans: stable stacks).
/** @type {Record<string, { model: string, scale?: number, shape?: string }>} */
const HOLE_ITEMS = {
    'soda-can': { model: 'assets/models/food/soda-can.glb', shape: 'cylinder' },
    'can': { model: 'assets/models/food/can.glb', shape: 'cylinder' },
    'can-small': { model: 'assets/models/food/can-small.glb', shape: 'cylinder' },
    'soda-bottle': { model: 'assets/models/food/soda-bottle.glb' },
    'apple': { model: 'assets/models/food/apple.glb' },
    'orange': { model: 'assets/models/food/orange.glb' },
    'tomato': { model: 'assets/models/food/tomato.glb' },
    'lemon': { model: 'assets/models/food/lemon.glb' },
    'pear': { model: 'assets/models/food/pear.glb' },
    'donut': { model: 'assets/models/food/donut.glb' },
    'cupcake': { model: 'assets/models/food/cupcake.glb' },
    'muffin': { model: 'assets/models/food/muffin.glb' },
    'mug': { model: 'assets/models/food/mug.glb' },
    'carton': { model: 'assets/models/food/carton.glb' },
    'pineapple': { model: 'assets/models/food/pineapple.glb' },
    'cabbage': { model: 'assets/models/food/cabbage.glb' },
    'burger': { model: 'assets/models/food/burger.glb' },
    'cheese': { model: 'assets/models/food/cheese.glb' },
    'cake': { model: 'assets/models/food/cake.glb', scale: 0.8 },
    'pot-stew': { model: 'assets/models/food/pot-stew.glb', scale: 0.7 },
    'barrel': { model: 'assets/models/food/barrel.glb', scale: 0.6 },
    'pizza-box': { model: 'assets/models/food/pizza-box.glb', scale: 0.6 },
    'whole-ham': { model: 'assets/models/food/whole-ham.glb' },
    'watermelon': { model: 'assets/models/food/watermelon.glb' },
    'pumpkin': { model: 'assets/models/food/pumpkin.glb' },
    'loaf': { model: 'assets/models/food/loaf.glb' },
    'croissant': { model: 'assets/models/food/croissant.glb' }
};

// Scatter pools: a scatter kind that names a pool picks a random item of it. 'small' — everything
// the starting hole swallows (around the start: a muffin or a cupcake there is a wall that bounces
// the first shot straight back); 'fruit' — with mid-size treats to eat after the first growth.
/** @type {Record<string, string[]>} */
const HOLE_POOLS = {
    small: ['apple', 'orange', 'tomato', 'lemon', 'pear', 'donut'],
    fruit: ['apple', 'orange', 'tomato', 'lemon', 'pear', 'donut', 'muffin', 'cupcake']
};

const HOLE_LEVELS = [
    {
        id: 'lab', name: 'Полигон', w: 720, h: 1200, shots: 9, start: [360, 1080],
        boards: [[200, 640, 160, 28, 0]],
        posts: [[520, 560, 34]],
        stacks: [['soda-can', 360, 260, 3, 0, true], ['soda-can', 560, 860, 2, 90, true]],
        items: [['cake', 150, 300, 20], ['barrel', 590, 330, 0], ['pumpkin', 140, 900, 0]],
        scatter: [['fruit', 80, 420, 560, 140, 14, 1], ['small', 80, 960, 560, 80, 8, 2]]
    },
    {
        // Level 1: cans in the open — learn the slingshot and the growth.
        id: 'picnic', name: 'Пикник', w: 720, h: 1200, shots: 3, start: [360, 1080],
        boards: [],
        posts: [],
        stacks: [['soda-can', 240, 300, 3, 0, true], ['soda-can', 500, 520, 3, 0, true]],
        items: [['watermelon', 600, 240, 0], ['cheese', 130, 620, 0], ['loaf', 590, 820, 30]],
        scatter: [['fruit', 80, 360, 560, 520, 22, 3], ['small', 120, 860, 480, 120, 8, 4]]
    },
    {
        // Level 2: the cans sit inside a ring of barrels — grow on the fruit first, then eat the ring.
        id: 'fortress', name: 'Крепость из бочек', w: 720, h: 1200, shots: 4, start: [360, 1080],
        boards: [],
        posts: [],
        stacks: [['soda-can', 360, 360, 3, 0, true]],
        items: [
            ['barrel', 570, 360, 90], ['barrel', 508, 508, 135], ['barrel', 360, 570, 0], ['barrel', 212, 508, 45],
            ['barrel', 150, 360, 90], ['barrel', 212, 212, 135], ['barrel', 360, 150, 0], ['barrel', 508, 212, 45],
            ['cake', 120, 760, 0], ['pot-stew', 600, 780, 0]
        ],
        scatter: [['fruit', 60, 640, 600, 200, 20, 5], ['small', 60, 840, 600, 180, 14, 10],
            ['fruit', 40, 60, 140, 140, 5, 6], ['fruit', 540, 40, 140, 120, 5, 7]]
    },
    {
        // Level 3: the cans hide behind boards — reach them off the side cushion or the posts.
        id: 'ricochet', name: 'Рикошет', w: 720, h: 1200, shots: 3, start: [360, 1080],
        boards: [[360, 520, 520, 30, 0], [170, 300, 30, 300, 0], [560, 220, 30, 220, 0]],
        posts: [[360, 760, 36], [180, 820, 30], [540, 820, 30]],
        stacks: [['soda-can', 360, 300, 3, 0, true], ['soda-can', 640, 120, 2, 90, true]],
        items: [['pumpkin', 90, 140, 0], ['cabbage', 300, 120, 0]],
        scatter: [['fruit', 220, 160, 300, 300, 10, 8], ['fruit', 60, 600, 600, 160, 8, 9], ['small', 60, 860, 600, 120, 10, 11]]
    }
];
