// ガチャシュミレーター
// 確率は提供割合の画像通り:
//   通常枠: 仲間 7.500% (うちPU仲間 0.500%、特定の仲間(PU以外) 0.055%),
//           絵札★5 15.000%, 絵札★4 35.000%, 絵札★3 42.500%
//   仲間1人確定枠 (神結晶10連の10枚目): PU仲間 10.000%, 特定の仲間 0.714%, その他仲間 89.286%
//   ※特定の仲間はPUではないので、天井カウントのリセット対象にはならない
// 天井: 400連。PUが出たら、その10連が終わったタイミングでカウントをリセット。
//       400連に到達した枠はPU仲間確定。

const RESULT_TYPES = {
  pu_nakama: { label: 'PU仲間', stars: '', cssClass: 'pu', isPU: true },
  nakama: { label: '仲間', stars: '', cssClass: 'nakama', isPU: false },
  tokutei: { label: '特定の仲間', stars: '', cssClass: 'nakama', isPU: false },
  efuda5: { label: '絵札', stars: '★★★★★', cssClass: 'r5', isPU: false },
  efuda4: { label: '絵札', stars: '★★★★', cssClass: 'r4', isPU: false },
  efuda3: { label: '絵札', stars: '★★★', cssClass: 'r3', isPU: false },
};

// 通常枠 (合計 100.000%)
const NORMAL_RATES = [
  { key: 'pu_nakama', rate: 0.5 },
  { key: 'tokutei', rate: 0.055 },
  { key: 'nakama', rate: 6.945 },
  { key: 'efuda5', rate: 15.0 },
  { key: 'efuda4', rate: 35.0 },
  { key: 'efuda3', rate: 42.5 },
];

// 仲間1人確定枠 (合計 100.000%)
const GUARANTEED_RATES = [
  { key: 'pu_nakama', rate: 10.0 },
  { key: 'tokutei', rate: 0.714 },
  { key: 'nakama', rate: 89.286 },
];

const CEILING_MAX = 400;

function drawOnce(rates) {
  const roll = Math.random() * 100;
  let acc = 0;
  for (const entry of rates) {
    acc += entry.rate;
    if (roll < acc) return entry.key;
  }
  return rates[rates.length - 1].key;
}

// 10連を生成する。ceiling は現在の天井カウント (0-399)。
// 戻り値: { results: [{key, ceilingHit}], newCeiling, puFound }
function generatePull(kind, ceiling) {
  const results = [];
  let count = ceiling;
  let puFound = false;
  for (let i = 0; i < 10; i++) {
    if (!puFound) count++;
    const rates = (kind === 'kami' && i === 9) ? GUARANTEED_RATES : NORMAL_RATES;
    let key = drawOnce(rates);
    let ceilingHit = false;
    if (count >= CEILING_MAX && !puFound && !RESULT_TYPES[key].isPU) {
      key = 'pu_nakama'; // 天井到達: その枠はPU仲間確定
      ceilingHit = true;
    }
    if (RESULT_TYPES[key].isPU) puFound = true;
    results.push({ key, ceilingHit });
  }
  return { results, newCeiling: puFound ? 0 : count, puFound };
}

// ---- 状態 ----
const state = {
  ceiling: 0,
  totalDraws: 0,
  totalPulls: 0,
  puCount: 0,
  nakamaCount: 0,
  efuda5Count: 0,
  currentResults: null,
  flippedCount: 0,
};

// ---- UI ----
const gridEl = () => document.getElementById('gacha-grid');
const summaryEl = () => document.getElementById('gacha-summary');

function updateStats() {
  document.getElementById('ceiling-count').textContent =
    `${state.ceiling} / ${CEILING_MAX}連 (あと ${CEILING_MAX - state.ceiling}連で天井)`;
  document.getElementById('total-stats').textContent =
    `合計 ${state.totalDraws}連 / PU ${state.puCount}回 / 仲間 ${state.nakamaCount}人 / 絵札★5 ${state.efuda5Count}枚`;
}

function flipCard(cardEl) {
  if (cardEl.classList.contains('flipped')) return;
  cardEl.classList.add('flipped');
  state.flippedCount++;
  if (state.flippedCount >= 10) showSummary();
}

function showSummary() {
  if (!state.currentResults) return;
  const counts = {};
  for (const r of state.currentResults) counts[r.key] = (counts[r.key] || 0) + 1;
  const parts = [];
  for (const key of ['pu_nakama', 'tokutei', 'nakama', 'efuda5', 'efuda4', 'efuda3']) {
    if (counts[key]) {
      const t = RESULT_TYPES[key];
      parts.push(`${t.label}${t.stars} ×${counts[key]}`);
    }
  }
  const ceilingHit = state.currentResults.some((r) => r.ceilingHit);
  summaryEl().innerHTML =
    `<p><strong>結果:</strong> ${parts.join(' / ')}</p>` +
    (ceilingHit ? '<p><strong>天井到達！</strong> PU仲間が確定で出ました</p>' : '') +
    (state.lastPuFound ? '<p>PUが出たので、天井カウントをリセットしました</p>' : '');
  summaryEl().style.display = 'block';
}

function doPull(kind) {
  const { results, newCeiling, puFound } = generatePull(kind, state.ceiling);
  state.ceiling = newCeiling;
  state.lastPuFound = puFound;
  state.currentResults = results;
  state.flippedCount = 0;
  state.totalDraws += 10;
  state.totalPulls += 1;
  for (const r of results) {
    const t = RESULT_TYPES[r.key];
    if (t.isPU) state.puCount++;
    if (r.key === 'nakama' || r.key === 'pu_nakama' || r.key === 'tokutei') state.nakamaCount++;
    if (r.key === 'efuda5') state.efuda5Count++;
  }
  updateStats();
  summaryEl().style.display = 'none';

  const grid = gridEl();
  grid.innerHTML = '';
  results.forEach((r, idx) => {
    const t = RESULT_TYPES[r.key];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'gacha-card';
    card.setAttribute('aria-label', `${idx + 1}枚目をめくる`);
    card.innerHTML =
      `<span class="card-inner">` +
      `<span class="card-face card-back">?</span>` +
      `<span class="card-face card-front ${t.cssClass}">` +
      (t.isPU ? '<span class="pu-badge">PU</span>' : '') +
      (r.ceilingHit ? '<span class="pu-badge">天井</span>' : '') +
      (t.stars ? `<span class="card-stars">${t.stars}</span>` : '') +
      `<span class="card-label">${t.label}</span>` +
      `</span></span>`;
    card.addEventListener('click', () => flipCard(card));
    grid.appendChild(card);
  });
  document.getElementById('skip-btn').disabled = false;
  document.getElementById('gacha-area').style.display = 'flex';
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
  updateStats();
  document.getElementById('houshou-btn').addEventListener('click', () => doPull('houshou'));
  document.getElementById('kami-btn').addEventListener('click', () => doPull('kami'));
  document.getElementById('skip-btn').addEventListener('click', () => {
    document.querySelectorAll('.gacha-card').forEach((c) => flipCard(c));
  });
});

// Node でのテスト用 (ブラウザでは無視される)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { drawOnce, generatePull, NORMAL_RATES, GUARANTEED_RATES, RESULT_TYPES, CEILING_MAX };
}
