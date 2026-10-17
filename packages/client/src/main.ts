import './styles/main.css';
import { GameApp } from './app/GameApp';
import { t } from './i18n';

const mount = document.getElementById('game')!;

const app = new GameApp(mount);
// Geliştirme sırasında konsoldan inceleme/profil için
if (import.meta.env.DEV) Object.assign(window, { __yilan: app });

app.start().catch((err: unknown) => {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent = t('error.webgl');
  document.body.appendChild(box);
});
