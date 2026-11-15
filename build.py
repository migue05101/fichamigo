# Genera public/index.html a partir de fichamigo.html (la app)
import pathlib
src=pathlib.Path(__file__).with_name("fichamigo.html").read_text()
head='''<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#7C5CFF">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Fichamigo">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" href="icon-192.png?v=2">
<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png?v=2">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,-apple-system,"Segoe UI",sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
'''
pathlib.Path(__file__).with_name("public").joinpath("index.html").write_text(head+src+"\n</body>\n</html>\n")
print("ok")
