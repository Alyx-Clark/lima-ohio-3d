# Lima 3D City Explorer

A range-streamed, GPU-accelerated reconstruction of Lima, Ohio. It combines physical building heights, an aerial ground surface, LiDAR-derived canopy, OpenStreetMap street detail, and free-flight camera controls in a static web application.

## What is rendered

- Every street available in the OpenFreeMap/OpenStreetMap vector tiles
- 24,718 Overture building footprints; 24,179 carry source-provided height attributes and 539 use conservative class-based fallbacks
- Procedural facade materials and shallow roof caps derived at runtime without texture downloads
- Esri World Imagery as an optional photographic ground surface
- 270,515 canopy objects derived from two adjacent USGS 3DEP QL1 work units, with per-object height and crown radius
- 778 locally packaged pedestrian paths, footways, pedestrian streets, and steps
- Mapped parks, gardens, forests, cemeteries, recreation grounds, and grass areas
- Benches, lamps, signals, crossings, bus stops, bicycle parking, waste baskets, and hydrants where mapped
- The official OpenStreetMap municipal boundary for Lima
- Optional 3D terrain from public Mapzen/AWS Terrarium elevation tiles

This is an open-data reconstruction, not a live camera feed or engineering survey. The LiDAR was acquired between November 2019 and April 2020; the aerial imagery is served at runtime and its capture dates vary by source. LiDAR canopy objects represent detected crown apexes, not a certified tree inventory. Building geometry, map completeness, and imagery freshness vary by source.

The build retains valid Overture heights. Source values below 2.2 meters are treated as implausible building measurements, labeled `normalized`, and replaced with class-aware defaults; records without any height remain labeled `inferred`.

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
- A pinned, integrity-checked MapLibre GL JS CDN build performs WebGL vector, raster, and 3D building rendering.
- Overture buildings are compiled into a same-origin PMTiles archive so the browser requests only the vector-tile ranges in view. Range reads are revalidated to avoid stale or incomplete partial-cache entries after a reload.
- LiDAR trees are partitioned into 650-meter spatial chunks. Only camera-adjacent chunks are converted to native MapLibre trunk and two-tier crown extrusions, eliminating cross-renderer WebGL state while retaining per-object height and crown radius.
- USGS 3DEP point clouds are normalized and sampled offline with PDAL. Overture footprints mask likely roof returns before the browser asset is written.
- OpenFreeMap supplies keyless, globally tiled OpenStreetMap data.
- A build-time Node script converts a Lima Overpass extract into static GeoJSON.
- Progressive minimum zooms keep fine street detail and canopy out of the GPU workload until they are visible.
- Modern browsers fetch a precompressed city-detail payload (about 377 KB instead of 2.25 MB); the plain JSON remains as a compatibility fallback.
- The full-municipality canopy inventory compresses from 9.5 MB to 2.41 MB; only a bounded camera-adjacent subset becomes render geometry.
- An adaptive safeguard reduces the camera-adjacent canopy batch after sustained low framerate; the complete source inventory remains available as the camera moves.

No backend, database, container, daemon, or client API key is required. The production files are served directly by Nginx.

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

This runs JavaScript linting, semantic HTML validation, camera/data-integrity tests, and an optimized production build.

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

The realism layers can be rebuilt separately:

```bash
npm run data:buildings  # Overture → PMTiles; requires DuckDB and Tippecanoe
npm run data:lidar      # USGS 3DEP EPT → canopy inventory; requires PDAL
npm run data:realism    # both in dependency order
```

The LiDAR build reads `data/source/lima-buildings.geojsonseq` to reject canopy candidates within building footprints. `npm run data:refresh` updates OSM and both realism layers; expect the LiDAR phase to take several minutes and download point-cloud ranges from the USGS public dataset.

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
- Building footprints and height attributes from [Overture Maps Foundation](https://overturemaps.org/), available under the ODbL.
- Aerial ground imagery © Esri and its source providers; imagery is requested at runtime and is not redistributed in this repository.
- Canopy geometry derived from adjacent USGS 3DEP QL1 work units `OH_Statewide_Phase1_2_2019` and `OH_Statewide_Phase1_5_2019`.
- Terrain tiles originate from the public Mapzen terrain tile archive hosted on AWS.
- Application source is released under the MIT License.
