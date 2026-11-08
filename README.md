# TomasRamirezDev — sitio web y panel

Sitio de [tomasramirezdev.com](https://tomasramirezdev.com): páginas web para inmobiliarias.

| Carpeta | Qué hay |
|---|---|
| `tomasramirezdev-sitio/sitio/` | Sitio estático publicado: landing, Modelo 1 (Clásico) y Modelo 2 (Moderno). Es lo que va en `/var/www/tomasramirezdev`. |
| `backend/` | Panel de administración y API (Node.js + Fastify + PostgreSQL): newsletters, mensajes del formulario, usuarios, roles, permisos y estadísticas con Umami. Ver [`backend/README.md`](backend/README.md). |
| `Logo y recursos/` | Logo y fotos generadas con IA usadas en los ejemplos. |
| `Tarjetas/` | Tarjetas personales para imprenta (PDF). |

## Instalar o actualizar en el VPS

```bash
# en el servidor, con el paquete descomprimido
bash backend/deploy/install.sh          # panel + sitio + nginx + copias de seguridad
bash backend/deploy/install-umami.sh    # estadísticas en estadisticas.tomasramirezdev.com
```

Las claves (`.env`) se generan en el servidor y nunca se suben a este repositorio.
