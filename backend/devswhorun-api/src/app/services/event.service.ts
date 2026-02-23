import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Databases, ID, Query } from 'node-appwrite';
import { AppwriteService } from './appwrite.service';
import { CreateEventDto, UpdateEventDto, Event } from '../dto/events.dto';

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);
  private databases: Databases;

  constructor(private readonly appwriteService: AppwriteService) {
    this.databases = this.appwriteService.getDatabases();
  }

  async createEvent(createEventDto: CreateEventDto): Promise<Event> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getEventsCollectionId();

      const eventData = {
        conference: createEventDto.conference,
        eventType: createEventDto.eventType,
        date: createEventDto.date,
        location: createEventDto.location,
        name: createEventDto.name,
        sport: createEventDto.sport,
        description: createEventDto.description,
        time: createEventDto.time,
        capacity: createEventDto.capacity,
        createdBy: createEventDto.createdBy,
        createdByUserId: createEventDto.createdByUserId,
      };

      const document = await this.databases.createDocument(
        databaseId,
        collectionId,
        ID.unique(),
        eventData
      );

      this.logger.log(`Event created with ID: ${document.$id}`);
      return this.mapAppwriteDocumentToEvent(document);
    } catch (error) {
      this.logger.error('Failed to create event', error);
      throw error;
    }
  }

  async getEvents(): Promise<Event[]> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getEventsCollectionId();

      const response = await this.databases.listDocuments(
        databaseId,
        collectionId,
        [Query.orderDesc('$createdAt')]
      );

      return response.documents.map((doc) =>
        this.mapAppwriteDocumentToEvent(doc)
      );
    } catch (error) {
      this.logger.error('Failed to get events', error);
      throw error;
    }
  }

  async getEventById(eventId: string): Promise<Event> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getEventsCollectionId();

      const document = await this.databases.getDocument(
        databaseId,
        collectionId,
        eventId
      );

      return this.mapAppwriteDocumentToEvent(document);
    } catch (error) {
      this.logger.error(`Failed to get event with ID: ${eventId}`, error);
      throw error;
    }
  }

  async updateEvent(
    eventId: string,
    updateData: UpdateEventDto
  ): Promise<Event> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getEventsCollectionId();

      const document = await this.databases.updateDocument(
        databaseId,
        collectionId,
        eventId,
        updateData
      );

      this.logger.log(`Event updated with ID: ${eventId}`);
      return this.mapAppwriteDocumentToEvent(document);
    } catch (error) {
      this.logger.error(`Failed to update event with ID: ${eventId}`, error);
      throw error;
    }
  }

  async deleteEvent(eventId: string): Promise<void> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getEventsCollectionId();

      await this.databases.deleteDocument(databaseId, collectionId, eventId);

      this.logger.log(`Event deleted with ID: ${eventId}`);
    } catch (error) {
      this.logger.error(`Failed to delete event with ID: ${eventId}`, error);
      throw error;
    }
  }

  async getEventsByConference(conference: string): Promise<Event[]> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getEventsCollectionId();

      const response = await this.databases.listDocuments(
        databaseId,
        collectionId,
        [Query.search('conference', conference), Query.orderDesc('$createdAt')]
      );

      return response.documents.map((doc) =>
        this.mapAppwriteDocumentToEvent(doc)
      );
    } catch (error) {
      this.logger.error(
        `Failed to get events by conference: ${conference}`,
        error
      );
      throw error;
    }
  }

  async getEventsByType(eventType: string): Promise<Event[]> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getEventsCollectionId();

      const response = await this.databases.listDocuments(
        databaseId,
        collectionId,
        [Query.equal('eventType', eventType), Query.orderDesc('$createdAt')]
      );

      return response.documents.map((doc) =>
        this.mapAppwriteDocumentToEvent(doc)
      );
    } catch (error) {
      this.logger.error(`Failed to get events by type: ${eventType}`, error);
      throw error;
    }
  }

  private mapAppwriteDocumentToEvent(doc: any): Event {
    return {
      id: doc.$id,
      conference: doc.conference,
      eventType: doc.eventType,
      date: doc.date,
      location: doc.location,
      name: doc.name,
      sport: doc.sport,
      description: doc.description,
      time: doc.time,
      capacity: doc.capacity,
      createdBy: doc.createdBy,
      createdByUserId: doc.createdByUserId,
      confirmedCount: doc.confirmedCount || 0,
      waitlistCount: doc.waitlistCount || 0,
      createdAt: doc.$createdAt ? new Date(doc.$createdAt) : undefined,
      updatedAt: doc.$updatedAt ? new Date(doc.$updatedAt) : undefined,
    };
  }
}
