# VideoSystem

Plataforma autohosteable de mensajeria interna y videollamadas con LiveKit.

## Inicio local

1. Copiar `.env.example` a `.env` y cambiar las claves de LiveKit y credenciales sensibles.
2. Ejecutar `pnpm install`.
3. Ejecutar `docker compose up -d` y esperar a que PostgreSQL figure como `healthy`.
4. En una instalación nueva ejecutar `pnpm db:migrate`; para una base existente creada con `db:push`, marcar primero la baseline con `pnpm exec prisma migrate resolve --applied 0001_initial`.
5. Ejecutar `pnpm db:generate`.
6. Ejecutar `pnpm db:seed` para crear el admin y los usuarios de prueba.
7. Ejecutar `pnpm dev` y abrir http://localhost:3000.
8. Abrir http://localhost:8025 para consultar OTP y correos locales.

En desarrollo, las credenciales son `admin@videosystem.local` / `AdminVideo2026!`, `usuario1@videosystem.local` / `UsuarioUno2026!` y `usuario2@videosystem.local` / `UsuarioDos2026!`.

## Pruebas manuales

- Login: introducir credenciales, comprobar que sin OTP una recarga vuelve al login y que el código usado por segunda vez es rechazado.
- OTP: solicitar dos códigos; el primero debe dejar de funcionar y el segundo debe ser el único válido.
- Rate limiting: superar cinco intentos de login o OTP debe devolver `429`.
- Salas: crear una sala con usuario 1, invitar usuario 2 y comprobar que un usuario no invitado recibe `403`.
- Cámara (creador, usuario e invitado): denegar permisos, tapar la lente o seleccionar una fuente sin imagen y comprobar que no permite entrar. Durante la llamada, tapar la cámara más de cinco segundos o desconectarla debe cerrar la llamada con un aviso; volver a entrar requiere imagen nuevamente. Al salir de la vista, comprobar que se apagan cámara y micrófono.
- Llamada: abrir la misma sala en dos navegadores, verificar video remoto y enviar un mensaje desde la pestaña Chat.
- Reunión: programar una reunión con usuarios activos y comprobar que reciben el correo con enlace en MailHog.
- Invitado externo: desde una sala elegir `Invitar`, ingresar un email sin cuenta, abrir su enlace personal, registrarse con ese mismo email, confirmar el correo y aprobar la cuenta desde Administración. Al completar el OTP debe acceder directamente a la llamada sin ver el dashboard ni el chat.
- Seguridad de invitación: comprobar que otro email no puede usar el token, que el mismo token no permite dos registros y que un simple enlace `?room=` no crea una cuenta `GUEST`.
- Salud: `GET /api/health` debe devolver `200` con PostgreSQL `ok`.
- Backup local: con PostgreSQL cliente instalado, ejecutar `pnpm db:backup` y comprobar un `.sql` nuevo en `backups/`.

## Comprobación de cámara

La aplicación comprueba fotogramas visibles y nuevos antes de entrar, vuelve a comprobarlos tras las esperas de permisos y conexión, y mantiene el control durante la llamada. No basta con aceptar permisos o tener una pista de video activa: se rechazan imágenes negras, uniformes y fuentes que dejan de entregar fotogramas. Una escena quieta con video actualizado sí es válida. La comprobación inicial tiene un máximo de ocho segundos; una vez validada, cinco segundos sin imagen visible provocan la desconexión. Apagar o retirar la cámara también cierra la llamada.

Los píxeles analizados permanecen en el navegador; esta comprobación no sube ni almacena imágenes adicionales al video de la llamada. Es una validación del cliente, no una prueba de presencia humana ni de cámara física: no detecta cámaras virtuales que emiten video válido ni protege contra un cliente modificado. Se necesita iluminación suficiente. En móviles, pasar la aplicación a segundo plano puede detener la cámara y causar la desconexión.

Ejecutar `pnpm test:camera` para las pruebas de regresión en Chrome/Chromium/Edge con video sintético, sin usar una webcam ni necesitar LiveKit o PostgreSQL. Si el navegador no se encuentra automáticamente, configurar `CAMERA_TEST_BROWSER` con su ruta. Las pruebas no sustituyen la comprobación manual con cámaras físicas y dos participantes en LiveKit.

## Estado y limitaciones conocidas

- Las cuentas no son publicas: un admin invita o habilita solicitudes pendientes.
- Las contrasenas se almacenan con bcrypt y las sesiones usan cookies HttpOnly firmadas.
- Las contrasenas deben cambiarse cada 30 dias; una cuenta vencida solo puede acceder al formulario de actualizacion desde Mi perfil.
- Los OTP nuevos se generan con aleatoriedad criptográfica, se almacenan con hash y se consumen una sola vez.
- El rate limiting se persiste en PostgreSQL, por lo que se comparte entre réplicas; conviene vigilar el crecimiento de la tabla y ejecutar la retención periódicamente.
- El chat de llamada se distribuye por LiveKit, pero todavía no se persiste en PostgreSQL.
- Las migraciones nuevas deben versionarse con `prisma migrate`; `db:push` queda reservado para prototipos locales.
- LiveKit corre dentro de la infraestructura propia. `--dev` es solo para desarrollo local.
- Los archivos no se habilitan dentro de llamadas. El módulo de Mensajes tampoco expone adjuntos hasta contar con un almacenamiento y análisis de seguridad dedicado.
- El cifrado E2E de medios es incompatible con grabacion server-side y ciertas funciones de procesamiento. Por eso la grabacion queda desactivada por defecto hasta decidir la politica definitiva.

## Producción

Antes de publicar hay que retirar MailHog, usar HTTPS, no exponer PostgreSQL, configurar backups y revisar las credenciales iniciales. El Compose de producción ejecuta las migraciones antes de la app y mantiene un worker de retención que limpia datos caducados y revoca accesos de invitados expirados.
