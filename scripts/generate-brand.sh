#!/usr/bin/env bash
# Genera los recursos de marca a partir de brand/logo-original.jpg.
# Requiere ImageMagick 7 (`magick`). Los resultados se versionan, así que solo
# hace falta ejecutarlo cuando cambie el logo.
set -euo pipefail
cd "$(dirname "$0")/.."

src=brand/logo-original.jpg
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Fondo blanco → transparente rellenando desde las cuatro esquinas (el contorno
# negro del bocadillo protege el interior), y recorte al contenido.
read -r w h < <(magick "$src" -format '%w %h\n' info:)
magick "$src" -alpha set -fuzz 14% -fill none \
  -draw "color 0,0 floodfill" -draw "color $((w - 1)),0 floodfill" \
  -draw "color 0,$((h - 1)) floodfill" -draw "color $((w - 1)),$((h - 1)) floodfill" \
  -trim +repage "$tmp/logo.png"

# Logo de la interfaz (se muestra a 240 px como máximo; 2x para pantallas retina).
# WebP con transparencia: la textura granulada ocupa ~7 veces más en PNG.
magick "$tmp/logo.png" -resize 480x -strip -quality 82 -define webp:alpha-quality=90 public/brand/logo.webp

# Favicon: el logo centrado en un cuadrado transparente.
magick "$tmp/logo.png" -resize 60x60 -background none -gravity center -extent 64x64 -strip public/brand/favicon.png

# Icono de la app de escritorio (Wails genera el .icns a partir de él): bocadillo
# sobre un cuadrado redondeado color papel con el contorno de tinta del logo.
magick -size 1024x1024 xc:none -fill '#fff6d8' -stroke '#1a1714' -strokewidth 16 \
  -draw 'roundrectangle 92,92 932,932 180,180' "$tmp/base.png"
magick "$tmp/logo.png" -resize 700x700 "$tmp/mark.png"
magick "$tmp/base.png" "$tmp/mark.png" -gravity center -composite -strip build/appicon.png

echo "Marca generada: public/brand/logo.webp, public/brand/favicon.png, build/appicon.png"
