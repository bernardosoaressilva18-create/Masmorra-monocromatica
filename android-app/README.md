# O Último Legado — Android

Este projeto é um aplicativo Android em tela cheia, travado em orientação vertical (retrato), que abre a versão multiplayer hospedada em:

https://masmorra-monocromatica.onrender.com/

O jogo precisa de internet; o servidor multiplayer permanece no Render. O APK não copia nem substitui o servidor.

## APK automático

O workflow `.github/workflows/build-apk.yml` compila o APK de depuração e publica o artefato do GitHub Actions. Quando permitido pelas permissões do repositório, também anexa o APK a uma GitHub Release.

## Compilação local

É necessário Android SDK com API 35, JDK 17 e Gradle 8.9:

```sh
gradle -p android-app assembleDebug
```

APK gerado em `android-app/app/build/outputs/apk/debug/app-debug.apk`.
