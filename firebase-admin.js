import {cert, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {FieldValue, getFirestore} from "firebase-admin/firestore";

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must be configured.");
}

let serviceAccount;
try {
    serviceAccount = JSON.parse(serviceAccountJson);
} catch (error) {
    throw new Error(
        "FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.",
        {cause: error}
    );
}

const firebaseApp = initializeApp({
    credential: cert(serviceAccount)
});

export const firebaseAuth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);
export {FieldValue};
