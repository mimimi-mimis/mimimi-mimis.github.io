// 天和ジェネレーター
// 天和・役満の判定ロジック (高速化版: スート別ルックアップテーブル + 配牌中の集計)
// ※ 役満指定モードでは早期リジェクトで天和判定を省略して高速化し、その代わり
//    天和回数・他の役満は集計しない。指定なしモードでは全配牌を完全判定して集計する
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

// ---- 高速判定用ルックアップテーブル ----
// 数牌スート (9種) の牌形を、カウントベクトルを 5 進数とみなしたキーで分類する。
// SUIT_BITS[key] の bit0: そのスート単独で面子に分解できる / bit1: 雀頭を1つ含んで分解できる。
// テーブルは面子の組み合わせの列挙で作る (全パターンの走査より桁違いに速い)。
const POW5 = [1, 5, 25, 125, 625, 3125, 15625, 78125, 390625];
const TILE_GROUP = new Uint8Array(34); // 牌種 -> グループ番号 (0=萬,1=筒,2=索,3=字)
const TILE_POW5 = new Int32Array(34);  // 牌種 -> スートキーへの加算値 (字牌は0)
for (let t = 0; t < 34; t++) {
  TILE_GROUP[t] = t < 27 ? (t / 9) | 0 : 3;
  TILE_POW5[t] = t < 27 ? POW5[t % 9] : 0;
}

function buildSuitTable() {
  const table = new Uint8Array(1953125); // 5^9 通り
  const meldIdx = [];
  for (let i = 0; i < 9; i++) meldIdx.push([i, i, i]);         // 刻子
  for (let i = 0; i < 7; i++) meldIdx.push([i, i + 1, i + 2]); // 順子
  const cur = new Int32Array(9);
  function keyOf() {
    let k = 0;
    for (let i = 8; i >= 0; i--) k = k * 5 + cur[i];
    return k;
  }
  function dfs(start, used, bit) {
    table[keyOf()] |= bit;
    if (used === 4) return;
    for (let m = start; m < meldIdx.length; m++) {
      const md = meldIdx[m];
      cur[md[0]]++; cur[md[1]]++; cur[md[2]]++;
      if (cur[md[0]] <= 4 && cur[md[1]] <= 4 && cur[md[2]] <= 4) dfs(m, used + 1, bit);
      cur[md[0]]--; cur[md[1]]--; cur[md[2]]--;
    }
  }
  dfs(0, 0, 1); // 面子のみ
  for (let p = 0; p < 9; p++) { // 雀頭1つ + 面子
    cur[p] = 2;
    dfs(0, 0, 2);
    cur[p] = 0;
  }
  return table;
}
const SUIT_BITS = buildSuitTable();

// 国士無双か (13種の么九字牌が全部あり、么九字牌だけで14枚)
function isKokushi(counts) {
  let termSum = 0;
  for (let k = 0; k < TENHOU_TERMINALS.length; k++) {
    const t = TENHOU_TERMINALS[k];
    if (counts[t] < 1) return false;
    termSum += counts[t];
  }
  return termSum === 14;
}

// 字牌は順子がないので、各牌が 0 枚か 3 の倍数枚 (雀頭を除く) であれば面子になる
function honorsMelds(counts) {
  for (let i = 27; i < 34; i++) if (counts[i] % 3 !== 0) return false;
  return true;
}

