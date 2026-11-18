import { initializeApp } from 'firebase/app';
import { doc, getDocFromServer, getFirestore, type Firestore } from 'firebase/firestore';

interface FirebaseAppletJsonConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  firestoreDatabaseId?: string;
}

const localConfigs = import.meta.glob<{ default: FirebaseAppletJsonConfig }>(
  '../../firebase-applet-config.json',
  { eager: true }
);
const fallbackConfig: FirebaseAppletJsonConfig =
  localConfigs['../../firebase-applet-config.json']?.default ?? {};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || fallbackConfig.apiKey || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || fallbackConfig.authDomain || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || fallbackConfig.projectId || '',
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || fallbackConfig.storageBucket || '',
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || fallbackConfig.messagingSenderId || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || fallbackConfig.appId || '',
};

const databaseId =
  import.meta.env.VITE_FIREBASE_DATABASE_ID || fallbackConfig.firestoreDatabaseId;

const dataSource = (import.meta.env.VITE_DATA_SOURCE || 'firestore').toLowerCase();
const shouldInitFirebase = dataSource !== 'api' || Boolean(firebaseConfig.projectId && firebaseConfig.apiKey);

const app = shouldInitFirebase ? initializeApp(firebaseConfig) : null;
export const db: Firestore = app
  ? databaseId
    ? getFirestore(app, databaseId)
    : getFirestore(app)
  : (null as unknown as Firestore);

async function testConnection() {
  if (!db) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Verifica la configuración de Firebase: el cliente está sin conexión.');
    }
  }
}

if (dataSource !== 'api') {
  void testConnection();
}
