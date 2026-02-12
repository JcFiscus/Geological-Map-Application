const state = {
  lat: null,
  lon: null,
  heading: 90,
  distanceKm: 2,
  tiltDeg: 35,
  source: 'manual',
  stream: null,
  orientationActive: false,
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
  menuBtn: document.querySelector('#menuBtn'),
  settingsPanel: document.querySelector('#settingsPanel'),
  startArBtn: document.querySelector('#startArBtn'),
  closeMenuBtn: document.querySelector('#closeMenuBtn'),
  cameraFeed: document.querySelector('#cameraFeed'),
  locationBtn: document.querySelector('#locationBtn'),
  orientationBtn: document.querySelector('#orientationBtn'),
  locationStatus: document.querySelector('#locationStatus'),
  headingStatus: document.querySelector('#headingStatus'),
  tiltStatus: document.querySelector('#tiltStatus'),
  headingInput: document.querySelector('#headingInput'),
  distanceInput: document.querySelector('#distanceInput'),
  tiltInput: document.querySelector('#tiltInput'),
  insightText: document.querySelector('#insightText'),
  centerHint: document.querySelector('#centerHint'),
  legend: document.querySelector('#legend'),
  canvas: document.querySelector('#overlayCanvas'),
};

const ctx = el.canvas.getContext('2d');

const clampHeading = (value) => ((value % 360) + 360) % 360;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const createDirectionalStack = () => {
  const headingFactor = Math.sin((state.heading * Math.PI) / 180);
  const distanceFactor = Math.min(state.distanceKm / 12, 1);
  const tiltFactor = Math.min(state.tiltDeg / 80, 1);

  const weightedLayers = geologicPalette.map((layer, index) => {
    const base = 65 + index * 38;
    const headingWave = Math.sin((state.heading + index * 36) * 0.06) * (20 + index * 2);
    const distanceDepth = distanceFactor * (36 + index * 18);
    const tiltDepth = (1 - tiltFactor) * (42 + index * 6);

    return {
      ...layer,
      thicknessM: Math.max(24, base + headingWave + distanceDepth + tiltDepth),
      confidence: clamp(0.58 + Math.abs(headingFactor) * 0.26 - index * 0.022, 0.45, 0.96),
    };
  });

  let runningDepth = 0;
  return weightedLayers.map((layer, index) => {
    const topDepthM = runningDepth;
    const bottomDepthM = runningDepth + layer.thicknessM;
    runningDepth = bottomDepthM;
    return {
      ...layer,
      index,
      topDepthM,
      bottomDepthM,
      midpointDepthM: (topDepthM + bottomDepthM) / 2,
      distanceFromUserM: state.distanceKm * 1000 + topDepthM * 0.52,
    };
  });
};

