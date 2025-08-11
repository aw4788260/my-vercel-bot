import { Firestore } from '@google-cloud/firestore';

// هذه الدالة ستقوم بفك ترميز المفتاح من Base64
const decodedPrivateKey = Buffer.from(process.env.GCP_PRIVATE_KEY, 'base64').toString('utf8');

// تهيئة Firestore باستخدام المفتاح بعد فك ترميزه
const firestore = new Firestore({
  projectId: process.env.GCP_PROJECT_ID,
  credentials: {
    client_email: process.env.GCP_CLIENT_EMAIL,
    private_key: decodedPrivateKey,
  },
});

export default firestore;
