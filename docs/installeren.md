# INNLI installeren

Je hebt twee bestanden ontvangen of gedownload:

- `innli-<versie>.zip`: het programma;
- `innli-wordpress-<versie>.zip`: de WordPress-plugin. Die is alleen nodig als je website op WordPress draait.

Kies één van de drie manieren hieronder. Weet je het niet? Neem **A** op een computer die altijd aan staat, of **B** op een Raspberry Pi of server.

## A. Windows, Mac of Linux, zonder Docker

1. Installeer **Node.js 22 of nieuwer** van <https://nodejs.org> (kies "LTS").
2. Pak `innli-<versie>.zip` uit, bijvoorbeeld naar `Documenten\innli`.
3. Open in die map een terminal. Op Windows: klik in de adresbalk van de Verkenner, typ `cmd` en druk op Enter.
4. Typ `npm start` en druk op Enter.
5. Er verschijnt een **installatiecode**. Open <http://localhost:3000/dashboard/> en vul die code in.

Je hoeft niets anders te installeren. Alles wat INNLI nodig heeft, zit in de zip.

## B. Met Docker (Raspberry Pi, server, NAS)

Pak de zip uit en ga in een terminal naar die map. Dan:

```bash
docker compose up -d
docker compose logs innli      # toont de installatiecode
```

Open daarna op hetzelfde apparaat <http://localhost:3000/dashboard/>. Om veiligheidsredenen is INNLI zo alleen vanaf het apparaat zelf bereikbaar. Andere apparaten bereiken het via de tunnel uit `docs/hosting.md`. Docker werkt op gewone pc's en op een Raspberry Pi (64-bit).

Gegevens staan in Docker in het volume `innli-data` en niet in een map. Een back-up maken staat in `docs/hosting.md`.

## C. Laten installeren

Heb je een webbouwer? Stuur deze pagina en de zip door. Je eigenaarssleutel en licentiesleutel deel je alleen met iemand die je vertrouwt.

## Daarna

1. **Licentie activeren:** in het dashboard onder *Overzicht → Licentie & INNLI-gids*. Plak de sleutel die je per mail kreeg (die begint met `INNLI-`).
2. **Online zetten:** agents kunnen je alleen bereiken als INNLI 24/7 online is. Kijk in `docs/hosting.md` voor de goedkoopste manier. Een Cloudflare Tunnel is gratis en je hoeft geen poorten open te zetten.
3. **Instellen:** volg de stappen *Aan de slag* in het dashboard, of lees `docs/handleiding.md`.
4. **WordPress (optioneel):** ga in WordPress naar *Plugins → Nieuwe plugin → Plugin uploaden* en kies `innli-wordpress-<versie>.zip`. Activeer de plugin en vul onder *Instellingen → INNLI* het adres van je INNLI in (zonder `/dashboard`), plus het accommodatie-ID en de geheime sleutel uit *Boeking & gegevens*. De pagina laat meteen zien of de verbinding werkt.

## Bijwerken naar een nieuwe versie

Je gegevens blijven bij een update gewoon staan.

- **Zonder Docker:** stop INNLI met Ctrl+C. Pak de nieuwe zip uit naar een **nieuwe** map en kopieer de map `data/` uit de oude map erin. Start daar met `npm start`. Werkt het, dan kun je de oude map weggooien.
- **Met Docker:** `docker compose pull && docker compose up -d` als `INNLI_IMAGE` in `.env` staat; anders `docker compose up -d --build` in de map van de nieuwe versie.

Maak vóór iedere update een back-up (map `data/`, of bij Docker het volume).

## Hulp

Mail de leverancier; het adres staat in `LICENSE` en op je factuur. Vermeld je versie. Die staat in het dashboard onder *Overzicht → Licentie & INNLI-gids*, of op `http://localhost:3000/health`.
