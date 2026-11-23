// 天和ジェネレーター
// oroca-mimini の /tenho・/yakuman と同じ判定ロジックを移植したもの。
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
const YAKUMAN_MAX_ATTEMPTS = 10_000_000; // 過負荷防止の強制ストップ回数 (bot版と同じ)

// 残りの牌が全部 面子(順子/刻子) に分解できれば true
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
  for (const v of counts) if (v === 2) pairs++;
  if (pairs === 7) return true;
  // 国士無双
  let kokushi = true;
  let termSum = 0;
  for (const t of TENHOU_TERMINALS) {
    if (counts[t] < 1) { kokushi = false; break; }
    termSum += counts[t];
  }
  if (kokushi && termSum === 14) return true;
  // 通常形: 雀頭を1つ抜いて、残りが全部面子
  for (let pair = 0; pair < 34; pair++) {
    if (counts[pair] >= 2) {
      const rest = counts.slice();
      rest[pair] -= 2;
      if (canFormMelds(rest)) return true;
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
      const rest = counts.slice();
      rest[pair] -= 2;
      if (canFormTriplets(rest)) return true;
    }
  }
  return false;
}

// 和了形の counts から、該当する役満の名前リストを返す (bot版と同順・同条件)
function yakumanNames(counts) {
  const names = [];
  const winds = counts.slice(27, 31); // 東南西北
  const dragons = counts.slice(31, 34); // 白發中
  // 国士無双
  let termSum = 0;
  let kokushi = true;
  for (const t of TENHOU_TERMINALS) {
    if (counts[t] < 1) { kokushi = false; break; }
    termSum += counts[t];
  }
  if (kokushi && termSum === 14) names.push('国士無双');
  // 大七星 (字牌の七対子)
  let pairs = 0;
  for (const v of counts) if (v === 2) pairs++;
  let honorSum = 0;
  for (let i = 27; i < 34; i++) honorSum += counts[i];
  if (pairs === 7 && honorSum === 14) names.push('大七星');
  // 大四喜 / 小四喜
  if (winds.every((v) => v >= 3)) {
    names.push('大四喜');
  } else if (winds.filter((v) => v >= 3).length === 3 && winds.some((v) => v === 2)) {
    names.push('小四喜');
  }
  // 大三元
  if (dragons.every((v) => v >= 3)) names.push('大三元');
  // 字一色
  if (honorSum === 14) names.push('字一色');
  // 緑一色 (索子の2,3,4,6,8 と 發 だけ)
  const green = [19, 20, 21, 23, 25, 32];
  if (counts.every((v, t) => green.includes(t) || v === 0)) names.push('緑一色');
  // 紅孔雀 (索子の1,5,7,9 と 中 だけ)
  const red = [18, 22, 24, 26, 33];
  if (counts.every((v, t) => red.includes(t) || v === 0)) names.push('紅孔雀');
  // 九蓮宝燈 (1種の数牌で 1112345678999 + 1枚)
  for (const base of [0, 9, 18]) {
    const suit = counts.slice(base, base + 9);
    const suitSum = suit.reduce((a, b) => a + b, 0);
    if (suitSum === 14 && suit[0] >= 3 && suit[8] >= 3 && suit.every((v) => v >= 1)) {
      names.push('九蓮宝燈');
      break;
    }
  }
  // 大車輪(筒子) / 大竹林(索子) / 大数隣(萬子) : 2〜8の七対子
  for (const [base, name] of [[9, '大車輪'], [18, '大竹林'], [0, '大数隣']]) {
    let ok = true;
    for (let i = 1; i <= 7; i++) if (counts[base + i] !== 2) { ok = false; break; }
    let suitSum = 0;
    for (let i = 0; i < 9; i++) suitSum += counts[base + i];
    if (ok && suitSum === 14) names.push(name);
  }
  // 四暗刻
  if (isSuuankou(counts)) names.push('四暗刻');
  return names;
}

// 山 (各牌4枚・全136枚) から14枚引いた counts を返す
const wall = Array.from({ length: 136 }, (_, i) => i);
function drawCounts() {
  const counts = new Array(34).fill(0);
  // 部分 Fisher-Yates で先頭14枚を抽選 (Python の random.sample と同分布)
  for (let i = 0; i < 14; i++) {
    const j = i + Math.floor(Math.random() * (136 - i));
    const tmp = wall[i]; wall[i] = wall[j]; wall[j] = tmp;
    counts[Math.floor(wall[i] / 4)]++;
  }
  return counts;
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

// ---- 検索ランナー (画面を固めないようチャンク実行 + 中止対応) ----
function createRunner() {
  let cancelled = false;
  return {
    cancel() { cancelled = true; },
    run({ target = null, maxAttempts = Infinity, onProgress }) {
      return new Promise((resolve) => {
        let attempts = 0;
        let tenhouCount = 0;
        const otherYakumans = {};
        cancelled = false;
        function chunk() {
          if (cancelled) {
            resolve({ cancelled: true, attempts, tenhouCount, otherYakumans });
            return;
          }
          const chunkSize = 3000;
          const end = Math.min(attempts + chunkSize, maxAttempts);
          while (attempts < end) {
            attempts++;
            const counts = drawCounts();
            if (isTenhou(counts)) {
              const yakumans = yakumanNames(counts);
              if (target === null) {
                resolve({ attempts, counts, yakumans, tenhouCount: tenhouCount + 1, otherYakumans });
                return;
              }
              tenhouCount++;
              if (yakumans.includes(target)) {
                resolve({ attempts, counts, yakumans, tenhouCount, otherYakumans });
                return;
              }
              for (const name of yakumans) {
                otherYakumans[name] = (otherYakumans[name] || 0) + 1;
              }
            }
          }
          if (onProgress) onProgress(attempts, tenhouCount);
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
      // 強制ストップ (bot版と同じ文言・集計)
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
  module.exports = { isTenhou, yakumanNames, drawCounts, handTiles, YAKUMAN_LIST };
}
