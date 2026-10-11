const speedForm = document.getElementById('speed-form');
const comparisonResult = document.getElementById('comparison-result');
const speedRange = document.getElementById('speed-range');

function applyBuff(speed, buff) {
  const multiplier = 1 + Math.abs(buff) * 0.3;

  return buff >= 0 ? speed * multiplier : speed / multiplier;
}

function getInputValue(id, defaultValue = 0) {
  const value = document.getElementById(id).valueAsNumber;

  return Number.isNaN(value) ? defaultValue : value;
}

function calculateSpeed(speedId, firstBuffId, secondBuffId, iceId) {
  const speed = getInputValue(speedId);
  const firstBuff = getInputValue(firstBuffId);
  const secondBuff = getInputValue(secondBuffId);
  const ice = getInputValue(iceId);
  const buffedSpeed = applyBuff(applyBuff(speed, firstBuff), secondBuff);

  return buffedSpeed * 0.875 ** ice;
}

function formatSpeed(speed) {
  return Number(speed.toFixed(2));
}

speedForm.addEventListener('submit', (event) => {
  event.preventDefault();

  if (!speedForm.checkValidity()) {
    speedForm.reportValidity();
    return;
  }

  const calculatedSpeeds = [
    calculateSpeed('speed1', 'speed_buff1_1', 'speed_buff1_2', 'speed_ice1'),
    calculateSpeed('speed2', 'speed_buff2_1', 'speed_buff2_2', 'speed_ice2'),
  ];

  if (calculatedSpeeds.some((speed) => !Number.isFinite(speed))) {
    comparisonResult.textContent = '数値を入力してください。';
    speedRange.textContent = '未計算';
    return;
  }

  const minimumSpeeds = calculatedSpeeds.map((speed) => speed * 0.64);
  const maximumSpeeds = calculatedSpeeds;
  let comparison = 'どちらも確実には上回りません。';

  if (minimumSpeeds[0] > maximumSpeeds[1]) {
    comparison = '1人目が確実に上回ります。';
  } else if (minimumSpeeds[1] > maximumSpeeds[0]) {
    comparison = '2人目が確実に上回ります。';
  }

  comparisonResult.textContent = comparison;
  speedRange.textContent =
    `1人目 ${formatSpeed(minimumSpeeds[0])}〜${formatSpeed(maximumSpeeds[0])} / ` +
    `2人目 ${formatSpeed(minimumSpeeds[1])}〜${formatSpeed(maximumSpeeds[1])}`;
});