const fitCanvas = () => {
  const ratio = window.devicePixelRatio || 1;
  const rect = el.canvas.getBoundingClientRect();
  el.canvas.width = Math.round(rect.width * ratio);
  el.canvas.height = Math.round(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
};

const depthToScreenY = (depthM, horizonY, height, maxDepth) => {
  const depthFraction = 1 - Math.exp((-depthM / maxDepth) * 2.35);
  return clamp(horizonY + depthFraction * (height - horizonY), horizonY + 6, height - 4);
};

const drawLayerBand = (layer, width, topY, bottomY, waveOffset) => {
  const lift = 8 + layer.index * 1.7;
  const xQuarter = width * 0.25;
  const xMid = width * 0.5;
  const xThreeQuarter = width * 0.75;

  ctx.beginPath();
  ctx.moveTo(0, topY + Math.sin(waveOffset) * lift);
  ctx.quadraticCurveTo(
    xQuarter,
    topY + Math.sin(waveOffset + 1.2) * lift,
    xMid,
    topY + Math.sin(waveOffset + 2.4) * lift,
  );
  ctx.quadraticCurveTo(
    xThreeQuarter,
    topY + Math.sin(waveOffset + 3.7) * lift,
    width,
    topY + Math.sin(waveOffset + 4.8) * lift,
  );
  ctx.lineTo(width, bottomY + Math.sin(waveOffset + 4.8) * (lift * 0.42));
  ctx.quadraticCurveTo(
    xThreeQuarter,
    bottomY + Math.sin(waveOffset + 3.6) * (lift * 0.42),
    xMid,
    bottomY + Math.sin(waveOffset + 2.4) * (lift * 0.42),
  );
  ctx.quadraticCurveTo(
    xQuarter,
    bottomY + Math.sin(waveOffset + 1.2) * (lift * 0.42),
    0,
    bottomY + Math.sin(waveOffset) * (lift * 0.42),
  );
  ctx.closePath();

  ctx.fillStyle = `${layer.color}7a`;
  ctx.fill();
  ctx.strokeStyle = `${layer.color}e6`;
  ctx.lineWidth = 1;
  ctx.stroke();
};

const drawOverlay = (layers) => {
  const width = el.canvas.clientWidth;
  const height = el.canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);

  const horizonY = height * (0.28 + state.tiltDeg / 240);
  const maxDepth = layers[layers.length - 1].bottomDepthM;

  ctx.fillStyle = 'rgba(14, 165, 233, 0.12)';
  ctx.fillRect(0, horizonY - 3, width, 3);

  layers.forEach((layer) => {
    const topY = depthToScreenY(layer.topDepthM, horizonY, height, maxDepth);
    const bottomY = depthToScreenY(layer.bottomDepthM, horizonY, height, maxDepth);
    const waveOffset = (state.heading / 50) + layer.index * 0.53;

    drawLayerBand(layer, width, topY, bottomY, waveOffset);

    if (bottomY - topY > 24) {
      ctx.fillStyle = 'rgba(248,250,252,0.95)';
      ctx.font = '600 12px Inter, sans-serif';
      ctx.fillText(
        `${layer.name} · ${Math.round(layer.distanceFromUserM)}m`,
        12,
        (topY + bottomY) / 2,
      );
    }
  });

  ctx.strokeStyle = 'rgba(226,232,240,0.5)';
  ctx.setLineDash([5, 7]);
  ctx.beginPath();
  ctx.moveTo(width * 0.5, 0);
  ctx.lineTo(width * 0.5, height);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(2, 6, 23, 0.58)';
  ctx.fillRect(10, 10, Math.min(width - 20, 420), 58);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '600 13px Inter, sans-serif';
  ctx.fillText(
    `Bearing ${Math.round(state.heading)}° · Look-ahead ${state.distanceKm.toFixed(1)} km · Tilt ${state.tiltDeg}°`,
    18,
    32,
  );

  if (state.lat !== null && state.lon !== null) {
    ctx.fillText(`Lat ${state.lat.toFixed(5)}, Lon ${state.lon.toFixed(5)}`, 18, 52);
  }
};

const renderLegend = (layers) => {
  el.legend.innerHTML = '';
  layers.forEach((layer) => {
    const chip = document.createElement('span');
    chip.className = 'legend-chip';
    chip.style.background = `${layer.color}36`;
    chip.style.borderColor = `${layer.color}b4`;
    chip.textContent = `${layer.name} (${Math.round(layer.topDepthM)}-${Math.round(layer.bottomDepthM)}m)`;
    el.legend.append(chip);
  });
};

const renderInsight = (layers) => {
  const dominant = layers.reduce((prev, curr) => (curr.thicknessM > prev.thicknessM ? curr : prev), layers[0]);
  const youngest = layers[0];
  const confidence = Math.round(
    (layers.reduce((sum, layer) => sum + layer.confidence, 0) / layers.length) * 100,
  );

  el.insightText.textContent =
    `Top layer starts with ${youngest.name}, then steps downward in estimated depth intervals along your viewing ray. ` +
    `Dominant thickness is ${dominant.name}; confidence ${confidence}% with current GPS/compass quality.`;
};

const refresh = () => {
  const layers = createDirectionalStack();
  drawOverlay(layers);
  renderLegend(layers);
  renderInsight(layers);
};

const syncSliders = () => {
  el.headingInput.value = String(Math.round(state.heading));
  el.distanceInput.value = String(state.distanceKm);
  el.tiltInput.value = String(state.tiltDeg);
};

