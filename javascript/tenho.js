// 天和ジェネレーター
// 天和・役満の判定ロジック (高速化版: 配列の使い回しで割り当てを削減)
// 牌の種類は 0-33: 0-8=萬子, 9-17=筒子, 18-26=索子, 27-33=字牌(東南西北白發中)

const TILE_EMOJIS = [
  ...Array.from({ length: 9 }, (_, i) => String.fromCodePoint(0x1f007 + i)), // 萬子
  ...Array.from({ length: 9 }, (_, i) => String.fromCodePoint(0x1f019 + i)), // 筒子
  ...Array.from({ length: 9 }, (_, i) => String.fromCodePoint(0x1f010 + i)), // 索子
  '🀀', '🀁', '🀂', '🀃', '🀆', '🀅', '🀄', // 東南西北白發中
];

const TENHOU_TERMINALS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

const YAKUMAN_LIST = [
  '国士無双', '四暗刻', '字一色', '大四喜', '小四喜', '大七星',
  '緑一色', '紅孔雀', '大三元', '九蓮宝燈', '大車輪', '大竹林', '大数隣',
];
const YAKUMAN_MAX_ATTEMPTS = Infinity; // 上限なし (中止ボタンで止める)

// 緑一色 / 紅孔雀 の対象牌マスク
const GREEN_MASK = new Array(34).fill(false);
for (const t of [19, 20, 21, 23, 25, 32]) GREEN_MASK[t] = true;
const RED_MASK = new Array(34).fill(false);
for (const t of [18, 22, 24, 26, 33]) RED_MASK[t] = true;

// 残りの牌が全部 面子(順子/刻子) に分解できれば true
// counts を直接書き換えて復元する (コピーを作らない)
function canFormMelds(counts) {
  let i = 0;
  while (i < 34 && counts[i] === 0) i++;
  if (i === 34) return true;
  if (counts[i] >= 3) { // 刻子
    counts[i] -= 3;
    if (canFormMelds(counts)) { counts[i] += 3; return true; }
    counts[i] += 3;
  }
  if (i < 27 && i % 9 <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) { // 順子
    counts[i]--; counts[i + 1]--; counts[i + 2]--;
    if (canFormMelds(counts)) { counts[i]++; counts[i + 1]++; counts[i + 2]++; return true; }
    counts[i]++; counts[i + 1]++; counts[i + 2]++;
  }
  return false;
}

// 14枚が和了形か (通常形 / 七対子 / 国士無双)
function isTenhou(counts) {
  // 七対子
  let pairs = 0;
  for (let i = 0; i < 34; i++) if (counts[i] === 2) pairs++;
  if (pairs === 7) return true;
  // 国士無双
  let termSum = 0;
  let kokushi = true;
  for (let k = 0; k < TENHOU_TERMINALS.length; k++) {
    const t = TENHOU_TERMINALS[k];
    if (counts[t] < 1) { kokushi = false; break; }
    termSum += counts[t];
  }
  if (kokushi && termSum === 14) return true;
  // 通常形: 雀頭を1つ抜いて、残りが全部面子 (counts を直接使う)
  for (let pair = 0; pair < 34; pair++) {
    if (counts[pair] >= 2) {
      counts[pair] -= 2;
      const ok = canFormMelds(counts);
      counts[pair] += 2;
      if (ok) return true;
    }
  }
  return false;
}

// 残りの牌が全部 刻子 に分解できれば true (四暗刻判定用)
function canFormTriplets(counts) {
  for (let i = 0; i < 34; i++) {
    if (counts[i] > 0) {
      if (counts[i] < 3) return false;
      counts[i] -= 3;
      const result = canFormTriplets(counts);
      counts[i] += 3;
      return result;
    }
  }
  return true;
}

// 雀頭を1つ抜いて、残りが全部刻子にできれば四暗刻
function isSuuankou(counts) {
  for (let pair = 0; pair < 34; pair++) {
    if (counts[pair] >= 2) {
      counts[pair] -= 2;
      const ok = canFormTriplets(counts);
      counts[pair] += 2;
      if (ok) return true;
    }
  }
  return false;
}

