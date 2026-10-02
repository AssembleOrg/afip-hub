import { ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { afipFailure, isAfipInfraError } from './afip-failure';

describe('isAfipInfraError', () => {
  it.each([
    [{ code: 'ETIMEDOUT', message: 'x' }],
    [{ code: 'ECONNRESET', message: 'x' }],
    [{ message: 'socket hang up' }],
    [{ message: 'Error al crear cliente SOAP WSFE: getaddrinfo ENOTFOUND servicios1.afip.gov.ar' }],
    [{ message: 'Request failed with status code 503' }],
    [{ response: { status: 502 }, message: 'x' }],
    [{ message: 'Servicio no disponible momentáneamente' }],
  ])('caída de ARCA o red: %o', (err) => {
    expect(isAfipInfraError(err)).toBe(true);
  });

  it.each([
    [{ message: 'El campo DocNro es inválido' }],
    [{ message: 'CUIT emisor no autorizado (10016)' }],
    [{ message: 'Importe total no coincide (10048)' }],
  ])('error de datos: %o', (err) => {
    expect(isAfipInfraError(err)).toBe(false);
  });
});

describe('afipFailure', () => {
  it('503 para fallas de infraestructura', () => {
    expect(afipFailure({ code: 'ETIMEDOUT' }, 'x')).toBeInstanceOf(ServiceUnavailableException);
  });
  it('400 para errores de datos', () => {
    expect(afipFailure(new Error('DocNro inválido'), 'x')).toBeInstanceOf(BadRequestException);
  });
});
