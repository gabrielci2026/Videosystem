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
- Cámara: bloquear la cámara del navegador y comprobar que la sala no conecta.
- Llamada: abrir la misma sala en dos navegadores, verificar video remoto y enviar un mensaje desde la pestaña Chat.
- Reunión: programar una reunión con usuarios activos y comprobar que reciben el correo con enlace en MailHog.
- Invitado externo: desde una sala elegir `Invitar`, ingresar un email sin cuenta, abrir su enlace personal, registrarse con ese mismo email, confirmar el correo y aprobar la cuenta desde Administración. Al completar el OTP debe acceder directamente a la llamada sin ver el dashboard ni el chat.
- Seguridad de invitación: comprobar que otro email no puede usar el token, que el mismo token no permite dos registros y que un simple enlace `?room=` no crea una cuenta `GUEST`.
- Salud: `GET /api/health` debe devolver `200` con PostgreSQL `ok`.
- Backup local: con PostgreSQL cliente instalado, ejecutar `pnpm db:backup` y comprobar un `.sql` nuevo en `backups/`.

## Estado y limitaciones conocidas

- Las cuentas no son publicas: un admin invita o habilita solicitudes pendientes.
- Las contrasenas se almacenan con bcrypt y las sesiones usan cookies HttpOnly firmadas.
- Los OTP nuevos se generan con aleatoriedad criptográfica, se almacenan con hash y se consumen una sola vez.
- El rate limiting actual vive en memoria del proceso; producción requiere Redis o un almacén compartido.
- El chat de llamada se distribuye por LiveKit, pero todavía no se persiste en PostgreSQL.
- Las migraciones nuevas deben versionarse con `prisma migrate`; `db:push` queda reservado para prototipos locales.
- LiveKit corre dentro de la infraestructura propia. `--dev` es solo para desarrollo local.
- Los archivos no se habilitan dentro de llamadas. El módulo de Mensajes tampoco expone adjuntos hasta contar con un almacenamiento y análisis de seguridad dedicado.
- El cifrado E2E de medios es incompatible con grabacion server-side y ciertas funciones de procesamiento. Por eso la grabacion queda desactivada por defecto hasta decidir la politica definitiva.

## Producción pendiente

Antes de publicar hay que desactivar el modo `--dev` de LiveKit, retirar MailHog, usar HTTPS, no exponer PostgreSQL, configurar backups, añadir un rate limiter compartido, versionar migraciones Prisma y ejecutar un worker de retención.