// 和了形の counts から、該当する役満の名前リストを返す
function yakumanNames(counts) {
  const names = [];
  // 国士無双
  let termSum = 0;
  let kokushi = true;
  for (let k = 0; k < TENHOU_TERMINALS.length; k++) {
    const t = TENHOU_TERMINALS[k];
    if (counts[t] < 1) { kokushi = false; break; }
    termSum += counts[t];
  }
  if (kokushi && termSum === 14) names.push('国士無双');
  // 大七星 (字牌の七対子)
  let pairs = 0;
  for (let i = 0; i < 34; i++) if (counts[i] === 2) pairs++;
  let honorSum = 0;
  for (let i = 27; i < 34; i++) honorSum += counts[i];
  if (pairs === 7 && honorSum === 14) names.push('大七星');
  // 大四喜 / 小四喜 (東南西北 = 27-30)
  const w0 = counts[27], w1 = counts[28], w2 = counts[29], w3 = counts[30];
  const windTriplets = (w0 >= 3) + (w1 >= 3) + (w2 >= 3) + (w3 >= 3);
  if (windTriplets === 4) {
    names.push('大四喜');
  } else if (windTriplets === 3 && (w0 === 2 || w1 === 2 || w2 === 2 || w3 === 2)) {
    names.push('小四喜');
  }
  // 大三元 (白發中 = 31-33)
  if (counts[31] >= 3 && counts[32] >= 3 && counts[33] >= 3) names.push('大三元');
  // 字一色
  if (honorSum === 14) names.push('字一色');
  // 緑一色 (索子の2,3,4,6,8 と 發 だけ)
  let greenOk = true;
  for (let t = 0; t < 34; t++) if (counts[t] > 0 && !GREEN_MASK[t]) { greenOk = false; break; }
  if (greenOk) names.push('緑一色');
  // 紅孔雀 (索子の1,5,7,9 と 中 だけ)
  let redOk = true;
  for (let t = 0; t < 34; t++) if (counts[t] > 0 && !RED_MASK[t]) { redOk = false; break; }
  if (redOk) names.push('紅孔雀');
  // 九蓮宝燈 (1種の数牌で 1112345678999 + 1枚)
  for (const base of [0, 9, 18]) {
    let suitSum = 0;
    let allPresent = true;
    for (let i = 0; i < 9; i++) {
      suitSum += counts[base + i];
      if (counts[base + i] < 1) allPresent = false;
    }
    if (suitSum === 14 && counts[base] >= 3 && counts[base + 8] >= 3 && allPresent) {
      names.push('九蓮宝燈');
      break;
    }
  }
  // 大車輪(筒子) / 大竹林(索子) / 大数隣(萬子) : 2〜8の七対子
  for (const [base, name] of [[9, '大車輪'], [18, '大竹林'], [0, '大数隣']]) {
    let ok = true;
    for (let i = 1; i <= 7; i++) if (counts[base + i] !== 2) { ok = false; break; }
    if (ok) {
      let suitSum = 0;
      for (let i = 0; i < 9; i++) suitSum += counts[base + i];
      if (suitSum === 14) names.push(name);
    }
  }
  // 四暗刻
  if (isSuuankou(counts)) names.push('四暗刻');
  return names;
}

// 配牌用の使い回しバッファ (検索ごとに1セット)
function createDrawState() {
  return {
    counts: new Int32Array(34),
    drawn: new Int32Array(14),
    touched: new Int32Array(34),
    touchedCount: 0,
  };
}

// 山 (各牌4枚・全136枚) から14枚引いて state.counts にセットする
// 重複なし抽選 (136枚から14枚を一様に選ぶ)
function drawInto(state) {
  const { counts, drawn, touched } = state;
  for (let k = 0; k < state.touchedCount; k++) counts[touched[k]] = 0;
  state.touchedCount = 0;
  for (let i = 0; i < 14; i++) {
    let x;
    let dup;
    do {
      x = (Math.random() * 136) | 0;
      dup = false;
      for (let k = 0; k < i; k++) if (drawn[k] === x) { dup = true; break; }
    } while (dup);
    drawn[i] = x;
    const tile = (x / 4) | 0;
    if (counts[tile] === 0) touched[state.touchedCount++] = tile;
    counts[tile]++;
  }
  return counts;
}

