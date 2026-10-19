# Installing INNLI

You have received or downloaded two files:

- `innli-<version>.zip`: the program;
- `innli-wordpress-<version>.zip`: the WordPress plugin. You only need it if your website runs on WordPress.

Choose one of the three options below. Not sure? Choose **A** on a computer that is always on, or **B** on a Raspberry Pi or server.

## A. Windows, Mac or Linux, without Docker

1. Install **Node.js 22 or newer** from <https://nodejs.org> (choose "LTS").
2. Unzip `innli-<version>.zip`, for example to `Documents\innli`.
3. Open a terminal in that folder. On Windows: click in the address bar of File Explorer, type `cmd` and press Enter.
4. Type `npm start` and press Enter.
5. An **installation code** appears. Open <http://localhost:3000/dashboard/> and enter that code.

You do not need to install anything else. Everything INNLI needs is in the zip.

## B. With Docker (Raspberry Pi, server, NAS)

Unzip the file and go to that folder in a terminal. Then:

```bash
docker compose up -d
docker compose logs innli      # shows the installation code
```

Then open <http://localhost:3000/dashboard/> on the same device. For security reasons, INNLI can only be reached from the device itself this way. Other devices reach it through the tunnel described in [hosting.md](hosting.md). Docker works on ordinary PCs and on a Raspberry Pi (64-bit).

With Docker, your data is stored in the volume `innli-data`, not in a folder. How to make a backup is explained in [hosting.md](hosting.md#backup).

## C. Have someone install it

Do you have a web developer? Send them this page and the zip. Only share your owner key and licence key with someone you trust.

## Next steps

1. **Activate your licence:** in the dashboard under *Overview → Licence & INNLI guide*. Paste the key you received by e-mail (it starts with `INNLI-`).
2. **Put it online:** agents can only reach you if INNLI is online 24/7. See [hosting.md](hosting.md) for the cheapest way. A Cloudflare Tunnel is free and you do not need to open any ports.
3. **Set it up:** follow the *Getting started* steps in the dashboard, or read [owner-guide.md](owner-guide.md).
4. **WordPress (optional):** in WordPress, go to *Plugins → Add New Plugin → Upload Plugin* and choose `innli-wordpress-<version>.zip`. Activate it and, under *Settings → INNLI*, fill in the address of your INNLI (without `/dashboard`), plus the property ID and secret key from *Booking & details*. The page shows straight away whether the connection works.

## Updating to a new version

Your data stays in place when you update.

- **Without Docker:** stop INNLI with Ctrl+C. Unzip the new zip to a **new** folder and copy the `data/` folder from the old folder into it. Start it there with `npm start`. If it works, you can delete the old folder.
- **With Docker:** `docker compose pull && docker compose up -d` when `INNLI_IMAGE` is set in `.env`; otherwise `docker compose up -d --build` in the new version's folder.

Make a backup before every update (the `data/` folder, or the volume if you use Docker).

## Help

E-mail the supplier; the address is in `LICENSE` and on your invoice. Include your version number. You can find it in the dashboard under *Overview → Licence & INNLI guide*, or at `http://localhost:3000/health`.
