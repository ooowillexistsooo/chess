# Intermezzo
<b>a new chess app</b>

## run on render

1. sign up for firebase, then enable auth with email/password signup.
2. go to **Project settings → Service accounts → Firebase Admin SDK → Generate new private key**. its the service key
3. Set `FIREBASE_SERVICE_ACCOUNT_JSON` as a render enviroment varible 
4. The browser Firebase project configuration is in `public/firebase-client.js`; update it from **Project settings → General → Your apps → SDK setup and configuration** if needed. This web config is public and is not the Admin private key.
5. install npm and start with 
```shell
npm start
```
in render
6. yay
## Stockfish
theres fih