// 単発用 (テスト等): 新しい counts 配列を返す
const _singleState = createDrawState();
function drawCounts() {
  drawInto(_singleState);
  return Array.from(_singleState.counts);
}

function handTiles(counts) {
  const tiles = [];
  for (let t = 0; t < 34; t++) for (let k = 0; k < counts[t]; k++) tiles.push(t);
  return tiles;
}

function formatCount(n) {
  if (n >= 10000 && n % 10000 === 0) return `${n / 10000}万`;
  return String(n);
}

// ---- 検索ランナー ----
// Web Worker が使える環境では複数ワーカーで並列に配り、最初に見つけたワーカーの結果を採用する。
// 使えない環境では従来通りメインスレッドで分割実行する (フォールバック)。

function buildWorkerSource() {
  return `
'use strict';
const TENHOU_TERMINALS = ${JSON.stringify(TENHOU_TERMINALS)};
const GREEN_MASK = ${JSON.stringify(GREEN_MASK)};
const RED_MASK = ${JSON.stringify(RED_MASK)};
${canFormMelds.toString()}
${canFormTriplets.toString()}
${isTenhou.toString()}
${isSuuankou.toString()}
${yakumanNames.toString()}
${createDrawState.toString()}
${drawInto.toString()}

let running = false;
let target = null;
let attempts = 0;
let tenhouCount = 0;
let others = {};
let state = createDrawState();
let lastPost = 0;

function postProgress(force) {
  const now = Date.now();
  if (!force && now - lastPost < 150) return;
  lastPost = now;
  postMessage({ type: 'progress', attempts, tenhouCount, others });
}

function chunk() {
  if (!running) return;
  const deadline = Date.now() + 40;
  while (Date.now() < deadline) {
    for (let k = 0; k < 2000; k++) {
      attempts++;
      const counts = drawInto(state);
      if (isTenhou(counts)) {
        const yakumans = yakumanNames(counts);
        if (target === null) {
          running = false;
          postMessage({ type: 'found', attempts, counts: Array.from(counts), yakumans, tenhouCount: tenhouCount + 1, others });
          return;
        }
        tenhouCount++;
        if (yakumans.includes(target)) {
          running = false;
          postMessage({ type: 'found', attempts, counts: Array.from(counts), yakumans, tenhouCount, others });
          return;
        }
        for (const name of yakumans) others[name] = (others[name] || 0) + 1;
      }
    }
  }
  postProgress(false);
  setTimeout(chunk, 0);
}

onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'start') {
    target = msg.target;
    attempts = 0;
    tenhouCount = 0;
    others = {};
    state = createDrawState();
    running = true;
    chunk();
  } else if (msg.type === 'stop') {
    running = false;
    postMessage({ type: 'stopped', attempts, tenhouCount, others });
  }
};
`;
}

const workerPool = { byCount: {}, busy: false };

// 速度モードから使うワーカー数 (≒コア数) を決める
function workerCountForMode(mode) {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  const max = Math.min(6, Math.max(1, cores - 1));
  if (mode === 'low') return 1;
  if (mode === 'medium') return Math.max(1, Math.ceil(max / 2));
  return max; // 'high'
}

function getSpeedMode() {
  try {
    const el = document.getElementById('speed-mode');
    if (el && el.value) return el.value;
  } catch (e) {}
  return 'medium';
}

function getWorkerPool(count) {
  if (workerPool.byCount[count]) return workerPool.byCount[count];
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return null;
  try {
    const url = URL.createObjectURL(new Blob([buildWorkerSource()], { type: 'text/javascript' }));
    const workers = [];
    for (let i = 0; i < count; i++) workers.push(new Worker(url));
    workerPool.byCount[count] = workers;
    return workers;
  } catch (err) {
    return null;
  }
}

