# Make Me YAML!

Make Me YAML! es un editor web para archivos YAML de configuración. Muestra un **menú de inicio** con los archivos según su estructura de carpetas y abre cada uno como un **formulario generado desde su JSON Schema**. Al guardar solo cambian las líneas que tocaste: comentarios, comillas, orden, alineación de comentarios, anclas y saltos de línea del resto del archivo se conservan.

- Servidor: Node ≥ 20, sin framework (`node:http`), 3 dependencias (`yaml`, `ajv`, `ajv-formats`).
- Front end: JavaScript sin build, con Lottie local para animaciones, sin CDN (funciona sin internet después de `npm install`).
- Sin roles, un archivo a la vez, pensado para decenas de archivos.
- Escritorio: Wails v2 con selector nativo de carpeta/manifiesto y motor YAML incluido en el paquete.

## Aplicación de escritorio (Wails)

Al abrir la aplicación aparece **¿Dónde está tu configuración?**. Ninguna carpeta se escanea hasta elegirla o solicitar su revisión.

1. **Elegir carpeta** abre el selector nativo. También puedes pegar una ruta absoluta y pulsar **Revisar carpeta**.
2. El modo automático usa `editor.manifest.yaml` si existe. Si no, descubre los `.yaml` y `.yml` de esa carpeta y sus subcarpetas. El selector **Cómo abrirla** permite pedir descubrimiento sin manifiesto.
3. **Elegir manifiesto…** permite abrir un manifiesto con otro nombre; su carpeta se convierte en la raíz.
4. Revisa el número de archivos encontrados y pulsa **Abrir configuración**. Revisar no escribe archivos ni crea historial. Una carpeta vacía también puede abrirse.

Los manifiestos ilegibles o inválidos muestran un error y deben corregirse o abrirse mediante descubrimiento explícito. En el editor, **Cambiar carpeta** vuelve a la pantalla inicial y pide descartar si hay cambios pendientes. La app recuerda la última carpeta como acceso rápido, y favoritos, recientes y carpetas desplegadas se guardan por raíz. El cierre nativo también protege cambios sin guardar y espera si hay un guardado activo.

### Compilar y ejecutar

