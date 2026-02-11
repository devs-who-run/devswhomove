import { registerAs } from '@nestjs/config';

export default registerAs('appwrite', () => ({
  projectId: process.env.APPWRITE_PROJECT_ID,
  projectName: process.env.APPWRITE_PROJECT_NAME,
  endpoint: process.env.APPWRITE_ENDPOINT,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200',
  apiKey: process.env.APPWRITE_API_KEY,
  databaseId: process.env.APPWRITE_DATABASE_ID,
  eventsCollectionId: process.env.APPWRITE_EVENTS_COLLECTION_ID,
  usersCollectionId: process.env.APPWRITE_USERS_COLLECTION_ID,
}));