function runParallel(workers, { target, onProgress }) {
  return new Promise((resolve) => {
    const latest = workers.map(() => ({ attempts: 0, tenhouCount: 0, others: {} }));
    let found = null;
    let stoppedCount = 0;
    let finished = false;
    let cancelledRun = false;

    function totals() {
      let attempts = 0, tenhouCount = 0;
      const others = {};
      for (const s of latest) {
        attempts += s.attempts;
        tenhouCount += s.tenhouCount;
        for (const [k, v] of Object.entries(s.others)) others[k] = (others[k] || 0) + v;
      }
      return { attempts, tenhouCount, others };
    }

    function finish(extra) {
      if (finished) return;
      finished = true;
      workers.forEach((w) => { w.onmessage = null; w.onerror = null; });
      workerPool.busy = false;
      const t = totals();
      if (cancelledRun) {
        resolve({ cancelled: true, attempts: t.attempts, tenhouCount: t.tenhouCount, otherYakumans: t.others });
      } else if (found) {
        resolve({
          attempts: t.attempts,
          counts: found.counts,
          yakumans: found.yakumans,
          tenhouCount: t.tenhouCount,
          otherYakumans: t.others,
        });
      } else {
        resolve({ cancelled: true, attempts: t.attempts, tenhouCount: t.tenhouCount, otherYakumans: t.others });
      }
      if (extra) extra();
    }

    function stopAll() {
      workers.forEach((w) => { try { w.postMessage({ type: 'stop' }); } catch (e) {} });
      // 応答が来ないワーカーがいても固まらないよう保険
      setTimeout(() => finish(), 600);
    }

    workers.forEach((w, idx) => {
      w.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          latest[idx] = { attempts: msg.attempts, tenhouCount: msg.tenhouCount, others: msg.others || {} };
          if (onProgress && !found) {
            const t = totals();
            onProgress(t.attempts, t.tenhouCount);
          }
        } else if (msg.type === 'found') {
          latest[idx] = { attempts: msg.attempts, tenhouCount: msg.tenhouCount, others: msg.others || {} };
          if (!found) {
            found = msg;
            stopAll();
          }
        } else if (msg.type === 'stopped') {
          latest[idx] = { attempts: msg.attempts, tenhouCount: msg.tenhouCount, others: msg.others || {} };
          stoppedCount++;
          if ((found || cancelledRun) && stoppedCount >= workers.length) finish();
        }
      };
      w.onerror = () => {};
      w.postMessage({ type: 'start', target });
    });

    runParallel._cancelCurrent = () => {
      cancelledRun = true;
      stopAll();
    };
  });
}

function createRunner() {
  let cancelled = false;
  let parallelCancel = null;
  return {
    cancel() {
      cancelled = true;
      if (parallelCancel) parallelCancel();
    },
    run({ target = null, maxAttempts = Infinity, onProgress }) {
      // 並列実行 (上限なしの検索のみ対象; ワーカーが使えない/他で使用中ならフォールバック)
      const workers = getWorkerPool(workerCountForMode(getSpeedMode()));
      if (workers && !workerPool.busy && maxAttempts === Infinity) {
        workerPool.busy = true;
        const promise = runParallel(workers, { target, onProgress });
        parallelCancel = () => runParallel._cancelCurrent && runParallel._cancelCurrent();
        return promise;
      }
      // フォールバック: メインスレッドで分割実行
      return new Promise((resolve) => {
        let attempts = 0;
        let tenhouCount = 0;
        const otherYakumans = {};
        const state = createDrawState();
        let lastProgressAt = 0;
        cancelled = false;
        function chunk() {
          if (cancelled) {
            resolve({ cancelled: true, attempts, tenhouCount, otherYakumans });
            return;
          }
          const deadline = performance.now() + 40;
          while (performance.now() < deadline && attempts < maxAttempts) {
            for (let k = 0; k < 2000 && attempts < maxAttempts; k++) {
              attempts++;
              const counts = drawInto(state);
              if (isTenhou(counts)) {
                const yakumans = yakumanNames(counts);
                if (target === null) {
                  resolve({ attempts, counts: Array.from(counts), yakumans, tenhouCount: tenhouCount + 1, otherYakumans });
                  return;
                }
                tenhouCount++;
                if (yakumans.includes(target)) {
                  resolve({ attempts, counts: Array.from(counts), yakumans, tenhouCount, otherYakumans });
                  return;
                }
                for (const name of yakumans) {
                  otherYakumans[name] = (otherYakumans[name] || 0) + 1;
                }
              }
            }
          }
          const now = performance.now();
          if (onProgress && now - lastProgressAt >= 150) {
            lastProgressAt = now;
            onProgress(attempts, tenhouCount);
          }
          if (attempts >= maxAttempts) {
            resolve({ attempts, counts: null, yakumans: null, tenhouCount, otherYakumans });
            return;
          }
          setTimeout(chunk, 0);
        }
        chunk();
      });
    },
  };
}

