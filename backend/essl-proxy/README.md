# SmartHRMS eSSL Proxy

Tiny Node service that bridges your **eSSL eTimeTrackLite** SOAP server to clean JSON for the SmartHRMS mobile app.

## Why a proxy?
The mobile app (especially on web) cannot call SOAP directly because of CORS. This proxy:
- Wraps the SOAP `GetTransactionsLog` call in a JSON endpoint
- Allows CORS for the mobile dev server
- Lets you keep eSSL server credentials out of the mobile bundle (only proxy URL is shipped)

## Run
```bash
cd essl-proxy
npm install
npm start
```
Default port: **4000**

## Configure mobile
1. Open SmartHRMS → HR drawer → **ESSL Connection**
2. Fill in:
   - **Proxy URL** — e.g. `http://192.168.1.10:4000` (this Mac's LAN IP)
   - **eSSL Server URL** — e.g. `http://192.168.1.50:8090`
   - **User / Password** — your eTimeTrackLite login
3. Tap **Test** → then **Save & Start polling**
4. App will hit `/api/essl/punches` every **5 seconds** and update attendance live.

## Endpoints
- `GET  /health`
- `POST /api/essl/test` `{ serverUrl, userName, password }`
- `POST /api/essl/punches` `{ serverUrl, userName, password, fromDate?, toDate? }`
