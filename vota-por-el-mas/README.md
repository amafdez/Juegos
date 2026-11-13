# Vota por el más

Juego de votación para celular. Una sala con código de 4 letras, cada persona entra desde su teléfono, aparece una pregunta ("¿Quién...?") con 2 o 4 nombres y todas votan. Algunas rondas son privadas (solo conteo) y otras públicas (se ve quién votó por quién). Las parejas y los grupos rotan solos.

Hecho con tu design system "Juego". Sin build, sin servidor propio: HTML + JS, Firebase Realtime Database para sincronizar y GitHub Pages para publicarlo, todo gratis.

## Cómo se juega

1. Una persona (el host) crea la sala y comparte el código.
2. Las demás entran con su nombre y el código (2 a 12 personas).
3. El host elige rondas (5 a 30), candidatos por ronda (2, 4 o mezcla), tiempo por ronda (10, 15, 20, 30 segundos o sin tiempo; 15 por defecto) y categorías (Solo chicas, Fiesta, Primos).
4. Cada ronda termina cuando votan todas o se acaba el tiempo, lo que pase primero. El host también puede tocar "Mostrar resultados" antes. Después toca "Siguiente".
5. Si quieren parar antes, el host toca "Terminar partida" (dos toques para confirmar). El podio cuenta solo las rondas ya jugadas y las preguntas que no salieron quedan disponibles para otra partida.
6. Al final: podio de "más votado" con votos recibidos y rondas ganadas. "Jugar otra vez" vuelve a la sala con las mismas personas.

Las preguntas que ya salieron no se repiten en partidas siguientes. Cuando se agota una categoría, el historial de esa categoría se reinicia solo.

## Puesta en marcha

### 1. Probar sin Firebase (opcional)

Con `firebase-config.js` sin tocar, el juego corre en modo demo: solo sirve entre pestañas del mismo navegador. Sirve para ver cómo se ve.

```
python3 -m http.server 8000
```

y abre `http://localhost:8000`. No funciona abriendo el archivo con doble clic (los módulos JS necesitan http).

### 2. Crear el proyecto de Firebase

1. Entra a https://console.firebase.google.com con tu cuenta de Google y toca "Crear un proyecto". Ponle un nombre (por ejemplo `vota-por-el-mas`). Desactiva Google Analytics. Crear.
2. En el menú izquierdo: Compilación, Realtime Database, "Crear base de datos". Ubicación: la que ofrezca por defecto (Estados Unidos). Modo: "bloqueado". Habilitar.
3. Pestaña "Reglas". Borra lo que haya, pega el contenido de `database.rules.json` y toca "Publicar".

### 3. Conectar el juego

1. Engranaje junto a "Descripción general", "Configuración del proyecto". Baja hasta "Tus apps" y toca el ícono web `</>`. Ponle un nombre, sin Hosting, "Registrar app".
2. Te muestra un bloque `firebaseConfig`. Copia `apiKey`, `authDomain`, `projectId` y `appId`.
3. `databaseURL`: si no aparece en ese bloque, vuelve a Realtime Database, pestaña "Datos", y copia la URL que sale arriba (termina en `firebasedatabase.app`).
4. Pega los cinco valores en `firebase-config.js`. La `apiKey` de Firebase no es secreta, puede quedar en un repo público.

### 4. Publicar en GitHub Pages

1. Sube esta carpeta a tu repositorio (por ejemplo en `vota-por-el-mas/` dentro del sitio de juegos). Todas las rutas son relativas, así que funciona en cualquier subcarpeta.
2. En el repo: Settings, Pages, "Deploy from a branch", rama `main`, carpeta `/ (root)`. Guardar.
3. En uno o dos minutos queda en `https://TU-USUARIO.github.io/TU-REPO/vota-por-el-mas/`. Ese es el link que compartes.

GitHub Pages gratis pide que el repositorio sea público. El link del juego se comparte por separado y nadie necesita el del repo.

## Agregar o cambiar preguntas

Edita `js/questions.js`: cada categoría es una lista de textos. Reglas que usé: empiezan con "¿Quién", sin signos de exclamación, sin emojis, y en Primos nada sexual. Puedes correr los chequeos con:

```
node --test tests/logic.test.mjs
```

Para reiniciar el historial de "ya jugadas" a mano: Realtime Database, pestaña "Datos", borra el nodo `seen`.

## Cosas a saber

- El host maneja el ritmo. Con tiempo activado, si el host se desconecta, cualquiera de las demás hace avanzar los resultados unos 4 segundos después de que se acabe el tiempo. Sin tiempo, la partida espera al host (la sesión se recupera sola al volver a abrir el link).
- El reloj usa la hora del servidor de Firebase, así que marca lo mismo en todos los teléfonos aunque tengan la hora mal puesta.
- Quien se sale en medio de una partida puede volver entrando con el mismo nombre.
- Las reglas de la base de datos son abiertas para `rooms` y `seen`: cualquiera que tenga el código de una sala puede jugar en ella. Para un juego entre amigas alcanza. Si lo quieres más cerrado, hay que sumar autenticación anónima de Firebase.
- Solo está el peso Bold de Astrid Grotesk en los archivos del design system, así que todo el texto sale en Bold. Si agregas los demás pesos a `fonts/`, declara un `@font-face` por cada uno al inicio de `css/game.css`.