// ---- UI ----

// 速度モードの初期化: 選択肢に実際のコア数を表示し、前回の選択を復元する
(function initSpeedMode() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('speed-mode');
  if (!el) return;
  const label = (mode) => {
    const n = workerCountForMode(mode);
    return mode === 'low' ? `低速（${n}コア）` : mode === 'medium' ? `中速（${n}コア）` : `最速（${n}コア）`;
  };
  for (const opt of el.options) opt.textContent = label(opt.value);
  try {
    const saved = localStorage.getItem('tenho-speed-mode');
    if (saved && ['low', 'medium', 'high'].includes(saved)) el.value = saved;
  } catch (e) {}
  el.addEventListener('change', () => {
    try { localStorage.setItem('tenho-speed-mode', el.value); } catch (e) {}
  });
})();

function setupGenerator(prefix, { targetSelectId = null } = {}) {
  const startBtn = document.getElementById(`${prefix}-btn`);
  const stopBtn = document.getElementById(`${prefix}-stop`);
  const statusEl = document.getElementById(`${prefix}-status`);
  const resultEl = document.getElementById(`${prefix}-result`);
  const tilesEl = document.getElementById(`${prefix}-tiles`);
  if (!startBtn) return;
  let runner = null;

  startBtn.addEventListener('click', async () => {
    const target = targetSelectId
      ? document.getElementById(targetSelectId).value
      : null;
    const maxAttempts = target ? YAKUMAN_MAX_ATTEMPTS : Infinity;

    startBtn.disabled = true;
    stopBtn.disabled = false;
    resultEl.style.display = 'none';
    statusEl.textContent = '配牌中… 0回';

    runner = createRunner();
    const res = await runner.run({
      target,
      maxAttempts,
      onProgress: (n, th) => {
        statusEl.textContent = target
          ? `配牌中… ${n.toLocaleString()}回 (天和 ${th}回)`
          : `配牌中… ${n.toLocaleString()}回`;
      },
    });

    startBtn.disabled = false;
    stopBtn.disabled = true;

    if (res.cancelled) {
      statusEl.textContent = `${res.attempts.toLocaleString()}回で中止しました`;
      return;
    }

    tilesEl.textContent = '';
    resultEl.style.display = 'block';

    if (res.counts === null) {
      // 上限到達時 (現在は上限なしのため通常は到達しない)
      statusEl.textContent = '';
      tilesEl.innerHTML =
        `<p>${target}の天和は${formatCount(res.attempts)}回配っても出ませんでした…</p>` +
        `<p>過負荷防止のため強制ストップしました</p>` +
        `<p>その間に天和は<strong>${res.tenhouCount}回</strong>出ました</p>`;
      const others = YAKUMAN_LIST.filter((n) => res.otherYakumans[n]);
      if (others.length) {
        tilesEl.innerHTML += '<p>その間に出た役満:</p>' +
          others.map((n) => `<p>${n}: ${res.otherYakumans[n]}回</p>`).join('');
      }
      return;
    }

    statusEl.textContent = '';
    const tiles = handTiles(res.counts).map((t) => TILE_EMOJIS[t]).join('');
    let html = `<p class="tiles">${tiles}</p><p>天和！</p>`;
    for (const name of res.yakumans) {
      html += `<p>天和！${name}！</p>`;
    }
    html += `<p>天和が出るまでにかかった回数は…</p><p><strong>${res.attempts.toLocaleString()}回</strong></p>`;
    tilesEl.innerHTML = html;
  });

  stopBtn.addEventListener('click', () => {
    if (runner) runner.cancel();
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    setupGenerator('tenho');
    setupGenerator('yakuman', { targetSelectId: 'yakuman-select' });
  });
}

// Node でのテスト用 (ブラウザでは無視される)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isTenhou, yakumanNames, drawCounts, handTiles, YAKUMAN_LIST, createDrawState, drawInto };
}
