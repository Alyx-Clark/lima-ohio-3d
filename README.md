# Lima 3D City Explorer

A detailed, GPU-accelerated 3D explorer for Lima, Ohio. It combines OpenFreeMap vector tiles with a compact, reproducible OpenStreetMap detail layer for pedestrian ways, green spaces, hedges, street furniture, and deterministic park canopy.

## What is rendered

- Every street and building available in the OpenFreeMap/OpenStreetMap vector tiles
- 3D building footprints with source-provided heights or OpenFreeMap defaults
- 778 locally packaged pedestrian paths, footways, pedestrian streets, and steps
- Mapped parks, gardens, forests, cemeteries, recreation grounds, and grass areas
- Benches, lamps, signals, crossings, bus stops, bicycle parking, waste baskets, and hydrants where mapped
- Deterministic 3D tree proxies inside mapped parks, gardens, and forest polygons
- The official OpenStreetMap municipal boundary for Lima
- Optional 3D terrain from public Mapzen/AWS Terrarium elevation tiles

The map is a visualization, not an engineering, parcel, accessibility, or navigation authority. OpenStreetMap completeness varies. Inferred park trees communicate canopy mass and are not surveyed tree locations.

## Controls

- Mouse/touch: drag to pan, right-drag or Control-drag to orbit, pinch/scroll to change height
- `W` / `S`: fly forward and backward
- `A` / `D`: strafe left and right
- `Q` / `E`: turn
- `R` / `F`: climb and descend
- `T` / `G`: tilt up and down
- `Shift`: boost flight speed

The control deck includes six camera presets, layer toggles, daylight/golden/night lighting, fullscreen, compass, pitch, and zoom controls.

## Architecture

The application is deliberately static and framework-light:

- Vite builds plain HTML, CSS, and JavaScript.
- MapLibre GL JS performs WebGL vector and 3D rendering.
- OpenFreeMap supplies keyless, globally tiled OpenStreetMap data.
- A build-time Node script converts a Lima Overpass extract into static GeoJSON.
- Progressive minimum zooms keep paths, furniture, and inferred trees out of the GPU workload until they are visible.
- An adaptive safeguard hides only inferred tree crowns after sustained low framerate; mapped data remains available.

No backend, database, container, daemon, or client API key is required.

## Local development

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

Then open the URL printed by Vite.

## Verification

```bash
npm run check
```

This runs JavaScript linting, semantic HTML validation, nine camera/data-integrity tests, and an optimized production build.

## Refreshing the local OSM detail data

The committed JSON is a reproducible snapshot so visitors never query Overpass. To fetch a new city extract and rebuild the browser assets, run:

```bash
npm run data:refresh
```

The raw response is stored under ignored `data/source/`; derived assets under `public/data/` are versioned. The converter can also be called directly:

```bash
node scripts/build-osm-data.mjs /path/to/overpass.json public/data
```

It also refreshes the municipal boundary through Nominatim and records the OSM source timestamp in `public/data/lima-metadata.json`.

## Static deployment

```bash
npm ci
npm run check
```

Publish the contents of `dist/` at `/lima-3d`. The production build intentionally emits absolute `/lima-3d/` asset and data URLs because the documented Nginx configuration canonicalizes `/lima-3d/` to `/lima-3d`.

The public release target is [https://owlex.dev/lima-3d](https://owlex.dev/lima-3d); GitHub remains the canonical source repository.

For the documented Nginx server, deployment requires only a versioned copy of `dist/` into `/var/www/html/lima-3d`, followed by route verification. It does not require a new port, daemon, database, DNS record, TLS certificate, or Nginx behavior change. Keep the previous directory as the rollback target until the new route is verified.

## Data and licenses

- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the ODbL.
- Vector tiles and style by [OpenFreeMap](https://openfreemap.org/).
- Terrain tiles originate from the public Mapzen terrain tile archive hosted on AWS.
- Application source is released under the MIT License.
