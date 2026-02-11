const state = {
  lat: null,
  lon: null,
  heading: 90,
  distanceKm: 2,
  tiltDeg: 35,
  source: 'manual',
};

const geologicPalette = [
  { name: 'Quaternary alluvium', age: '0-2.6 Ma', color: '#f3d27a' },
  { name: 'Neogene sediments', age: '2.6-23 Ma', color: '#e9b966' },
  { name: 'Paleogene mudstone', age: '23-66 Ma', color: '#d18f58' },
  { name: 'Cretaceous sandstone', age: '66-145 Ma', color: '#b86f4d' },
  { name: 'Jurassic shale', age: '145-201 Ma', color: '#8d5a49' },
  { name: 'Triassic siltstone', age: '201-252 Ma', color: '#6d4f54' },
  { name: 'Permian limestone', age: '252-299 Ma', color: '#4f4a64' },
  { name: 'Precambrian basement', age: '>541 Ma', color: '#393f65' },
];

const el = {
  locationBtn: document.querySelector('#locationBtn'),
  orientationBtn: document.querySelector('#orientationBtn'),
  locationStatus: document.querySelector('#locationStatus'),
  headingStatus: document.querySelector('#headingStatus'),
  headingRange: document.querySelector('#headingRange'),
  headingValue: document.querySelector('#headingValue'),
  distanceRange: document.querySelector('#distanceRange'),
  distanceValue: document.querySelector('#distanceValue'),
  elevationRange: document.querySelector('#elevationRange'),
  elevationValue: document.querySelector('#elevationValue'),
  insightText: document.querySelector('#insightText'),
  legend: document.querySelector('#legend'),
  canvas: document.querySelector('#overlayCanvas'),
};

const ctx = el.canvas.getContext('2d');

const clampHeading = (value) => ((value % 360) + 360) % 360;

const pseudoNoise = (x) => {
  const wave = Math.sin(x * 13.129) * 43758.5453;
  return wave - Math.floor(wave);
};

const createDirectionalStack = () => {
  const lat = state.lat ?? 39.742;
  const lon = state.lon ?? -105.011;
  const signalBase = lat * 0.037 + lon * 0.041 + state.heading * 0.019 + state.distanceKm * 0.42;

  const totalDepth = 100;
  let remaining = totalDepth;
  const layers = [];

  for (let i = 0; i < geologicPalette.length && remaining > 0; i += 1) {
    const noise = pseudoNoise(signalBase + i * 1.77);
    const proportion = 0.07 + noise * 0.23;
    const thickness = Math.min(remaining, Math.round(totalDepth * proportion));

    layers.push({
      ...geologicPalette[i],
      thickness,
      confidence: 0.68 + pseudoNoise(signalBase * 0.8 + i * 0.91) * 0.28,
    });

    remaining -= thickness;
  }

  if (remaining > 0) {
    layers[layers.length - 1].thickness += remaining;
  }

  return layers.filter((layer) => layer.thickness > 0);
};

