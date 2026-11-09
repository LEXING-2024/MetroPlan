/**
 * A custom OpenMapTiles style for the Metro Plan basemap.
 *
 * The visual target is the game's existing paper map: warm paper, sage water,
 * low-contrast hillside and a very restrained ink hierarchy. Unlike the static
 * PNG in the game, this style exposes the full OSM feature ladder -- landuse,
 * buildings, every road class, railways, ferry routes and POIs -- while keeping
 * the loudest colours reserved for the player's metro network.
 */

export const PALETTE = {
  paper: '#f4f0e6',
  paperLight: '#fbf7ed',
  paperDeep: '#ece5d7',
  ink: '#34382f',
  inkSoft: '#5d6253',
  muted: '#8b8f80',
  water: '#b8d3d7',
  waterEdge: '#94b5b9',
  waterInk: '#6d9399',
  forest: '#cfdbc0',
  forestDeep: '#c3d1b2',
  grass: '#dde6d0',
  farm: '#ece7d2',
  park: '#d6e1c8',
  parkEdge: '#b1c09f',
  residential: '#f0e8d9',
  commercial: '#f2e3d4',
  industrial: '#e8e2d5',
  institution: '#f1e7d0',
  hospital: '#f4e0dc',
  building: '#e7decd',
  buildingEdge: '#d6cbb7',
  roadCasing: '#d8cbb5',
  roadMajor: '#fbf4e4',
  roadSecondary: '#faf5e8',
  roadMinor: '#f9f3e5',
  motorway: '#ebcdb4',
  motorwayCasing: '#dcc3a9',
  path: '#b7ad99',
  rail: '#948b77',
  boundary: '#8d907c',
  accent: '#b4623f',
};

const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];
const FONT_ITALIC = ['Noto Sans Italic'];

const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const TILES = 'https://tiles.openfreemap.org/planet';

/** Linear zoom interpolation helper: [z, value, z, value...] */
const z = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];

const nameField = ['coalesce', ['get', 'name:zh'], ['get', 'name'], ['get', 'name:en']];
const hasName = ['all', ['has', 'name'], ['!=', ['get', 'name'], '']];

function roadWidth(low, mid, high) {
  return z(7, low * 0.45, 9, low * 0.75, 11, low, 13, mid, 15, high * 0.72, 17, high);
}

function labelHalo(width = 1.5) {
  return {
    'text-halo-color': 'rgba(248, 244, 234, 0.92)',
    'text-halo-width': width,
    'text-halo-blur': 0.2,
  };
}

function casing(width) {
  return {
    'line-color': PALETTE.roadCasing,
    'line-width': width,
    'line-opacity': 0.62,
  };
}

function road(fill, width) {
  return {
    'line-color': fill,
    'line-width': width,
    'line-opacity': 0.96,
  };
}

export const LAYER_GROUPS = {
  landuse: [
    'landcover-wood',
    'landcover-grass',
    'landcover-farmland',
    'landcover-sand',
    'landcover-wetland',
    'landuse-residential',
    'landuse-commercial',
    'landuse-industrial',
    'landuse-retail',
    'landuse-institution',
    'landuse-hospital',
    'landuse-recreation',
    'landuse-other',
    'park-protected',
  ],
  terrain: ['hillshade'],
  water: ['water-major', 'water-minor', 'waterway'],
  boundaries: ['boundary-admin6', 'boundary-admin8'],
  roads: [
    'road-motorway-casing',
    'road-motorway',
    'road-primary-casing',
    'road-primary',
    'road-secondary-casing',
    'road-secondary',
    'road-tertiary-casing',
    'road-tertiary',
    'road-minor',
    'road-service',
    'road-track',
    'road-path',
  ],
  transit: ['rail-base', 'rail-line', 'transit-line', 'ferry-line', 'aeroway-runway', 'aeroway-taxiway'],
  buildings: ['buildings'],
  labels: [
    'local-district',
    'local-river',
    'local-island',
    'local-lake',
    'local-mountain',
    'place-city',
    'place-town',
    'place-suburb',
    'place-quarter',
    'place-village',
    'place-hamlet',
    'waterway-label',
    'water-name',
    'road-label-major',
    'road-label-minor',
    'rail-label',
    'ferry-label',
  ],
  pois: [],
};

