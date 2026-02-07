import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Databases, ID, Query } from 'node-appwrite';
import { AppwriteService } from './appwrite.service';
import { mockEvents } from '../mock/events.mock';

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);
  private databases: Databases;

  constructor(
    private readonly appwriteService: AppwriteService,
    private readonly configService: ConfigService
  ) {
    this.databases = this.appwriteService.getDatabases();
  }

  async onModuleInit(): Promise<void> {
    const shouldSeed =
      this.configService.get<string>('NODE_ENV') !== 'production';
    if (!shouldSeed) {
      return;
    }

    try {
      await this.seedEvents();
    } catch (error) {
      this.logger.error('Failed to seed database', error);
    }
  }

  private async seedEvents(): Promise<void> {
    const databaseId = this.appwriteService.getDatabaseId();
    const collectionId = this.appwriteService.getEventsCollectionId();

    const existing = await this.databases.listDocuments(
      databaseId,
      collectionId,
      [Query.limit(1)]
    );

    if (existing.total > 0) {
      this.logger.log(
        `Skipping seed: collection already has ${existing.total} event(s)`
      );
      return;
    }

    this.logger.log(`Seeding ${mockEvents.length} events into Appwrite...`);

    for (const event of mockEvents) {
      await this.databases.createDocument(
        databaseId,
        collectionId,
        ID.unique(),
        {
          conference: event.conference,
          eventType: event.eventType,
          date: event.date,
          location: event.location,
          name: event.name,
          sport: event.sport,
          description: event.description,
          time: event.time,
          capacity: event.capacity,
          createdBy: event.createdBy,
        }
      );
    }

    this.logger.log(`Successfully seeded ${mockEvents.length} events`);
  }
}