// 字牌グループが「雀頭1つ + 刻子だけ」に分解できるか
function honorsPairMelds(counts) {
  for (let p = 27; p < 34; p++) {
    if (counts[p] < 2) continue;
    let ok = true;
    for (let i = 27; i < 34; i++) {
      const v = counts[i] - (i === p ? 2 : 0);
      if (v % 3 !== 0) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

// 和了形判定のコア。グループ別枚数だけを外から渡し、スートキーと対子数は
// 候補になった手についてだけ遅延計算する (大半の手は mod 3 フィルターで落ちる)。
// 面子分解は再帰ではなく SUIT_BITS の参照だけで済む。
function suitKeyOf(counts, base) {
  let k = 0;
  for (let i = 0; i < 9; i++) k += counts[base + i] * POW5[i];
  return k;
}
function tenhouFromParts(counts, g0, g1, g2, g3) {
  // 通常形の高速フィルター: 雀頭のあるグループだけ枚数 % 3 == 2、他は % 3 == 0
  let pairGroup = -1;
  let modOk = true;
  let m = g0 % 3;
  if (m === 2) pairGroup = 0; else if (m !== 0) modOk = false;
  m = g1 % 3;
  if (m === 2) { if (pairGroup !== -1) modOk = false; else pairGroup = 1; } else if (m !== 0) modOk = false;
  m = g2 % 3;
  if (m === 2) { if (pairGroup !== -1) modOk = false; else pairGroup = 2; } else if (m !== 0) modOk = false;
  m = g3 % 3;
  if (m === 2) { if (pairGroup !== -1) modOk = false; else pairGroup = 3; } else if (m !== 0) modOk = false;
  if (modOk && pairGroup !== -1) {
    let meldOk = true;
    if (pairGroup !== 0 && !(SUIT_BITS[suitKeyOf(counts, 0)] & 1)) meldOk = false;
    if (meldOk && pairGroup !== 1 && !(SUIT_BITS[suitKeyOf(counts, 9)] & 1)) meldOk = false;
    if (meldOk && pairGroup !== 2 && !(SUIT_BITS[suitKeyOf(counts, 18)] & 1)) meldOk = false;
    if (meldOk && pairGroup !== 3 && !honorsMelds(counts)) meldOk = false;
    if (meldOk) {
      if (pairGroup === 3) {
        if (honorsPairMelds(counts)) return true;
      } else if (SUIT_BITS[suitKeyOf(counts, pairGroup * 9)] & 2) {
        return true;
      }
    }
  }
  // 七対子: 各グループの枚数が全部偶数のときにだけ対子を数える (必要条件)
  if ((g0 & 1) === 0 && (g1 & 1) === 0 && (g2 & 1) === 0 && (g3 & 1) === 0) {
    let pairs = 0;
    for (let i = 0; i < 34; i++) if (counts[i] === 2) pairs++;
    if (pairs === 7) return true;
  }
  return isKokushi(counts);
}

// 14枚が和了形か (通常形 / 七対子 / 国士無双)。counts だけから判定する互換版
function isTenhou(counts) {
  let g0 = 0, g1 = 0, g2 = 0, g3 = 0;
  for (let i = 0; i < 9; i++) g0 += counts[i];
  for (let i = 9; i < 18; i++) g1 += counts[i];
  for (let i = 18; i < 27; i++) g2 += counts[i];
  for (let i = 27; i < 34; i++) g3 += counts[i];
  return tenhouFromParts(counts, g0, g1, g2, g3);
}

// 配牌状態 (drawInto が配りながら維持するグループ別枚数) を使う最速版
function isTenhouState(state) {
  const gr = state.groups;
  return tenhouFromParts(state.counts, gr[0], gr[1], gr[2], gr[3]);
}

// ---- 狙いの役満ごとの早期リジェクト (役満指定モードの検索ループで使用) ----
// どれも「その役満があり得るなら必ず満たす」必要条件だけを見るので、本物の役満を
// 弾くことはない。役満指定モードではこれで天和判定自体を省略して高速化し、その
// 代わり狙い以外の天和や役満は集計 (その間に天和はN回 / 他の役満) しない。
// 指定なしモードでは使わず、全配牌を完全判定して集計する。
const NONTERMINALS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23, 24, 25];
const TARGET_CODE = {
  '国士無双': 1, '大三元': 2, '四暗刻': 3, '字一色': 4, '大四喜': 5, '小四喜': 6,
  '九蓮宝燈': 7, '緑一色': 8, '大七星': 9, '紅孔雀': 10, '大車輪': 11, '大竹林': 12, '大数隣': 13,
};
function targetCodeOf(target) {
  if (target === null || target === undefined) return -1;
  return TARGET_CODE[target] || 0;
}
function targetPossible(counts, groups, code) {
  switch (code) {
    case 1: // 国士無双: 么九字牌以外の牌が1枚でもあれば不可
      for (let i = 0; i < NONTERMINALS.length; i++) if (counts[NONTERMINALS[i]] > 0) return false;
      return true;
    case 2: // 大三元: 白・發・中がそれぞれ3枚以上必要
      return counts[31] >= 3 && counts[32] >= 3 && counts[33] >= 3;
    case 3: // 四暗刻: 枚数が1枚・4枚の牌種があってはならない
      for (let i = 0; i < 34; i++) { const c = counts[i]; if (c === 1 || c === 4) return false; }
      return true;
    case 4: // 字一色: 字牌だけで14枚
      return groups[3] === 14;
    case 5: // 大四喜: 風牌12枚が必要
      return counts[27] + counts[28] + counts[29] + counts[30] >= 12;
    case 6: // 小四喜: 風牌11枚が必要
      return counts[27] + counts[28] + counts[29] + counts[30] >= 11;
    case 7: // 九蓮宝燈: 数牌1色のみで14枚
      return groups[0] === 14 || groups[1] === 14 || groups[2] === 14;
    case 8: // 緑一色: 対象外の牌があれば不可
      for (let t = 0; t < 34; t++) if (counts[t] > 0 && !GREEN_MASK[t]) return false;
      return true;
    case 9: // 大七星: 字牌だけで14枚
      return groups[3] === 14;
    case 10: // 紅孔雀: 対象外の牌があれば不可
      for (let t = 0; t < 34; t++) if (counts[t] > 0 && !RED_MASK[t]) return false;
      return true;
    case 11: // 大車輪: 筒子のみで14枚
      return groups[1] === 14;
    case 12: // 大竹林: 索子のみで14枚
      return groups[2] === 14;
    case 13: // 大数隣: 萬子のみで14枚
      return groups[0] === 14;
    default:
      return true;
  }
}

// 雀頭を1つ抜いて、残りが全部刻子 (各牌 0 枚か 3 枚) なら四暗刻。
// 刻子だけの分解は決定的なので、再帰なしで判定できる
function isSuuankou(counts) {
  for (let pair = 0; pair < 34; pair++) {
    if (counts[pair] < 2) continue;
    let ok = true;
    for (let i = 0; i < 34; i++) {
      const v = counts[i] - (i === pair ? 2 : 0);
      if (v !== 0 && v !== 3) { ok = false; break; }
    }
    if (ok) return true;
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
// wall は 136 枚の並びを保持し続け、部分 Fisher-Yates で先頭14枚を選ぶ。
// 置換後の wall も 136 枚の順列のままなので、毎回初期化し直さなくても
// 次の抽選は一様ランダムになる (重複チェックのループも不要になる)
function createDrawState() {
  const wall = new Uint8Array(136);
  for (let i = 0; i < 136; i++) wall[i] = i;
  return {
    counts: new Int32Array(34),
    wall,
    hand: new Uint8Array(14),
    touched: new Int32Array(34),
    touchedCount: 0,
    // drawInto が配りながら維持する集計値 (判定の再計算を避ける)
    groups: new Int32Array(4),
    // 高速な疑似乱数 (LCG) の種。ワーカーごとに違う値になるよう乱数+時刻で初期化
    rng: ((Math.random() * 4294967296) ^ Date.now()) | 0,
  };
}

// 山 (各牌4枚・全136枚) から14枚引いて state.counts にセットする
// 乱数は Math.random より高速な LCG を使い、上位ビットから抽選位置を決める
function drawInto(state) {
  const counts = state.counts;
  const wall = state.wall;
  const touched = state.touched;
  for (let k = 0; k < state.touchedCount; k++) counts[touched[k]] = 0;
  state.touchedCount = 0;
  const gr = state.groups;
  gr[0] = 0; gr[1] = 0; gr[2] = 0; gr[3] = 0;
  let rng = state.rng | 0;
  for (let i = 0; i < 14; i++) {
    rng = (Math.imul(rng, 1664525) + 1013904223) | 0;
    const j = i + (Math.imul(rng >>> 16, 136 - i) >>> 16);
    const tmp = wall[i]; wall[i] = wall[j]; wall[j] = tmp;
    const id = wall[i];
    state.hand[i] = id; // 引いた実牌 (結果表示用)
    const tile = id >> 2;
    const before = counts[tile];
    if (before === 0) touched[state.touchedCount++] = tile;
    counts[tile] = before + 1;
    gr[TILE_GROUP[tile]]++;
  }
  state.rng = rng;
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
const POW5 = [1, 5, 25, 125, 625, 3125, 15625, 78125, 390625];
const TILE_GROUP = new Uint8Array(34);
const TILE_POW5 = new Int32Array(34);
for (let t = 0; t < 34; t++) { TILE_GROUP[t] = t < 27 ? (t / 9) | 0 : 3; TILE_POW5[t] = t < 27 ? POW5[t % 9] : 0; }
${buildSuitTable.toString()}
const SUIT_BITS = buildSuitTable();
${honorsMelds.toString()}
${isKokushi.toString()}
${honorsPairMelds.toString()}
${suitKeyOf.toString()}
${tenhouFromParts.toString()}
${isTenhou.toString()}
${isTenhouState.toString()}
${isSuuankou.toString()}
${yakumanNames.toString()}
const NONTERMINALS = ${JSON.stringify(NONTERMINALS)};
const TARGET_CODE = ${JSON.stringify(TARGET_CODE)};
${targetCodeOf.toString()}
${targetPossible.toString()}
${createDrawState.toString()}
${drawInto.toString()}

let running = false;
let target = null;
let targetCode = -1;
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
    for (let k = 0; k < 20000; k++) {
      attempts++;
      const counts = drawInto(state);
      if (targetCode >= 1) {
        // 役満指定モード: 狙いの役満があり得ない配牌は判定を省略して高速化する。
        // このモードでは天和回数・他の役満は集計しない
        if (!targetPossible(counts, state.groups, targetCode)) continue;
        if (isTenhouState(state)) {
          const yakumans = yakumanNames(counts);
          if (yakumans.includes(target)) {
            running = false;
            postMessage({ type: 'found', attempts, counts: Array.from(counts), yakumans, tenhouCount, others });
            return;
          }
        }
        continue;
      }
      // 指定なしモード: 全配牌を完全判定し、天和回数と他の役満を漏れなく集計する
      if (isTenhouState(state)) {
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
    targetCode = targetCodeOf(msg.target);
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
        const targetCode = targetCodeOf(target);
        let lastProgressAt = 0;
        cancelled = false;
        function chunk() {
          if (cancelled) {
            resolve({ cancelled: true, attempts, tenhouCount, otherYakumans });
            return;
          }
          const deadline = performance.now() + 40;
          while (performance.now() < deadline && attempts < maxAttempts) {
            for (let k = 0; k < 20000 && attempts < maxAttempts; k++) {
              attempts++;
              const counts = drawInto(state);
              if (targetCode >= 1) {
                // 役満指定モード: 狙いの役満があり得ない配牌は判定を省略して高速化する。
                // このモードでは天和回数・他の役満は集計しない
                if (!targetPossible(counts, state.groups, targetCode)) continue;
                if (isTenhouState(state)) {
                  const yakumans = yakumanNames(counts);
                  if (yakumans.includes(target)) {
                    resolve({ attempts, counts: Array.from(counts), yakumans, tenhouCount, otherYakumans });
                    return;
                  }
                }
                continue;
              }
              // 指定なしモード: 全配牌を完全判定し、天和回数と他の役満を漏れなく集計する
              if (isTenhouState(state)) {
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
    // 役満指定モードでは天和回数・他の役満を集計しないので、表示も配牌回数だけにする
    const fastTarget = targetCodeOf(target) >= 1;

    startBtn.disabled = true;
    stopBtn.disabled = false;
    resultEl.style.display = 'none';
    statusEl.textContent = '配牌中… 0回';

    runner = createRunner();
    const res = await runner.run({
      target,
      maxAttempts,
      onProgress: (n, th) => {
        statusEl.textContent = (target && !fastTarget)
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
        `<p>過負荷防止のため強制ストップしました</p>`;
      if (!fastTarget) {
        tilesEl.innerHTML += `<p>その間に天和は<strong>${res.tenhouCount}回</strong>出ました</p>`;
        const others = YAKUMAN_LIST.filter((n) => res.otherYakumans[n]);
        if (others.length) {
          tilesEl.innerHTML += '<p>その間に出た役満:</p>' +
            others.map((n) => `<p>${n}: ${res.otherYakumans[n]}回</p>`).join('');
        }
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
  module.exports = { isTenhou, isTenhouState, yakumanNames, targetPossible, targetCodeOf, drawCounts, handTiles, YAKUMAN_LIST, createDrawState, drawInto };
}
