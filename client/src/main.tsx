import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// Sin StrictMode: su doble-montaje en dev rompía el join de la sala de video
// (Daily expulsa la sesión duplicada → "llamada finalizada"). No afecta producción.
createRoot(document.getElementById('root')!).render(<App />);
