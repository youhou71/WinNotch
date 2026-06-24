/**
 * Point d'entrée React. Monte `<App>` dans `#root`.
 *
 * Ordre d'import des CSS volontaire :
 *  1. tokens.css     — variables CSS (couleurs, espacements, spring)
 *  2. reset.css      — base (box-sizing, fonts, body transparent)
 *  3. notch.css      — shell + transitions du notch + sticky search
 *  4. audio.css      — module audio (footer, slider, dropdown)
 *  5. music.css      — module music (chip, card compact, scrubber)
 *  6. dnd.css        — mode Ne pas déranger (chip + banner)
 *  7. toast.css      — notification pill éphémère
 *  8. search.css     — search bar + chip mode + bouton gear
 *  9. tasks.css      — Tasks counter card (gros chiffre 48 px)
 *
 * `StrictMode` est conservé en dev pour détecter les effets non idempotents.
 * Il provoque un double-render mais reste sans effet en production build.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tokens.css';
import './styles/reset.css';
import './styles/notch.css';
import './styles/audio.css';
import './styles/music.css';
import './styles/dnd.css';
import './styles/toast.css';
import './styles/search.css';
import './styles/tasks.css';
import './styles/meetings.css';
import './styles/claude.css';
import './styles/claudeUsage.css';
import './styles/gitlab.css';
import './styles/gitlocal.css';
import './styles/vpn.css';
import './styles/privacy.css';
import './styles/teams.css';
import './styles/system.css';
import './styles/bambu.css';
import './styles/tooltip.css';
import './styles/clipboard.css';
import './styles/settings.css';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