export function buildStyle(localLabels, hillshadeUrl) {
  const layers = [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': PALETTE.paper },
    },

    // --- Land cover -------------------------------------------------------
    {
      id: 'landcover-wood',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'wood'],
      paint: {
        'fill-color': PALETTE.forest,
        'fill-opacity': z(8, 0.4, 11, 0.75, 13, 0.78, 16, 0.66),
      },
    },
    {
      id: 'landcover-grass',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'grass'],
      paint: {
        'fill-color': PALETTE.grass,
        'fill-opacity': z(9, 0.28, 13, 0.5, 16, 0.42),
      },
    },
    {
      id: 'landcover-farmland',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'farmland'],
      paint: {
        'fill-color': PALETTE.farm,
        'fill-opacity': z(9, 0.18, 13, 0.38, 16, 0.34),
      },
    },
    {
      id: 'landcover-sand',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'sand'],
      paint: { 'fill-color': '#eee7d3', 'fill-opacity': 0.45 },
    },
    {
      id: 'landcover-wetland',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'wetland'],
      paint: { 'fill-color': '#cadfd5', 'fill-opacity': 0.55 },
    },

    // --- Urban / land use -------------------------------------------------
    {
      id: 'landuse-residential',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landuse',
      filter: ['match', ['get', 'class'], ['residential', 'neighbourhood'], true, false],
      paint: {
        'fill-color': PALETTE.residential,
        'fill-opacity': z(9, 0.25, 12, 0.4, 14, 0.45, 16, 0.3),
      },
    },
    {
      id: 'landuse-commercial',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landuse',
      filter: ['match', ['get', 'class'], ['commercial', 'retail'], true, false],
      paint: {
        'fill-color': PALETTE.commercial,
        'fill-opacity': z(11, 0.22, 14, 0.42, 16, 0.3),
      },
    },
    {
      id: 'landuse-industrial',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landuse',
      filter: ['match', ['get', 'class'], ['industrial', 'railway', 'quarry', 'military'], true, false],
      paint: {
        'fill-color': PALETTE.industrial,
        'fill-opacity': z(10, 0.2, 13, 0.38, 16, 0.3),
      },
    },
    {
      id: 'landuse-retail',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landuse',
      filter: ['match', ['get', 'class'], ['retail'], true, false],
      paint: { 'fill-color': '#f2e5d8', 'fill-opacity': 0.24 },
    },
    {
      id: 'landuse-institution',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landuse',
      filter: [
        'match',
        ['get', 'class'],
        ['school', 'college', 'university', 'kindergarten', 'library'],
        true,
        false,
      ],
      paint: {
        'fill-color': PALETTE.institution,
        'fill-opacity': z(11, 0.2, 14, 0.42, 16, 0.34),
      },
    },
    {
      id: 'landuse-hospital',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landuse',
      filter: ['==', ['get', 'class'], 'hospital'],
      paint: {
        'fill-color': PALETTE.hospital,
        'fill-opacity': z(11, 0.28, 14, 0.5, 16, 0.4),
      },
    },
    {
      id: 'landuse-recreation',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landuse',
      filter: [
        'match',
        ['get', 'class'],
        ['park', 'playground', 'stadium', 'pitch', 'track', 'garden', 'golf_course'],
        true,
        false,
      ],
      paint: {
        'fill-color': PALETTE.park,
        'fill-opacity': z(10, 0.22, 14, 0.48, 16, 0.38),
      },
    },
    {
      id: 'landuse-other',
      type: 'fill',
      source: 'osm',
      'source-layer': 'landuse',
      filter: ['match', ['get', 'class'], ['cemetery', 'farmland', 'orchard', 'allotments'], true, false],
      paint: { 'fill-color': '#e6e6d5', 'fill-opacity': 0.28 },
    },
    {
      id: 'park-protected',
      type: 'fill',
      source: 'osm',
      'source-layer': 'park',
      filter: [
        'match',
        ['get', 'class'],
        ['nature_reserve', 'protected_area', 'national_park'],
        true,
        false,
      ],
      paint: {
        'fill-color': PALETTE.park,
        'fill-opacity': z(8, 0.2, 11, 0.45, 14, 0.5, 16, 0.38),
        'fill-outline-color': 'rgba(158, 177, 140, 0.42)',
      },
    },

    // --- Terrain ----------------------------------------------------------
    {
      id: 'hillshade',
      type: 'raster',
      source: 'terrain-image',
      paint: {
        'raster-opacity': z(9, 0.45, 13, 0.65, 16, 0.8),
        'raster-resampling': 'linear',
        'raster-fade-duration': 0,
      },
    },

    // --- Water ------------------------------------------------------------
    {
      id: 'water-major',
      type: 'fill',
      source: 'osm',
      'source-layer': 'water',
      filter: [
        'match',
        ['get', 'class'],
        ['river', 'lake', 'reservoir', 'ocean', 'bay', 'dock'],
        true,
        false,
      ],
      paint: {
        'fill-color': PALETTE.water,
        'fill-opacity': 1,
        'fill-outline-color': PALETTE.waterEdge,
      },
    },
    {
      id: 'water-minor',
      type: 'fill',
      source: 'osm',
      'source-layer': 'water',
      minzoom: 13.2,
      filter: ['match', ['get', 'class'], ['pond', 'swimming_pool'], true, false],
      paint: {
        'fill-color': PALETTE.water,
        'fill-opacity': z(13.2, 0, 14.2, 0.75),
        'fill-outline-color': 'rgba(148, 181, 185, 0.65)',
      },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'osm',
      'source-layer': 'waterway',
      minzoom: 9,
      filter: ['match', ['get', 'class'], ['river', 'canal', 'stream', 'drain'], true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': PALETTE.water,
        'line-width': z(9, 0.5, 11, 0.8, 13, 1.3, 15, 2.4),
        'line-opacity': 0.9,
      },
    },

    // --- Boundaries -------------------------------------------------------
    {
      id: 'boundary-admin6',
      type: 'line',
      source: 'osm',
      'source-layer': 'boundary',
      minzoom: 7,
      filter: [
        'all',
        ['has', 'admin_level'],
        ['>=', ['get', 'admin_level'], 6],
        ['<=', ['get', 'admin_level'], 7],
        ['!=', ['get', 'maritime'], 1],
      ],
      paint: {
        'line-color': PALETTE.boundary,
        'line-width': z(7, 0.4, 11, 0.9, 14, 1.3),
        'line-opacity': z(7, 0.18, 11, 0.34, 14, 0.25),
        'line-dasharray': [5, 3],
      },
    },
    {
      id: 'boundary-admin8',
      type: 'line',
      source: 'osm',
      'source-layer': 'boundary',
      minzoom: 12,
      filter: [
        'all',
        ['has', 'admin_level'],
        ['>=', ['get', 'admin_level'], 8],
        ['<=', ['get', 'admin_level'], 10],
        ['!=', ['get', 'maritime'], 1],
      ],
      paint: {
        'line-color': PALETTE.boundary,
        'line-width': 0.55,
        'line-opacity': z(12, 0, 13, 0.2),
        'line-dasharray': [2, 2],
      },
    },

    // --- Roads ------------------------------------------------------------
    {
      id: 'road-motorway-casing',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 5,
      filter: ['==', ['get', 'class'], 'motorway'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': PALETTE.motorwayCasing,
        'line-width': roadWidth(2.8, 4.3, 10.2),
        'line-opacity': z(5, 0, 7, 0.58),
      },
    },
    {
      id: 'road-motorway',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 5,
      filter: ['==', ['get', 'class'], 'motorway'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': PALETTE.motorway,
        'line-width': roadWidth(1.9, 3.1, 8.2),
        'line-opacity': 0.95,
      },
    },
    {
      id: 'road-primary-casing',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 7,
      filter: ['match', ['get', 'class'], ['trunk', 'primary'], true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        ...casing(roadWidth(2.1, 3.5, 8.3)),
        'line-opacity': z(7, 0, 9, 0.55),
      },
    },
    {
      id: 'road-primary',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 7,
      filter: ['match', ['get', 'class'], ['trunk', 'primary'], true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: road(PALETTE.roadMajor, roadWidth(1.35, 2.35, 6.5)),
    },
    {
      id: 'road-secondary-casing',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 10,
      filter: ['==', ['get', 'class'], 'secondary'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        ...casing(roadWidth(1.5, 2.3, 5.2)),
        'line-opacity': z(10, 0, 11, 0.55),
      },
    },
    {
      id: 'road-secondary',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 10,
      filter: ['==', ['get', 'class'], 'secondary'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: road(PALETTE.roadSecondary, roadWidth(0.9, 1.45, 4.1)),
    },
    {
      id: 'road-tertiary-casing',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 11,
      filter: ['==', ['get', 'class'], 'tertiary'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        ...casing(roadWidth(1.1, 1.8, 4.1)),
        'line-opacity': z(11, 0, 12, 0.5),
      },
    },
    {
      id: 'road-tertiary',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 11,
      filter: ['==', ['get', 'class'], 'tertiary'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: road(PALETTE.roadSecondary, roadWidth(0.68, 1.1, 3.4)),
    },
    {
      id: 'road-minor',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 13.3,
      filter: ['==', ['get', 'class'], 'minor'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        ...road(PALETTE.roadMinor, roadWidth(0.8, 1.15, 3.0)),
        'line-opacity': z(13.3, 0, 14.1, 0.9),
      },
    },
    {
      id: 'road-service',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 14,
      filter: ['match', ['get', 'class'], ['service', 'pier'], true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        ...road(PALETTE.roadMinor, z(14, 0.5, 16, 1.35, 18, 2.4)),
        'line-opacity': z(14, 0, 14.8, 0.8),
      },
    },
    {
      id: 'road-track',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 14.4,
      filter: ['==', ['get', 'class'], 'track'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#c8bca6',
        'line-width': z(14.4, 0.45, 16, 0.9, 18, 1.6),
        'line-dasharray': [2.4, 1.6],
        'line-opacity': z(14.4, 0, 15.2, 0.65),
      },
    },
    {
      id: 'road-path',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 14.2,
      filter: ['==', ['get', 'class'], 'path'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': PALETTE.path,
        'line-width': z(14.2, 0.45, 16, 1.15, 18, 2.1),
        'line-dasharray': [1.5, 1.5],
        'line-opacity': z(14.2, 0, 15, 0.55),
      },
    },

    // --- Rail / ferry / air ----------------------------------------------
    {
      id: 'rail-base',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 9,
      filter: ['match', ['get', 'class'], ['rail'], true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': PALETTE.paperLight,
        'line-width': z(9, 1.4, 12, 2.3, 15, 4.2),
        'line-opacity': 0.85,
      },
    },
    {
      id: 'rail-line',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 9,
      filter: ['match', ['get', 'class'], ['rail'], true, false],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': PALETTE.rail,
        'line-width': z(9, 0.6, 12, 0.95, 15, 1.5),
        'line-dasharray': [1.2, 1.4],
        'line-opacity': z(9, 0.35, 12, 0.65),
      },
    },
    {
      id: 'transit-line',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 12,
      filter: ['match', ['get', 'class'], ['transit'], true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#6f8491',
        'line-width': z(12, 0.9, 15, 2.1),
        'line-dasharray': [3, 1.2],
        'line-opacity': 0.72,
      },
    },
    {
      id: 'ferry-line',
      type: 'line',
      source: 'osm',
      'source-layer': 'transportation',
      minzoom: 8,
      filter: ['==', ['get', 'class'], 'ferry'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#7497a3',
        'line-width': z(8, 0.6, 12, 1.1, 15, 1.8),
        'line-dasharray': [2.2, 1.8],
        'line-opacity': z(8, 0.28, 12, 0.6),
      },
    },
    {
      id: 'aeroway-runway',
      type: 'line',
      source: 'osm',
      'source-layer': 'aeroway',
      minzoom: 10,
      filter: ['==', ['get', 'class'], 'runway'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#eadfce',
        'line-width': z(10, 2, 13, 5, 16, 11),
        'line-opacity': 0.8,
      },
    },
    {
      id: 'aeroway-taxiway',
      type: 'line',
      source: 'osm',
      'source-layer': 'aeroway',
      minzoom: 11,
      filter: ['==', ['get', 'class'], 'taxiway'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#f2e8d8',
        'line-width': z(11, 0.8, 14, 2, 16, 4),
        'line-opacity': 0.7,
      },
    },

    // --- Buildings --------------------------------------------------------
    {
      id: 'buildings',
      type: 'fill',
      source: 'osm',
      'source-layer': 'building',
      minzoom: 13.6,
      paint: {
        'fill-color': PALETTE.building,
        'fill-opacity': z(13.6, 0, 14.4, 0.68, 16, 0.78),
        'fill-outline-color': PALETTE.buildingEdge,
      },
    },

    // --- Curated landmark labels -----------------------------------------
    {
      id: 'local-district',
      type: 'symbol',
      source: 'local-labels',
      minzoom: 11.1,
      maxzoom: 13.6,
      filter: ['==', ['get', 'kind'], 'district'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FONT_BOLD,
        'text-size': z(11.1, 18, 12.3, 24, 13.4, 27),
        'text-letter-spacing': 0.2,
        'text-padding': 8,
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: {
        'text-color': '#4e5344',
        'text-opacity': z(11.1, 0.55, 12.2, 0.86),
        ...labelHalo(2.8),
      },
    },
    {
      id: 'local-river',
      type: 'symbol',
      source: 'local-labels',
      minzoom: 10.4,
      maxzoom: 15.4,
      filter: ['==', ['get', 'kind'], 'river'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FONT_BOLD,
        'text-size': z(10.4, 15, 12.4, 23, 14.2, 27),
        'text-letter-spacing': 0.38,
        'text-padding': 6,
      },
      paint: {
        'text-color': '#648b92',
        'text-opacity': 0.9,
        ...labelHalo(2.2),
      },
    },
    {
      id: 'local-island',
      type: 'symbol',
      source: 'local-labels',
      minzoom: 11.2,
      maxzoom: 15.6,
      filter: ['==', ['get', 'kind'], 'island'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FONT,
        'text-size': z(11.2, 9.8, 13, 12, 15, 13.5),
        'text-letter-spacing': 0.1,
        'text-padding': 5,
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: {
        'text-color': '#62685b',
        'text-opacity': 0.8,
        ...labelHalo(1.5),
      },
    },
    {
      id: 'local-lake',
      type: 'symbol',
      source: 'local-labels',
      minzoom: 12.4,
      maxzoom: 15.6,
      filter: ['==', ['get', 'kind'], 'lake'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FONT_ITALIC,
        'text-size': z(12.4, 10, 14.4, 12.5),
        'text-letter-spacing': 0.18,
        'text-padding': 4,
      },
      paint: {
        'text-color': PALETTE.waterInk,
        'text-opacity': 0.76,
        ...labelHalo(1.4),
      },
    },
    {
      id: 'local-mountain',
      type: 'symbol',
      source: 'local-labels',
      minzoom: 11.8,
      maxzoom: 15.1,
      filter: ['==', ['get', 'kind'], 'mountain'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FONT_ITALIC,
        'text-size': z(11.8, 10.2, 14, 12.5, 15, 13.5),
        'text-letter-spacing': 0.22,
        'text-padding': 4,
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: {
        'text-color': '#7c8773',
        'text-opacity': 0.72,
        ...labelHalo(1.3),
      },
    },

    // --- OSM place labels -------------------------------------------------
    {
      id: 'place-city',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'place',
      minzoom: 6.5,
      maxzoom: 11.1,
      filter: ['==', ['get', 'class'], 'city'],
      layout: {
        'text-field': nameField,
        'text-font': FONT_BOLD,
        'text-size': z(6.5, 11, 9, 15, 11, 20),
        'text-letter-spacing': 0.14,
        'text-padding': 7,
      },
      paint: {
        'text-color': '#4e5344',
        'text-opacity': 0.8,
        ...labelHalo(2.4),
      },
    },
    {
      id: 'place-town',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'place',
      minzoom: 10.8,
      maxzoom: 14.7,
      filter: ['==', ['get', 'class'], 'town'],
      layout: {
        'text-field': nameField,
        'text-font': FONT,
        'text-size': z(10.8, 10, 13, 12, 14.5, 13.5),
        'text-letter-spacing': 0.05,
        'text-padding': 6,
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: {
        'text-color': '#626757',
        'text-opacity': z(10.8, 0.4, 12, 0.72),
        ...labelHalo(1.6),
      },
    },
    {
      id: 'place-suburb',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'place',
      minzoom: 12.6,
      maxzoom: 15.3,
      filter: ['==', ['get', 'class'], 'suburb'],
      layout: {
        'text-field': nameField,
        'text-font': FONT,
        'text-size': z(12.6, 9.8, 14.5, 12),
        'text-letter-spacing': 0.12,
        'text-padding': 4,
      },
      paint: {
        'text-color': '#5f6455',
        'text-opacity': 0.72,
        ...labelHalo(1.5),
      },
    },
    {
      id: 'place-quarter',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'place',
      minzoom: 13.7,
      maxzoom: 16.6,
      filter: ['==', ['get', 'class'], 'quarter'],
      layout: {
        'text-field': nameField,
        'text-font': FONT,
        'text-size': z(13.7, 9.2, 15.5, 10.8),
        'text-letter-spacing': 0.06,
        'text-padding': 3,
      },
      paint: {
        'text-color': '#6a6f60',
        'text-opacity': 0.55,
        ...labelHalo(1.2),
      },
    },
    {
      id: 'place-village',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'place',
      minzoom: 13.6,
      maxzoom: 16.4,
      filter: ['==', ['get', 'class'], 'village'],
      layout: {
        'text-field': nameField,
        'text-font': FONT,
        'text-size': z(13.6, 9.2, 15.5, 10.8),
        'text-letter-spacing': 0.04,
        'text-padding': 3,
      },
      paint: {
        'text-color': '#6f7464',
        'text-opacity': 0.52,
        ...labelHalo(1.2),
      },
    },
    {
      id: 'place-hamlet',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'place',
      minzoom: 15.1,
      maxzoom: 17.2,
      filter: ['==', ['get', 'class'], 'hamlet'],
      layout: {
        'text-field': nameField,
        'text-font': FONT,
        'text-size': z(15.1, 8, 16.5, 9),
        'text-padding': 2,
      },
      paint: {
        'text-color': '#777c6b',
        'text-opacity': 0.45,
        ...labelHalo(1),
      },
    },

    // --- Water labels -----------------------------------------------------
    {
      id: 'waterway-label',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'waterway',
      minzoom: 10.5,
      filter: [
        'all',
        ['match', ['get', 'class'], ['river', 'canal'], true, false],
        ['!=', ['get', 'name'], '西江'],
        hasName,
      ],
      layout: {
        'symbol-placement': 'line',
        'text-field': nameField,
        'text-font': FONT_ITALIC,
        'text-size': z(10.5, 8.5, 13, 11, 15, 12),
        'text-letter-spacing': 0.16,
        'symbol-spacing': 420,
        'text-max-angle': 35,
        'text-padding': 2,
      },
      paint: {
        'text-color': PALETTE.waterInk,
        'text-opacity': 0.66,
        ...labelHalo(1.1),
      },
    },
    {
      id: 'water-name',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'water_name',
      minzoom: 12,
      maxzoom: 17,
      layout: {
        'text-field': nameField,
        'text-font': FONT_ITALIC,
        'text-size': z(12, 9, 14.5, 11.5, 16, 13),
        'text-letter-spacing': 0.1,
        'text-padding': 3,
      },
      paint: {
        'text-color': PALETTE.waterInk,
        'text-opacity': 0.68,
        ...labelHalo(1.2),
      },
    },

    // --- Road labels ------------------------------------------------------
    {
      id: 'road-label-major',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'transportation_name',
      minzoom: 12.1,
      maxzoom: 16.5,
      filter: [
        'all',
        ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], true, false],
        hasName,
      ],
      layout: {
        'symbol-placement': 'line',
        'text-field': nameField,
        'text-font': FONT,
        'text-size': z(12.1, 9, 14, 10.5, 16, 12),
        'text-letter-spacing': 0.02,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'map',
        'symbol-spacing': 320,
        'text-max-angle': 30,
        'text-padding': 3,
      },
      paint: {
        'text-color': '#837c6a',
        'text-opacity': 0.72,
        ...labelHalo(1.2),
      },
    },
    {
      id: 'road-label-minor',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'transportation_name',
      minzoom: 14.8,
      maxzoom: 17.5,
      filter: [
        'all',
        ['match', ['get', 'class'], ['tertiary', 'minor', 'service', 'path'], true, false],
        hasName,
      ],
      layout: {
        'symbol-placement': 'line',
        'text-field': nameField,
        'text-font': FONT,
        'text-size': z(14.8, 8.8, 16.2, 10.2),
        'text-letter-spacing': 0.01,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'map',
        'symbol-spacing': 260,
        'text-max-angle': 30,
        'text-padding': 2,
      },
      paint: {
        'text-color': '#8b8472',
        'text-opacity': 0.52,
        ...labelHalo(1),
      },
    },
    {
      id: 'rail-label',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'transportation_name',
      minzoom: 13.2,
      maxzoom: 17,
      filter: ['all', ['==', ['get', 'class'], 'rail'], hasName],
      layout: {
        'symbol-placement': 'line',
        'text-field': nameField,
        'text-font': FONT_ITALIC,
        'text-size': z(13.2, 8, 15.5, 9.5),
        'text-letter-spacing': 0.1,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'map',
        'symbol-spacing': 400,
      },
      paint: {
        'text-color': '#817a68',
        'text-opacity': 0.55,
        ...labelHalo(1.1),
      },
    },
    {
      id: 'ferry-label',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'transportation_name',
      minzoom: 12.2,
      maxzoom: 17,
      filter: ['all', ['==', ['get', 'class'], 'ferry'], hasName],
      layout: {
        'symbol-placement': 'line',
        'text-field': nameField,
        'text-font': FONT_ITALIC,
        'text-size': z(12.2, 8.5, 15, 10),
        'text-letter-spacing': 0.08,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'map',
        'symbol-spacing': 300,
      },
      paint: {
        'text-color': '#6e929d',
        'text-opacity': 0.65,
        ...labelHalo(1.1),
      },
    },
  ];

  // MapLibre resolves cross-layer label collisions in favour of the later
  // symbol layer. Keep the curated landmark labels (districts, 西江, islands
  // and mountains) above the generic OSM town/village labels so that 鼎湖区 is
  // not swallowed by 坑口街道 at the initial regional zoom.
  // Later symbol layers win collisions in MapLibre, so the district label is
  // deliberately last: it must never be swallowed by 鼎湖山 / 坑口街道.
  const curatedIds = [
    'local-mountain',
    'local-lake',
    'local-island',
    'local-river',
    'local-district',
  ];
  const curatedLayers = curatedIds
    .map((id) => layers.find((layer) => layer.id === id))
    .filter(Boolean);
  const orderedLayers = layers.filter((layer) => !curatedIds.includes(layer.id));
  // Landmark labels are appended after road/water labels: in MapLibre's
  // collision pass later symbol layers take the space.
  orderedLayers.push(...curatedLayers);

  return {
    version: 8,
    name: 'Metro Plan · Duanzhou–Dinghu paper atlas',
    metadata: {
      'metro-plan:region': '端州 · 鼎湖',
      'metro-plan:bounds': '112.32,23.00,112.82,23.26',
      'metro-plan:attribution': '© OpenStreetMap contributors (ODbL)',
    },
    glyphs: GLYPHS,
    sources: {
      osm: {
        type: 'vector',
        url: TILES,
        attribution:
          '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a> · <a href="https://openfreemap.org" target="_blank">OpenFreeMap</a>',
      },
      'terrain-image': {
        type: 'image',
        url: hillshadeUrl,
        coordinates: [
          [112.32, 23.26],
          [112.82, 23.26],
          [112.82, 23.0],
          [112.32, 23.0],
        ],
      },
      'local-labels': {
        type: 'geojson',
        data: localLabels,
        attribution: 'Landmark labels derived from OpenStreetMap data',
      },
    },
    layers: orderedLayers,
  };
}
