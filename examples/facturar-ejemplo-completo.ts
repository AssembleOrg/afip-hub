/**
 * EJEMPLO COMPLETO: Facturación Electrónica con AFIP
 * 
 * Este script muestra cómo facturar electrónicamente usando la API
 */

import axios from 'axios';

// ============================================
// CONFIGURACIÓN
// ============================================
const CONFIG = {
  API_URL: 'http://localhost:3000/api',
  JWT_TOKEN: 'TU_JWT_TOKEN_AQUI', // Reemplazar con tu token JWT
  PUNTO_VENTA: 1, // Tu punto de venta configurado en AFIP
  CUIT_VENDEDOR: '27928706821', // Tu CUIT
};

// ============================================
// FUNCIONES AUXILIARES
// ============================================

/**
 * Formatea una fecha como YYYYMMDD
 */
function formatDateYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Calcula importes para una factura con IVA 21%
 */
function calcularImportes(importeTotal: number) {
  const importeNetoGravado = Math.round((importeTotal / 1.21) * 100) / 100;
  const importeIva = Math.round((importeTotal - importeNetoGravado) * 100) / 100;
  return {
    importeNetoGravado,
    importeIva,
    importeTotal
  };
}

// ============================================
// EJEMPLO 1: FACTURA B A CONSUMIDOR FINAL
// ============================================

async function ejemplo1_FacturaBConsumidorFinal() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('EJEMPLO 1: Factura B a Consumidor Final');
  console.log('═══════════════════════════════════════════════════════════\n');

  const fechaHoy = formatDateYYYYMMDD(new Date());
  const importes = calcularImportes(1210.0); // $1210 total

  const facturaData = {
    puntoVenta: CONFIG.PUNTO_VENTA,
    tipoComprobante: 6, // Factura B
    numeroComprobante: 0, // AFIP asigna automáticamente
    fechaComprobante: fechaHoy,
    cuitCliente: '0', // Consumidor Final
    tipoDocumento: 96, // DNI
    importeNetoGravado: importes.importeNetoGravado,
    importeIva: importes.importeIva,
    importeTotal: importes.importeTotal,
    concepto: 1 // Productos
  };

  console.log('📝 Datos de la factura:');
  console.log(JSON.stringify(facturaData, null, 2));
  console.log('\n⏳ Enviando a AFIP...\n');

  try {
    const response = await axios.post(
      `${CONFIG.API_URL}/afip/invoice`,
      facturaData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.JWT_TOKEN}`
        }
      }
    );

    if (response.data.success && response.data.data.resultado === 'A') {
      const factura = response.data.data;
      
      console.log('✅ FACTURA APROBADA POR AFIP');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📄 CAE: ${factura.cae}`);
      console.log(`🔢 Número de Comprobante: ${factura.numeroComprobante}`);
      console.log(`🏪 Punto de Venta: ${factura.puntoVenta}`);
      console.log(`📋 Tipo: ${factura.tipoComprobante} (Factura B)`);
      console.log(`📅 Fecha: ${factura.fechaComprobante}`);
      console.log(`💰 Importe Total: $${factura.importeTotal.toFixed(2)}`);
      console.log(`⏰ CAE Válido hasta: ${factura.caeFchVto}`);
      console.log(`✅ Resultado: ${factura.resultado} (Aprobado)`);
      
      if (factura.observaciones && factura.observaciones.length > 0) {
        console.log('\n⚠️  Observaciones de AFIP:');
        factura.observaciones.forEach((obs: string) => {
          console.log(`   • ${obs}`);
        });
      }

      return factura;
    } else {
      throw new Error(`Factura rechazada: ${response.data.data?.resultado || 'Desconocido'}`);
    }
  } catch (error: any) {
    console.error('\n❌ ERROR AL CREAR FACTURA');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Mensaje: ${error.response.data?.message || 'Error desconocido'}`);
      if (error.response.data?.errors) {
        console.error('Errores de validación:');
        error.response.data.errors.forEach((err: string) => {
          console.error(`   • ${err}`);
        });
      }
    } else {
      console.error(`Error: ${error.message}`);
    }
    
    throw error;
  }
}

// ============================================
// EJEMPLO 2: FACTURA A A RESPONSABLE INSCRIPTO
// ============================================

async function ejemplo2_FacturaAResponsableInscripto() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('EJEMPLO 2: Factura A a Responsable Inscripto');
  console.log('═══════════════════════════════════════════════════════════\n');

  const fechaHoy = formatDateYYYYMMDD(new Date());
  const cuitCliente = '20123456789'; // CUIT del cliente
  const importes = calcularImportes(6050.0); // $6050 total

  const facturaData = {
    puntoVenta: CONFIG.PUNTO_VENTA,
    tipoComprobante: 1, // Factura A
    numeroComprobante: 0,
    fechaComprobante: fechaHoy,
    cuitCliente: cuitCliente,
    tipoDocumento: 80, // CUIT
    importeNetoGravado: importes.importeNetoGravado,
    importeIva: importes.importeIva,
    importeTotal: importes.importeTotal,
    concepto: 2 // Servicios
  };

  console.log('📝 Datos de la factura:');
  console.log(JSON.stringify(facturaData, null, 2));
  console.log('\n⏳ Enviando a AFIP...\n');

  try {
    const response = await axios.post(
      `${CONFIG.API_URL}/afip/invoice`,
      facturaData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.JWT_TOKEN}`
        }
      }
    );

    const factura = response.data.data;
    
    if (factura.resultado === 'A') {
      console.log('✅ FACTURA A APROBADA');
      console.log(`CAE: ${factura.cae}`);
      console.log(`Número: ${factura.numeroComprobante}`);
      console.log(`Cliente CUIT: ${cuitCliente}`);
      return factura;
    } else {
      throw new Error(`Factura rechazada: ${factura.resultado}`);
    }
  } catch (error: any) {
    console.error('❌ Error:', error.response?.data?.message || error.message);
    throw error;
  }
}

