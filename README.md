# Geological-Map-Application

GeoScope AR is a lightweight prototype for visualizing geological time layers in the direction a user points a smartphone. The concept is inspired by astronomy apps (like SkyView), but focused on local surface/subsurface geology, so users can aim at nearby terrain, canyon walls, or ground exposures and quickly interpret probable stratigraphic layers.

## Product description

The app combines:

- **Device location (GPS)** to anchor a local geology context.
- **Device heading (compass / orientation)** to understand viewing direction.
- **Look-ahead distance + camera tilt controls** to estimate what terrain cross-section is being observed.
- **A layered overlay renderer** that displays geological units and ages on top of a camera-like scene.

This repository currently contains a browser prototype that demonstrates the core UX flow and rendering model. It is intended as a foundation for integrating authoritative geological data sources later (USGS, state surveys, raster/vector geologic maps, and DEM-based line-of-sight calculations).

## Implementation plan

1. **Sensing + inputs**
   - Request geolocation permission.
   - Read heading from `deviceorientation` when available.
   - Provide manual fallback controls for heading, distance, and tilt.

2. **Directional geology model (prototype)**
   - Use location + heading + distance to generate deterministic directional stratigraphic stacks.
   - Represent each stack as ordered units with age, thickness, color, and confidence.

3. **Visualization**
   - Render a camera-style ground profile on canvas.
   - Paint geological layers from youngest to oldest with labels.
   - Show legend chips and a textual interpretation summary.

4. **Future productionization**
   - Replace synthetic layer model with real geologic map units.
   - Add digital elevation model sampling for accurate canyon/hillside intersections.
   - Add map tile caching + offline mode.
   - Calibrate sensor drift and support true-north correction.

## Run locally

Because this is a static app, run it with any local web server:

```bash
python -m http.server 4173
```

Then open: `http://localhost:4173`

## Project structure

- `index.html` – app layout and controls.
- `styles.css` – visual styling for panels, controls, and overlay.
- `app.js` – sensing logic, directional model, canvas rendering, and UX updates.
