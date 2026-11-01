import {initializeApp} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: ":)",
    authDomain: ":).firebaseapp.com",
    projectId: ":)",
    storageBucket: ":).firebasestorage.app",
    messagingSenderId: ":)",
    appId: ":)",
    measurementId: "G-:)"
};

const firebaseApp = initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
