/**
 * Ejemplo de uso del servicio AFIP para obtener tickets de acceso
 * 
 * Este archivo muestra cómo usar la API para obtener tickets de AFIP
 * y cómo usarlos posteriormente.
 */

// Ejemplo 1: Obtener ticket usando fetch (JavaScript nativo)
async function ejemplo1_ObtenerTicketConFetch() {
  console.log('=== Ejemplo 1: Obtener ticket con fetch ===\n');

  try {
    const response = await fetch('http://localhost:3000/api/afip/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cuit: '20123456789', // Tu CUIT
        service: 'wsfe',      // Servicio: Facturación Electrónica
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      const ticket = result.data;
      console.log('✅ Ticket obtenido exitosamente');
      console.log('Token:', ticket.token.substring(0, 50) + '...');
      console.log('Sign:', ticket.sign.substring(0, 50) + '...');
      console.log('Generado:', ticket.generationTime);
      console.log('Expira:', ticket.expirationTime);
      console.log('Válido por:', calcularTiempoRestante(ticket.expirationTime));
    } else {
      console.error('❌ Error:', result.message);
    }
  } catch (error) {
    console.error('❌ Error al obtener ticket:', error.message);
  }
}

// Ejemplo 2: Obtener ticket usando axios
async function ejemplo2_ObtenerTicketConAxios() {
  console.log('\n=== Ejemplo 2: Obtener ticket con axios ===\n');

  // Necesitas: npm install axios
  const axios = require('axios');

  try {
    const response = await axios.post('http://localhost:3000/api/afip/login', {
      cuit: '20123456789',
      service: 'wsfe',
    });

    const ticket = response.data.data;
    console.log('✅ Ticket obtenido');
    console.log('Token:', ticket.token);
    console.log('Válido hasta:', ticket.expirationTime);
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

// Ejemplo 3: Obtener tickets para diferentes servicios
async function ejemplo3_MultiplesServicios() {
  console.log('\n=== Ejemplo 3: Obtener tickets para múltiples servicios ===\n');

  const servicios = [
    { nombre: 'Facturación Electrónica', codigo: 'wsfe' },
    { nombre: 'Facturación de Exportación', codigo: 'wsfex' },
    { nombre: 'Facturación Básica', codigo: 'wsbfe' },
  ];

  for (const servicio of servicios) {
    try {
      const response = await fetch('http://localhost:3000/api/afip/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cuit: '20123456789',
          service: servicio.codigo,
        }),
      });

      const result = await response.json();
      if (result.success) {
        console.log(`✅ ${servicio.nombre} (${servicio.codigo}):`);
        console.log(`   Token: ${result.data.token.substring(0, 30)}...`);
        console.log(`   Expira: ${result.data.expirationTime}\n`);
      }
    } catch (error) {
      console.error(`❌ Error para ${servicio.nombre}:`, error.message);
    }
  }
}

// Ejemplo 4: Guardar y reutilizar ticket
async function ejemplo4_GuardarYReutilizarTicket() {
  console.log('\n=== Ejemplo 4: Guardar y reutilizar ticket ===\n');

  // Obtener ticket
  const response = await fetch('http://localhost:3000/api/afip/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cuit: '20123456789',
      service: 'wsfe',
    }),
  });

  const result = await response.json();
  const ticket = result.data;

  // Guardar en localStorage, base de datos, o memoria
  // Ejemplo: guardar en memoria (en producción usar Redis o DB)
  const ticketCache = {
    token: ticket.token,
    sign: ticket.sign,
    expirationTime: ticket.expirationTime,
    service: 'wsfe',
  };

  console.log('✅ Ticket guardado en caché');
  console.log('Token:', ticketCache.token.substring(0, 30) + '...');

  // Función para verificar si el ticket sigue válido
  function esTicketValido(ticket: any): boolean {
    const expiration = new Date(ticket.expirationTime);
    return expiration > new Date();
  }

  // Verificar validez
  if (esTicketValido(ticketCache)) {
    console.log('✅ Ticket aún válido, puedes reutilizarlo');
    console.log('Expira en:', calcularTiempoRestante(ticketCache.expirationTime));
  } else {
    console.log('❌ Ticket expirado, necesitas obtener uno nuevo');
  }

  return ticketCache;
}

// Ejemplo 5: Usar el ticket para autenticarse en otros servicios
async function ejemplo5_UsarTicketEnServicioAFIP() {
  console.log('\n=== Ejemplo 5: Usar ticket en servicio AFIP ===\n');

  // Primero obtener el ticket
  const ticketResponse = await fetch('http://localhost:3000/api/afip/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cuit: '20123456789',
      service: 'wsfe',
    }),
  });

  const { data: ticket } = await ticketResponse.json();

  // Ahora usar el ticket para autenticarte en otros servicios de AFIP
  // Ejemplo: Llamar al servicio de Facturación Electrónica
  console.log('Ticket obtenido, ahora puedes usarlo para:');
  console.log('1. Incluir token y sign en headers SOAP');
  console.log('2. Autenticarte en servicios como wsfe, wsfex, etc.');
  console.log('\nEjemplo de header SOAP:');
  console.log(`
<soap:Header>
  <Auth>
    <Token>${ticket.token.substring(0, 30)}...</Token>
    <Sign>${ticket.sign.substring(0, 30)}...</Sign>
    <Cuit>20123456789</Cuit>
  </Auth>
</soap:Header>
  `);
}

// Función auxiliar para calcular tiempo restante
function calcularTiempoRestante(expirationTime: string): string {
  const expiration = new Date(expirationTime);
  const now = new Date();
  const diff = expiration.getTime() - now.getTime();

  if (diff <= 0) return 'Expirado';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  return `${hours}h ${minutes}m`;
}

// Ejecutar ejemplos (descomenta el que quieras probar)
// ejemplo1_ObtenerTicketConFetch();
// ejemplo2_ObtenerTicketConAxios();
// ejemplo3_MultiplesServicios();
// ejemplo4_GuardarYReutilizarTicket();
// ejemplo5_UsarTicketEnServicioAFIP();

export {
  ejemplo1_ObtenerTicketConFetch,
  ejemplo2_ObtenerTicketConAxios,
  ejemplo3_MultiplesServicios,
  ejemplo4_GuardarYReutilizarTicket,
  ejemplo5_UsarTicketEnServicioAFIP,
};

