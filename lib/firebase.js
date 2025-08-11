import { Firestore } from '@google-cloud/firestore';

// This line reads the key and replaces the escaped newlines with actual newlines
const privateKey = process.env.GCP_PRIVATE_KEY.replace(/\\n/g, '\n');

// Initialize Firestore
const firestore = new Firestore({
  projectId: process.env.GCP_PROJECT_ID,
  credentials: {
    client_email: process.env.GCP_CLIENT_EMAIL,
    private_key: privateKey,
  },
});

export default firestore;
