const state = {
  lat: null,
  lon: null,
  altitudeM: null,
  locationAccuracyM: null,
  heading: 90,
  pitchDeg: 20,
  rollDeg: 0,
  distanceKm: 2,
  observerHeightM: 2,
  source: 'manual',
  stream: null,
  orientationActive: false,
  locationWatchId: null,
  centerHintTimers: [],
  groundVisibility: 1,
};

const geologicPalette = [
  { name: 'Surface soil & alluvium', age: 'Holocene', color: '#f3d27a', density: 1.7 },
  { name: 'Weathered regolith', age: 'Quaternary', color: '#e7bd72', density: 1.95 },
  { name: 'Sandstone package', age: 'Mesozoic', color: '#c99263', density: 2.2 },
  { name: 'Shale package', age: 'Paleozoic', color: '#9d6f62', density: 2.45 },
  { name: 'Carbonate bedrock', age: 'Paleozoic', color: '#7f6771', density: 2.58 },
  { name: 'Metamorphic basement', age: 'Precambrian', color: '#4f4f73', density: 2.8 },
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
  modeStatus: document.querySelector('#modeStatus'),
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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clampHeading = (value) => ((value % 360) + 360) % 360;
const toRadians = (degrees) => (degrees * Math.PI) / 180;

const getScreenOrientationAngle = () => {
  if (typeof window.screen?.orientation?.angle === 'number') {
    return clampHeading(window.screen.orientation.angle);
  }
  if (typeof window.orientation === 'number') {
    return clampHeading(window.orientation);
  }
  return 0;
};

const normalizePitch = (event) => {
  if (typeof event.beta !== 'number') {
    return null;
  }

  const orientation = Math.round(getScreenOrientationAngle() / 90) * 90;
  const beta = event.beta;
  const gamma = typeof event.gamma === 'number' ? event.gamma : 0;

  switch (clampHeading(orientation)) {
    case 90:
      return -gamma;
    case 180:
      return beta;
    case 270:
      return gamma;
    case 0:
    default:
      return -beta;
  }
};

const normalizeRoll = (event) => {
  if (typeof event.gamma !== 'number') {
    return 0;
  }

  const orientation = Math.round(getScreenOrientationAngle() / 90) * 90;
  const gamma = event.gamma;

  if (orientation === 0) {
    return gamma;
  }
  if (orientation === 180) {
    return -gamma;
  }
  return 0;
};

const smoothAngle = (current, next, alpha = 0.2) => {
  const delta = ((next - current + 540) % 360) - 180;
  return clampHeading(current + delta * alpha);
};

const fitCanvas = () => {
  const ratio = window.devicePixelRatio || 1;
  const rect = el.canvas.getBoundingClientRect();
  el.canvas.width = Math.round(rect.width * ratio);
  el.canvas.height = Math.round(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
};

const createDirectionalStack = () => {
  const depthMultiplier = clamp(0.8 + state.distanceKm / 9, 0.8, 2.2);
  const tiltFactor = clamp((state.pitchDeg + 45) / 90, 0, 1);

  let depth = 0;
  return geologicPalette.map((layer, index) => {
    const baseThickness = 20 + index * 45;
    const headingVariation = Math.sin(toRadians(state.heading + index * 20)) * (index * 6);
    const thicknessM = Math.max(18, baseThickness * depthMultiplier * (0.8 + tiltFactor * 0.3) + headingVariation);
    const topDepthM = depth;
    depth += thicknessM;

    return {
      ...layer,
      index,
      thicknessM,
      topDepthM,
      bottomDepthM: depth,
    };
  });
};

const calculateViewModel = (layers, width, height) => {
  const maxDepth = layers[layers.length - 1].bottomDepthM;
  const eyeHeightM = Math.max(1, state.observerHeightM);
  const geometricHorizonM = 3570 * Math.sqrt(eyeHeightM);
  const visibleDistanceM = Math.min(state.distanceKm * 1000, geometricHorizonM * 1.05);

  const pitchDown = clamp(state.pitchDeg, -45, 80);
  const groundVisibility = clamp((pitchDown + 3) / 18, 0, 1);
  const horizonY = height * (0.48 + clamp(-pitchDown, -35, 35) * 0.0105);

  const fovYDeg = 55;
  const metersPerPixel = Math.max(0.15, visibleDistanceM / height);

  return {
    width,
    height,
    horizonY,
    groundVisibility,
    lookingSky: groundVisibility < 0.04,
    maxDepth,
    visibleDistanceM,
    fovYDeg,
    metersPerPixel,
  };
};

const worldBearingToScreenX = (targetBearing, view) => {
  const delta = ((targetBearing - state.heading + 540) % 360) - 180;
  const normalized = delta / 35;
  return view.width * (0.5 + normalized);
};

const depthToScreenY = (depthM, view) => {
  const depthFraction = 1 - Math.exp((-depthM / view.maxDepth) * 1.9);
  const groundStartY = clamp(view.horizonY + 6, 0, view.height - 12);
  return clamp(groundStartY + depthFraction * (view.height - groundStartY), groundStartY + 6, view.height - 3);
};

const drawBearingTicks = (view) => {
  ctx.save();
  ctx.strokeStyle = 'rgba(226,232,240,0.55)';
  ctx.fillStyle = 'rgba(226,232,240,0.9)';
  ctx.lineWidth = 1;
  ctx.font = '600 11px Inter, sans-serif';

  for (let bearing = 0; bearing < 360; bearing += 15) {
    const x = worldBearingToScreenX(bearing, view);
    if (x < -20 || x > view.width + 20) {
      continue;
    }
    const major = bearing % 45 === 0;
    const tickTop = major ? 0 : 8;

    ctx.beginPath();
    ctx.moveTo(x, tickTop);
    ctx.lineTo(x, 20);
    ctx.stroke();

    if (major) {
      const label = bearing === 0 ? 'N' : bearing === 90 ? 'E' : bearing === 180 ? 'S' : bearing === 270 ? 'W' : `${bearing}°`;
      ctx.fillText(label, x - 8, 34);
    }
  }

  ctx.restore();
};

const drawLayerVolume = (layer, view) => {
  const topY = depthToScreenY(layer.topDepthM, view);
  const bottomY = depthToScreenY(layer.bottomDepthM, view);

  ctx.fillStyle = `${layer.color}cc`;
  ctx.fillRect(0, topY, view.width, bottomY - topY);

  const rollSkew = clamp(state.rollDeg * 1.2, -24, 24);
  ctx.fillStyle = `${layer.color}66`;
  ctx.beginPath();
  ctx.moveTo(0, topY);
  ctx.lineTo(view.width, topY + rollSkew);
  ctx.lineTo(view.width, bottomY + rollSkew);
  ctx.lineTo(0, bottomY);
  ctx.closePath();
  ctx.fill();

  if (bottomY - topY > 24) {
    ctx.fillStyle = 'rgba(248,250,252,0.95)';
    ctx.font = '600 12px Inter, sans-serif';
    ctx.fillText(`${layer.name} · ${Math.round(layer.topDepthM)}-${Math.round(layer.bottomDepthM)}m`, 12, (topY + bottomY) / 2);
  }
};

const drawOverlay = (layers) => {
  const width = el.canvas.clientWidth;
  const height = el.canvas.clientHeight;
  const view = calculateViewModel(layers, width, height);

  state.groundVisibility = view.groundVisibility;
  ctx.clearRect(0, 0, width, height);

  drawBearingTicks(view);

  if (view.lookingSky) {
    ctx.fillStyle = 'rgba(2, 6, 23, 0.58)';
    ctx.fillRect(12, height - 76, Math.min(width - 24, 570), 62);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 13px Inter, sans-serif';
    ctx.fillText('Sky view detected: no geologic intersection ahead.', 22, height - 48);
    ctx.fillText('Tilt the phone downward to intersect terrain and render layers.', 22, height - 28);
    return;
  }

  ctx.fillStyle = 'rgba(148,163,184,0.18)';
  ctx.fillRect(0, view.horizonY, width, height - view.horizonY);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, view.horizonY, width, height - view.horizonY);
  ctx.clip();
  layers.forEach((layer) => drawLayerVolume(layer, view));
  ctx.restore();

  ctx.strokeStyle = 'rgba(148,163,184,0.8)';
  ctx.beginPath();
  ctx.moveTo(0, view.horizonY);
  ctx.lineTo(width, view.horizonY);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(226,232,240,0.45)';
  ctx.setLineDash([5, 7]);
  ctx.beginPath();
  ctx.moveTo(width * 0.5, 0);
  ctx.lineTo(width * 0.5, height);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(2, 6, 23, 0.62)';
  ctx.fillRect(12, height - 76, Math.min(width - 24, 620), 62);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '600 13px Inter, sans-serif';
  ctx.fillText(
    `Ground intersected · Bearing ${Math.round(state.heading)}° · Pitch ${Math.round(state.pitchDeg)}° · Look-ahead ${(view.visibleDistanceM / 1000).toFixed(1)} km`,
    22,
    height - 48,
  );
  ctx.fillText(`Roll ${Math.round(state.rollDeg)}° · Eye ${Math.round(state.observerHeightM)}m`, 22, height - 28);
};

const renderLegend = (layers) => {
  el.legend.innerHTML = '';
  layers.forEach((layer) => {
    const chip = document.createElement('span');
    chip.className = 'legend-chip';
    chip.style.background = `${layer.color}36`;
    chip.style.borderColor = `${layer.color}aa`;
    chip.textContent = `${layer.name} (${Math.round(layer.topDepthM)}-${Math.round(layer.bottomDepthM)}m)`;
    el.legend.append(chip);
  });
};

const renderInsight = (layers) => {
  const deepest = layers[layers.length - 1].bottomDepthM;
  const accuracy = state.locationAccuracyM ? `GPS ±${Math.round(state.locationAccuracyM)}m` : 'GPS unavailable';
  const mode = state.source === 'sensor' ? 'Sensor-locked heading/pitch' : 'Manual heading';

  el.insightText.textContent =
    state.groundVisibility < 0.04
      ? `${mode}. Sky is in view, so no geological intersection is drawn.`
      : `${mode}. Overlay is earth-frame aligned using heading, pitch, and roll. ${accuracy}. Depth model currently synthetic (max ~${Math.round(deepest)}m) and ready for real map units.`;
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
  el.tiltInput.value = String(Math.round(state.pitchDeg));
  el.elevationInput.value = String(Math.round(state.observerHeightM));
};

const setHeading = (value, source = 'manual') => {
  const next = clampHeading(value);
  state.heading = source === 'sensor' ? smoothAngle(state.heading, next) : next;
  state.source = source;
  el.headingStatus.textContent = source === 'sensor' ? `${Math.round(state.heading)}° live` : `${Math.round(state.heading)}° manual`;
  syncSliders();
  refresh();
};

const setPitch = (value, source = 'manual') => {
  const next = clamp(value, -45, 80);
  state.pitchDeg = source === 'sensor' ? clamp(state.pitchDeg * 0.8 + next * 0.2, -45, 80) : next;
  el.tiltInput.value = String(Math.round(state.pitchDeg));
  refresh();
};

const setObserverHeight = (value) => {
  state.observerHeightM = clamp(Math.round(value), 1, 500);
  syncSliders();
  refresh();
};

const setMenuOpen = (isOpen) => {
  el.settingsPanel.toggleAttribute('hidden', !isOpen);
  el.menuBtn.setAttribute('aria-expanded', String(isOpen));
};

const clearCenterHintTimers = () => {
  state.centerHintTimers.forEach((timer) => clearTimeout(timer));
  state.centerHintTimers = [];
};

const showCenterHint = (message, options = {}) => {
  const { autoHideMs = 0 } = options;
  const fadeDurationMs = 420;

  clearCenterHintTimers();
  el.centerHint.textContent = message;
  el.centerHint.classList.remove('fade-out');
  el.centerHint.classList.add('visible');

  if (!autoHideMs) {
    return;
  }

  const fadeDelayMs = Math.max(0, autoHideMs - fadeDurationMs);
  const fadeTimer = window.setTimeout(() => {
    el.centerHint.classList.add('fade-out');
  }, fadeDelayMs);

  const hideTimer = window.setTimeout(() => {
    el.centerHint.classList.remove('visible', 'fade-out');
    el.centerHint.textContent = '';
  }, autoHideMs);

  state.centerHintTimers.push(fadeTimer, hideTimer);
};

const startCamera = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    showCenterHint('Camera not supported in this browser.');
    return false;
  }

  if (state.stream) {
    showCenterHint('AR view already active.', { autoHideMs: 2200 });
    return true;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });

    state.stream = stream;
    el.cameraFeed.srcObject = stream;
    await el.cameraFeed.play();
    el.cameraFeed.classList.add('active');
    showCenterHint('AR camera live. Point at terrain to intersect geologic layers.', { autoHideMs: 3500 });
    el.startArBtn.textContent = 'AR view active';
    el.startArBtn.disabled = true;
    return true;
  } catch (error) {
    showCenterHint(`Camera access failed: ${error.message}`);
    return false;
  }
};

