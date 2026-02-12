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
  { name: 'Urban fill & alluvium', age: '0-2.6 Ma', color: '#f3d27a', porosity: 0.33 },
  { name: 'Shallow aquifer sands', age: '2.6-10 Ma', color: '#e7bd72', porosity: 0.28 },
  { name: 'Floodplain silts', age: '10-34 Ma', color: '#cfa070', porosity: 0.22 },
  { name: 'Deltaic sandstone', age: '34-100 Ma', color: '#b67f61', porosity: 0.18 },
  { name: 'Marine shale', age: '100-180 Ma', color: '#8f6a6e', porosity: 0.11 },
  { name: 'Carbonate shelf', age: '180-300 Ma', color: '#6c5b71', porosity: 0.09 },
  { name: 'Metamorphic basement', age: '>300 Ma', color: '#4f4f73', porosity: 0.03 },
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

const clampHeading = (value) => ((value % 360) + 360) % 360;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const createDirectionalStack = () => {
  const distanceFactor = Math.min(state.distanceKm / 12, 1);
  const pitchFactor = clamp((clamp(state.tiltDeg, -20, 80) + 20) / 100, 0, 1);

  const weightedLayers = geologicPalette.map((layer, index) => {
    const base = 80 + index * 42;
    const headingPulse = Math.sin((state.heading + index * 31) * 0.05) * (20 + index * 2.5);
    const distanceDepth = distanceFactor * (34 + index * 18);
    const pitchDepth = (1 - pitchFactor) * (44 + index * 6.5);

    return {
      ...layer,
      thicknessM: Math.max(34, base + headingPulse + distanceDepth + pitchDepth),
      confidence: clamp(0.58 + distanceFactor * 0.24 - index * 0.03, 0.42, 0.96),
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
      distanceFromUserM: state.distanceKm * 1000 + topDepthM * 0.65,
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
  const depthFraction = 1 - Math.exp((-depthM / maxDepth) * 2.1);
  return clamp(horizonY + depthFraction * (height - horizonY), horizonY + 8, height - 4);
};

const calculateViewModel = (layers, width, height) => {
  const maxDepth = layers[layers.length - 1].bottomDepthM;
  const observerHeightM = Math.max(1, state.observerHeightM);

  const geometricHorizonM = 3570 * Math.sqrt(observerHeightM);
  const requestedLookAheadM = state.distanceKm * 1000;
  const indoorMinimumM = 900;
  const visibleDistanceM = Math.max(indoorMinimumM, Math.min(requestedLookAheadM, geometricHorizonM * 1.15));

  const horizonOffset = clamp((-state.tiltDeg / 55) * (height * 0.33), -height * 0.28, height * 0.38);
  const horizonY = clamp(height * 0.41 + horizonOffset, height * 0.15, height * 0.78);
  const groundStartY = clamp(horizonY + 5, 0, height - 12);

  const depthScaleMax = Math.max(maxDepth, observerHeightM + visibleDistanceM * 0.26);

  return {
    horizonY,
    groundStartY,
    maxDepth,
    visibleDistanceM,
    depthScaleMax,
  };
};

const createGroundMask = (width, height, horizonY, headingDeg) => {
  const undulation = 14;
  const wave = headingDeg / 57;

  ctx.beginPath();
  ctx.moveTo(0, horizonY + Math.sin(wave) * undulation);
  for (let x = 0; x <= width; x += Math.max(16, width / 30)) {
    const wobble = Math.sin((x / width) * Math.PI * 2.8 + wave) * undulation;
    const contour = Math.cos((x / width) * Math.PI * 4.1 + wave * 1.2) * (undulation * 0.42);
    ctx.lineTo(x, horizonY + wobble + contour);
  }
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
};

const drawVolumetricSlice = (layer, width, topY, bottomY, waveOffset, perspectiveSkew) => {
  const lift = 7 + layer.index * 1.8;
  const sideDepthPx = 12 + layer.index * 1.3;
  const xQuarter = width * 0.25;
  const xMid = width * 0.5;
  const xThreeQuarter = width * 0.75;

  const topShift = Math.sin(waveOffset) * lift;
  const topShiftMid = Math.sin(waveOffset + 2.1) * lift;
  const topShiftRight = Math.sin(waveOffset + 4.4) * lift;

  ctx.beginPath();
  ctx.moveTo(0, topY + topShift);
  ctx.quadraticCurveTo(xQuarter, topY + Math.sin(waveOffset + 1.1) * lift, xMid, topY + topShiftMid);
  ctx.quadraticCurveTo(xThreeQuarter, topY + Math.sin(waveOffset + 3.2) * lift, width, topY + topShiftRight);
  ctx.lineTo(width, bottomY + topShiftRight * 0.35);
  ctx.quadraticCurveTo(
    xThreeQuarter,
    bottomY + Math.sin(waveOffset + 3.2) * (lift * 0.45),
    xMid,
    bottomY + topShiftMid * 0.35,
  );
  ctx.quadraticCurveTo(
    xQuarter,
    bottomY + Math.sin(waveOffset + 1.1) * (lift * 0.45),
    0,
    bottomY + topShift * 0.35,
  );
  ctx.closePath();

  ctx.fillStyle = `${layer.color}88`;
  ctx.fill();
  ctx.strokeStyle = `${layer.color}f5`;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(width, topY + topShiftRight);
  ctx.lineTo(width + perspectiveSkew, topY + topShiftRight + sideDepthPx);
  ctx.lineTo(width + perspectiveSkew, bottomY + topShiftRight * 0.35 + sideDepthPx);
  ctx.lineTo(width, bottomY + topShiftRight * 0.35);
  ctx.closePath();
  ctx.fillStyle = 'rgba(15,23,42,0.28)';
  ctx.fill();
};

const drawOverlay = (layers) => {
  const width = el.canvas.clientWidth;
  const height = el.canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);

  const view = calculateViewModel(layers, width, height);
  const perspectiveSkew = clamp((state.heading - 180) * 0.09, -24, 24);

  ctx.fillStyle = 'rgba(14, 165, 233, 0.08)';
  ctx.fillRect(0, 0, width, view.horizonY);

  ctx.fillStyle = 'rgba(148, 163, 184, 0.2)';
  createGroundMask(width, height, view.horizonY, state.heading);
  ctx.fill();

  ctx.save();
  createGroundMask(width, height, view.horizonY, state.heading);
  ctx.clip();

  layers.forEach((layer) => {
    const topY = depthToScreenY(layer.topDepthM, view.groundStartY, height, view.depthScaleMax);
    const bottomY = depthToScreenY(layer.bottomDepthM, view.groundStartY, height, view.depthScaleMax);
    const waveOffset = state.heading / 60 + layer.index * 0.48;

    drawVolumetricSlice(layer, width, topY, bottomY, waveOffset, perspectiveSkew);

    if (bottomY - topY > 24) {
      ctx.fillStyle = 'rgba(248,250,252,0.95)';
      ctx.font = '600 12px Inter, sans-serif';
      ctx.fillText(`${layer.name} · ${(layer.porosity * 100).toFixed(0)}% φ`, 12, (topY + bottomY) / 2);
    }
  });

  ctx.restore();

  ctx.strokeStyle = 'rgba(148,163,184,0.85)';
  ctx.lineWidth = 1;
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
  ctx.fillRect(12, height - 72, Math.min(width - 24, 480), 58);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '600 13px Inter, sans-serif';
  ctx.fillText(
    `3D subsurface volume · Bearing ${Math.round(state.heading)}° · Look-ahead ${(view.visibleDistanceM / 1000).toFixed(1)} km`,
    22,
    height - 46,
  );

  const locationText =
    state.lat !== null && state.lon !== null
      ? `Lat ${state.lat.toFixed(5)}, Lon ${state.lon.toFixed(5)} · Eye ${Math.round(state.observerHeightM)}m`
      : `No GPS fix yet · Eye ${Math.round(state.observerHeightM)}m`;
  ctx.fillText(locationText, 22, height - 26);
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
  const confidence = Math.round((layers.reduce((sum, layer) => sum + layer.confidence, 0) / layers.length) * 100);

  el.insightText.textContent =
    `Volume model keeps subsurface context active even without direct terrain line-of-sight. ` +
    `Dominant unit is ${dominant.name}; estimated confidence ${confidence}%. ` +
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
    source === 'sensor' ? `${Math.round(state.heading)}° live` : `${Math.round(state.heading)}° manual`;
  syncSliders();
  refresh();
};

const setTiltFromSensor = (rawTilt) => {
  state.tiltDeg = clamp(Math.round(rawTilt), -20, 80);
  state.distanceKm = Number((0.8 + ((80 - clamp(state.tiltDeg, 0, 80)) / 80) * 9.2).toFixed(1));
  syncSliders();
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
    el.centerHint.textContent = 'AR view active. Subsurface volume remains visible indoors.';
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
      setTiltFromSensor(clamp(event.beta, -20, 80));
    }
  });

  state.orientationActive = true;
  el.headingStatus.textContent = 'Waiting for sensor...';
};

el.menuBtn.addEventListener('click', () => {
  setMenuOpen(el.settingsPanel.hasAttribute('hidden'));
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
  refresh();
});

el.elevationInput.addEventListener('input', (event) => {
  setObserverHeight(Number(event.target.value));
});

window.addEventListener('resize', () => {
  fitCanvas();
  refresh();
});

fitCanvas();
el.modeStatus.textContent = '3D subsurface';
setObserverHeight(state.observerHeightM);
syncSliders();
refresh();