const setHeading = (value, source = 'manual') => {
  state.heading = clampHeading(value);
  state.source = source;
  el.headingStatus.textContent =
    source === 'sensor' ? `${Math.round(state.heading)}° (live)` : `${Math.round(state.heading)}° (manual)`;
  syncSliders();
  refresh();
};

const setTiltFromSensor = (rawTilt) => {
  state.tiltDeg = clamp(Math.round(rawTilt), 5, 80);
  state.distanceKm = Number((0.8 + ((80 - state.tiltDeg) / 75) * 9.2).toFixed(1));
  el.tiltStatus.textContent = `${state.tiltDeg}° (live)`;
  syncSliders();
  refresh();
};

const setMenuOpen = (isOpen) => {
  el.settingsPanel.toggleAttribute('hidden', !isOpen);
  el.menuBtn.setAttribute('aria-expanded', String(isOpen));
};

const startCamera = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    el.centerHint.textContent = 'Camera not supported in this browser.';
    return false;
  }

  if (state.stream) {
    el.centerHint.textContent = 'AR view is active. Move slowly for stable alignment.';
    return true;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
      },
      audio: false,
    });
    state.stream = stream;
    el.cameraFeed.srcObject = stream;
    await el.cameraFeed.play();
    el.cameraFeed.classList.add('active');
    el.centerHint.textContent = 'AR view active. Point toward terrain to explore layers.';
    el.startArBtn.textContent = 'AR view active';
    el.startArBtn.disabled = true;
    return true;
  } catch (error) {
    el.centerHint.textContent = `Camera access failed: ${error.message}`;
    return false;
  }
};

const enableLocation = () => {
  if (!navigator.geolocation) {
    el.locationStatus.textContent = 'Not supported';
    return;
  }

  el.locationStatus.textContent = 'Finding...';
  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.lat = position.coords.latitude;
      state.lon = position.coords.longitude;
      el.locationStatus.textContent = `${state.lat.toFixed(4)}, ${state.lon.toFixed(4)}`;
      refresh();
    },
    () => {
      el.locationStatus.textContent = 'Unavailable';
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
    },
  );
};

const setupOrientation = async () => {
  if (state.orientationActive) {
    return;
  }

  const isIOS =
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function';

  if (isIOS) {
    const result = await DeviceOrientationEvent.requestPermission();
    if (result !== 'granted') {
      el.headingStatus.textContent = 'Permission denied';
      return;
    }
  }

  window.addEventListener('deviceorientation', (event) => {
    if (typeof event.alpha === 'number') {
      const heading = event.webkitCompassHeading ?? 360 - event.alpha;
      setHeading(heading, 'sensor');
    }

    if (typeof event.beta === 'number') {
      const sensorTilt = clamp(Math.abs(event.beta), 0, 90);
      setTiltFromSensor(sensorTilt);
    }
  });

  state.orientationActive = true;
  el.headingStatus.textContent = 'Waiting for sensor...';
};

el.menuBtn.addEventListener('click', () => {
  const shouldOpen = el.settingsPanel.hasAttribute('hidden');
  setMenuOpen(shouldOpen);
});

el.closeMenuBtn.addEventListener('click', () => {
  setMenuOpen(false);
});

el.startArBtn.addEventListener('click', async () => {
  const started = await startCamera();
  if (started) {
    setMenuOpen(false);
  }

  await setupOrientation().catch((error) => {
    el.headingStatus.textContent = `Compass unavailable (${error.message})`;
  });
  enableLocation();
});

el.locationBtn.addEventListener('click', () => {
  enableLocation();
});

el.orientationBtn.addEventListener('click', () => {
  setupOrientation().catch((error) => {
    el.headingStatus.textContent = `Compass unavailable (${error.message})`;
  });
});

el.headingInput.addEventListener('input', (event) => {
  setHeading(Number(event.target.value), 'manual');
});

el.distanceInput.addEventListener('input', (event) => {
  state.distanceKm = Number(event.target.value);
  refresh();
});

el.tiltInput.addEventListener('input', (event) => {
  state.tiltDeg = Number(event.target.value);
  el.tiltStatus.textContent = `${state.tiltDeg}° (manual)`;
  refresh();
});

window.addEventListener('resize', () => {
  fitCanvas();
  refresh();
});

fitCanvas();
syncSliders();
refresh();
