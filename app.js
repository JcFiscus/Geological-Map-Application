const state = {
  lat: null,
  lon: null,
  heading: 90,
  distanceKm: 2,
  tiltDeg: 35,
  observerHeightM: 2,
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
  elevationStatus: document.querySelector('#elevationStatus'),
  headingInput: document.querySelector('#headingInput'),
  distanceInput: document.querySelector('#distanceInput'),
  tiltInput: document.querySelector('#tiltInput'),
  elevationInput: document.querySelector('#elevationInput'),
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
  const downwardPitchDeg = clamp(state.tiltDeg, -25, 85);
  const pitchFactor = clamp((downwardPitchDeg + 20) / 105, 0, 1);

  const weightedLayers = geologicPalette.map((layer, index) => {
    const base = 72 + index * 34;
    const headingWave = Math.sin((state.heading + index * 36) * 0.06) * (16 + index * 2.2);
    const distanceDepth = distanceFactor * (28 + index * 16);
    const pitchDepth = (1 - pitchFactor) * (52 + index * 5);

    return {
      ...layer,
      thicknessM: Math.max(26, base + headingWave + distanceDepth + pitchDepth),
      confidence: clamp(0.6 + Math.abs(headingFactor) * 0.22 - index * 0.02, 0.48, 0.97),
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
      distanceFromUserM: state.distanceKm * 1000 + topDepthM * 0.5,
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

const calculateViewModel = (layers, width, height) => {
  const maxDepth = layers[layers.length - 1].bottomDepthM;
  const observerHeightM = Math.max(1, state.observerHeightM);
  const pitchDownDeg = state.tiltDeg;

  const geometricHorizonM = 3570 * Math.sqrt(observerHeightM);
  const lookAheadM = state.distanceKm * 1000;
  const visibleDistanceM = Math.max(500, Math.min(lookAheadM, geometricHorizonM * 0.96));

  const horizonOffset = clamp((-pitchDownDeg / 55) * (height * 0.36), -height * 0.32, height * 0.42);
  const horizonY = clamp(height * 0.44 + horizonOffset, height * 0.12, height * 0.82);
  const groundStartY = clamp(horizonY + 2, 0, height - 10);

  const verticalFovDeg = 62;
  const visibleGroundDepthM = Math.max(
    130,
    observerHeightM + Math.tan(((verticalFovDeg * 0.5 + Math.max(pitchDownDeg, 0)) * Math.PI) / 180) * visibleDistanceM,
  );
  const depthScaleMax = Math.max(visibleGroundDepthM, maxDepth * 0.3);

  return {
    horizonY,
    groundStartY,
    maxDepth,
    visibleDistanceM,
    depthScaleMax,
    pitchDownDeg,
  };
};

const createGroundMask = (width, height, horizonY, headingDeg) => {
  const undulation = 14;
  const wave = headingDeg / 57;

  ctx.beginPath();
  ctx.moveTo(0, horizonY + Math.sin(wave) * undulation);
  for (let x = 0; x <= width; x += Math.max(16, width / 28)) {
    const wobble = Math.sin((x / width) * Math.PI * 2.8 + wave) * undulation;
    const contour = Math.cos((x / width) * Math.PI * 4.6 + wave * 1.3) * (undulation * 0.38);
    ctx.lineTo(x, horizonY + wobble + contour);
  }
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
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

  const view = calculateViewModel(layers, width, height);

  ctx.fillStyle = 'rgba(14, 165, 233, 0.08)';
  ctx.fillRect(0, 0, width, view.horizonY);

  ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
  createGroundMask(width, height, view.horizonY, state.heading);
  ctx.fill();

  ctx.save();
  createGroundMask(width, height, view.horizonY, state.heading);
  ctx.clip();

  layers.forEach((layer) => {
    const topY = depthToScreenY(layer.topDepthM, view.groundStartY, height, view.depthScaleMax);
    const bottomY = depthToScreenY(layer.bottomDepthM, view.groundStartY, height, view.depthScaleMax);
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

  ctx.restore();

  ctx.strokeStyle = 'rgba(148,163,184,0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, view.horizonY);
  ctx.lineTo(width, view.horizonY);
  ctx.stroke();

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
    `Bearing ${Math.round(state.heading)}° · Look-ahead ${(view.visibleDistanceM / 1000).toFixed(1)} km · Pitch ${state.tiltDeg}°`,
    18,
    32,
  );

  if (state.lat !== null && state.lon !== null) {
    ctx.fillText(`Lat ${state.lat.toFixed(5)}, Lon ${state.lon.toFixed(5)} · Eye ${Math.round(state.observerHeightM)}m AGL`, 18, 52);
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
  const horizonKm = (3.57 * Math.sqrt(Math.max(1, state.observerHeightM))).toFixed(1);
  const dominant = layers.reduce((prev, curr) => (curr.thicknessM > prev.thicknessM ? curr : prev), layers[0]);
  const youngest = layers[0];
  const confidence = Math.round(
    (layers.reduce((sum, layer) => sum + layer.confidence, 0) / layers.length) * 100,
  );

  el.insightText.textContent =
    `Bands are clipped to terrain below the horizon and projected along your view ray as layered contours. ` +
    `Top unit is ${youngest.name}; dominant thickness is ${dominant.name}; confidence ${confidence}%. ` +
    `At ${Math.round(state.observerHeightM)}m eye height, geometric horizon is ~${horizonKm} km.`;
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
  el.elevationInput.value = String(Math.round(state.observerHeightM));
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
  state.tiltDeg = clamp(Math.round(rawTilt), -20, 80);
  state.distanceKm = Number((0.8 + ((80 - clamp(state.tiltDeg, 0, 80)) / 80) * 9.2).toFixed(1));
  el.tiltStatus.textContent = `${state.tiltDeg}° (live)`;
  syncSliders();
  refresh();
};

const setObserverHeight = (value, source = 'manual') => {
  state.observerHeightM = clamp(Math.round(value), 1, 500);
  el.elevationStatus.textContent = `${state.observerHeightM} m AGL${source === 'sensor' ? ' (live)' : ''}`;
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
      const sensorTilt = clamp(event.beta, -20, 80);
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

el.elevationInput.addEventListener('input', (event) => {
  setObserverHeight(Number(event.target.value), 'manual');
});

window.addEventListener('resize', () => {
  fitCanvas();
  refresh();
});

fitCanvas();
setObserverHeight(state.observerHeightM);
syncSliders();
refresh();
