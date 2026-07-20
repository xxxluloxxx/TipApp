import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import './assets/main.css'
// Hoja de estilos base de vue-sonner (posición fija, z-index, layout,
// animaciones de entrada/salida y swipe-to-dismiss). Sin este import el
// toast se renderiza como HTML sin estilar dentro del flujo normal del
// documento, en vez de flotar fijo sobre el resto de la app.
import 'vue-sonner/style.css'

import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
