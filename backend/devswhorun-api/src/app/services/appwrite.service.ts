import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Client,
  Account,
  OAuthProvider,
  Databases,
  Models,
} from 'node-appwrite';

@Injectable()
export class AppwriteService {
  private readonly logger = new Logger(AppwriteService.name);
  private client: Client;
  private account: Account;
  private databases: Databases;

  constructor(private configService: ConfigService) {
    this.initializeClient();
  }

  private initializeClient(): void {
    const endpoint = this.configService.get<string>('appwrite.endpoint');
    const projectId = this.configService.get<string>('appwrite.projectId');
    const apiKey = this.configService.get<string>('appwrite.apiKey');

    if (!endpoint || !projectId) {
      throw new Error('Appwrite configuration is missing');
    }

    this.client = new Client().setEndpoint(endpoint).setProject(projectId);

    if (apiKey) {
      this.client.setKey(apiKey);
    }

    this.account = new Account(this.client);
    this.databases = new Databases(this.client);
    this.logger.log('Appwrite client initialized successfully');
  }

  async createGitHubOAuthUrl(
    successUrl: string,
    failureUrl: string
  ): Promise<string> {
    try {
      const sessionUrl = await this.account.createOAuth2Token({
        provider: OAuthProvider.Github,
        success: successUrl,
        failure: failureUrl,
      });

      if (!sessionUrl) {
        throw new Error('Failed to generate OAuth URL');
      }
      return sessionUrl;
    } catch (error) {
      this.logger.error('Failed to create GitHub OAuth URL', error);
      throw error;
    }
  }

  async getCurrentUser(sessionSecret?: string): Promise<Models.User> {
    try {
      if (!sessionSecret) {
        throw new Error('Session secret is required');
      }

      const endpoint = this.configService.get<string>('appwrite.endpoint');
      const projectId = this.configService.get<string>('appwrite.projectId');

      const userClient = new Client()
        .setEndpoint(endpoint)
        .setProject(projectId)
        .setSession(sessionSecret);

      const userAccount = new Account(userClient);

      const user = await userAccount.get();

      return user;
    } catch (error) {
      this.logger.error('Error details:', JSON.stringify(error, null, 2));
      throw error;
    }
  }

  async createSessionFromCallback(
    userId: string,
    secret: string
  ): Promise<{ session: Models.Session; user: Models.User }> {
    try {
      const session = await this.account.createSession(userId, secret);

      const endpoint = this.configService.get<string>('appwrite.endpoint');
      const projectId = this.configService.get<string>('appwrite.projectId');
      const sessionClient = new Client()
        .setEndpoint(endpoint)
        .setProject(projectId)
        .setSession(session.secret);

      const sessionAccount = new Account(sessionClient);
      const user = await sessionAccount.get();
      return { session, user };
    } catch (error) {
      this.logger.error('Failed to create session from callback', error);
      throw error;
    }
  }

  async deleteSession(secretToken: string): Promise<void> {
    try {
      const endpoint = this.configService.get<string>('appwrite.endpoint');
      const projectId = this.configService.get<string>('appwrite.projectId');

      const userClient = new Client()
        .setEndpoint(endpoint)
        .setProject(projectId)
        .setSession(secretToken);

      const userAccount = new Account(userClient);
      await userAccount.deleteSession({ sessionId: 'current' });
    } catch (error) {
      this.logger.error('Failed to delete session', error);
      throw error;
    }
  }

  async getSessions(sessionId: string): Promise<Models.SessionList> {
    try {
      const endpoint = this.configService.get<string>('appwrite.endpoint');
      const projectId = this.configService.get<string>('appwrite.projectId');

      const userClient = new Client()
        .setEndpoint(endpoint)
        .setProject(projectId)
        .setSession(sessionId);

      const userAccount = new Account(userClient);
      const sessions = await userAccount.listSessions();
      return sessions;
    } catch (error) {
      this.logger.error('Failed to get sessions', error);
      throw error;
    }
  }

  getDatabases(): Databases {
    return this.databases;
  }

  getDatabaseId(): string {
    return (
      this.configService.get<string>('appwrite.databaseId') || 'devswhorun'
    );
  }

  getEventsCollectionId(): string {
    return (
      this.configService.get<string>('appwrite.eventsCollectionId') || 'events'
    );
  }

  getUsersCollectionId(): string {
    return (
      this.configService.get<string>('appwrite.usersCollectionId') || 'users'
    );
  }

  getRegistrationsCollectionId(): string {
    return (
      this.configService.get<string>('appwrite.registrationsCollectionId') ||
      'registrations'
    );
  }
}
