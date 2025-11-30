# Ejemplos de Uso - Autenticación AFIP

## ¿Qué hace `getTicket()`?

La función `getTicket()` obtiene un **Ticket de Acceso (TA)** de AFIP que te permite autenticarte con los servicios web de AFIP. Este ticket es necesario para hacer llamadas a los diferentes servicios de AFIP.

### Flujo del proceso:

1. **Crea un TRA** (Ticket de Requerimiento de Acceso) - Un XML con tu solicitud
2. **Firma el TRA** - Lo firmas con tu certificado digital de AFIP
3. **Envía al WSAA** - Envías el TRA firmado al Web Service de Autenticación y Autorización
4. **Recibes el TA** - AFIP te devuelve un Ticket de Acceso válido por 12 horas

## Servicios de AFIP disponibles

Los servicios más comunes son:

- `wsfe` - Web Service de Facturación Electrónica
- `wsfev1` - Web Service de Facturación Electrónica v1
- `wsmtxca` - Web Service de Facturación Electrónica MTX
- `wsaa` - Web Service de Autenticación y Autorización (este mismo)
- `wsfex` - Web Service de Facturación de Exportación
- `wsbfe` - Web Service de Facturación Básica

## Ejemplos de Uso

### 1. Ejemplo con cURL

```bash
# Obtener ticket para Facturación Electrónica
curl -X POST http://localhost:3000/api/afip/login \
  -H "Content-Type: application/json" \
  -d '{
    "cuit": "20123456789",
    "service": "wsfe"
  }'
```

**Respuesta:**
```json
{
  "data": {
    "token": "PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pg0K...",
    "sign": "abc123def456...",
    "expirationTime": "2024-11-27T07:30:00.000Z",
    "generationTime": "2024-11-26T19:30:00.000Z"
  },
  "success": true,
  "message": "Ticket obtenido exitosamente",
  "timestamp": "2024-11-26T19:30:00.000Z"
}
```

### 2. Ejemplo con JavaScript/TypeScript

```typescript
// Obtener ticket para Facturación Electrónica
const response = await fetch('http://localhost:3000/api/afip/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    cuit: '20123456789',
    service: 'wsfe'
  })
});

const result = await response.json();
console.log('Ticket:', result.data);
console.log('Token:', result.data.token);
console.log('Expira en:', result.data.expirationTime);
```

### 3. Ejemplo con Axios

```typescript
import axios from 'axios';

async function obtenerTicketAFIP() {
  try {
    const response = await axios.post('http://localhost:3000/api/afip/login', {
      cuit: '20123456789',
      service: 'wsfe' // Facturación Electrónica
    });
    
    const ticket = response.data.data;
    
    console.log('✅ Ticket obtenido exitosamente');
    console.log('Token:', ticket.token);
    console.log('Firma:', ticket.sign);
    console.log('Válido hasta:', ticket.expirationTime);
    
    return ticket;
  } catch (error) {
    console.error('❌ Error al obtener ticket:', error.response?.data);
    throw error;
  }
}

// Usar el ticket para llamar a otros servicios de AFIP
async function facturarConAFIP(ticket) {
  // Aquí usarías el ticket.token y ticket.sign para autenticarte
  // en otros servicios de AFIP como wsfe
}
```

### 4. Ejemplo completo: Obtener ticket y usarlo

```typescript
// Paso 1: Obtener el ticket
const ticketResponse = await fetch('http://localhost:3000/api/afip/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    cuit: '20123456789',
    service: 'wsfe'
  })
});

const { data: ticket } = await ticketResponse.json();

// Paso 2: Verificar que el ticket no haya expirado
const expirationDate = new Date(ticket.expirationTime);
const now = new Date();

if (expirationDate <= now) {
  throw new Error('El ticket ha expirado');
}

// Paso 3: Usar el ticket para autenticarte en otros servicios
// El token y sign se incluyen en los headers SOAP de las llamadas a AFIP
console.log('Ticket válido hasta:', ticket.expirationTime);
console.log('Token para usar:', ticket.token);
```

### 5. Ejemplos para diferentes servicios

```typescript
// Facturación Electrónica
const ticketFE = await obtenerTicket('wsfe');

// Facturación de Exportación
const ticketFEX = await obtenerTicket('wsfex');

// Facturación Básica
const ticketBFE = await obtenerTicket('wsbfe');

async function obtenerTicket(servicio: string) {
  const response = await fetch('http://localhost:3000/api/afip/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cuit: '20123456789',
      service: servicio
    })
  });
  return response.json();
}
```

## Notas Importantes

1. **El CUIT en el DTO**: Actualmente el campo `cuit` se recibe pero no se usa en la implementación. El CUIT real se toma de la configuración (`AFIP_CUIT` en `.env`).

2. **Validez del ticket**: Los tickets expiran después de 12 horas. Debes guardarlos y reutilizarlos hasta que expiren.

3. **Certificados**: Necesitas tener los certificados de AFIP configurados:
   - `AFIP_CERT_PATH`: Ruta al certificado (.crt)
   - `AFIP_KEY_PATH`: Ruta a la clave privada (.key)

4. **Ambientes**:
   - **Homologación**: `https://wsaahomo.afip.gov.ar/ws/services/LoginCms`
   - **Producción**: `https://wsaa.afip.gov.ar/ws/services/LoginCms`

## Uso del ticket obtenido

Una vez que tienes el ticket, lo usas así en las llamadas SOAP a otros servicios de AFIP:

```xml
<soap:Header>
  <Auth>
    <Token>TU_TOKEN_AQUI</Token>
    <Sign>TU_SIGN_AQUI</Sign>
    <Cuit>20123456789</Cuit>
  </Auth>
</soap:Header>
```

El token y sign del ticket se incluyen en los headers SOAP de cada llamada a los servicios de AFIP.

