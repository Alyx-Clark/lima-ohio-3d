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

## Elevation tiles

Optional terrain uses the public Mapzen/AWS terrain tile archive. Terrain is disabled by default and is not included in the committed dataset.

## Inferred vegetation

Tree locations generated inside mapped parks, gardens, and forests are deterministic visualization proxies. They are derivative visual features based on mapped land-use geometry, not observed or surveyed individual trees. The metadata and interface documentation must retain this distinction.
