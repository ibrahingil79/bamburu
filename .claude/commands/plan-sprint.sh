#!/bin/bash
echo "╔════════════════════════════════════════════════════════════╗"
echo "║          PLAN MODE — Ingeniería de Contexto               ║"
echo "╚════════════════════════════════════════════════════════════╝"
cat /home/bamburu/bamburu/.claude/session.json | jq '.next_steps' 2>/dev/null
