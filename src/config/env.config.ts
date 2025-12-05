/**
 * AFIP Environment URLs
 * 
 * PRODUCCIÓN (facturas reales, fiscalmente válidas):
 * - WSAA: https://wsaa.afip.gov.ar/ws/services/LoginCms?WSDL
 * - WSFE: https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL
 * - Padrón: https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5?WSDL
 * 
 * HOMOLOGACIÓN (testing, sin efecto fiscal):
 * - WSAA: https://wsaahomo.afip.gov.ar/ws/services/LoginCms?WSDL
 * - WSFE: https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL
 * - Padrón: https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5?WSDL
 */

const isProduction = process.env.AFIP_ENVIRONMENT === 'production';

// Default to HOMOLOGACIÓN for safety (testing environment)
const AFIP_URLS = {
  production: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms?WSDL',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL',
    padron: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5?WSDL',
  },
  homologacion: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms?WSDL',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL',
    padron: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5?WSDL',
  },
};

const afipEnv = isProduction ? AFIP_URLS.production : AFIP_URLS.homologacion;

export default () => ({
  port: parseInt(process.env.PORT || '3000', 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    url: process.env.DATABASE_URL || '',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  swagger: {
    enabled: process.env.SWAGGER_ENABLED === 'true',
    password: process.env.SWAGGER_PASSWORD || 'admin',
  },
  afip: {
    environment: isProduction ? 'production' : 'homologacion',
    wsaaUrl: process.env.AFIP_WSAA_URL || afipEnv.wsaa,
    wsfeUrl: process.env.AFIP_WSFE_URL || afipEnv.wsfe,
    padronUrl: process.env.AFIP_PADRON_URL || afipEnv.padron,
    certPath: process.env.AFIP_CERT_PATH || '',
    keyPath: process.env.AFIP_KEY_PATH || '',
    cuit: process.env.AFIP_CUIT || '',
  },
  timezone: 'America/Argentina/Buenos_Aires', // GMT-3
});