const drawOverlay = (layers) => {
  const { width, height } = el.canvas;
  ctx.clearRect(0, 0, width, height);

  const horizonY = height * (0.42 + state.tiltDeg / 200);

  const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
  sky.addColorStop(0, '#082f49');
  sky.addColorStop(1, '#1e3a5f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizonY);

  const ground = ctx.createLinearGradient(0, horizonY, 0, height);
  ground.addColorStop(0, '#3b2f2f');
  ground.addColorStop(1, '#211818');
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizonY, width, height - horizonY);

  const canyonAmplitude = 38 + state.distanceKm * 1.8;
  ctx.beginPath();
  ctx.moveTo(0, horizonY + 28);
  for (let x = 0; x <= width; x += 14) {
    const signal = Math.sin((x / width) * Math.PI * 4 + state.heading * 0.035);
    const ridge = Math.sin((x / width) * Math.PI * 9 + state.distanceKm);
    const y = horizonY + 26 + signal * canyonAmplitude * 0.35 + ridge * canyonAmplitude * 0.22;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = 'rgba(23, 15, 15, 0.5)';
  ctx.fill();

  const usableHeight = height - horizonY - 12;
  let currentTop = height - 6;

  layers.forEach((layer) => {
    const segmentHeight = (layer.thickness / 100) * usableHeight;
    currentTop -= segmentHeight;

    ctx.fillStyle = layer.color;
    ctx.fillRect(0, currentTop, width, segmentHeight);

    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.strokeRect(0, currentTop, width, segmentHeight);

    if (segmentHeight > 34) {
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 17px Inter, sans-serif';
      ctx.fillText(layer.name, 18, currentTop + segmentHeight / 2);
    }
  });

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '600 16px Inter, sans-serif';
  ctx.fillText(
    `Bearing ${Math.round(state.heading)}° · Distance ${state.distanceKm.toFixed(1)} km · Tilt ${state.tiltDeg}°`,
    16,
    28,
  );

  if (state.lat !== null && state.lon !== null) {
    ctx.fillText(`Lat ${state.lat.toFixed(5)}, Lon ${state.lon.toFixed(5)}`, 16, 50);
  }
};

const renderLegend = (layers) => {
  el.legend.innerHTML = '';
  layers.forEach((layer) => {
    const chip = document.createElement('span');
    chip.className = 'legend-chip';
    chip.style.background = `${layer.color}33`;
    chip.style.borderColor = `${layer.color}aa`;
    chip.textContent = `${layer.name} (${layer.age})`;
    el.legend.append(chip);
  });
};

const renderInsight = (layers) => {
  const dominant = layers.reduce((prev, curr) => (curr.thickness > prev.thickness ? curr : prev), layers[0]);
  const youngest = layers[0];
  const confidence = Math.round(
    (layers.reduce((sum, layer) => sum + layer.confidence, 0) / layers.length) * 100,
  );

  el.insightText.textContent = `Facing ${Math.round(state.heading)}°, your line of sight is projected through ${layers.length} stratigraphic units. ` +
    `The dominant exposed unit is ${dominant.name} (${dominant.age}). Surface material starts with ${youngest.name}. ` +
    `Model confidence is ${confidence}% and improves when using calibrated compass + GPS. This preview is a concept layer, not a regulatory geologic map.`;
};

const refresh = () => {
  const layers = createDirectionalStack();
  drawOverlay(layers);
  renderLegend(layers);
  renderInsight(layers);
};

const setHeading = (value, source = 'manual') => {
  state.heading = clampHeading(value);
  state.source = source;
  el.headingRange.value = String(Math.round(state.heading));
  el.headingValue.textContent = `${Math.round(state.heading)}`;
  el.headingStatus.textContent =
    source === 'sensor'
      ? `Live compass heading (${Math.round(state.heading)}°).`
      : `Using manual heading (${Math.round(state.heading)}°).`;
  refresh();
};

el.headingRange.addEventListener('input', (event) => {
  setHeading(Number(event.target.value), 'manual');
});

el.distanceRange.addEventListener('input', (event) => {
  state.distanceKm = Number(event.target.value);
  el.distanceValue.textContent = state.distanceKm.toFixed(1);
  refresh();
});

el.elevationRange.addEventListener('input', (event) => {
  state.tiltDeg = Number(event.target.value);
  el.elevationValue.textContent = `${state.tiltDeg}`;
  refresh();
});

el.locationBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    el.locationStatus.textContent = 'Geolocation is not supported in this browser.';
    return;
  }

  el.locationStatus.textContent = 'Finding your location...';
  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.lat = position.coords.latitude;
      state.lon = position.coords.longitude;
      el.locationStatus.textContent = `Lat ${state.lat.toFixed(5)}, Lon ${state.lon.toFixed(5)} (±${Math.round(
        position.coords.accuracy,
      )}m)`;
      refresh();
    },
    (error) => {
      el.locationStatus.textContent = `Location unavailable (${error.message}).`;
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
    },
  );
});

const setupOrientation = async () => {
  const isIOS = typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function';

  if (isIOS) {
    const result = await DeviceOrientationEvent.requestPermission();
    if (result !== 'granted') {
      el.headingStatus.textContent = 'Compass permission denied; using manual heading.';
      return;
    }
  }

  window.addEventListener('deviceorientation', (event) => {
    if (typeof event.alpha !== 'number') {
      return;
    }
    const heading = event.webkitCompassHeading ?? 360 - event.alpha;
    setHeading(heading, 'sensor');
  });

  el.headingStatus.textContent = 'Compass enabled; waiting for sensor data.';
};

el.orientationBtn.addEventListener('click', () => {
  setupOrientation().catch((err) => {
    el.headingStatus.textContent = `Compass not available (${err.message}).`;
  });
});

refresh();
