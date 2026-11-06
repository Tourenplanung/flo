import type { IconName } from '../schema';

/** flö icon names → lucide-react export names (same set the editor renders). */
const MAP: Record<IconName, string> = {
  'arrow-right': 'ArrowRight',
  'arrow-left': 'ArrowLeft',
  'arrow-up-right': 'ArrowUpRight',
  check: 'Check',
  x: 'X',
  plus: 'Plus',
  minus: 'Minus',
  menu: 'Menu',
  search: 'Search',
  user: 'User',
  users: 'Users',
  home: 'Home',
  settings: 'Settings',
  bell: 'Bell',
  mail: 'Mail',
  phone: 'Phone',
  calendar: 'Calendar',
  clock: 'Clock',
  heart: 'Heart',
  star: 'Star',
  bookmark: 'Bookmark',
  share: 'Share2',
  download: 'Download',
  upload: 'Upload',
  image: 'Image',
  camera: 'Camera',
  play: 'Play',
  'shopping-cart': 'ShoppingCart',
  'credit-card': 'CreditCard',
  lock: 'Lock',
  globe: 'Globe',
  'map-pin': 'MapPin',
  car: 'Car',
  'chevron-down': 'ChevronDown',
  'chevron-right': 'ChevronRight',
  info: 'Info',
  'alert-triangle': 'AlertTriangle',
  sparkles: 'Sparkles',
  zap: 'Zap',
  layout: 'LayoutGrid',
};

export function lucideName(icon: IconName): string {
  return MAP[icon];
}
