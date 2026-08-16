Sunwave Tracker SQLite Server

Start the app:
1. Double-click start-server.bat
2. Open http://127.0.0.1:4178/

Start for phone access:
1. Double-click start-phone-server.bat
2. On a phone connected to the same Wi-Fi, open:
   http://192.168.25.202:4178/

Login:
Use the user accounts configured in the app.

Database:
The SQLite database is created automatically at:
data/equiptrack.db

Google Maps:
The Maps page uses Google Maps JavaScript, not an iframe. Add your Google Maps
API key in config.js under googleMapsApiKey before using the live map.

Phone access:
The default start file is local-only for safety. The phone start file opens
the app to devices on the same Wi-Fi. Windows Firewall may need to allow Python.
Only use phone access on a trusted network.

App Store / Play Store:
Use outputs/mobile-app as the starter wrapper project. A public HTTPS backend is
required before store submission; the local SQLite server is not enough for a
downloadable app-store app.
