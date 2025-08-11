import { Firestore } from '@google-cloud/firestore';

// يتم قراءة المتغيرات من Vercel Environment Variables تلقائيًا عند النشر
const privateKey = process.env.GCP_PRIVATE_KEY.replace(/\\n/g, '\n');

// تهيئة Firestore
const firestore = new Firestore({
projectId: process.env.GCP_PROJECT_ID,
credentials: {
client_email: process.env.GCP_CLIENT_EMAIL,
private_key: privateKey,
},
});

export default firestore;