Para desarrollo: Node.js **22+**, Go **1.25+**, Wails **2.14.0** y las [dependencias nativas de Wails](https://wails.io/docs/gettingstarted/installation/) para tu sistema.

```bash
npm ci
go install github.com/wailsapp/wails/v2/cmd/wails@v2.14.0
npm run desktop:dev       # aplicación de escritorio en desarrollo
npm run desktop:build     # paquete nativo en build/bin/
```

En macOS se genera `build/bin/Make Me YAML.app`; se puede abrir desde Finder o copiar a Aplicaciones. La compilación verificada en este proyecto es macOS Apple Silicon. La firma generada por Wails es local (ad hoc); distribuirla públicamente para macOS requiere firma Developer ID y notarización.

El paquete incluye la interfaz, Lottie y Node comprimido junto al servicio YAML empaquetado con esbuild. **Quien usa la app no necesita instalar Node, npm ni Go**. Go extrae el motor en un directorio temporal privado, lo ejecuta mediante pipes de entrada/salida y lo retira al cerrar. No se inicia el servidor HTTP del modo web. El motor conserva la misma validación, preservación de formato, control de concurrencia e historial.

Los archivos generados están en `desktop/generated/` y no se versionan. `npm run desktop:prepare` los regenera; también sirve para actualizar los archivos de la interfaz durante `wails dev`. Los comandos `desktop:dev` y `desktop:build` ejecutan esa preparación antes de generar los bindings de Go. Compila en el sistema y arquitectura de destino: el Node incluido corresponde a la máquina de compilación; este flujo no prepara runtimes para compilación cruzada. Las licencias de Node y las dependencias JavaScript se incluyen en `THIRD_PARTY_LICENSES.txt` dentro de los assets del paquete.

## Inicio rápido

```bash
npm install
npm start                       # edita ./examples en http://127.0.0.1:8787
YAML_ROOT=/etc/miapp npm start  # edita tu propia carpeta
```

| Variable | Por defecto | Qué hace |
|---|---|---|
| `YAML_ROOT` | `examples` | Carpeta raíz. Nada fuera de ella es accesible. |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | Dirección de escucha. |
| `EDITOR_USER` / `EDITOR_PASS` | vacío | Activa autenticación Basic. **Obligatoria si `HOST` no es localhost.** |
| `EDITOR_MANIFEST` | `editor.manifest.yaml` | Nombre del manifiesto (dentro de la raíz). |
| `HISTORY_KEEP` | `20` | Copias previas que se guardan por archivo. |
| `MAX_FILE_BYTES` | `1048576` | Tamaño máximo de archivo editable. |

## Línea de comandos

```bash
npm link                                 # instala el comando make-me-yaml (desde este repo)
make-me-yaml                             # edita el directorio actual y abre el navegador
make-me-yaml /etc/miapp --port 9000      # otra carpeta, otro puerto
make-me-yaml . -m otro.manifest.yaml --no-open
```

A diferencia de `npm start`, la carpeta por defecto es el **directorio actual**. Si el puerto 8787 está ocupado se prueban los diez siguientes, salvo que el puerto se haya fijado con `--port` o `PORT`. Las variables de la tabla anterior siguen funcionando, pero las opciones tienen prioridad. Las credenciales (`EDITOR_USER`/`EDITOR_PASS`) solo se aceptan por entorno, para que no queden en el historial de la shell. `make-me-yaml --help` muestra todas las opciones.

## Qué archivos aparecen (modelo híbrido)

El servidor **escanea** la raíz buscando `**/*.yaml` y `**/*.yml`. El **manifiesto** (opcional) enriquece o restringe lo encontrado:

```yaml
# <raíz>/editor.manifest.yaml
include: ["**/*.yaml", "**/*.yml"]
exclude: ["**/secrets/**"]     # se suma a .git, node_modules, *.bak e historial
only_listed: false             # true = solo los de "files"
folders:
  servicios: { title: Servicios, description: Un archivo por servicio }
files:
  servicios/web/nginx.yaml:
    title: Proxy inverso
    description: Puertos, upstreams y TLS
    group: Servicios           # agrupa las tarjetas del menú de inicio
    schema: schemas/otro.json  # opcional, relativo a la raíz
    readonly: false
    restart_required: true
```

Sin manifiesto todo funciona igual: los títulos salen del `title` del schema y los grupos de las carpetas.

## Schema junto a cada YAML

Orden de resolución (el primero que exista gana):

1. `files.<ruta>.schema` del manifiesto.
2. Primera línea del YAML: `# yaml-language-server: $schema=./nginx.schema.json` (compatible con VS Code; solo rutas locales).
3. Archivo hermano: `nginx.yaml` → `nginx.schema.json`.
4. `defaults.schema` del manifiesto.

Sin schema, el archivo se abre **solo en modo YAML** (no se inventa un formulario). Draft-07, 2019-09 y 2020-12; `$ref` locales (`#/…`) y `allOf` se resuelven.

### Extensiones opcionales del schema

| Clave | Efecto |
|---|---|
| `x-secret: true` | El valor **nunca viaja al navegador** (se muestra enmascarado; si no lo cambias se conserva). Desactiva el modo YAML de ese archivo para no exponerlo. |
| `x-restart-required: true` | Tras guardar un cambio en ese campo (o dentro de él) se avisa que hay que recargar el servicio. |
| `x-order: n` | Orden de los campos en el formulario. |
| `x-multiline: true` | Fuerza un área de texto. |

El formulario soporta objetos, listas (añadir, quitar, reordenar), mapas de claves libres (`additionalProperties`), `enum`, booleanos (interruptor), números con `min`/`max`, `format: password`, `oneOf`/`anyOf` (selector de variante), valores por defecto, restaurar por campo, indicador de campos modificados y filtro de campos. Lo que no reconoce (por ejemplo `if/then/else`) se edita como JSON en ese campo.

## Cómo se guarda (por qué es seguro)

1. El formulario envía el estado completo; el **servidor** calcula el diff contra el archivo en disco y aplica solo esas operaciones sobre el árbol del documento (librería `yaml`, modo conservador de comentarios).
2. La **vista previa** y el **guardado** usan exactamente el mismo código, así que el diff que ves es lo que se escribe.
3. Se **verifica** que el texto resultante, vuelto a leer, equivale exactamente a lo que pidió el formulario. Si no, no se escribe nada y se explica por qué (por ejemplo, borrar una clave heredada por `<<`).
4. Se restauran las líneas que el serializador habría normalizado sin motivo (sangrías, columna de los comentarios, comentarios de una clave con hijos).
5. Antes de escribir se valida contra el schema (se puede forzar con «guardar de todos modos» si el archivo ya era inválido).
6. **Concurrencia**: cada lectura incluye el hash SHA-256; si el archivo cambió en disco, el guardado responde 409 y no pisa nada.
7. **Escritura atómica**: temporal en el mismo directorio → `fsync` → `rename`, conservando permisos y propietario. Si el archivo está montado individualmente (Docker), el `rename` falla y se sobrescribe en sitio, avisando en la interfaz. Monta la **carpeta**, no el archivo.
8. **Historial**: copia previa en `<raíz>/.yaml-editor/history/…` antes de cada guardado (últimas `HISTORY_KEEP`) y restauración desde la interfaz.

## API

Todas las rutas aceptan `?path=<ruta relativa>` o `{path}` en el cuerpo. Las peticiones que modifican exigen la cabecera `X-Requested-With: yaml-editor` y un `Origin` coherente (defensa CSRF).

| Ruta | Función |
|---|---|
| `GET /api/files` | Árbol con metadatos y estado (válido, con errores, sin schema…). |
| `GET /api/file?path=` | Datos (secretos enmascarados), schema, hash, avisos. |
| `POST /api/preview` | `{path, baseHash, data \| raw}` → errores, diff, texto resultante. No escribe. |
| `PUT /api/file` | Igual que `preview` y guarda. `allowInvalid: true` ignora errores de schema. |
| `GET /api/history?path=` · `POST /api/restore` | Versiones previas y restauración. |

## Seguridad

- Escucha en `127.0.0.1` por defecto. Para exponerlo: `HOST=0.0.0.0`, `EDITOR_USER`/`EDITOR_PASS` **y TLS delante** (Caddy, nginx, Traefik). Basic sin TLS viaja en claro.
- Solo se abren archivos que pasan `include`/`exclude`/`only_listed` **y** cuya ruta real (tras resolver enlaces simbólicos) sigue dentro de `YAML_ROOT`.
- Cabeceras CSP, `nosniff`, `no-referrer`, `no-store`. Todo el contenido del YAML se pinta con `textContent` (nunca HTML).
- Ejecuta el servicio con un usuario que solo pueda escribir esa carpeta.
- Los secretos `x-secret` no se envían al navegador, pero siguen en claro en el archivo y en las copias del historial.

## Límites conocidos

- Un solo proceso: el bloqueo por archivo es en memoria (si lanzas varias instancias, la comprobación de hash sigue evitando pisarse, pero sin exclusión mutua).
- Conflictos: no hay fusión a tres bandas; ante un 409 se recarga el archivo desde disco.
- Archivos con **varios documentos** (`---`) solo se editan en modo YAML.
- Un archivo que mezcla varios estilos de sangría puede normalizarse al guardar: la vista previa lo muestra y un aviso lo anuncia.
- Quitar elementos de una lista elimina sus comentarios; reordenar elementos mueve los valores, no los comentarios.
- El editor valida con el schema, pero no sabe qué parser usará tu aplicación: valores ambiguos (`yes`, `0123`) se escriben entrecomillados cuando hace falta.

## Pruebas

```bash
npm test                     # API, seguridad, formato, selección de carpetas y comando
npx playwright install chromium && npm run test:e2e   # flujos del editor y animaciones en Chromium real
npm run test:desktop          # pantalla inicial + contrato de bindings, motor real y selectores simulados
npm run desktop:prepare && go test .   # motor incluido: abrir, guardar, historial y limpieza
```

## Marca

- **Logo:** el original está en `brand/logo-original.jpg`. `scripts/generate-brand.sh` (requiere ImageMagick 7) le quita el fondo blanco y genera `public/brand/logo.webp` (interfaz), `public/brand/favicon.png` y `build/appicon.png` (icono de escritorio; Wails crea el `.icns` al compilar). Los resultados se versionan; solo hay que volver a ejecutarlo si cambia el logo.
- **Tipografía:** Bangers para los títulos grandes (clase `.display`) y la marca; Comic Neue (300, 400 y 700) para el resto de la interfaz. Bangers solo tiene mayúsculas, así que no se usa para nombres de archivo. Los valores que se editan usan la fuente del sistema, y el código, la monoespaciada. Las fuentes están en `public/fonts/` con sus licencias OFL, sin depender de internet.
- **Colores:** variables al inicio de `public/style.css`: `--brand-red`, `--brand-yellow`, `--brand-orange` e `--ink`, sacados del logo, y `--accent`, un rojo más oscuro (claro) o más claro (oscuro) para cumplir el contraste WCAG AA. El botón principal es amarillo con contorno y sombra de tinta, como el logo.

## Animaciones Lottie

Se usan animaciones en las cargas de archivos e historial, actualización, validación, guardado, restauración, avisos, favoritos, tarjetas y estados vacíos (incluidos búsquedas y listas del formulario). Los botones y tarjetas reproducen sus iconos al recibir el puntero o el foco del teclado. Las confirmaciones y estados vacíos se reproducen una vez; solo las operaciones pendientes usan bucle.

- Reproductor [`lottie-web`](https://github.com/airbnb/lottie-web) 5.13.0, versión **light**, servido desde `/vendor/lottie-light.min.js`. Se importa bajo demanda y funciona con la CSP existente, sin `eval`, CDN ni peticiones a servicios externos.
- Diez JSON originales en `public/animations/` (unos 14 KB en total), sin fuentes ni imágenes externas. `npm run animations:generate` los regenera junto con el sprite SVG de respaldo a partir de `scripts/generate-animations.mjs`.
- `public/motion.js` centraliza carga, caché y ciclo de vida. Pausa al salir del área visible o al ocultar la pestaña, destruye las instancias retiradas del DOM y respeta cambios en `prefers-reduced-motion` en tiempo real. Con movimiento reducido no descarga el reproductor y conserva iconos estáticos.
- Los iconos son decorativos y los mensajes conservan texto accesible. Los colores siguen el tema claro/oscuro. Si falla la carga de Lottie, el editor sigue funcionando con SVG estáticos.

## Estructura

```
server.js            servidor HTTP, autenticación, rutas
bin/make-me-yaml.js  comando make-me-yaml (argumentos, puerto libre, abrir navegador)
main.go              ventana Wails y assets incluidos
desktop_app.go       selectores nativos, bindings y protección al cerrar
engine.go            ciclo de vida y comunicación con Node incluido
desktop/worker.js    servicio YAML por pipes privados (sin HTTP)
lib/workspace.js     inspección, selección de raíz y aislamiento de sesiones
scripts/prepare-desktop.mjs  empaquetado del motor y los assets
lib/scan.js          rutas seguras y lista blanca
lib/schemas.js       resolución y compilación de schemas, mensajes en español
lib/yamlops.js       diff, aplicación conservadora de cambios, secretos
lib/linediff.js      diff de líneas y restauración de formato
lib/store.js         escritura atómica, historial, exclusión mutua
lib/documents.js     lectura, vista previa y guardado
public/              interfaz (explorer, editor, form, widgets)
public/brand, fonts  logo, favicon y fuentes de la marca
brand/               logo original (fuente de scripts/generate-brand.sh)
examples/            carpeta de muestra con manifiesto, schemas y casos límite
```
