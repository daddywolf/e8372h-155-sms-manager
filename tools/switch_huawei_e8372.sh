#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT_DIR/tools/huawei_e8372_modeswitch.c"
BIN="$ROOT_DIR/tools/huawei_e8372_modeswitch"

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
