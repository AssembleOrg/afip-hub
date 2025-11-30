#!/bin/bash

# ============================================
# EJEMPLOS DE FACTURACIÓN CON cURL
# ============================================

API_URL="http://localhost:3000/api"
JWT_TOKEN="TU_JWT_TOKEN_AQUI"  # Reemplazar con tu token JWT

# Obtener fecha actual en formato YYYYMMDD
FECHA_HOY=$(date +%Y%m%d)

echo "═══════════════════════════════════════════════════════════"
echo "EJEMPLOS DE FACTURACIÓN ELECTRÓNICA CON AFIP"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ============================================
# EJEMPLO 1: FACTURA B A CONSUMIDOR FINAL
# ============================================

echo "📄 Ejemplo 1: Factura B a Consumidor Final"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

curl -X POST "${API_URL}/afip/invoice" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -d "{
    \"puntoVenta\": 1,
    \"tipoComprobante\": 6,
    \"numeroComprobante\": 0,
    \"fechaComprobante\": \"${FECHA_HOY}\",
    \"cuitCliente\": \"0\",
    \"tipoDocumento\": 96,
    \"importeNetoGravado\": 1000.0,
    \"importeIva\": 210.0,
    \"importeTotal\": 1210.0,
    \"concepto\": 1
  }" | jq '.'

echo ""
echo ""

# ============================================
# EJEMPLO 2: FACTURA A A RESPONSABLE INSCRIPTO
# ============================================

echo "📄 Ejemplo 2: Factura A a Responsable Inscripto"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

curl -X POST "${API_URL}/afip/invoice" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -d "{
    \"puntoVenta\": 1,
    \"tipoComprobante\": 1,
    \"numeroComprobante\": 0,
    \"fechaComprobante\": \"${FECHA_HOY}\",
    \"cuitCliente\": \"20123456789\",
    \"tipoDocumento\": 80,
    \"importeNetoGravado\": 5000.0,
    \"importeIva\": 1050.0,
    \"importeTotal\": 6050.0,
    \"concepto\": 2
  }" | jq '.'

echo ""
echo ""

# ============================================
# EJEMPLO 3: FACTURA C (EXENTO)
# ============================================

echo "📄 Ejemplo 3: Factura C (Exento de IVA)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

curl -X POST "${API_URL}/afip/invoice" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -d "{
    \"puntoVenta\": 1,
    \"tipoComprobante\": 11,
    \"numeroComprobante\": 0,
    \"fechaComprobante\": \"${FECHA_HOY}\",
    \"cuitCliente\": \"20123456789\",
    \"tipoDocumento\": 80,
    \"importeNetoGravado\": 0.0,
    \"importeIva\": 0.0,
    \"importeTotal\": 1000.0,
    \"concepto\": 1
  }" | jq '.'

echo ""
echo ""

# ============================================
# NOTAS
# ============================================

echo "═══════════════════════════════════════════════════════════"
echo "NOTAS:"
echo "═══════════════════════════════════════════════════════════"
echo "1. Reemplaza JWT_TOKEN con tu token de autenticación"
echo "2. Asegúrate de que el punto de venta esté habilitado en AFIP"
echo "3. El númeroComprobante: 0 hace que AFIP asigne automáticamente"
echo "4. La fecha debe ser YYYYMMDD (ej: 20241126)"
echo "5. Para Factura B, cuitCliente debe ser '0'"
echo "═══════════════════════════════════════════════════════════"

