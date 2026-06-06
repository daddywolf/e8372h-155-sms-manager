#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT_DIR/tools/huawei_e8372_modeswitch.c"
BIN="$ROOT_DIR/tools/huawei_e8372_modeswitch"
ENV_FILE="$ROOT_DIR/.env"

if [[ -f "$ENV_FILE" && -z "${SKIP_USB_MODESWITCH+x}" ]]; then
  skip_from_env="$(awk -F= '$1 == "SKIP_USB_MODESWITCH" {print $2; exit}' "$ENV_FILE" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["'\'']//' -e 's/["'\'']$//')"
  if [[ -n "$skip_from_env" ]]; then
    SKIP_USB_MODESWITCH="$skip_from_env"
  fi
fi

if [[ "${SKIP_USB_MODESWITCH:-0}" == "1" ]]; then
  echo "SKIP_USB_MODESWITCH=1; skipping USB mode switch."
  exit 0
fi

if ioreg -p IOUSB -l -w 0 | rg -qi 'HUAWEI|12d1|4817' && ioreg -p IOUSB -l -w 0 | rg -qi '14db|5339|CDC|ECM|NCM'; then
  echo "Huawei HiLink device already appears to be in network mode; skipping USB mode switch."
  exit 0
fi

if ! ioreg -p IOUSB -l -w 0 | rg -qi '1f01|7937|HiLink'; then
  echo "Huawei HiLink install-mode device was not found; skipping USB mode switch."
  exit 0
fi

if [[ ! -f /opt/homebrew/include/libusb-1.0/libusb.h ]]; then
  echo "libusb is missing. Install it first with: brew install libusb" >&2
  exit 1
fi

cc "$SRC" -I/opt/homebrew/include -L/opt/homebrew/lib -lusb-1.0 -o "$BIN"

hilink_disk="$(diskutil list external physical | awk '/HiLink/ {print $NF; exit}')"
if [[ -n "${hilink_disk:-}" ]]; then
  diskutil eject "/dev/$hilink_disk" || true
  sleep 2
fi

sudo "$BIN"

echo
echo "USB state:"
ioreg -p IOUSB -l -w 0 | rg -i -C 8 'HUAWEI|12d1|14db|1f01|CDC|ECM|NCM' || true

echo
echo "Network hardware ports:"
networksetup -listallhardwareports
