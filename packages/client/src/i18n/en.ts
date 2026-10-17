import type { MessageKey } from './tr';

export const en: Record<MessageKey, string> = {
  'doc.title': 'Yılan.io | Free online snake io game',
  'menu.nickPlaceholder': 'Nickname',
  'menu.play': 'Play',
  'menu.lastScore': 'Your last score: {score}',
  'menu.tip.boost': 'Hold the left mouse button or Space to speed up',
  'menu.tip.steer': 'Move the mouse to change direction',
  'menu.tip.avoid': "Don't crash into other snakes' bodies or the arena edge!",
  'menu.tip.cost': 'Speeding up costs you length and score',
  'menu.tip.keys': 'You can also steer with ←/→ or A/D',
  'menu.tip.escape': 'Press Esc during the game to return to the menu',
  'hud.fps': 'FPS',
  'hud.score': 'Score',
  'hud.rank': 'Rank',
  'hud.rankOf': '{rank} of {total}',
  'error.webgl': 'The game could not start. Your browser may not support WebGL.',
};
