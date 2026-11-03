import {initializeApp} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCaY35R4tX-jFM9yUP9NI89hbe0TfTebCM",
    authDomain: "club-idservice.firebaseapp.com",
    projectId: "club-idservice",
    storageBucket: "club-idservice.firebasestorage.app",
    messagingSenderId: "96859325007",
    appId: "1:96859325007:web:b2883f5084e7cc45b5203a",
    measurementId: "G-6WBFYRFLVZ"
};

const firebaseApp = initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