// ============================================
// EJEMPLO 3: FACTURA C (EXENTO)
// ============================================

async function ejemplo3_FacturaCExento() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('EJEMPLO 3: Factura C (Exento de IVA)');
  console.log('═══════════════════════════════════════════════════════════\n');

  const fechaHoy = formatDateYYYYMMDD(new Date());
  const cuitCliente = '20123456789';

  const facturaData = {
    puntoVenta: CONFIG.PUNTO_VENTA,
    tipoComprobante: 11, // Factura C
    numeroComprobante: 0,
    fechaComprobante: fechaHoy,
    cuitCliente: cuitCliente,
    tipoDocumento: 80, // CUIT
    importeNetoGravado: 0.0, // Exento = 0
    importeIva: 0.0, // Exento = 0
    importeTotal: 1000.0, // Pero el total sí tiene valor
    concepto: 1
  };

  console.log('📝 Datos de la factura C (Exento):');
  console.log(JSON.stringify(facturaData, null, 2));

  try {
    const response = await axios.post(
      `${CONFIG.API_URL}/afip/invoice`,
      facturaData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.JWT_TOKEN}`
        }
      }
    );

    return response.data.data;
  } catch (error: any) {
    console.error('❌ Error:', error.response?.data?.message || error.message);
    throw error;
  }
}

// ============================================
// EJEMPLO 4: FUNCIÓN REUTILIZABLE
// ============================================

/**
 * Función reutilizable para crear facturas
 */
async function crearFactura(params: {
  tipoComprobante: number;
  cuitCliente: string;
  tipoDocumento: number;
  importeTotal: number;
  concepto: number;
  puntoVenta?: number;
  numeroComprobante?: number;
}) {
  const fechaHoy = formatDateYYYYMMDD(new Date());
  const importes = calcularImportes(params.importeTotal);

  // Para Factura C, los importes son 0
  const importeNeto = params.tipoComprobante === 11 ? 0 : importes.importeNetoGravado;
  const importeIva = params.tipoComprobante === 11 ? 0 : importes.importeIva;

  const facturaData = {
    puntoVenta: params.puntoVenta || CONFIG.PUNTO_VENTA,
    tipoComprobante: params.tipoComprobante,
    numeroComprobante: params.numeroComprobante ?? 0,
    fechaComprobante: fechaHoy,
    cuitCliente: params.cuitCliente,
    tipoDocumento: params.tipoDocumento,
    importeNetoGravado: importeNeto,
    importeIva: importeIva,
    importeTotal: params.importeTotal,
    concepto: params.concepto
  };

  const response = await axios.post(
    `${CONFIG.API_URL}/afip/invoice`,
    facturaData,
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.JWT_TOKEN}`
      }
    }
  );

  if (!response.data.success) {
    throw new Error(response.data.message);
  }

  if (response.data.data.resultado !== 'A') {
    throw new Error(`Factura rechazada: ${response.data.data.resultado}`);
  }

  return response.data.data;
}

// ============================================
// EJEMPLO 5: USO DE LA FUNCIÓN REUTILIZABLE
// ============================================

async function ejemplo5_UsoFuncionReutilizable() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('EJEMPLO 5: Usando función reutilizable');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Factura B simple
  const factura = await crearFactura({
    tipoComprobante: 6, // Factura B
    cuitCliente: '0', // Consumidor Final
    tipoDocumento: 96, // DNI
    importeTotal: 2420.0, // $2420
    concepto: 1 // Productos
  });

  console.log('✅ Factura creada:');
  console.log(`   CAE: ${factura.cae}`);
  console.log(`   Número: ${factura.numeroComprobante}`);
  console.log(`   Total: $${factura.importeTotal}`);
}

// ============================================
// EJECUTAR EJEMPLOS
// ============================================

async function main() {
  try {
    // Descomenta el ejemplo que quieras probar:
    
    // await ejemplo1_FacturaBConsumidorFinal();
    // await ejemplo2_FacturaAResponsableInscripto();
    // await ejemplo3_FacturaCExento();
    // await ejemplo5_UsoFuncionReutilizable();

    console.log('\n✅ Todos los ejemplos ejecutados correctamente');
  } catch (error) {
    console.error('\n❌ Error en los ejemplos:', error);
    process.exit(1);
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  main();
}

export {
  ejemplo1_FacturaBConsumidorFinal,
  ejemplo2_FacturaAResponsableInscripto,
  ejemplo3_FacturaCExento,
  ejemplo5_UsoFuncionReutilizable,
  crearFactura,
  calcularImportes,
  formatDateYYYYMMDD
};

