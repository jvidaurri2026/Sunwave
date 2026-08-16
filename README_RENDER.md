# Sunwave Tracker Render Deploy

## Render settings

- Service type: Web Service
- Runtime: Python
- Build command: `python --version`
- Start command: `python server.py --host 0.0.0.0`
- Persistent disk mount path: `/var/data`
- Environment variable: `SUNWAVE_DATA_DIR=/var/data`
- Environment variable: `GROUPME_BOT_ID=<your GroupMe bot id>`

The SQLite database file is `equiptrack.db` inside the mounted `data` folder.
On first Render startup, if the disk is empty, the app copies the bundled `data/equiptrack.db` into `/var/data/equiptrack.db`.

If Render shows `go.mod file not found`, the service is set to Go or Render is looking at the wrong folder. Create the service as Python, or use this folder/zip as the root source.

## GroupMe callback

After Render deploys, set the GroupMe bot callback URL to:

`https://YOUR-RENDER-URL/api/groupme/callback`

Replace `YOUR-RENDER-URL` with the Render public URL.
