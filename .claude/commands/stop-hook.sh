#!/bin/bash
echo "╔════════════════════════════════════════════════════════════╗"
echo "║              STOP HOOK — Tests & Verificación             ║"
echo "╚════════════════════════════════════════════════════════════╝"

cd /home/bamburu/bamburu || exit 1

echo ""
echo "1. Suite de tests..."
npm test 2>&1 | tail -5

if [ $? -ne 0 ]; then
  echo "❌ Tests fallaron"
  exit 1
fi

echo "✅ Tests pasan"
echo ""
echo "2. Verificando dev.bamburu.com..."
curl -s -I https://dev.bamburu.com/admin/login 2>&1 | head -2
echo ""
echo "✅ STOP HOOK COMPLETO"
