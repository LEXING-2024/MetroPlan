import {
  CIVIC_POI_CLASSES,
  ICON_EXPRESSION,
  MINOR_POI_CLASSES,
  POI_PRIORITY,
  SCHOOL_POI_CLASSES,
} from './poi.js';

const nameField = ['coalesce', ['get', 'name:zh'], ['get', 'name'], ['get', 'name:en']];
const hasName = ['all', ['has', 'name'], ['!=', ['get', 'name'], '']];
const HAZE = {
  'text-halo-color': 'rgba(248, 244, 234, 0.96)',
  'text-halo-width': 1.45,
  'text-halo-blur': 0.15,
};

export const POI_LAYER_IDS = [
  'poi-civic-icon',
  'poi-civic-label',
  'poi-school-icon',
  'poi-school-label',
  'poi-minor-icon',
  'poi-minor-label',
];

const base = {
  type: 'symbol',
  source: 'osm',
  'source-layer': 'poi',
};

const civicFilter = ['all', ['match', ['get', 'class'], CIVIC_POI_CLASSES, true, false], hasName];
const schoolFilter = ['all', ['match', ['get', 'class'], SCHOOL_POI_CLASSES, true, false], hasName];
const minorFilter = ['all', ['match', ['get', 'class'], MINOR_POI_CLASSES, true, false], hasName];

const iconLayout = (sizeStops) => ({
  'icon-image': ICON_EXPRESSION,
  'icon-size': ['interpolate', ['linear'], ['zoom'], ...sizeStops],
  'icon-allow-overlap': false,
  'icon-ignore-placement': false,
  'icon-padding': 2,
  'symbol-sort-key': POI_PRIORITY,
});

const label = (id, minzoom, sizeStops, filter, offset = 1.75) => ({
  ...base,
  id,
  minzoom,
  filter,
  layout: {
    'text-field': nameField,
    'text-font': ['Noto Sans Regular'],
    'text-size': ['interpolate', ['linear'], ['zoom'], ...sizeStops],
    'text-anchor': 'top',
    'text-offset': [0, offset],
    'text-max-width': 7,
    'text-line-height': 1.06,
    'text-letter-spacing': 0.008,
    'text-optional': true,
    'text-padding': 3,
    'text-allow-overlap': false,
    'text-ignore-placement': false,
    'symbol-sort-key': POI_PRIORITY,
  },
  paint: {
    'text-color': '#4c5145',
    'text-opacity': 0.92,
    ...HAZE,
  },
});

export function buildPoiLayers() {
  return [
    {
      ...base,
      id: 'poi-civic-icon',
      minzoom: 13.4,
      filter: civicFilter,
      layout: iconLayout([13.4, 0.43, 15, 0.56, 17, 0.7, 18, 0.78]),
    },
    label('poi-civic-label', 14.9, [14.9, 10, 16, 11.4, 18, 13], civicFilter, 1.85),
    {
      ...base,
      id: 'poi-school-icon',
      minzoom: 14.25,
      filter: schoolFilter,
      layout: iconLayout([14.25, 0.36, 16, 0.52, 18, 0.66]),
    },
    label('poi-school-label', 15.55, [15.55, 9.2, 17, 10.4, 18, 11.6], schoolFilter, 1.7),
    {
      ...base,
      id: 'poi-minor-icon',
      minzoom: 15.15,
      filter: minorFilter,
      layout: iconLayout([15.15, 0.33, 17, 0.47, 18, 0.56]),
    },
    label('poi-minor-label', 16.1, [16.1, 8.4, 17.5, 9.6], minorFilter, 1.55),
  ];
}
