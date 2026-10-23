function legMarkup(index: number, fur: string, sock: string): string {
  return `<g data-part="legg${index}"><path data-part="leg${index}o" fill="#67432c" /><path data-part="leg${index}f" fill="${fur}" /><path data-part="leg${index}s" fill="${sock}" /></g>`
}

export const CHAT_MASCOT_STYLES = `
    .chat-mascot-row {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 84px;
      padding: 0 8px 2px;
      flex-shrink: 0;
    }
    .chat-mascot-row[hidden] { display: none; }
    .chat-mascot-stage {
      position: relative;
      flex: 1;
      min-width: 0;
      height: 82px;
      overflow: hidden;
      cursor: pointer;
      outline: none;
      border-radius: 5px;
    }
    .chat-mascot-stage:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    .chat-mascot-stage::before {
      position: absolute;
      right: 3px;
      bottom: 4px;
      left: 3px;
      height: 1px;
      content: '';
      background: linear-gradient(90deg, transparent, var(--vscode-widget-border, var(--vscode-panel-border)) 15%, var(--vscode-widget-border, var(--vscode-panel-border)) 85%, transparent);
      opacity: 0.75;
    }
    .chat-mascot-dog {
      position: absolute;
      bottom: 1px;
      left: 18%;
      width: 88px;
      height: 71px;
      transform: translateX(-50%);
      will-change: transform;
    }
    .chat-mascot-dog svg { display: block; width: 100%; height: 100%; overflow: visible; }
    .chat-mascot-face { width: 100%; height: 100%; transform: scaleX(var(--pet-facing, 1)); }
    .chat-mascot-mark {
      position: absolute;
      bottom: 58px;
      left: 74%;
      font: 700 12px var(--vscode-font-family);
      color: var(--vscode-charts-blue, #579bd3);
      white-space: nowrap;
      pointer-events: none;
    }
    .chat-mascot-mark:not(:empty) { animation: mascot-float 2.6s ease-in-out infinite; }
    .chat-mascot-spark {
      position: absolute;
      pointer-events: none;
      width: 7px;
      height: 7px;
      border-radius: 2px;
      background: var(--vscode-charts-yellow, #e2b86d);
    }
    .chat-mascot-menu {
      position: fixed;
      z-index: 2000;
      display: grid;
      grid-template-columns: repeat(3, minmax(84px, 1fr));
      gap: 1px;
      min-width: 270px;
      max-height: calc(100vh - 8px);
      overflow-y: auto;
      padding: 4px;
      color: var(--vscode-menu-foreground, var(--vscode-foreground, #cccccc));
      background: var(--vscode-menu-background, var(--vscode-editorWidget-background, #252526));
      border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent));
      border-radius: 6px;
      box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
      font: 12px var(--vscode-font-family);
    }
    .chat-mascot-menu-title {
      grid-column: 1 / -1;
      margin: 4px 6px 1px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      opacity: 0.65;
    }
    .chat-mascot-menu-item {
      padding: 3px 8px;
      color: inherit;
      font: inherit;
      text-align: left;
      white-space: nowrap;
      cursor: pointer;
      background: none;
      border: 0;
      border-radius: 3px;
    }
    .chat-mascot-menu-item:hover,
    .chat-mascot-menu-item:focus-visible {
      outline: none;
      color: var(--vscode-menu-selectionForeground, inherit);
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
    }
    @keyframes mascot-float {
      0% { opacity: 0; transform: translate(0, 5px) scale(.8); }
      30% { opacity: .95; }
      100% { opacity: 0; transform: translate(4px, -14px) scale(1.15); }
    }
    @media (prefers-reduced-motion: reduce) {
      #chatMascotRow * { animation: none !important; transition: none !important; }
    }
    .chat-mascot-row[data-paused="true"] * { animation-play-state: paused !important; }
`

export const CHAT_MASCOT_HTML = `
  <div class="chat-mascot-row" id="chatMascotRow">
    <div
      class="chat-mascot-stage"
      id="chatMascotStage"
      role="slider"
      tabindex="0"
      aria-label="Max the puppy's position"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow="18"
      title="Max: click to hop, double-click to run, right-click for tricks. Arrow keys move; Space plays."
    >
      <div class="chat-mascot-dog" id="chatMascotDog" aria-hidden="true">
        <div class="chat-mascot-mark" id="chatMascotMark"></div>
        <div class="chat-mascot-face">
        <svg viewBox="0 0 104 84" role="presentation">
          <defs><clipPath id="chatMascotEyeClip"><ellipse cx="12.6" cy="-3.8" rx="6.2" ry="6" /></clipPath></defs>
          <ellipse data-part="shadow" cx="52" cy="80.6" rx="30" ry="2.6" fill="#000" opacity=".18" />
          <g data-part="root">
            <path data-part="tailO" fill="#67432c" />
            <path data-part="tailF" fill="#d9a363" />
            <path data-part="tailT" fill="#fff0d6" />
            ${legMarkup(1, "#c28f55", "#efd7b0")}
            ${legMarkup(3, "#c28f55", "#efd7b0")}
            <path data-part="neckO" fill="#67432c" />
            <path data-part="torsoFill" fill="#e2b372" />
            <path data-part="saddle" fill="#cf9a5c" />
            <path data-part="belly" fill="#fff0d6" />
            <path data-part="torsoLine" fill="none" stroke="#67432c" stroke-width="1.4" stroke-linejoin="round" />
            <path data-part="neckF" fill="#e6bb7c" />
            ${legMarkup(0, "#e2b372", "#fff0d6")}
            ${legMarkup(2, "#e8bc7c", "#fff0d6")}
            <path data-part="collarO" fill="#315b63" />
            <path data-part="collarF" fill="#4f9db1" />
            <circle data-part="tag" r="2.3" fill="#f1d36f" stroke="#906f32" stroke-width=".8" />
            <g data-part="headG">
              <g data-part="earF">
                <path d="M-1.5 0 C-7.5 -1 -10.5 7 -9.5 15 C-9 20 -3 20.5 -.5 15 C1.5 10 3 4 2.5 .5Z" fill="#94602f" stroke="#67432c" stroke-width="1.2" stroke-linejoin="round" />
              </g>
              <path data-part="jawIn" fill="#5a2f30" />
              <g data-part="jawG">
                <path d="M10 3.6 L26.2 3.6 C28.4 4.2 28 7 25.2 7.8 C19 9.2 14 9 10 7.6 Z" fill="#fff0d6" stroke="#67432c" stroke-width="1.2" stroke-linejoin="round" />
                <g data-part="tongue">
                  <path d="M13 3.9 C17 3.5 22 3.6 26 4.4 C29.4 5.6 30.2 9.5 28.4 12.2 C27.2 13.6 25 13.2 24.6 11.4 C24.2 9.4 23.8 7.6 21 6.6 C18 5.8 15 5.6 13 5.4Z" fill="#e8838a" stroke="#b24c58" stroke-width=".7" stroke-linejoin="round" />
                  <path d="M20 5.2 Q25.5 6.6 26.8 11.2" fill="none" stroke="#b24c58" stroke-width=".6" stroke-linecap="round" />
                </g>
              </g>
              <circle cx="5" cy="0" r="11.6" fill="#ecc58a" stroke="#67432c" stroke-width="1.4" />
              <ellipse cx="12.6" cy="-3.8" rx="6.2" ry="6" fill="#d9a96a" />
              <path d="M8 -6 C13 -7 21 -6 27 -4 C30.8 -3 31.4 1.8 28.2 3.4 C23 4.6 15 4.6 9 4 C6.6 2 6.6 -4 8 -6 Z" fill="#fff0d6" />
              <path d="M10.5 -6.4 C15 -6.6 21.5 -5.8 27 -4 C30.8 -3 31.4 1.8 28.2 3.4 C23 4.6 16 4.6 11 4.2" fill="none" stroke="#67432c" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
              <ellipse cx="29.4" cy="-1.5" rx="3" ry="2.4" fill="#2d2420" />
              <ellipse cx="28.6" cy="-2.5" rx="1.1" ry=".6" fill="#fff" opacity=".75" />
              <path d="M29 .8 Q28 3 25 3.4" fill="none" stroke="#67432c" stroke-width=".9" stroke-linecap="round" />
              <circle cx="24" cy="-.2" r=".5" fill="#b77a41" opacity=".6" />
              <circle cx="21.6" cy="-1.2" r=".5" fill="#b77a41" opacity=".6" />
              <circle cx="25.8" cy="1.4" r=".5" fill="#b77a41" opacity=".6" />
              <ellipse data-part="blush" cx="17" cy="2.2" rx="3" ry="1.9" fill="#f08a8a" opacity="0" />
              <g data-part="eyeG">
                <ellipse cx="12.6" cy="-4.2" rx="3.1" ry="3.6" fill="#2d2420" />
                <circle cx="13.9" cy="-5.6" r="1.25" fill="#fff" />
                <circle cx="11.6" cy="-2.7" r=".6" fill="#fff" opacity=".85" />
              </g>
              <rect data-part="lid" x="8.4" y="-8.6" width="8.8" height="0" fill="#d9a96a" clip-path="url(#chatMascotEyeClip)" />
              <path data-part="eyeClosed" d="M10 -3.4 Q12.6 -1.2 15.2 -3.4" fill="none" stroke="#2d2420" stroke-width="1.3" stroke-linecap="round" opacity="0" />
              <path data-part="eyeHappy" d="M10 -2.2 Q12.6 -6.8 15.2 -2.2" fill="none" stroke="#2d2420" stroke-width="1.4" stroke-linecap="round" opacity="0" />
              <ellipse data-part="brow" cx="12.4" cy="-10.2" rx="2.1" ry="1.1" fill="#b77a41" />
              <g data-part="earN">
                <path d="M-1.5 0 C-7.5 -1 -10.5 7 -9.5 15 C-9 20 -3 20.5 -.5 15 C1.5 10 3 4 2.5 .5Z" fill="#b77a41" stroke="#67432c" stroke-width="1.3" stroke-linejoin="round" />
                <path d="M-4.6 4 C-6.2 8.5 -5.8 12.5 -3.8 15.6" fill="none" stroke="#d19559" stroke-width="1.8" stroke-linecap="round" />
              </g>
            </g>
          </g>
        </svg>
        </div>
      </div>
    </div>
  </div>
`

