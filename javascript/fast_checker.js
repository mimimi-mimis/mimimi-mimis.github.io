const speedForm = document.getElementById('speed-form');
const comparisonResult = document.getElementById('comparison-result');
const speedRange = document.getElementById('speed-range');

function applyBuff(speed, buff) {
  const multiplier = 1 + Math.abs(buff) * 0.3;

  return buff >= 0 ? speed * multiplier : speed / multiplier;
}

function calculateSpeed(speedId, firstBuffId, secondBuffId) {
  const speed = document.getElementById(speedId).valueAsNumber;
  const firstBuff = document.getElementById(firstBuffId).valueAsNumber;
  const secondBuff = document.getElementById(secondBuffId).valueAsNumber;

  return applyBuff(applyBuff(speed, firstBuff), secondBuff);
}

function formatSpeed(speed) {
  return Number(speed.toFixed(6));
}

speedForm.addEventListener('submit', (event) => {
  event.preventDefault();

  if (!speedForm.checkValidity()) {
    speedForm.reportValidity();
    return;
  }

  const calculatedSpeeds = [
    calculateSpeed('speed1', 'speed_buff1_1', 'speed_buff1_2'),
    calculateSpeed('speed2', 'speed_buff2_1', 'speed_buff2_2'),
  ];

  if (calculatedSpeeds.some((speed) => !Number.isFinite(speed))) {
    comparisonResult.textContent = '数値を入力してください。';
    speedRange.textContent = '未計算';
    return;
  }

  const minimumSpeeds = calculatedSpeeds.map((speed) => formatSpeed(speed * 0.64));
  const maximumSpeeds = calculatedSpeeds.map((speed) => formatSpeed(speed));
  let comparison = 'どちらも確実には上回りません。';

  if (minimumSpeeds[0] > maximumSpeeds[1]) {
    comparison = '1人目が確実に上回ります。';
  } else if (minimumSpeeds[1] > maximumSpeeds[0]) {
    comparison = '2人目が確実に上回ります。';
  }

  comparisonResult.textContent = comparison;
  speedRange.textContent =
    `1人目 ${minimumSpeeds[0]}〜${maximumSpeeds[0]} / ` +
    `2人目 ${minimumSpeeds[1]}〜${maximumSpeeds[1]}`;
});