# Yılan.io

Tarayıcıda oynanan, çok oyunculu (şimdilik botlara karşı) neon yılan oyunu.
Yol haritası ve tasarım kararları: [CURRENT_PLAN.md](CURRENT_PLAN.md).

## Gereksinimler

- Node.js 22.12+ (önerilen: 24 LTS)

Bu bilgisayarda Node.js sisteme kurulu değil; taşınabilir sürüm `C:\Users\mciha\.tools\node`
klasöründe. Komutları çalıştırmadan önce o terminal oturumu için yola ekleyin:

```powershell
$env:Path = "C:\Users\mciha\.tools\node;" + $env:Path
```

(Node.js'i nodejs.org'dan sisteme kurarsanız bu adıma gerek kalmaz.)

## Kurulum

```bash
npm install
```

## Geliştirme

```bash
npm run dev:client
```

Tarayıcıda http://localhost:5173 adresini açın. Oyun şu an tamamen tarayıcıda, botlarla çalışır;
sunucu gerekmez. Aynı Wi-Fi'daki bir cihazdan girmek için konsolda yazan "Network" adresini kullanın.

İstemci ve sunucuyu birlikte başlatmak için: `npm run dev`

## Diğer komutlar

| Komut | Açıklama |
|-------|----------|
| `npm test` | Birim testleri (Vitest) |
| `npm run typecheck` | Tüm paketlerde TypeScript tip kontrolü |
| `npm run build` | İstemciyi `packages/client/dist` klasörüne derler |
| `npm start` | Sunucu: derlenmiş istemciyi ve `/health` uç noktasını 8080 portundan sunar |
| `npm run bench -- 120 20 5000` | Başsız simülasyon ölçümü (saniye, bot sayısı, arena yarıçapı) |
| `npm run format` | Prettier ile biçimlendirme |

## Kontroller

- **Fare**: yön · **Sol tık / Space**: hızlan (skor harcar)
- **←/→ veya A/D**: klavyeyle dön · **Esc**: menüye dön

## Proje yapısı

```
packages/
  shared/   oyun kuralları ve simülasyon (istemci + sunucu ortak), botlar, testler
  client/   Vite + PixiJS istemcisi: çizim, girdi, menü, HUD, çevrimdışı mod
  server/   Node.js sunucusu (Faz 4'te çok oyunculu WebSocket eklenecek)
tools/      simbench (başsız simülasyon ölçümü)
```
