import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCYBdl7Z1xTkFb__3KfTfXNQXcSoB-UlOc",
  authDomain: "ramino-pokerato.firebaseapp.com",
  databaseURL: "https://ramino-pokerato-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "ramino-pokerato",
  storageBucket: "ramino-pokerato.firebasestorage.app",
  messagingSenderId: "951425457894",
  appId: "1:951425457894:web:ce6ecff0c685dee55d6527"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