export const CHAT_MASCOT_SCRIPT = `
    function createAcpChatMascot(onChange) {
      const row = document.getElementById('chatMascotRow');
      const stage = document.getElementById('chatMascotStage');
      const dog = document.getElementById('chatMascotDog');
      const facing = dog.querySelector('.chat-mascot-face');
      const mark = document.getElementById('chatMascotMark');
      const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

      // Rig units are SVG viewBox units; y grows downward and the ground is y = GY.
      const GY = 80, CX = 52, D = 30, SCALE = 0.846, R_ANK = 2.6, GRAV = 760;
      const HP0 = 30, HS0 = 28.5, HP_MIN = 10, HS_MIN = 13.2;
      const P0X = CX - D / 2, S0X = CX + D / 2;
      const RAD = Math.PI / 180;
      const lim = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const mix = (a, b, t) => a + (b - a) * t;
      const f2 = n => Math.round(n * 100) / 100;
      const smooth = t => { t = lim(t, 0, 1); return t * t * (3 - 2 * t); };
      const ramp = (t, a, b) => smooth((t - a) / (b - a));
      const bell = p => Math.sin(lim(p, 0, 1) * Math.PI);
      const clock = () => performance.now();

      const names = ['shadow', 'root', 'tailO', 'tailF', 'tailT', 'neckO', 'neckF', 'torsoFill', 'saddle', 'belly', 'torsoLine',
        'collarO', 'collarF', 'tag', 'headG', 'earF', 'earN', 'eyeG', 'lid', 'eyeClosed', 'eyeHappy', 'brow', 'blush', 'jawIn', 'jawG', 'tongue'];
      for (let leg = 0; leg < 4; leg++) for (const part of ['o', 'f', 's']) names.push('leg' + leg + part);
      for (let leg = 0; leg < 4; leg++) names.push('legg' + leg);
      const el = {};
      for (const name of names) el[name] = dog.querySelector('[data-part="' + name + '"]');
      const put = (name, key, value) => el[name].setAttribute(key, value);

      // Legs: a = upper bone, b = lower bone, c = pastern/metatarsus, bend = +1 knee forward (hind) / -1 elbow back (front).
      const LEGS = [
        { hind: 1, a: 12, b: 12, c: 8, toe: 6, bend: 1, ax: 4, hx: 1, hy: 1, heel: 12, r: [6, 4.3, 3.1, 2.7, 2.5] },
        { hind: 1, a: 12, b: 12, c: 8, toe: 6, bend: 1, ax: -1, hx: -1, hy: 0, heel: 12, r: [5.6, 4.1, 3, 2.6, 2.4] },
        { hind: 0, a: 11, b: 12.5, c: 5, toe: 6, bend: -1, ax: 2, hx: 0, hy: 1, heel: 2, r: [5, 3.8, 2.9, 2.7, 2.5] },
        { hind: 0, a: 11, b: 12.5, c: 5, toe: 6, bend: -1, ax: -3, hx: -1.5, hy: 0, heel: 2, r: [4.8, 3.6, 2.8, 2.6, 2.4] }
      ];
      const TORSO = ['M', -10.5, -2, 'C', -10.5, -8, -5, -11.5, 2, -11.5, 'C', 10, -12.3, 22, -12.3, D + 2, -11.5,
        'C', D + 8, -11, D + 13.5, -7, D + 13.5, 0, 'C', D + 13.5, 8, D + 9, 13.5, D + 2, 13.5,
        'C', D - 4, 13.5, 20, 8.5, 12, 8.5, 'C', 6, 8.5, 2, 10, -3, 9.5, 'C', -8, 9, -10.5, 5, -10.5, -2, 'Z'];
      const BELLY = ['M', D + 13, 1, 'C', D + 13, 8, D + 9, 13, D + 2, 13, 'C', D - 4, 13, 20, 8, 12, 8,
        'C', 8, 8, 6, 7.8, 5, 7.5, 'C', 8, 4.5, 16, 4, 22, 4.5, 'C', D, 5, D + 9, 3.5, D + 13, 1, 'Z'];
      const SADDLE = ['M', 3, -10.8, 'C', 10, -11.8, 22, -11.8, D + 1, -11, 'C', 27, -5, 14, -3, 5, -5.5, 'C', 2, -7, 1, -9, 3, -10.8, 'Z'];

      // Spring-damper channel: every soft body part owns one so it settles, overshoots and follows through by itself.
      const springs = [];
      function spring(value, hz, zeta) {
        const w = 2 * Math.PI * hz;
        const s = { v: value, d: 0, t: value, k: w * w, c: 2 * zeta * w };
        springs.push(s);
        return s;
      }
      const sp = {
        hp: spring(HP0, 3.2, .5), hs: spring(HS0, 3.2, .5),
        neck: spring(54, 3.4, .6), head: spring(6, 3.8, .55), len: spring(9, 4, .9),
        earN: spring(8, 5.5, .28), earF: spring(12, 5.2, .28),
        t1: spring(34, 6, .42), t2: spring(34, 5, .4), t3: spring(34, 4.2, .4),
        jaw: spring(0, 10, .65), tongue: spring(0, 7, .8),
        eye: spring(1, 14, 1), happy: spring(0, 8, 1), brow: spring(0, 7, .8), blush: spring(0, 5, 1),
        gx: spring(0, 8, 1), gy: spring(0, 8, 1), arch: spring(0, 4, .6),
        roll: spring(0, 2.6, .6), rot: spring(0, 5, .5), sq: spring(0, 6, .45), yaw: spring(0, 9, .7)
      };
      const legSp = LEGS.map(leg => ({
        x: spring(0, 5, .8), y: spring(0, 7, .75), heel: spring(leg.heel, 6, .8), toe: spring(0, 8, .8),
        free: spring(0, 6, 1), fx: spring(0, 7, .75), fy: spring(0, 7, .75)
      }));
      const SOFT = ['neck', 'head', 'len', 'earN', 'earF', 'jaw', 'tongue', 'eye', 'happy', 'brow', 'blush', 'gx', 'gy', 'arch', 'roll', 'rot', 'sq', 'yaw'];

      // Targets are rebuilt from scratch every frame by the active behaviour; springs do all of the blending.
      const T = { leg: LEGS.map(() => ({})) };
      function rest() {
        T.toneP = 1; T.toneS = 1; T.neck = 54; T.head = 6; T.len = 9; T.earN = 8; T.earF = 12;
        T.tail = 34; T.wag = 5; T.wagHz = 1.1; T.curl = 8; T.jaw = 0; T.tongue = 0; T.eye = 1; T.happy = 0; T.brow = 0;
        T.blush = 0; T.gx = 0; T.gy = 0; T.arch = 0; T.roll = 0; T.rot = 0; T.sq = 0; T.yaw = 0; T.shake = 0; T.breath = 1; T.breathHz = .45;
        for (let i = 0; i < 4; i++) {
          const l = T.leg[i];
          l.x = 0; l.y = 0; l.heel = LEGS[i].heel; l.toe = 0; l.free = 0; l.fx = 0; l.fy = 0;
        }
      }
      rest();

      let enabled = true, position = 18, activity = 'idle', frame = 0, timer = 0;
      let travel = null, action = null, turn = null;
      let lastInteraction = clock(), talkingUntil = 0, disposed = false, direction = 1;
      let speed = 0, phase = 0, lastNow = 0, wagPh = 0, blinkAt = 0, blinkStart = -1000;
      let prevRide = 0, prevHeadD = 0, lastAria = -1;
      let pointerRel = 0, pointerUntil = 0;
      let turnBody = 0, turnHead = 0, menu = null;
      const TURN_MS = 460, GALLOP_MIN = 100, BRAKE = 250;
      const WATCH_MS = 3000, HOLD = 12, ZONE_HYST = 24, TRACK_MS = 900, WATCH_TURN_MS = 340;
      // Catch-up: speed grows with how far behind the caret the dog is, so it keeps pace with any typing speed.
      const CATCH = 4, CATCH_BASE = 10, CATCH_FLOOR = 40, CATCH_BRAKE = 700, CATCH_ACCEL = 800, JUMP_PX = 150;
      const promptBox = document.getElementById('promptInput');
      let lastCaretKey = '', caretVel = 0, caretMoveAt = -1e9;
      const WATCH_TONE = .85, WATCH_LEN = 10, GAZE_GAP = 24;
      let lastTyped = -1e9, backing = false;
      let watchUntil = 0, watchOn = false, watchPrev = false, caretDirty = false, haveCaret = false, caretPx = 0, gaze = null, mirror = null;
      const air = { y: 0, vy: 0, vx: 0 };
      const rig = { Px: P0X, Py: GY - HP0, Sx: S0X, Sy: GY - HS0, Cx: CX, Cy: GY - 26 };
      const pendingTools = new Set();
      // Tool calls are often instant and parallel, so the pose follows a debounced state rather than each start/finish.
      const TOOL_DELAY = 700, TOOL_HOLD = 1200;
      let toolSince = 0, toolClearAt = 0, investigating = false;
      const particles = new Set();

      function active() { return enabled && !document.hidden && !disposed; }
      function clampPos(value) {
        const margin = Math.min(50, 44 / Math.max(1, stage.clientWidth) * 100);
        return Math.max(margin, Math.min(100 - margin, value));
      }
      function remember() { onChange({ enabled, position }); }

      // ---- geometry helpers ----
      function cap(x1, y1, r1, x2, y2, r2) {
        let dx = x2 - x1, dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const nx = -dy, ny = dx;
        return 'M' + f2(x1 + nx * r1) + ' ' + f2(y1 + ny * r1) + 'L' + f2(x2 + nx * r2) + ' ' + f2(y2 + ny * r2)
          + 'A' + f2(r2) + ' ' + f2(r2) + ' 0 0 0 ' + f2(x2 - nx * r2) + ' ' + f2(y2 - ny * r2)
          + 'L' + f2(x1 - nx * r1) + ' ' + f2(y1 - ny * r1)
          + 'A' + f2(r1) + ' ' + f2(r1) + ' 0 0 0 ' + f2(x1 + nx * r1) + ' ' + f2(y1 + ny * r1) + 'Z';
      }
      function spineAt(t) {
        const u = 1 - t;
        const x = u * u * rig.Px + 2 * u * t * rig.Cx + t * t * rig.Sx;
        const y = u * u * rig.Py + 2 * u * t * rig.Cy + t * t * rig.Sy;
        const tx = 2 * u * (rig.Cx - rig.Px) + 2 * t * (rig.Sx - rig.Cx);
        const ty = 2 * u * (rig.Cy - rig.Py) + 2 * t * (rig.Sy - rig.Cy);
        const l = Math.hypot(tx, ty) || 1;
        return [x, y, tx / l, ty / l];
      }
      // Torso-local (along spine, down) to world; the spine is a bendable curve between pelvis and shoulder.
      function body(lx, ly) {
        const t = lx / D;
        const s = spineAt(lim(t, 0, 1));
        const along = t < 0 ? lx : t > 1 ? lx - D : 0;
        return [s[0] + s[2] * along - s[3] * ly, s[1] + s[3] * along + s[2] * ly];
      }
      function mapPath(cmds, breath) {
        let out = '', i = 0;
        while (i < cmds.length) {
          const c = cmds[i++];
          out += c;
          const n = c === 'C' ? 3 : c === 'Z' ? 0 : 1;
          for (let k = 0; k < n; k++) {
            const p = body(cmds[i], cmds[i + 1] * breath);
            i += 2;
            out += f2(p[0]) + ' ' + f2(p[1]) + (k < n - 1 ? ' ' : '');
          }
        }
        return out;
      }
      // Two-bone IK from hip to the hock/wrist; the lower bone hangs off the ankle at the heel angle.
      function ik(L, hx, hy, ax, ay, heel) {
        const h = heel * RAD;
        let jx = ax - L.c * Math.sin(h), jy = ay - L.c * Math.cos(h);
        let dx = jx - hx, dy = jy - hy;
        let d = Math.hypot(dx, dy);
        if (d < .001) { dx = 0; dy = 1; d = .001; }
        const dc = lim(d, Math.abs(L.a - L.b) + .4, L.a + L.b - .06);
        if (dc !== d) {
          jx = hx + dx / d * dc; jy = hy + dy / d * dc;
          dx = jx - hx; dy = jy - hy; d = dc;
        }
        const alpha = Math.acos(lim((L.a * L.a + d * d - L.b * L.b) / (2 * L.a * d), -1, 1));
        const ang = Math.atan2(dy, dx) - L.bend * alpha;
        return {
          kx: hx + L.a * Math.cos(ang), ky: hy + L.a * Math.sin(ang), jx, jy,
          ax: jx + L.c * Math.sin(h), ay: jy + L.c * Math.cos(h)
        };
      }

      // ---- locomotion ----
      const GAITS = [
        { v: 0, stride: 0, duty: .7, lift: 0, bob: 0, one: 0, off: [0, .5, .25, .75] },
        { v: 50, stride: 10, duty: .64, lift: 3.4, bob: .5, one: 0, off: [0, .5, .25, .75] },
        { v: 125, stride: 16, duty: .52, lift: 5.8, bob: 1.5, one: 0, off: [0, .5, .5, 1] },
        // Four-beat gallop: far hind, near hind, far front, near front, then one flight phase with the legs gathered.
        { v: 215, stride: 25, duty: .38, lift: 9.5, bob: 2.6, one: 1, off: [0, .12, .62, .74] }
      ];
      function gaitFor(v) {
        let i = 0;
        while (i < GAITS.length - 2 && v > GAITS[i + 1].v) i++;
        const a = GAITS[i], b = GAITS[i + 1];
        const k = lim((v - a.v) / (b.v - a.v), 0, 1);
        return {
          stride: mix(a.stride, b.stride, k), duty: mix(a.duty, b.duty, k), lift: mix(a.lift, b.lift, k),
          bob: mix(a.bob, b.bob, k), one: mix(a.one, b.one, k), off: a.off.map((o, j) => mix(o, b.off[j], k))
        };
      }
      function footGait(i, g) {
        const p = (((phase + g.off[i]) % 1) + 1) % 1;
        if (p < g.duty) return { dx: g.stride * (.5 - p / g.duty), dy: 0, heel: 0, toe: 0 };
        const s = (p - g.duty) / (1 - g.duty);
        const arc = Math.sin(Math.PI * s);
        return { dx: g.stride * (smooth(s) - .5), dy: g.lift * arc, heel: LEGS[i].hind ? 26 * arc : -38 * arc, toe: 22 * arc };
      }

      // ---- postures ----
      function sitPose() {
        T.toneP = 0;
        T.leg[0].x = 7; T.leg[1].x = 9; T.leg[0].heel = 88; T.leg[1].heel = 88;
        T.neck = 70; T.head = -6; T.tail = -6; T.earN = 12; T.earF = 15;
      }
      function lieFront() {
        T.toneS = 0;
        T.leg[2].x = 17; T.leg[3].x = 14; T.leg[2].heel = 88; T.leg[3].heel = 88;
        T.neck = -78; T.head = 14; T.len = 5; T.earN = 24; T.earF = 28;
      }
      function bowPose(feet, heel) {
        T.toneS = 0;
        T.leg[2].x = feet; T.leg[3].x = feet - 2; T.leg[2].heel = heel; T.leg[3].heel = heel;
      }
      function jump(vy, vx) {
        if (air.y > .5) return;
        air.vy = vy; air.vx = vx || 0; air.y = .01;
        sp.sq.d -= 2.4; sp.hp.d += 20; sp.hs.d += 20;
      }
      function flail(i, w, spread) {
        const l = T.leg[i];
        l.free = 1;
        l.fx = (LEGS[i].hind ? 5 : 7) + spread * Math.sin(w + i * 1.7);
        l.fy = -(17 + 4 * Math.sin(w * 1.3 + i));
        l.heel = LEGS[i].hind ? 40 : -30;
      }
      function wag(amount, hz) { T.wag = amount; T.wagHz = hz; }

      const DUR = { sniff: 2.8, stretch: 3.4, scratch: 2.8, shake: 1.9, shakeoff: 1.9, bow: 2.2, look: 2, roll: 3.8, belly: 4.2, paw: 3, sit: 4.8,
        sneeze: 1.6, pounce: 3, nap: 14, sad: 3.4, celebrate: 2.5, pet: 2, tilt: 2.2, investigate: 1.8, beg: 4 };
      const ACTIONS = {
        sit(a) {
          if (a.t > .2 && a.t < a.len - .7) {
            sitPose();
            if (a.t > 1.1) { wag(16, 2.3); T.tongue = .7; T.jaw = .1 + .06 * Math.sin(a.t * 14); T.happy = 1; T.eye = 0; }
          } else T.neck = 60;
        },
        nap(a) {
          const t = a.t;
          if (t < 1.1) { T.jaw = .8 * bell(t / 1.1); T.eye = .55; T.neck = 62; T.head = -8; }
          if (t > .6) sitPose();
          if (t >= 1.1 && t < 2.9) { T.eye = .38 + .2 * Math.sin(t * 2.4); T.neck = 60 - (t - 1.1) * 14; T.head = 8 + (t - 1.1) * 14; T.earN = 20; }
          if (t >= 2.9) {
            lieFront();
            T.eye = 0; T.tail = -14; T.wag = 1.5; T.wagHz = .5; T.breath = 2.6; T.breathHz = .3;
            const twitch = Math.sin(t * 2.3) * Math.sin(t * .71);
            if (t > 4.5 && twitch > .88) { T.earF = 2; T.leg[3].x = 15.5; T.tail = -4; }
          }
        },
        sad(a) {
          sitPose();
          T.neck = 34; T.head = 34; T.earN = 28; T.earF = 32; T.tail = -30; T.wag = 0; T.brow = 1; T.eye = .8; T.gy = -.9; T.breath = 1.6;
        },
        bow(a) {
          if (a.t > .15 && a.t < a.len - .55) {
            bowPose(10, 55);
            T.neck = 34; T.head = -12; T.tail = 62; wag(20, 4.8); T.tongue = .8; T.jaw = .16; T.earN = 0; T.earF = 4;
          }
        },
        stretch(a) {
          const t = a.t;
          if (t > .2 && t < a.len - .5) {
            bowPose(11, 60);
            T.leg[0].x = -3; T.leg[1].x = -4; T.arch = -2; T.neck = 14; T.head = 38; T.tail = 55; wag(8, 2.5);
            if (t > .7 && t < 2.2) { T.jaw = .9; T.eye = .1; T.tongue = 1; T.neck = 24; T.head = 12; }
          }
        },
        sniff(a) {
          const t = a.t, env = ramp(t, 0, .35) * (1 - ramp(t, a.len - .45, a.len));
          T.toneS = mix(1, .7, env);
          T.neck = mix(54, -64 + 4 * Math.sin(t * 3.1), env); T.head = mix(6, 50 + 9 * Math.sin(t * 5.3), env);
          T.tail = 52; wag(12, 3.2); T.earN = 0; T.earF = 4; T.gy = .8 * env;
        },
        scratch(a) {
          const t = a.t;
          if (t > .15 && t < a.len - .5) {
            sitPose(); T.neck = 46; T.head = 34; T.eye = .5; T.earN = 30;
            if (t > .55) {
              const l = T.leg[0];
              l.free = 1; l.fx = 18; l.fy = 10 + 3.5 * Math.sin(t * 26); l.heel = 60;
              T.earN = 30 + 12 * Math.sin(t * 26);
            }
          }
        },
        shake(a) {
          const env = ramp(a.t, 0, .15) * (1 - ramp(a.t, a.len - .4, a.len));
          const w = a.t * Math.PI * 2 * 6.5;
          T.eye = .55; T.jaw = env * (.1 + .08 * Math.sin(w * 2)); wag(6, 1.6);
          T.yaw = env * 38 * Math.sin(w);
          T.head += env * 5 * Math.sin(w * 2 + .6);
          T.earN = 8 + env * 34 * Math.sin(w - 1.1); T.earF = 12 + env * 40 * Math.sin(w - 1.5);
        },
        shakeoff(a) {
          const env = ramp(a.t, 0, .2) * (1 - ramp(a.t, a.len - .5, a.len));
          const w = a.t * Math.PI * 2 * 8.5;
          T.shake = env; T.toneP = T.toneS = .93; T.eye = .5; wag(26, 7);
          T.neck += env * 10 * Math.sin(w); T.head += env * 20 * Math.sin(w + .8);
          T.arch = env * 1.6 * Math.sin(w + 2);
        },
        look(a) { T.neck = 66; T.head = -10; T.earN = -6; T.earF = -2; T.eye = 1.1; T.gx = .8; wag(8, 2.2); },
        tilt(a) {
          const e = bell(a.t / a.len);
          T.neck = 60; T.head = 6 + 24 * e; T.earN = 8 - 18 * e; T.earF = 12 + 20 * e; T.eye = 1.1; T.gx = .7 * e; wag(10, 2.6);
        },
        paw(a) {
          if (a.t > .2 && a.t < a.len - .6) {
            sitPose(); T.tongue = .6; T.jaw = .1; wag(18, 3);
            if (a.t > .8) {
              const l = T.leg[2];
              l.free = 1; l.fx = 15; l.fy = 3 + 3 * Math.sin(a.t * 9); l.heel = -30;
            }
          }
        },
        sneeze(a) {
          const t = a.t;
          if (t < .55) { T.neck = 66; T.head = -16 - 10 * ramp(t, 0, .5); T.eye = .3; T.jaw = .5 * ramp(t, .2, .5); }
          else {
            if (!a.s.fired) { a.s.fired = true; sp.head.d += 520; sp.hs.d -= 40; sp.hp.d -= 30; sp.jaw.d -= 5; }
            T.head = 6 + 22 * (1 - ramp(t, .55, 1.3)); T.eye = .2 + .8 * ramp(t, .8, 1.2); T.earN = 30; T.earF = 34;
          }
        },
        roll(a) {
          const t = a.t;
          if (t < .5) { T.toneP = .35; T.toneS = .35; T.neck = 40; T.head = 24; }
          else if (t < a.len - .7) {
            T.roll = 180; T.rot = t > 1.1 ? Math.sin(t * 8) * 6 : 0;
            T.toneP = .5; T.toneS = .5; T.neck = -35; T.head = 4; T.len = 9; T.tail = -45;
            T.earN = 82; T.earF = 92;
            T.happy = 1; T.eye = 0; wag(24, 4);
            const w = t * 9;
            for (let i = 0; i < 4; i++) flail(i, w + (a.kind === 'belly' ? Math.sin(t * 2) : 0), a.kind === 'belly' ? 4 : 6);
          } else { T.toneP = .6; T.toneS = .6; }
        },
        belly(a, sec) { ACTIONS.roll(a, sec); },
        pounce(a) {
          const t = a.t;
          if (t < 1.0) {
            bowPose(9, 55);
            T.leg[0].x = 2 * Math.sin(t * 38); T.leg[1].x = 2 * Math.sin(t * 38 + Math.PI);
            T.neck = 38; T.head = -8; T.tail = 66; wag(22, 6); T.eye = 1.1; T.gx = .8; T.earN = 0; T.earF = 4;
          } else {
            if (!a.s.jumped) { a.s.jumped = true; jump(170, 110 * direction); }
            T.neck = 44; T.head = 12; T.tail = 58; wag(14, 4);
            if (t > 1.9) { bowPose(9, 55); T.neck = 34; T.head = -10; T.tongue = .8; T.jaw = .15; wag(22, 5); }
          }
        },
        celebrate(a) {
          const t = a.t;
          T.tongue = .8; T.jaw = .3; T.tail = 56; wag(26, 5.5); T.happy = 1; T.eye = 0; T.earN = 0; T.earF = 6;
          if (t < .22 || (t > 1.0 && t < 1.2)) { T.toneP = T.toneS = .2; T.neck = 46; }
          if (t >= .22 && !a.s.j1) { a.s.j1 = true; jump(150, 0); }
          if (t >= 1.2 && !a.s.j2) { a.s.j2 = true; jump(135, 0); }
          if (t > 2) { T.happy = 0; T.eye = 1; T.jaw = .12; }
        },
        pet(a) {
          T.happy = 1; T.eye = 0; T.blush = 1; wag(24, 4); T.neck = 50; T.head = 12 + 6 * Math.sin(a.t * 6); T.tongue = .6;
        },
        investigate(a, sec) { investigate(sec); },
        beg(a, sec) { beg(sec); }
      };
      function investigate(sec) {
        T.toneS = .7; T.leg[2].x = 4; T.neck = -64 + 4 * Math.sin(sec * 3.1); T.head = 50 + 9 * Math.sin(sec * 5.3);
        T.tail = 52; wag(12, 3.2); T.earN = 0; T.earF = 4; T.gy = .8;
      }
      function run(now, sec) {
        const k = lim(speed / 200, 0, 1);
        T.neck = mix(54, 36, k); T.head = mix(6, 2, k); T.tail = mix(40, 54, k); wag(mix(5, 10, k), 3.5);
        T.earN = 8 + 40 * k; T.earF = 12 + 44 * k;
        // Panting belongs to the fast gaits: a walk keeps the mouth closed.
        const pant = ramp(speed, 95, 190);
        T.jaw = .16 * pant * (.6 + .4 * Math.sin(sec * 30)); T.tongue = 1.1 * pant;
        // In a gallop the spine gathers while all four legs are under the body, then stretches out again.
        const gal = ramp(speed, 125, 215), flex = Math.cos((phase - .82) * Math.PI * 2);
        T.arch += 1.9 * gal * flex; T.neck += 5 * gal * flex; T.head -= 5 * gal * flex; T.tail += 8 * gal;
        if (turn) {
          const w = turn.p * Math.PI * 4;
          T.toneP = T.toneS = .88; T.neck = 46; T.arch = 1.2 * Math.sin(turn.p * Math.PI);
          T.leg[2].y = 2.6 * Math.max(0, Math.sin(w)); T.leg[3].y = 2.6 * Math.max(0, -Math.sin(w));
          T.leg[0].y = 2.2 * Math.max(0, Math.sin(w + 1.6)); T.leg[1].y = 2.2 * Math.max(0, -Math.sin(w + 1.6));
        }
      }
      // Begging while the reply streams: sits tall, eyes up and wide, tongue out, panting hard, tail going, now and then a paw flick.
      function beg(sec) {
        sitPose();
        T.neck = 78; T.head = -36 + 2.5 * Math.sin(sec * 3.1); T.len = 10;
        T.eye = 1.1; T.gx = .4; T.gy = -1.5; T.brow = .8;
        T.tongue = 1.1; T.jaw = .3 + .2 * Math.sin(sec * 28);
        T.earN = -4; T.earF = 0; T.tail = 6; wag(24, 6.5);
        T.breath = 3.4; T.breathHz = 3.4;
        if (sec % 3.6 < 1.3) { const l = T.leg[2]; l.free = 1; l.fx = 14; l.fy = 2 + 3 * Math.sin(sec * 12); l.heel = -30; }
      }
      // Waiting for the reply: begs from the moment of sending until it ends.
      function begging(now) { return now < talkingUntil || activity === 'working'; }
      // Engages only after tools have been running continuously for a while, and releases only after they have stayed clear.
      function trackTools(now) {
        if (pendingTools.size) {
          if (!toolSince) toolSince = now;
          if (now - toolSince >= TOOL_DELAY) investigating = true;
        } else {
          toolSince = 0;
          if (investigating && now - toolClearAt >= TOOL_HOLD) investigating = false;
        }
      }
      function startWaiting() {
        watchUntil = 0;
        if (travel && !travel.fetch) { travel = null; turn = null; turnBody = turnHead = 0; facing.style.transform = 'scaleX(' + direction + ')'; }
        if (action) { action = null; mark.textContent = ''; }
        schedule();
      }

      function buildTargets(now, sec, dt) {
        rest();
        T.neck += Math.sin(sec * .65) * 2.2;
        T.head += Math.sin(sec * .83 + 1.2) * 3;
        T.earN += Math.sin(sec * 1.7) * 2;
        if (travel || speed > 5) { run(now, sec); if (watchOn && gaze) watchHead(sec); }
        else if (action) ACTIONS[action.kind](action, sec);
        else if (watchOn) watchPose(sec);
        else if (investigating) investigate(sec);
        else if (begging(now)) beg(sec);
        if (air.y > .2) {
          const up = air.vy > 0;
          T.leg[2].x = 5; T.leg[3].x = 4; T.leg[2].y = T.leg[3].y = up ? 5 : 2; T.leg[2].heel = T.leg[3].heel = -25;
          T.leg[0].x = -4; T.leg[1].x = -5; T.leg[0].y = T.leg[1].y = up ? 6 : 2.5; T.leg[0].heel = T.leg[1].heel = 38;
          T.neck += up ? 8 : -2; T.tail = 50;
        }
        if (!travel && !action && !watchOn && now < pointerUntil) {
          T.gx = lim(pointerRel / 100, -1, 1) * .9;
          T.head -= lim(pointerRel / 150, -1, 1) * 5;
        }

        const g = gaitFor(speed);
        const bobAt = ph => -g.bob * ((1 - g.one) * Math.cos(4 * Math.PI * (ph - g.duty / 2)) + g.one * Math.cos(2 * Math.PI * (ph - g.duty / 2)));
        const phH = (((phase + g.off[0]) % 1) + 1) % 1, phF = (((phase + g.off[2]) % 1) + 1) % 1;
        const breathe = Math.sin(sec * Math.PI * 2 * T.breathHz) * T.breath;
        sp.hp.t = mix(HP_MIN, HP0, T.toneP) + bobAt(phH) + breathe * .25;
        sp.hs.t = mix(HS_MIN, HS0, T.toneS) + bobAt(phF) + breathe * .35;
        for (const key of SOFT) sp[key].t = T[key];
        wagPh += dt * Math.PI * 2 * T.wagHz;
        sp.t1.t = T.tail + T.wag * Math.sin(wagPh);
        sp.t2.t = sp.t1.v + T.curl;
        sp.t3.t = sp.t2.v + T.curl * .7;
        for (let i = 0; i < 4; i++) {
          const s = legSp[i], l = T.leg[i];
          s.x.t = l.x; s.y.t = l.y; s.heel.t = l.heel; s.toe.t = l.toe; s.free.t = l.free; s.fx.t = l.fx; s.fy.t = l.fy;
        }
        return { g, breathe };
      }

      function integrate(dt) {
        const rideVel = (sp.hp.d + sp.hs.d) / 2 + air.vy;
        const acc = lim((rideVel - prevRide) / Math.max(dt, .001), -3000, 3000);
        prevRide = rideVel;
        const headAcc = lim((sp.head.d - prevHeadD) / Math.max(dt, .001), -60000, 60000);
        prevHeadD = sp.head.d;
        sp.earN.d += (-acc * 0.024 - headAcc * .9) * dt;
        sp.earF.d += (-acc * 0.02 - headAcc * .8) * dt;
        sp.t1.d += -acc * .006 * dt;
        sp.head.d += -acc * .003 * dt;
        sp.jaw.d += acc * .0008 * dt;
        const steps = Math.max(2, Math.ceil(dt / .004)), h = dt / steps;
        for (let n = 0; n < steps; n++) {
          for (const s of springs) {
            s.d += (s.k * (s.t - s.v) - s.c * s.d) * h;
            s.v += s.d * h;
            if (!Number.isFinite(s.v)) { s.v = s.t; s.d = 0; }
          }
        }
        if (air.y > 0 || air.vy > 0) {
          air.vy -= GRAV * dt;
          air.y += air.vy * dt;
          if (air.vx) {
            position = clampPos(position + air.vx * dt / Math.max(1, stage.clientWidth) * 100);
          }
          if (air.y <= 0) {
            const impact = Math.max(0, -air.vy);
            air.y = 0; air.vy = 0; air.vx = 0;
            sp.hp.d -= impact * .45; sp.hs.d -= impact * .45; sp.sq.d += impact * .018;
            remember();
          }
        }
      }

      function render(sec, now, g) {
        // Feet first: a planted foot limits how high its hip may rise, and the body floors limit how low it may sink.
        const A = [];
        const gf = [0, 1, 2, 3].map(i => footGait(i, g));
        let maxP = 99, maxS = 99;
        for (let i = 0; i < 4; i++) {
          const L = LEGS[i], s = legSp[i];
          const lift = s.y.v + gf[i].dy;
          const a = {
            x: (L.hind ? P0X : S0X) + L.ax + s.x.v + gf[i].dx, y: GY - R_ANK - lift,
            heel: s.heel.v + gf[i].heel, toe: s.toe.v + gf[i].toe
          };
          A[i] = a;
          if (s.free.v < .5 && lift < 1.2 && sp.roll.v < 20) {
            const h = a.heel * RAD;
            const jx = a.x - L.c * Math.sin(h), jy = a.y - L.c * Math.cos(h);
            const reach = .985 * (L.a + L.b), dx = (L.hind ? rig.Px : rig.Sx) - jx;
            const top = (GY - jy) + Math.sqrt(Math.max(0, reach * reach - dx * dx));
            if (L.hind) maxP = Math.min(maxP, top); else maxS = Math.min(maxS, top);
          }
        }
        if (sp.hp.v > maxP) { sp.hp.v = maxP; if (sp.hp.d > 0) sp.hp.d = 0; }
        if (sp.hs.v > maxS) { sp.hs.v = maxS; if (sp.hs.d > 0) sp.hs.d = 0; }
        if (sp.hp.v < HP_MIN) { sp.hp.v = HP_MIN; if (sp.hp.d < 0) sp.hp.d *= -.18; }
        if (sp.hs.v < HS_MIN) { sp.hs.v = HS_MIN; if (sp.hs.d < 0) sp.hs.d *= -.18; }

        const hp = sp.hp.v, hs = sp.hs.v;
        const tau = Math.asin(lim((hp - hs) / D, -.95, .95));
        const cosT = Math.cos(tau);
        rig.Px = CX - D / 2 * cosT; rig.Py = GY - hp;
        rig.Sx = CX + D / 2 * cosT; rig.Sy = GY - hs;
        const mx = (rig.Px + rig.Sx) / 2, my = (rig.Py + rig.Sy) / 2;
        rig.Cx = mx + Math.sin(tau) * sp.arch.v * 2;
        rig.Cy = my - Math.cos(tau) * sp.arch.v * 2;
        const flipped = sp.roll.v > 20;

        // Turning is a yaw: the body narrows but never goes flat, the head leads, and near/far parts separate in depth.
        const bodyC = Math.cos(turnBody), sinB = Math.sin(turnBody);
        const bodyS = (bodyC < 0 ? -1 : 1) * Math.max(.2, Math.abs(bodyC));
        const headY = turnHead + sp.yaw.v * RAD, headC = Math.cos(headY), sinH = Math.sin(headY);
        const headW = (headC < 0 ? -1 : 1) * Math.max(.62, Math.abs(headC));

        // Legs.
        for (let i = 0; i < 4; i++) {
          const L = LEGS[i], s = legSp[i], a = A[i];
          const hx = (L.hind ? rig.Px : rig.Sx) + L.hx, hy = (L.hind ? rig.Py : rig.Sy) + L.hy;
          let ax = a.x, ay = a.y;
          const fr = lim(s.free.v, 0, 1.2);
          if (fr > .001) { ax = mix(ax, hx + s.fx.v, fr); ay = mix(ay, hy - s.fy.v, fr); }
          if (!flipped) ay = Math.min(ay, GY - R_ANK);
          const k = ik(L, hx, hy, ax, ay, a.heel);
          const tx = k.ax + L.toe * Math.cos(a.toe * RAD), ty = k.ay + L.toe * Math.sin(a.toe * RAD);
          const r = L.r, o = 1.05;
          put('leg' + i + 'o', 'd', cap(hx, hy, r[0] + o, k.kx, k.ky, r[1] + o) + cap(k.kx, k.ky, r[1] + o, k.jx, k.jy, r[2] + o)
            + cap(k.jx, k.jy, r[2] * .92 + o, k.ax, k.ay, r[3] + o) + cap(k.ax, k.ay, r[3] + o, tx, ty, r[4] + o));
          put('leg' + i + 'f', 'd', cap(hx, hy, r[0], k.kx, k.ky, r[1]) + cap(k.kx, k.ky, r[1], k.jx, k.jy, r[2]));
          put('leg' + i + 's', 'd', cap(k.jx, k.jy, r[2] * .92, k.ax, k.ay, r[3]) + cap(k.ax, k.ay, r[3], tx, ty, r[4]));
          put('legg' + i, 'transform', 'translate(' + f2((i % 2 ? 1 : -1) * 5 * sinB / bodyS) + ' 0)');
        }

        // Torso.
        const breath = 1 + Math.sin(sec * Math.PI * 2 * T.breathHz) * .018 * T.breath;
        const torso = mapPath(TORSO, breath);
        put('torsoFill', 'd', torso);
        put('torsoLine', 'd', torso);
        put('belly', 'd', mapPath(BELLY, breath));
        put('saddle', 'd', mapPath(SADDLE, 1));

        // Neck, collar and head.
        const n0 = body(D + 2, -7);
        const e = sp.neck.v * RAD, len = sp.len.v;
        const n1 = [n0[0] + len * Math.cos(e), n0[1] - len * Math.sin(e)];
        put('neckO', 'd', cap(n0[0], n0[1], 8.6, n1[0], n1[1], 7));
        put('neckF', 'd', cap(n0[0], n0[1], 7.4, n1[0], n1[1], 5.8));
        const cx0 = mix(n0[0], n1[0], .78), cy0 = mix(n0[1], n1[1], .78);
        const nx = Math.sin(e), ny = Math.cos(e), rr = 6.1;
        put('collarO', 'd', cap(cx0 - nx * rr, cy0 - ny * rr, 2.6, cx0 + nx * rr, cy0 + ny * rr, 2.6));
        put('collarF', 'd', cap(cx0 - nx * rr, cy0 - ny * rr, 1.5, cx0 + nx * rr, cy0 + ny * rr, 1.5));
        put('tag', 'cx', f2(cx0 + nx * (rr + 1.4))); put('tag', 'cy', f2(cy0 + ny * (rr + 1.4)));
        const flipY = Math.cos(sp.roll.v * RAD);
        put('headG', 'transform', 'translate(' + f2(n1[0]) + ' ' + f2(n1[1]) + ') rotate(' + f2(sp.head.v) + ') scale(' + f2(headW / bodyS) + ' 1)');
        put('earN', 'transform', 'translate(' + f2(2 - 9 * sinH / headW) + ' -9) rotate(' + f2(sp.earN.v) + ')');
        put('earF', 'transform', 'translate(' + f2(4.5 + 9 * sinH / headW) + ' -8.5) rotate(' + f2(sp.earF.v) + ')');

        // Face.
        const blink = now - blinkStart < 150 ? 1 - bell((now - blinkStart) / 150) : 1;
        const open = lim(sp.eye.v * blink, 0, 1.1), happy = lim(sp.happy.v, 0, 1);
        put('lid', 'height', f2(lim(8.6 * (1 - open), 0, 8.6)));
        put('eyeClosed', 'opacity', f2(lim((.35 - open) / .35, 0, 1) * (1 - happy)));
        put('eyeHappy', 'opacity', f2(happy));
        put('eyeG', 'transform', 'translate(' + f2(sp.gx.v) + ' ' + f2(sp.gy.v) + ')');
        put('brow', 'transform', 'translate(0 ' + f2(-lim(sp.brow.v, -1, 1) * 1.1) + ') rotate(' + f2(sp.brow.v * 22) + ' 12.4 -10.2)');
        put('blush', 'opacity', f2(lim(sp.blush.v, 0, 1) * .45));
        const jaw = lim(sp.jaw.v, 0, 1.2) * 30;
        put('jawG', 'transform', 'rotate(' + f2(jaw) + ' 10 3.8)');
        const tipX = 10 + 16.5 * Math.cos(jaw * RAD) - 2.6 * Math.sin(jaw * RAD), tipY = 3.8 + 16.5 * Math.sin(jaw * RAD) + 2.6 * Math.cos(jaw * RAD);
        put('jawIn', 'd', 'M10 3.8 L27 3.4 L' + f2(tipX) + ' ' + f2(tipY) + 'Z');
        const tongue = lim(sp.tongue.v, 0, 1.2);
        put('tongue', 'opacity', f2(lim(tongue * 4, 0, 1)));
        put('tongue', 'transform', 'translate(0 3.9) scale(1 ' + f2(.5 + tongue * .5) + ') translate(0 -3.9)');

        // Tail: three chained segments that trail the wag.
        const tp = spineAt(0), t0 = body(-9, -5);
        const base = Math.atan2(tp[3], tp[2]) / RAD + 180;
        const segs = [[sp.t1.v, 9, 3.4, 2.9], [sp.t2.v, 8, 2.9, 2.3], [sp.t3.v, 7, 2.3, 1.7]];
        const pts = [t0];
        let ox = t0[0], oy = t0[1];
        for (const sg of segs) {
          const a = (base + sg[0]) * RAD;
          ox += sg[1] * Math.cos(a); oy += sg[1] * Math.sin(a);
          if (!flipped) oy = Math.min(oy, GY - sg[3]);
          pts.push([ox, oy]);
        }
        let tailFill = '', tailOut = '';
        for (let i = 0; i < 3; i++) {
          tailFill += cap(pts[i][0], pts[i][1], segs[i][2], pts[i + 1][0], pts[i + 1][1], segs[i][3]);
          tailOut += cap(pts[i][0], pts[i][1], segs[i][2] + 1.1, pts[i + 1][0], pts[i + 1][1], segs[i][3] + 1.1);
        }
        const mt = [mix(pts[2][0], pts[3][0], .3), mix(pts[2][1], pts[3][1], .3)];
        put('tailO', 'd', tailOut);
        put('tailF', 'd', tailFill);
        put('tailT', 'd', cap(mt[0], mt[1], 2.1, pts[3][0], pts[3][1], 1.7));

        // Root: lift, roll, landing squash and shaking.
        const shake = T.shake;
        const rot = sp.rot.v + shake * 2.6 * Math.sin(sec * Math.PI * 2 * 8.5);
        const meanH = (hp + hs) / 2, cyc = GY - meanH;
        const rollAmt = smooth(sp.roll.v / 180);
        const drop = Math.max(0, meanH - 12) * rollAmt;
        const sq = sp.sq.v;
        const shx = shake * 1.1 * Math.sin(sec * Math.PI * 2 * 8.5 + 1);
        put('root', 'transform', 'translate(' + f2(shx) + ' ' + f2(drop - air.y) + ') translate(' + CX + ' ' + f2(cyc) + ') rotate(' + f2(rot)
          + ') scale(1 ' + f2(flipY) + ') translate(' + (-CX) + ' ' + f2(-cyc) + ') translate(' + CX + ' ' + GY
          + ') scale(' + f2(1 + sq * .5) + ' ' + f2(1 - sq) + ') translate(' + (-CX) + ' ' + (-GY) + ') translate(' + CX + ' 0) scale(' + f2(bodyS) + ' 1) translate(' + (-CX) + ' 0)');
        const shadow = lim(1 - air.y / 40, .3, 1);
        put('shadow', 'rx', f2((hp < 14 && hs < 16 ? 33 : 29) * shadow));
        put('shadow', 'opacity', f2(.2 * shadow));
      }

      // ---- control ----
      function stepDogPosition() {
        dog.style.left = position + '%';
        const rounded = Math.round(position);
        if (rounded !== lastAria) { lastAria = rounded; stage.setAttribute('aria-valuenow', String(rounded)); }
      }
      // ---- watching the prompt ----
      const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
      const MIRROR_PROPS = ['fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'fontVariant', 'letterSpacing', 'lineHeight',
        'textTransform', 'textIndent', 'wordSpacing', 'tabSize', 'textAlign', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'];
      // The caret end of the selection: with a backwards selection it is the start.
      function caretIndex(input) {
        if (input.selectionDirection === 'backward' && typeof input.selectionStart === 'number') return input.selectionStart;
        return typeof input.selectionEnd === 'number' ? input.selectionEnd : input.value.length;
      }
      function caretKey() {
        return promptBox ? promptBox.selectionStart + ':' + promptBox.selectionEnd + ':' + promptBox.scrollTop + ':' + promptBox.value.length : '';
      }
      // A textarea has no caret geometry, so lay the same text out in an off-screen twin and read where the caret would be.
      function measureCaret() {
        const input = promptBox;
        if (!input || !input.getBoundingClientRect || !window.getComputedStyle || !document.body || !input.clientWidth) return false;
        const style = window.getComputedStyle(input);
        if (!mirror) {
          mirror = document.createElement('div');
          mirror.setAttribute('aria-hidden', 'true');
          mirror.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;overflow:hidden;border:0;height:auto;box-sizing:border-box';
          document.body.appendChild(mirror);
        }
        for (const prop of MIRROR_PROPS) mirror.style[prop] = style[prop];
        mirror.style.width = input.clientWidth + 'px';
        const end = caretIndex(input);
        mirror.textContent = input.value.slice(0, end);
        const marker = document.createElement('span');
        marker.textContent = String.fromCharCode(8203);
        mirror.appendChild(marker);
        const box = input.getBoundingClientRect(), stageBox = stage.getBoundingClientRect();
        const x = box.left + (parseFloat(style.borderLeftWidth) || 0) + marker.offsetLeft - input.scrollLeft;
        const y = box.top + (parseFloat(style.borderTopWidth) || 0) + marker.offsetTop + marker.offsetHeight / 2 - input.scrollTop;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        const px = x - stageBox.left, delta = px - caretPx, now = clock();
        if (Math.abs(delta) > JUMP_PX) { caretVel = 0; caretMoveAt = now; }
        else if (Math.abs(delta) > 2) {
          // Smoothed signed caret speed (px/s): the feed-forward that lets the dog match the pace instead of trailing it.
          const inst = delta / Math.max(.03, (now - caretMoveAt) / 1000);
          caretVel = now - caretMoveAt > 700 ? 0 : caretVel * .5 + lim(inst, -400, 400) * .5;
          caretMoveAt = now;
        }
        caretPx = px;
        gaze = solveGaze(lim(y - (stageBox.bottom - 4), 6, 400));
        return true;
      }
      // Picks the head tilt whose gaze line (eye along the snout) lands on the caret, and how far behind it the dog must stand.
      function solveGaze(drop) {
        const n0x = S0X + 2, n0y = GY - mix(HS_MIN, HS0, WATCH_TONE) - 7;
        let head = 55, neck = -30, eyeX = 0, eyeH = 0;
        for (let pass = 0; pass < 4; pass++) {
          const h = head * RAD;
          neck = -45;
          // Lift the neck until the snout clears the ground.
          while (neck < 40 && n0y - WATCH_LEN * Math.sin(neck * RAD) + 29.4 * Math.sin(h) - 1.5 * Math.cos(h) > GY - 3) neck += 4;
          const n1x = n0x + WATCH_LEN * Math.cos(neck * RAD), n1y = n0y - WATCH_LEN * Math.sin(neck * RAD);
          eyeX = (n1x + 12.6 * Math.cos(h) + 4.2 * Math.sin(h) - CX) * SCALE;
          eyeH = (GY - (n1y + 12.6 * Math.sin(h) - 4.2 * Math.cos(h))) * SCALE;
          head = lim(Math.atan2(drop + eyeH, GAZE_GAP) / RAD, 36, 68);
        }
        return { neck, head, drop, eyeX, eyeH, stand: eyeX + (drop + eyeH) / Math.tan(head * RAD) };
      }
      function promptHasText() {
        return !!promptBox && (promptBox.value || '').trim() !== '';
      }
      function noteTyping(typed) {
        if (!active() || motion.matches) return;
        if (!promptHasText()) { watchUntil = 0; return; }
        const now = clock();
        const starting = now >= watchUntil;
        watchUntil = now + WATCH_MS;
        lastTyped = now;
        caretDirty = true;
        if (starting && action) { action = null; mark.textContent = ''; }
        if (starting && travel && !travel.watch && !travel.fetch) travel = null;
        if (typed) { sp.head.d += 110; sp.earN.d += 70; sp.earF.d += 60; }
        schedule();
      }
      // The caret can move without any key or click event reaching us (a held arrow, a drag-select, undo), so the
      // selection itself is watched every frame.
      function pollCaret() {
        const key = caretKey();
        if (key === lastCaretKey) return;
        lastCaretKey = key;
        if (promptBox && document.activeElement === promptBox) noteTyping(false);
      }
      // Fixed rule, no dynamic switching: the dog looks left to right, standing a gaze-length left of the caret. Only when
      // the caret is so near the left wall that the dog cannot fit there does it stand right of the caret and look right to left.
      function follow(now) {
        if (!gaze || turn || action || (travel && !travel.watch)) return;
        const width = Math.max(1, stage.clientWidth);
        const me = position / 100 * width, edge = Math.min(width / 2, 44);
        // Hysteresis: once on the left-facing side, the caret has to clear the wall zone by a margin before turning back.
        const wall = edge + gaze.stand + (direction < 0 ? ZONE_HYST : 0);
        const face = caretPx < wall || me > caretPx ? -1 : 1;
        const spotPct = clampPos((caretPx - face * gaze.stand) / width * 100);
        const fwd = (spotPct / 100 * width - me) * face;
        if (face !== direction) {
          move(spotPct, false, 'walk', face);
          if (travel) { travel.watch = true; travel.cruise = 215; }
          if (turn) turn.dur = WATCH_TURN_MS;
          return;
        }
        if (travel) { travel.to = spotPct; return; }
        if (Math.abs(fwd) > HOLD) {
          move(spotPct, false, 'walk', face);
          if (travel) { travel.watch = true; travel.cruise = 215; }
        }
      }
      // The stare is shared by standing and walking, and re-aimed every frame at where the caret actually is.
      function watchHead(sec) {
        const width = Math.max(1, stage.clientWidth);
        const reach = Math.max(8, (caretPx - position / 100 * width) * direction - gaze.eyeX);
        const tilt = lim(Math.atan2(gaze.drop + gaze.eyeH, reach) / RAD, 36, 70);
        T.neck = gaze.neck + 2.5 * Math.sin(sec * 2.1 + 1); T.head = tilt + 3 * Math.sin(sec * 4.3);
        T.len = WATCH_LEN; T.toneS = WATCH_TONE; T.eye = 1.1; T.gx = .5; T.gy = 1.7;
      }
      function watchPose(sec) {
        if (!gaze) return;
        watchHead(sec);
        T.leg[2].x = 4; T.earN = 0; T.earF = 4; T.tail = 54; wag(24, 5.5);
      }

      function update(now, dt) {
        const sec = now / 1000;
        if (action && now >= action.start + action.len * 1000) endAction();
        if (action) action.t = (now - action.start) / 1000;
        trackTools(now);
        if (enabled) pollCaret();
        const typing = enabled && now < watchUntil && activity !== 'connecting' && promptHasText();
        if (typing && caretDirty) { caretDirty = false; haveCaret = measureCaret(); }
        watchOn = typing && haveCaret;
        if (watchPrev && !watchOn) { remember(); idleLater(); }
        watchPrev = watchOn;
        if (watchOn) follow(now);
        if (turn) {
          const p = Math.min(1, (now - turn.start) / turn.dur);
          turn.p = p;
          turnBody = Math.PI * smooth(p);
          turnHead = Math.PI * smooth(lim(p * 1.45, 0, 1));
          direction = turnBody < Math.PI / 2 ? turn.from : turn.to;
          if (p >= 1) { turn = null; turnBody = turnHead = 0; facing.style.transform = 'scaleX(' + direction + ')'; }
        }
        if (travel) {
          const standing = sp.hp.v > HP0 - 5 && sp.hs.v > HS0 - (travel.watch ? 9 : 5) && air.y < .5;
          const width = Math.max(1, stage.clientWidth);
          const remain = (travel.to - position) / 100 * width;
          const dist = Math.abs(remain);
          // Moving against the facing direction is a backpedal: the stride cycle runs in reverse.
          backing = !turn && dist > 1.5 && (remain > 0 ? 1 : -1) === -direction;
          // Cruise at the chosen gait and only brake over the last stretch, so a gallop isn't cut short by the border.
          let vmax = Math.min(travel.cruise, Math.sqrt(2 * BRAKE * dist) + 6);
          // Following the caret: the further behind, the faster, so any typing speed is matched in either direction.
          if (travel.watch) {
            const lead = remain > 0 ? caretVel : -caretVel;
            const ff = now - caretMoveAt < 500 && lead > 0 ? lead : 0;
            vmax = Math.min(travel.cruise, Math.max(CATCH_FLOOR, CATCH * dist + CATCH_BASE + ff), Math.sqrt(2 * CATCH_BRAKE * dist) + 6 + ff);
          }
          if (dist < .8 && travel.watch) vmax = 0;
          if (!standing || turn) vmax = 0;
          speed += lim(vmax - speed, -900 * dt, (travel.watch ? CATCH_ACCEL : Math.max(420, travel.cruise * 7)) * dt);
          const stepPx = speed * dt;
          // While keys are still landing the dog keeps tracking instead of arriving and stopping, so it doesn't stutter.
          const tracking = travel.watch && now - lastTyped < TRACK_MS;
          if (!turn && standing && !tracking && dist <= Math.max(.8, stepPx)) {
            const fetched = travel.fetch, watching = travel.watch;
            position = travel.to; travel = null; speed = 0;
            if (!watching) remember();
            if (fetched) react('celebrate');
            else if (activity === 'connecting') move(position > 50 ? 8 : 92, false, 'gallop');
            else idleLater();
          } else if (!turn) {
            position = clampPos(position + Math.sign(remain) * Math.min(stepPx, dist) / width * 100);
          }
        } else speed = speed < .5 ? 0 : speed * Math.exp(-dt * 14);
        if (!travel && !turn && !action && activity === 'connecting') move(position > 50 ? 8 : 92, false, 'gallop');
        const g = gaitFor(speed);
        if (speed > 1) phase = (phase + (backing ? -1 : 1) * speed * dt / SCALE * g.duty / Math.max(g.stride, 4)) % 1;
        row.dataset.gait = speed > 150 ? 'gallop' : speed > 80 ? 'trot' : speed > 5 ? 'walk' : 'rest';
        row.dataset.pose = action ? action.kind : travel ? 'run' : watchOn ? 'watch' : investigating ? 'investigate' : begging(now) ? 'beg' : 'idle';
        row.dataset.activity = pendingTools.size ? 'tool' : now < talkingUntil ? 'talking' : activity;
        if (now >= blinkAt) { blinkStart = now; blinkAt = now + 2200 + Math.random() * 3800; }
        stepDogPosition();
        const built = buildTargets(now, sec, dt);
        integrate(dt);
        render(sec, now, built.g);
      }
      function snap() {
        const now = clock();
        speed = 0; air.y = 0; air.vy = 0; air.vx = 0;
        const built = buildTargets(now, now / 1000, .016);
        for (const s of springs) { s.v = s.t; s.d = 0; }
        prevRide = 0; prevHeadD = 0;
        render(now / 1000, now, built.g);
      }
      function tick(now) {
        frame = 0;
        if (!active() || motion.matches) return;
        if (!lastNow) lastNow = now - 16;
        const dt = lim((now - lastNow) / 1000, .001, .033);
        lastNow = now;
        update(now, dt);
        schedule();
      }
      function schedule() {
        if (!frame && active() && !motion.matches) frame = requestAnimationFrame(tick);
      }
      function sparkle(kind) {
        if (motion.matches || !active()) return;
        for (let index = 0; index < 6; index++) {
          const spark = document.createElement('span');
          spark.className = 'chat-mascot-spark';
          spark.style.left = position + '%';
          spark.style.bottom = '34px';
          if (kind === 'love') {
            spark.textContent = String.fromCharCode(9829);
            spark.style.cssText += ';background:none;color:var(--vscode-charts-red, #e87676);font-size:14px;width:14px;height:14px';
          }
          stage.appendChild(spark);
          const animation = spark.animate([
            { transform: 'translate(0, 0) scale(.4)', opacity: 1 },
            { transform: 'translate(' + (index - 2.5) * 12 + 'px, -' + (18 + index % 3 * 8) + 'px) rotate(60deg)', opacity: 0 }
          ], { duration: 700 + index * 70, easing: 'ease-out' });
          const particle = { spark, animation };
          particles.add(particle);
          animation.onfinish = () => { spark.remove(); particles.delete(particle); };
        }
      }
      function stop() {
        cancelAnimationFrame(frame);
        clearTimeout(timer);
        frame = timer = lastNow = 0;
        travel = action = turn = null;
        turnBody = turnHead = 0;
        watchUntil = 0; watchOn = false;
        toolSince = 0; investigating = false;
        facing.style.transform = 'scaleX(' + direction + ')';
        mark.textContent = '';
        for (const particle of particles) { particle.animation.cancel(); particle.spark.remove(); }
        particles.clear();
        snap();
      }
      // Idle life: he strolls to a new spot between tricks, so he is always going somewhere or doing something.
      const IDLE_PICKS = [['sniff', 2], ['stretch', 1.5], ['scratch', 1.5], ['shake', 1.5], ['shakeoff', 1], ['bow', 1.5],
        ['look', 1.5], ['tilt', 2], ['roll', 1], ['belly', 1], ['paw', 1.5], ['sit', 1.5], ['sneeze', 1], ['pounce', 1]];
      const IDLE_MIN = 700, IDLE_SPAN = 1300, NAP_AFTER = 60000, NAP_EVERY = 150000, WANDER_MIN = 70, TRICK_CHANCE = .75;
      const recentIdle = [];
      let lastNap = -1e9, wandered = false;
      function pickIdle() {
        const pool = IDLE_PICKS.filter(p => !recentIdle.includes(p[0]));
        let r = Math.random() * pool.reduce((sum, p) => sum + p[1], 0);
        for (const p of pool) { r -= p[1]; if (r <= 0) return p[0]; }
        return pool[0][0];
      }
      // A new spot far enough from here to be a real stroll, spread over the stage rather than near the current spot.
      function wanderSpot() {
        const width = Math.max(1, stage.clientWidth), margin = Math.min(50, 60 / width * 100);
        const lo = margin, hi = 100 - margin;
        for (let tries = 0; tries < 8; tries++) {
          const to = lo + Math.random() * (hi - lo);
          if (Math.abs(to - position) / 100 * width >= WANDER_MIN) return to;
        }
        return position > 50 ? lo + (hi - lo) * .2 : lo + (hi - lo) * .8;
      }
      function idleLater(delay) {
        clearTimeout(timer);
        if (!active() || motion.matches) return;
        timer = window.setTimeout(() => {
          const now = clock();
          if (activity !== 'idle' || travel || turn || action || pendingTools.size || investigating || now < watchUntil || now < talkingUntil) { idleLater(500); return; }
          if (now - lastInteraction > NAP_AFTER && now - lastNap > NAP_EVERY) { lastNap = now; wandered = false; react('nap'); return; }
          // Alternate: stroll somewhere, then (usually) do something there; sometimes stroll twice or trick twice.
          if (!wandered || Math.random() > TRICK_CHANCE) {
            wandered = true;
            const to = wanderSpot();
            move(to, false, Math.abs(to - position) / 100 * Math.max(1, stage.clientWidth) > 230 && Math.random() < .5 ? 'gallop' : 'walk');
            return;
          }
          wandered = false;
          const pick = pickIdle();
          recentIdle.push(pick);
          if (recentIdle.length > 4) recentIdle.shift();
          react(pick);
        }, delay === undefined ? IDLE_MIN + Math.random() * IDLE_SPAN : delay);
      }
      function move(nextPosition, fetch, gait, face) {
        if (!active()) return;
        action = null;
        mark.textContent = '';
        const destination = clampPos(nextPosition);
        const nextDirection = face || (destination >= position ? 1 : -1);
        if (!(turn && nextDirection === turn.to)) {
          if (turn) { facing.style.transform = 'scaleX(' + direction + ')'; turnBody = turnHead = 0; }
          turn = nextDirection !== direction && !motion.matches ? { from: direction, to: nextDirection, start: clock(), p: 0, dur: TURN_MS } : null;
          if (!turn) { direction = nextDirection; facing.style.transform = 'scaleX(' + direction + ')'; }
        }
        if (motion.matches) {
          position = destination;
          stepDogPosition();
          remember();
          return;
        }
        const reach = Math.abs(destination - position) / 100 * Math.max(1, stage.clientWidth);
        const far = gait === undefined || gait === 'auto' ? reach >= GALLOP_MIN : gait === 'gallop';
        travel = { to: destination, fetch: !!fetch, cruise: fetch || far ? 215 : gait === 'trot' ? 130 : 62, watch: false };
        row.dataset.pose = 'run';
        schedule();
      }
      function react(kind) {
        if (!active()) return;
        travel = null;
        turn = null;
        turnBody = turnHead = 0;
        facing.style.transform = 'scaleX(' + direction + ')';
        if (kind === 'spin') kind = 'roll';
        row.dataset.pose = kind;
        action = { kind, start: clock(), len: DUR[kind] || 2, t: 0, s: {} };
        mark.textContent = kind === 'nap' ? 'z z z' : kind === 'sad' ? '?' : '';
        mark.style.left = direction > 0 ? '74%' : '18%';
        mark.style.bottom = kind === 'nap' ? '30px' : '58px';
        if (kind === 'pet') sparkle('love');
        if (kind === 'celebrate') sparkle('stars');
        schedule();
        idleLater();
      }
      function endAction() {
        const kind = action.kind;
        action = null;
        mark.textContent = '';
        if (kind === 'nap') react('stretch');
        else idleLater();
      }
      function interact() { lastInteraction = clock(); }
      function applyState() {
        row.hidden = !enabled;
        row.dataset.paused = String(!active());
        if (!active()) { closeMenu(); stop(); return; }
        position = clampPos(position);
        stepDogPosition();
        if (activity === 'connecting') move(position > 50 ? 8 : 92, false, 'gallop');
        else { snap(); schedule(); idleLater(); }
      }

      const MENU = [
        ['Go to here', [['walk', 'Walk'], ['trot', 'Trot'], ['gallop', 'Gallop']]],
        ['Rest', [['sit', 'Sit'], ['nap', 'Sleep'], ['sad', 'Sad']]],
        ['Play', [['bow', 'Play bow'], ['roll', 'Roll over'], ['belly', 'Belly rub'], ['pounce', 'Pounce'], ['celebrate', 'Celebrate'], ['paw', 'Give paw']]],
        ['Body', [['stretch', 'Stretch'], ['scratch', 'Scratch'], ['shake', 'Shake head'], ['shakeoff', 'Shake off'], ['sneeze', 'Sneeze']]],
        ['Attention', [['sniff', 'Sniff'], ['look', 'Look'], ['tilt', 'Tilt head'], ['investigate', 'Investigate'], ['beg', 'Beg'], ['pet', 'Pet']]]
      ];
      function closeMenu() {
        if (menu) { menu.remove(); menu = null; }
      }
      function choose(kind, at) {
        interact();
        if (kind === 'walk' || kind === 'trot' || kind === 'gallop') move(at, false, kind);
        else react(kind);
      }
      function openMenu(x, y, at) {
        closeMenu();
        menu = document.createElement('div');
        menu.className = 'chat-mascot-menu';
        menu.setAttribute('role', 'menu');
        for (const group of MENU) {
          const title = document.createElement('div');
          title.className = 'chat-mascot-menu-title';
          title.textContent = group[0];
          menu.appendChild(title);
          for (const entry of group[1]) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'chat-mascot-menu-item';
            item.setAttribute('role', 'menuitem');
            item.textContent = entry[1];
            item.addEventListener('click', () => { closeMenu(); choose(entry[0], at); });
            menu.appendChild(item);
          }
        }
        document.body.appendChild(menu);
        const box = menu.getBoundingClientRect();
        menu.style.left = Math.max(4, Math.min(x, window.innerWidth - box.width - 4)) + 'px';
        menu.style.top = Math.max(4, Math.min(y, window.innerHeight - box.height - 4)) + 'px';
        menu.querySelector('button').focus();
      }
      stage.addEventListener('contextmenu', event => {
        event.preventDefault();
        if (!active()) return;
        interact();
        const bounds = stage.getBoundingClientRect();
        openMenu(event.clientX, event.clientY, ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 100);
      });
      document.addEventListener('pointerdown', event => {
        if (menu && !menu.contains(event.target)) closeMenu();
      }, true);
      document.addEventListener('keydown', event => {
        if (!menu) return;
        if (event.key === 'Escape') { event.preventDefault(); closeMenu(); stage.focus(); return; }
        const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
        if (!forward && event.key !== 'ArrowUp' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const items = Array.from(menu.querySelectorAll('button'));
        const next = items.indexOf(document.activeElement) + (forward ? 1 : -1);
        items[(next + items.length) % items.length].focus();
      }, true);
      window.addEventListener('blur', closeMenu);
      window.addEventListener('resize', closeMenu);

      stage.addEventListener('click', event => {
        interact();
        const bounds = stage.getBoundingClientRect();
        move(((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 100, false);
      });
      stage.addEventListener('dblclick', event => {
        interact();
        const bounds = stage.getBoundingClientRect();
        move(((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 100, true);
      });
      stage.addEventListener('pointermove', event => {
        if (!active() || motion.matches) return;
        const bounds = stage.getBoundingClientRect();
        pointerRel = (event.clientX - bounds.left - position / 100 * bounds.width) * direction;
        pointerUntil = clock() + 1200;
      });
      stage.addEventListener('keydown', event => {
        const steps = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 };
        if (event.key in steps || ['Home', 'End', ' ', 'Enter'].includes(event.key)) {
          event.preventDefault();
          interact();
          if (event.key === ' ' || event.key === 'Enter') react('spin');
          else move(event.key === 'Home' ? 0 : event.key === 'End' ? 100 : position + steps[event.key], false);
        }
      });
      const resize = new ResizeObserver(() => {
        if (!active() || !stage.clientWidth) return;
        if (travel) { if (!travel.watch) { const destination = travel.to; move(destination, travel.fetch); } }
        else { position = clampPos(position); stepDogPosition(); }
        if (watchOn) caretDirty = true;
      });
      resize.observe(stage);
      document.addEventListener('visibilitychange', applyState);
      motion.addEventListener('change', () => { stop(); applyState(); });
      const promptEl = promptBox;
      promptEl?.addEventListener('input', () => {
        interact();
        noteTyping(true);
      });
      promptEl?.addEventListener('keyup', event => { if (NAV_KEYS.includes(event.key)) { interact(); noteTyping(false); } });
      promptEl?.addEventListener('click', () => { interact(); noteTyping(false); });
      promptEl?.addEventListener('scroll', () => { if (watchOn) caretDirty = true; });
      promptEl?.addEventListener('blur', () => { watchUntil = 0; });
      window.addEventListener('pagehide', () => { disposed = true; closeMenu(); stop(); resize.disconnect(); });

      return {
        setState(state) {
          if (typeof state.enabled === 'boolean') enabled = state.enabled;
          const savedPosition = Number(state.position);
          position = Number.isFinite(savedPosition) ? clampPos(savedPosition) : 18;
          applyState();
        },
        setEnabled(value) { enabled = !!value; applyState(); remember(); },
        setActivity(value) {
          const previous = activity;
          activity = value;
          if (value !== 'working') { talkingUntil = 0; pendingTools.clear(); toolSince = 0; investigating = false; }
          else watchUntil = 0;
          row.dataset.activity = value;
          if (value === 'connecting') { stop(); applyState(); }
          else if (value === 'error') { stop(); activity = 'idle'; react('sad'); }
          else if (previous === 'connecting') { stop(); react('celebrate'); }
          else if (value === 'working') { interact(); startWaiting(); }
          else if (previous === 'working' && value === 'idle') react('celebrate');
          idleLater();
        },
        react(kind) { interact(); react(kind); },
        // Called the instant a prompt is sent, before the host confirms; the timer lapses by itself if the send fails.
        submit() {
          if (!active()) return;
          interact();
          startWaiting();
          talkingUntil = clock() + 2500;
        },
        toolUpdate(id, status) {
          if (!id) return;
          if (status === 'completed' || status === 'failed') {
            if (pendingTools.delete(id) && !pendingTools.size) toolClearAt = clock();
          } else pendingTools.add(id);
          row.dataset.activity = pendingTools.size ? 'tool' : activity;
          schedule();
        },
        speak() {
          if (!active()) return;
          if (action && ['bow', 'look', 'investigate'].includes(action.kind)) action = null;
          talkingUntil = clock() + 1500;
          row.dataset.activity = 'talking';
          schedule();
        }
      };
    }
`
