# Geological-Map-Application

GeoScope AR is a browser-based augmented reality prototype for geological visualization. It anchors a synthetic subsurface model to the real world using live camera, compass heading, tilt, roll, and geolocation.

## Vision

The app is designed to behave like a geologic "x-ray" only when the camera intersects terrain:

- When the user points the camera **toward sky**, no subsurface layer should render.
- When the user points **toward ground/terrain**, layers should appear beneath the horizon and align with camera direction.
- Heading and roll are used to keep orientation earth-frame aligned as the viewer turns the device.

This repository implements that first-iteration alignment behavior and keeps the data model modular so real geological map sources can replace the synthetic stack.

## Current capabilities

- Live rear camera AR stage.
- iOS-compatible orientation permission flow.
- Heading smoothing for stable world-locking.
- Pitch-based ground intersection gating (sky suppresses geology overlay).
- Roll-aware volumetric rendering for better directional realism.
- Continuous GPS watch for location + accuracy readout.
- Deterministic synthetic geology stack as a stand-in for real map data.

## Next production steps

1. Replace `createDirectionalStack` with map-unit queries from USGS/state geologic services.
2. Add DEM + line-of-sight ray intersection to place layer boundaries on actual terrain geometry.
3. Convert magnetic heading to true north with declination correction.
4. Add calibration UX and drift quality indicators.

## Run locally

```bash
python -m http.server 4173
```

Open `http://localhost:4173`.

## Project structure

- `index.html` – AR shell, controls, and HUD.
- `styles.css` – HUD/panel styles and overlay readability.
- `app.js` – camera/orientation/location wiring plus geologic overlay rendering.
