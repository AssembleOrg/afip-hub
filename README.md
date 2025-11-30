# AFIP Hub - SaaS Application

Aplicación SaaS para integración con servicios de AFIP (Administración Federal de Ingresos Públicos) de Argentina.

## Características

- ✅ Arquitectura limpia (Clean Architecture)
- ✅ PostgreSQL con Prisma ORM
- ✅ Autenticación JWT (solo login, sin registro)
- ✅ Roles: Admin y Subadmin
- ✅ Interceptores de auditoría y respuesta
- ✅ Swagger con protección por contraseña en producción
- ✅ Soft deletes y timestamps en GMT-3 (Buenos Aires)
- ✅ Integración con AFIP vía SOAP/XML
- ✅ CORS habilitado
- ✅ Validación de datos con class-validator
- ✅ Transformación de datos con class-transformer

## Requisitos Previos

- Node.js >= 18
- PostgreSQL >= 14
- pnpm >= 8

## Instalación

1. Clonar el repositorio
2. Instalar dependencias:
```bash
pnpm install
```

3. Configurar variables de entorno:
```bash
cp .env.example .env
```

Editar `.env` con tus configuraciones:
- `DATABASE_URL`: URL de conexión a PostgreSQL
- `JWT_SECRET`: Clave secreta para JWT
- `AFIP_CERT_PATH`: Ruta al certificado de AFIP
- `AFIP_KEY_PATH`: Ruta a la clave privada de AFIP
- `AFIP_CUIT`: CUIT del contribuyente

4. Generar cliente de Prisma:
```bash
pnpm prisma:generate
```

**Nota**: Prisma 7 requiere usar un adapter. El proyecto ya está configurado con `@prisma/adapter-pg` para PostgreSQL.

5. Ejecutar migraciones:
```bash
pnpm prisma:migrate
```

6. Ejecutar seed (crea usuarios admin y subadmin):
```bash
pnpm prisma:seed
```

**Importante**: El cliente de Prisma se genera en `generated/prisma`. Este directorio está en `.gitignore` y debe regenerarse después de cada `git clone` con `pnpm prisma:generate`.

## Scripts Disponibles

```bash
# Desarrollo
pnpm start:dev

# Producción
pnpm build
pnpm start:prod

# Prisma
pnpm prisma:generate      # Generar cliente Prisma
pnpm prisma:migrate       # Crear y aplicar migraciones
pnpm prisma:studio        # Abrir Prisma Studio
pnpm prisma:seed          # Ejecutar seed

# Testing
pnpm test
pnpm test:e2e
pnpm test:cov
```

## Estructura del Proyecto

```
src/
├── common/           # Código compartido
│   ├── decorators/   # Decoradores (@Public, @Auditory)
│   ├── dto/          # DTOs comunes (Response, Pagination)
│   ├── filters/      # Filtros de excepciones
│   ├── guards/       # Guards (JWT)
│   ├── interceptors/ # Interceptores (Response, Audit)
│   └── utils/        # Utilidades
├── config/           # Configuración
├── database/          # Servicio de Prisma
├── modules/           # Módulos de la aplicación
│   ├── auth/         # Autenticación
│   └── afip/         # Integración con AFIP
└── main.ts           # Punto de entrada
```

## Endpoints

### Autenticación

- `POST /api/auth/login` - Iniciar sesión (público)

### AFIP

- `POST /api/afip/login` - Obtener ticket de acceso de AFIP (requiere autenticación)

## Documentación Swagger

En desarrollo: `http://localhost:3000/api/docs`

En producción: Requiere autenticación básica (usuario: `admin`, contraseña: configurada en `SWAGGER_PASSWORD`)

## Formato de Respuestas

### Respuesta Exitosa (sin paginación)
```json
{
  "data": {...},
  "success": true,
  "message": "Operación exitosa",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Respuesta con Paginación
```json
{
  "data": [...],
  "success": true,
  "message": "Operación exitosa",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

## Integración con AFIP

La integración con AFIP utiliza el servicio WSAA (Web Service de Autenticación y Autorización) para obtener tickets de acceso.

**Nota importante**: La implementación actual del servicio AFIP es una estructura base. Para producción, necesitarás:

1. Implementar correctamente la firma CMS (Cryptographic Message Syntax) usando una librería como `node-forge` o `pkcs7`
2. Configurar correctamente los certificados de AFIP
3. Manejar adecuadamente los diferentes ambientes (homologación y producción)

## Usuarios por Defecto

Después de ejecutar el seed:

- **Admin**: `admin@afip-hub.com` / `Admin123!`
- **Subadmin**: `subadmin@afip-hub.com` / `Subadmin123!`

Puedes cambiar estos valores en el archivo `.env` antes de ejecutar el seed.

## Notas de Desarrollo

- Todos los errores se devuelven en español
- Los timestamps se manejan en GMT-3 (Buenos Aires) usando Luxon
- El decorador `@Public()` marca rutas que no requieren autenticación
- El decorador `@Auditory()` registra operaciones para auditoría
- Todas las respuestas pasan por el `ResponseInterceptor` para mantener formato consistente

## Licencia

UNLICENSED
