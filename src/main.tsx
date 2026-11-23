import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import {applyInitialTheme} from './context/ThemeContext.tsx';
import './index.css';

applyInitialTheme();

registerSW({
  immediate: true,
});

createRoot(document.getElementById('root')!).render(<App />);
