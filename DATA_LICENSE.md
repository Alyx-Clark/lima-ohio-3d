# Map data licensing and attribution

The application code and the map data are licensed separately.

## OpenStreetMap

The committed files under `public/data` are derived from OpenStreetMap through Nominatim and the Overpass API.

OpenStreetMap data is © OpenStreetMap contributors and available under the Open Data Commons Open Database License (ODbL) 1.0:

- https://www.openstreetmap.org/copyright
- https://opendatacommons.org/licenses/odbl/1-0/

The required attribution is displayed persistently in the explorer.

## OpenFreeMap

Runtime vector tiles, glyphs, and sprites are served by OpenFreeMap. OpenFreeMap's published attribution and data-license terms apply:

- https://openfreemap.org/

## Overture Maps buildings

`public/data/lima-buildings.pmtiles` is derived from the Overture Maps Foundation buildings theme, release `2026-06-17.0`. Overture data is available under the Open Data Commons Open Database License (ODbL) 1.0 and may include source-specific attribution requirements recorded in the Overture dataset:

- https://docs.overturemaps.org/attribution/
- https://docs.overturemaps.org/guides/buildings/
- https://opendatacommons.org/licenses/odbl/1-0/

The application displays Overture attribution persistently. Valid source-provided `height` values remain unchanged. Values below 2.2 meters are labeled `normalized` and use a class-aware visualization default; missing values are labeled `inferred`.

## USGS 3DEP LiDAR

`public/data/lima-trees.json` and its compressed counterpart are derived from the adjacent USGS 3DEP `OH_Statewide_Phase1_2_2019` and `OH_Statewide_Phase1_5_2019` QL1 point clouds, acquired from November 4, 2019 through April 27, 2020. U.S. Geological Survey-authored data are public domain unless otherwise noted:

- https://www.usgs.gov/3d-elevation-program
- https://registry.opendata.aws/usgs-lidar/

The derived objects are height-normalized, de-duplicated canopy-apex visualizations. They are not surveyed trees, species observations, or a current inventory.

## Cinematic traffic routes

`public/data/lima-traffic.json` and its compressed counterpart are derived from drivable OpenStreetMap ways fetched through Overpass. The route geometry remains ODbL-licensed OpenStreetMap data. Vehicle models, colors, spacing, direction, and animated positions are deterministic visual simulations; they do not represent live traffic, vehicle ownership, or observed road conditions.

## Procedural rooftop details

`public/data/lima-rooftops.json` and its compressed counterpart are deterministic derivatives of the Overture building footprints and heights described above. Equipment rectangles are validated inside source footprints and classified for visualization, but their exact positions and types are not surveyed roof inventories.

## Esri World Imagery

The aerial surface is requested at runtime from Esri World Imagery. No Esri raster tile is stored or redistributed in this repository. Esri and its contributing imagery providers retain their applicable rights and attribution requirements:

- https://doc.arcgis.com/en/data-appliance/2025/maps/world-imagery.htm
- https://www.esri.com/en-us/legal/terms/full-master-agreement

## Elevation tiles

Optional terrain uses the public Mapzen/AWS terrain tile archive. Terrain is disabled by default and is not included in the committed dataset.

## Native inferred vegetation fallback

The OSM detail snapshot retains deterministic park-canopy proxies as a compatibility fallback when the LiDAR asset or instanced scene cannot load. The production renderer hides this fallback after the cinematic scene initializes. These proxies are derivative visual features based on mapped land-use geometry, not observed or surveyed individual trees.
