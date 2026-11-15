import { createBrowserRouter } from 'react-router';
import App from './App';

// Rotas das 24 telas do protótipo (docs/01-modelagem-produto/1.1-sitemap.md)
export const router = createBrowserRouter([{ path: '/', element: <App /> }]);
