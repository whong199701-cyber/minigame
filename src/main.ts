import './styles/base.css';
import { startApp } from './app/shell';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

const app = document.getElementById('app');
if (app) startApp(app);
