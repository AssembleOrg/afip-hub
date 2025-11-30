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
    wsaaUrl: process.env.AFIP_WSAA_URL || 'https://wsaa.afip.gov.ar/ws/services/LoginCms?WSDL',
    wsfeUrl: process.env.AFIP_WSFE_URL || 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL',
    certPath: process.env.AFIP_CERT_PATH || '',
    keyPath: process.env.AFIP_KEY_PATH || '',
    cuit: process.env.AFIP_CUIT || '',
  },
  timezone: 'America/Argentina/Buenos_Aires', // GMT-3
});

