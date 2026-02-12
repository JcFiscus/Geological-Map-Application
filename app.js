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
  startArBtn: document.querySelector('#startArBtn'),
  cameraFeed: document.querySelector('#cameraFeed'),
  locationBtn: document.querySelector('#locationBtn'),
  orientationBtn: document.querySelector('#orientationBtn'),
  locationStatus: document.querySelector('#locationStatus'),
  headingStatus: document.querySelector('#headingStatus'),
  tiltStatus: document.querySelector('#tiltStatus'),
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
  const distanceFactor = Math.min(state.distanceKm / 15, 1);
  const tiltFactor = Math.min(state.tiltDeg / 80, 1);

  const layers = geologicPalette.map((layer, index) => {
    const base = 9 + index * 2;
    const headingWave = Math.sin((state.heading + index * 41) * 0.07) * 5.5;
    const depthInfluence = (index / geologicPalette.length) * 16 * distanceFactor;
    const tiltCompression = (1 - tiltFactor) * (7 - index * 0.55);
    const confidence = 0.65 + Math.abs(headingFactor) * 0.24 - index * 0.025;

    return {
      ...layer,
      thickness: Math.max(3, base + headingWave + depthInfluence + tiltCompression),
      confidence: Math.max(0.5, Math.min(0.97, confidence)),
    };
  });

  const totalThickness = layers.reduce((sum, layer) => sum + layer.thickness, 0);

  return layers
    .map((layer) => ({
      ...layer,
      thickness: (layer.thickness / totalThickness) * 100,
    }))
    .filter((layer) => layer.thickness > 0);
};

const fitCanvas = () => {
  const ratio = window.devicePixelRatio || 1;
  const rect = el.canvas.getBoundingClientRect();
  el.canvas.width = Math.round(rect.width * ratio);
  el.canvas.height = Math.round(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
};

const drawOverlay = (layers) => {
  const width = el.canvas.clientWidth;
  const height = el.canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);

  const horizonY = height * (0.38 + state.tiltDeg / 220);
  const scanLineY = horizonY - 26;

  ctx.fillStyle = 'rgba(14, 165, 233, 0.16)';
  ctx.fillRect(0, scanLineY, width, 2);

  const usableHeight = height - horizonY;
  let currentTop = height;

  layers.forEach((layer) => {
    const segmentHeight = (layer.thickness / 100) * usableHeight;
    currentTop -= segmentHeight;

    ctx.fillStyle = `${layer.color}55`;
    ctx.fillRect(0, currentTop, width, segmentHeight);

    ctx.strokeStyle = `${layer.color}dd`;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, currentTop, width, segmentHeight);

    if (segmentHeight > 30) {
      ctx.fillStyle = '#f8fafc';
      ctx.font = '600 14px Inter, sans-serif';
      ctx.fillText(layer.name, 14, currentTop + segmentHeight / 2);
    }
  });

  ctx.strokeStyle = 'rgba(226,232,240,0.45)';
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(width * 0.5, 0);
  ctx.lineTo(width * 0.5, height);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(2,6,23,0.52)';
  ctx.fillRect(10, 10, Math.min(width - 20, 430), 64);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '600 14px Inter, sans-serif';
  ctx.fillText(
    `Bearing ${Math.round(state.heading)}° · Look-ahead ${state.distanceKm.toFixed(1)} km · Tilt ${state.tiltDeg}°`,
    18,
    34,
  );

  if (state.lat !== null && state.lon !== null) {
    ctx.fillText(`Lat ${state.lat.toFixed(5)}, Lon ${state.lon.toFixed(5)}`, 18, 54);
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

  el.insightText.textContent =
    `Facing ${Math.round(state.heading)}°, this view projects through ${layers.length} units. ` +
    `Dominant exposure: ${dominant.name} (${dominant.age}). Surface expression starts with ${youngest.name}. ` +
    `Confidence: ${confidence}% (higher with stable GPS + compass). Prototype output is conceptual only.`;
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
  el.headingStatus.textContent =
    source === 'sensor' ? `${Math.round(state.heading)}° (live)` : `${Math.round(state.heading)}° (manual)`;
  refresh();
};

const setTiltFromSensor = (rawTilt) => {
  state.tiltDeg = clamp(Math.round(rawTilt), 5, 80);
  state.distanceKm = Number((0.8 + ((80 - state.tiltDeg) / 75) * 9.2).toFixed(1));
  el.tiltStatus.textContent = `${state.tiltDeg}° (live)`;
  refresh();
};

const startCamera = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    el.centerHint.textContent = 'Camera not supported in this browser.';
    return;
  }

  if (state.stream) {
    el.centerHint.textContent = 'AR view is active. Move slowly for stable alignment.';
    return;
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
  } catch (error) {
    el.centerHint.textContent = `Camera access failed: ${error.message}`;
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

el.startArBtn.addEventListener('click', async () => {
  await startCamera();
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

window.addEventListener('resize', () => {
  fitCanvas();
  refresh();
});

fitCanvas();
refresh();
