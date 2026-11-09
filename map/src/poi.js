/** Shared POI taxonomy for icons, labels and the click card. */
export const POI_KINDS = {
  hospital: { label: '医疗', glyph: '医', color: '#b97777' },
  school: { label: '学校', glyph: '学', color: '#b08a45' },
  park: { label: '公园', glyph: '园', color: '#6f8f68' },
  attraction: { label: '景点', glyph: '景', color: '#8a7660' },
  culture: { label: '文化', glyph: '馆', color: '#7a6ba8' },
  worship: { label: '祠庙', glyph: '祠', color: '#957c63' },
  food: { label: '餐饮', glyph: '食', color: '#a56b50' },
  cafe: { label: '咖啡', glyph: '咖', color: '#92715a' },
  shop: { label: '商店', glyph: '购', color: '#8b7357' },
  hotel: { label: '住宿', glyph: '宿', color: '#7b7f91' },
  ferry: { label: '渡口', glyph: '渡', color: '#5f8492' },
  transit: { label: '交通', glyph: '站', color: '#54748c' },
  default: { label: '设施', glyph: '·', color: '#7b7f70' },
};

export function poiKind(props = {}) {
  const cls = props.class;
  const sub = props.subclass;
  if (['hospital', 'clinic', 'doctors', 'dentist'].includes(cls) || ['hospital', 'clinic'].includes(sub)) {
    return 'hospital';
  }
  if (['school', 'college', 'university', 'kindergarten'].includes(cls)) return 'school';
  if (['park', 'garden', 'nature_reserve'].includes(cls)) return 'park';
  if (['attraction', 'viewpoint', 'artwork', 'monument', 'castle', 'ruins'].includes(cls)) {
    return 'attraction';
  }
  if (['museum', 'gallery', 'library', 'theatre', 'cinema'].includes(cls)) return 'culture';
  if (cls === 'place_of_worship' || sub === 'place_of_worship') return 'worship';
  if (cls === 'restaurant' || cls === 'fast_food') return 'food';
  if (cls === 'cafe') return 'cafe';
  if (cls === 'shop') return 'shop';
  if (['hotel', 'hostel', 'guest_house', 'motel'].includes(cls)) return 'hotel';
  if (cls === 'ferry_terminal') return 'ferry';
  if (['railway', 'aerodrome', 'bus'].includes(cls)) return 'transit';
  return 'default';
}

/** Icon-image expression used by the two POI symbol layers. */
export const ICON_EXPRESSION = [
  'match',
  ['get', 'class'],
  ['hospital', 'clinic', 'doctors', 'dentist'],
  'poi-hospital',
  ['school', 'college', 'university', 'kindergarten'],
  'poi-school',
  ['park', 'garden', 'nature_reserve'],
  'poi-park',
  ['attraction', 'viewpoint', 'artwork', 'monument', 'castle', 'ruins'],
  'poi-attraction',
  ['museum', 'gallery', 'library', 'theatre', 'cinema'],
  'poi-culture',
  ['place_of_worship'],
  'poi-worship',
  ['restaurant', 'fast_food'],
  'poi-food',
  ['cafe'],
  'poi-cafe',
  ['shop'],
  'poi-shop',
  ['hotel', 'hostel', 'guest_house', 'motel'],
  'poi-hotel',
  ['ferry_terminal'],
  'poi-ferry',
  ['railway', 'aerodrome', 'bus'],
  'poi-transit',
  'poi-default',
];

export const POI_PRIORITY = [
  'match',
  ['get', 'class'],
  ['hospital', 'clinic', 'doctors', 'dentist'],
  0,
  ['railway', 'ferry_terminal', 'aerodrome'],
  1,
  ['school', 'college', 'university', 'kindergarten'],
  2,
  ['park', 'garden', 'nature_reserve'],
  3,
  ['attraction', 'museum', 'gallery', 'library'],
  4,
  ['restaurant', 'fast_food', 'cafe'],
  7,
  ['shop', 'hotel', 'hostel', 'guest_house', 'motel'],
  8,
  9,
];

export const CIVIC_POI_CLASSES = [
  'hospital',
  'clinic',
  'doctors',
  'dentist',
  'park',
  'garden',
  'nature_reserve',
  'attraction',
  'viewpoint',
  'artwork',
  'monument',
  'castle',
  'ruins',
  'museum',
  'gallery',
  'library',
  'theatre',
  'cinema',
  'ferry_terminal',
  'railway',
  'aerodrome',
];

export const SCHOOL_POI_CLASSES = ['school', 'college', 'university', 'kindergarten'];

/** All non-food / non-shop facilities; used for the POI toggle and docs. */
export const CORE_POI_CLASSES = [...CIVIC_POI_CLASSES, ...SCHOOL_POI_CLASSES];

export const MINOR_POI_CLASSES = [
  'restaurant',
  'fast_food',
  'cafe',
  'shop',
  'hotel',
  'hostel',
  'guest_house',
  'motel',
  'place_of_worship',
];
