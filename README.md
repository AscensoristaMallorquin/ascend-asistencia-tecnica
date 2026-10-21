# Ascend · asistente de búsqueda de manuales de ascensores

Ascend permite iniciar sesión con Google, consultar una biblioteca privada y buscar códigos o términos en manuales seleccionados. Esta versión no usa IA generativa ni la API de OpenAI: busca términos y muestra documentos. No explica ni confirma el significado de un código.

## Arquitectura pública y cuotas gratuitas

- **GitHub** guarda el código fuente. La web debe conectarse a **Cloudflare Pages** para publicarse; GitHub Pages por sí solo no ejecuta el backend privado.
- **Cloudflare Pages Functions** ejecuta el backend en `/functions/api/[[path]].js`.
- **Firebase Authentication** inicia sesión con Google y confirma el token de identidad.
- **Cloudflare D1** guarda cuentas y permisos.
- **Cloudflare R2** guarda copias privadas de manuales. Los archivos no se incluyen en GitHub ni se sirven con enlaces públicos.
- Una cuenta de servicio de Google, con acceso de solo lectura a una carpeta dedicada de Drive, permite elegir y copiar manuales.

Los límites gratuitos que Cloudflare publica actualmente incluyen 100.000 solicitudes Worker al día, 5 millones de filas leídas y 100.000 escritas al día en D1, y 10 GB-mes más 1 millón de operaciones de escritura y 10 millones de lectura al mes en R2. Al alcanzar los límites, las solicitudes o consultas pueden fallar hasta que se restablezcan las cuotas. El exceso de almacenamiento u otros usos puede tener coste; revisa la facturación y las cuotas en Cloudflare. [Workers](https://developers.cloudflare.com/workers/platform/limits/) · [D1](https://developers.cloudflare.com/d1/platform/pricing/) · [R2](https://developers.cloudflare.com/r2/pricing/)

## Preparación para publicar

El repositorio público ya está creado en GitHub. El sitio aún no está desplegado en Cloudflare y faltan configurar las cuentas de Cloudflare y Google. Inicia sesión allí tú cuando se te solicite; nunca pegues contraseñas o claves en el chat.

1. **Subir el backend y el esquema** al repositorio público existente. No incluyas `.env`, `.ascend-state.json`, claves privadas, credenciales descargadas ni manuales. `.gitignore` ya excluye los archivos locales sensibles.
2. **Crear recursos en Cloudflare:** crea una base de datos D1 llamada `ascend` y pega el contenido de `cloudflare/schema.sql` en su consola SQL; crea un bucket R2 llamado `ascend-manuals`.
3. **Conectar Pages con GitHub:** en Cloudflare, crea una aplicación Pages conectada al repositorio. Para una web HTML sin compilación, usa el directorio raíz como carpeta de salida. Añade bindings en la configuración de Pages Functions: D1 con variable `DB` hacia `ascend`, y R2 con variable `FILES` hacia `ascend-manuals`.
4. En **Settings → Variables and Secrets** de Pages Functions, configura:
   - `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`: datos públicos de la app web Ascend que aparece en Firebase Console → configuración del proyecto → Tus apps. `FIREBASE_PROJECT_ID` debe ser `ascend-ai-512314`.
   - `ASCEND_ADMIN_EMAIL`: el correo de Google que utilizarás como cuenta administradora.
   - `GOOGLE_DRIVE_FOLDER_ID`: el ID de la carpeta exclusiva de manuales, que se ve en la URL de Drive después de `/folders/`.
   - Secretos `GOOGLE_SERVICE_ACCOUNT_EMAIL` y `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`: correo de una cuenta de servicio y su clave privada JSON. Marca la clave como secreta. No uses ni compartas una clave OAuth personal.
5. En Google Cloud, verifica que Drive API esté habilitada. Crea una cuenta de servicio, genera una clave JSON y comparte **solo la carpeta dedicada** de Drive con el correo de servicio como lector. Mantén esa carpeta para los manuales autorizados.
6. Tras el primer despliegue, copia el dominio exacto que termina en `.pages.dev`. En Firebase Authentication → Configuración → Dominios autorizados, añade ese dominio sin `https://` ni ruta.
7. Inicia sesión con la cuenta administradora. La cuenta administradora puede elegir y publicar manuales y gestionar permisos de lectura y descarga.

Los nombres de los recursos y variables deben coincidir exactamente. Cloudflare puede cambiar las pantallas; si algo no aparece, no compartas una clave para resolverlo: describe la pantalla y te guío paso a paso.

## Seguridad y límites funcionales

- Los usuarios sin aprobación no pueden consultar la biblioteca. La lectura y descarga se comprueban en el backend en cada solicitud.
- La búsqueda consulta Drive solo dentro de la carpeta configurada y únicamente muestra archivos que la administradora publicó en la biblioteca privada.
- La importación permite PDF, Word, texto y Documentos de Google exportados a PDF, hasta 40 MB por archivo.
- La aplicación no analiza páginas ni extrae citas. Verifica siempre el modelo, revisión, página y procedimientos en el manual original y en la documentación oficial aplicable. No uses el buscador para decidir maniobras de riesgo o rescate.

## Desarrollo local anterior

`start.ps1` conserva el servidor Python local anterior. El despliegue público nuevo usa Cloudflare Pages Functions y los bindings descritos arriba; el servidor local no sustituye esas conexiones.