const enableLocation = () => {
  if (!navigator.geolocation) {
    el.locationStatus.textContent = 'Not supported';
    return;
  }

  if (state.locationWatchId !== null) {
    return;
  }

  el.locationStatus.textContent = 'Finding...';
  state.locationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      state.lat = position.coords.latitude;
      state.lon = position.coords.longitude;
      state.altitudeM = position.coords.altitude;
      state.locationAccuracyM = position.coords.accuracy;
      el.locationStatus.textContent = `${state.lat.toFixed(4)}, ${state.lon.toFixed(4)} (±${Math.round(position.coords.accuracy)}m)`;
      refresh();
    },
    () => {
      el.locationStatus.textContent = 'Unavailable';
    },
    {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 10000,
    },
  );
};

const setupOrientation = async () => {
  if (state.orientationActive) {
    return;
  }

  const isIOS = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
  if (isIOS) {
    const permission = await DeviceOrientationEvent.requestPermission();
    if (permission !== 'granted') {
      el.headingStatus.textContent = 'Permission denied';
      return;
    }
  }

  const listener = (event) => {
    if (typeof event.alpha === 'number') {
      const magneticHeading = event.webkitCompassHeading ?? 360 - event.alpha;
      setHeading(magneticHeading, 'sensor');
    }

    const pitch = normalizePitch(event);
    if (pitch !== null) {
      setPitch(pitch, 'sensor');
    }

    state.rollDeg = clamp(state.rollDeg * 0.75 + normalizeRoll(event) * 0.25, -45, 45);
  };

  window.addEventListener('deviceorientationabsolute', listener, true);
  window.addEventListener('deviceorientation', listener, true);
  state.orientationActive = true;
  el.headingStatus.textContent = 'Sensor active';
  showCenterHint('Compass + tilt lock enabled.', { autoHideMs: 2500 });
};

el.menuBtn.addEventListener('click', () => setMenuOpen(el.settingsPanel.hasAttribute('hidden')));
el.closeMenuBtn.addEventListener('click', () => setMenuOpen(false));

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

el.locationBtn.addEventListener('click', enableLocation);
el.orientationBtn.addEventListener('click', () => {
  setupOrientation().catch((error) => {
    el.headingStatus.textContent = `Compass unavailable (${error.message})`;
  });
});

el.headingInput.addEventListener('input', (event) => setHeading(Number(event.target.value), 'manual'));
el.distanceInput.addEventListener('input', (event) => {
  state.distanceKm = Number(event.target.value);
  refresh();
});
el.tiltInput.addEventListener('input', (event) => setPitch(Number(event.target.value), 'manual'));
el.elevationInput.addEventListener('input', (event) => setObserverHeight(Number(event.target.value)));

window.addEventListener('resize', () => {
  fitCanvas();
  refresh();
});

fitCanvas();
el.modeStatus.textContent = 'Earth-frame AR';
setObserverHeight(state.observerHeightM);
syncSliders();
refresh();
showCenterHint('Point toward ground to see geological layers aligned to your view.');
