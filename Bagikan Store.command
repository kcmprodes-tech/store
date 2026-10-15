#!/bin/bash
# Bagikan Store Kompas.com lewat link publik sementara (Cloudflare quick tunnel).
# Cara pakai: klik dua kali file ini di Finder. Linknya otomatis tersalin.
# Selama jendela Terminal ini terbuka, link hidup dan Mac tidak tidur. Tutup jendela = link mati.

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PORT=3000
LOG="${TMPDIR:-/tmp}/store-kompas-share.log"

for cmd in npm cloudflared; do
  if ! command -v "$cmd" >/dev/null; then
    echo "Program '$cmd' tidak ditemukan. Minta bantuan tim teknis untuk memasangnya."
    read -r -p "Tekan Enter untuk menutup."
    exit 1
  fi
done

# 1. Nyalakan store di Mac kalau belum jalan
if ! curl -s -o /dev/null "http://localhost:$PORT/healthz"; then
  echo "Menyalakan store di Mac…"
  npm run dev >"$LOG" 2>&1 &
  DEV_PID=$!
  trap 'kill "$DEV_PID" 2>/dev/null' EXIT
  for _ in $(seq 1 60); do
    curl -s -o /dev/null "http://localhost:$PORT/healthz" && break
    sleep 1
  done
fi
if ! curl -s -o /dev/null "http://localhost:$PORT/healthz"; then
  echo "Store gagal menyala. Detailnya ada di: $LOG"
  read -r -p "Tekan Enter untuk menutup."
  exit 1
fi

# 2. Mac tidak tidur selama jendela ini terbuka
caffeinate -dims -w $$ &

# 3. Buat link publik, tampilkan & salin ke clipboard
echo "Membuat link publik… (tunggu beberapa detik)"
cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" 2>&1 | while read -r line; do
  url=$(printf '%s' "$line" | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com')
  if [ -n "$url" ]; then
    printf '%s' "$url" | pbcopy
    echo ""
    echo "  ✅ Link untuk dibagikan:  $url"
    echo "     (sudah tersalin, tinggal paste ke WhatsApp/email)"
    echo "     Link baru biasanya bisa dibuka ±1 menit setelah muncul."
    echo ""
    echo "  Biarkan jendela ini terbuka selama link dipakai."
    echo "  Tutup jendela ini untuk mematikan link."
  fi
done
