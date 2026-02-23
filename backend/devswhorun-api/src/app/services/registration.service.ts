import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Databases, ID, Query } from 'node-appwrite';
import { AppwriteService } from './appwrite.service';
import { EventService } from './event.service';
import {
  CreateRegistrationDto,
  Registration,
  RegistrationStatus,
  RegistrationCountsDto,
} from '../dto/registration.dto';

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);
  private databases: Databases;

  constructor(
    private readonly appwriteService: AppwriteService,
    private readonly eventService: EventService
  ) {
    this.databases = this.appwriteService.getDatabases();
  }

  async registerForEvent(
    createRegistrationDto: CreateRegistrationDto
  ): Promise<Registration> {
    try {
      const { eventId, userId, userName } = createRegistrationDto;
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getRegistrationsCollectionId();

      const existing = await this.getUserRegistrationStatus(eventId, userId);
      if (existing) {
        throw new ConflictException(
          'User is already registered for this event'
        );
      }

      const event = await this.eventService.getEventById(eventId);
      const confirmedCount = event.confirmedCount || 0;
      const capacity = event.capacity;

      const status =
        confirmedCount < capacity
          ? RegistrationStatus.CONFIRMED
          : RegistrationStatus.WAITLIST;

      let waitlistPosition = null;
      if (status === RegistrationStatus.WAITLIST) {
        const waitlistCount = event.waitlistCount || 0;
        waitlistPosition = waitlistCount + 1;
      }

      const registrationData = {
        eventId,
        userId,
        userName,
        status,
        waitlistPosition,
      };

      const document = await this.databases.createDocument(
        databaseId,
        collectionId,
        ID.unique(),
        registrationData
      );

      // Post-hoc validation: re-count actual confirmed registrations to detect race conditions
      const actualConfirmedRegistrations = await this.databases.listDocuments(
        databaseId,
        collectionId,
        [
          Query.equal('eventId', eventId),
          Query.equal('status', RegistrationStatus.CONFIRMED),
        ]
      );

      const actualConfirmedCount =
        actualConfirmedRegistrations.documents.length;

      // If we exceeded capacity due to concurrent requests, demote this registration to waitlist
      if (
        status === RegistrationStatus.CONFIRMED &&
        actualConfirmedCount > capacity
      ) {
        this.logger.warn(
          `Race condition detected: ${actualConfirmedCount} confirmed registrations exceed capacity ${capacity} for event ${eventId}. Demoting registration ${document.$id} to waitlist.`
        );

        // Calculate new waitlist position
        const waitlistRegistrations = await this.databases.listDocuments(
          databaseId,
          collectionId,
          [
            Query.equal('eventId', eventId),
            Query.equal('status', RegistrationStatus.WAITLIST),
          ]
        );
        const newWaitlistPosition = waitlistRegistrations.documents.length + 1;

        // Atomically demote this registration to waitlist
        const updatedDocument = await this.databases.updateDocument(
          databaseId,
          collectionId,
          document.$id,
          {
            status: RegistrationStatus.WAITLIST,
            waitlistPosition: newWaitlistPosition,
          }
        );

        // Update event counts with retry logic
        await this.updateEventCountsWithRetry(eventId, {
          confirmedCount: capacity, // Set to exact capacity
          waitlistCount: newWaitlistPosition,
        });

        this.logger.log(
          `User ${userId} registered for event ${eventId} with status: ${RegistrationStatus.WAITLIST} (demoted from confirmed due to race condition)`
        );

        return this.mapAppwriteDocumentToRegistration(updatedDocument);
      }

      // Normal path: update event counts with retry logic
      if (status === RegistrationStatus.CONFIRMED) {
        await this.updateEventCountsWithRetry(eventId, {
          confirmedCount: confirmedCount + 1,
        });
      } else {
        const waitlistCount = event.waitlistCount || 0;
        await this.updateEventCountsWithRetry(eventId, {
          waitlistCount: waitlistCount + 1,
        });
      }

      this.logger.log(
        `User ${userId} registered for event ${eventId} with status: ${status}`
      );

      return this.mapAppwriteDocumentToRegistration(document);
    } catch (error) {
      this.logger.error('Failed to register for event', error);
      throw error;
    }
  }

  private async updateEventCountsWithRetry(
    eventId: string,
    counts: { confirmedCount?: number; waitlistCount?: number },
    maxRetries = 3
  ): Promise<void> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.eventService.updateEvent(eventId, counts);
        return; // Success
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `Failed to update event counts for ${eventId} (attempt ${attempt}/${maxRetries})`,
          error
        );

        if (attempt < maxRetries) {
          // Exponential backoff: 100ms, 200ms, 400ms
          await new Promise((resolve) =>
            setTimeout(resolve, 100 * Math.pow(2, attempt - 1))
          );
        }
      }
    }

    // If all retries failed, log critical error but don't throw to avoid leaving registration in inconsistent state
    this.logger.error(
      `CRITICAL: Failed to update event counts for ${eventId} after ${maxRetries} attempts. Event counts may be inconsistent.`,
      lastError
    );

    // Re-throw to signal the failure
    throw lastError;
  }

  async unregisterFromEvent(eventId: string, userId: string): Promise<void> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getRegistrationsCollectionId();

      const registration = await this.getUserRegistrationStatus(
        eventId,
        userId
      );
      if (!registration) {
        throw new NotFoundException('Registration not found');
      }

      await this.databases.deleteDocument(
        databaseId,
        collectionId,
        registration.id
      );

      const event = await this.eventService.getEventById(eventId);

      if (registration.status === RegistrationStatus.CONFIRMED) {
        const confirmedCount = Math.max(0, (event.confirmedCount || 0) - 1);
        await this.eventService.updateEvent(eventId, { confirmedCount });

        await this.promoteFromWaitlist(eventId);
      } else if (registration.status === RegistrationStatus.WAITLIST) {
        const waitlistCount = Math.max(0, (event.waitlistCount || 0) - 1);
        await this.eventService.updateEvent(eventId, { waitlistCount });

        // Only adjust waitlist positions if waitlistPosition is a valid number
        if (typeof registration.waitlistPosition === 'number') {
          await this.adjustWaitlistPositions(
            eventId,
            registration.waitlistPosition
          );
        }
      }

      this.logger.log(`User ${userId} unregistered from event ${eventId}`);
    } catch (error) {
      this.logger.error('Failed to unregister from event', error);
      throw error;
    }
  }

  private async promoteFromWaitlist(eventId: string): Promise<void> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getRegistrationsCollectionId();

      const waitlistUsers = await this.databases.listDocuments(
        databaseId,
        collectionId,
        [
          Query.equal('eventId', eventId),
          Query.equal('status', RegistrationStatus.WAITLIST),
          Query.orderAsc('waitlistPosition'),
          Query.limit(1),
        ]
      );

      if (waitlistUsers.documents.length === 0) {
        return; // No one on waitlist
      }

      const firstWaitlistUser = waitlistUsers.documents[0];

      await this.databases.updateDocument(
        databaseId,
        collectionId,
        firstWaitlistUser.$id,
        {
          status: RegistrationStatus.CONFIRMED,
          waitlistPosition: null,
        }
      );

      const event = await this.eventService.getEventById(eventId);
      const confirmedCount = (event.confirmedCount || 0) + 1;
      const waitlistCount = Math.max(0, (event.waitlistCount || 0) - 1);

      await this.eventService.updateEvent(eventId, {
        confirmedCount,
        waitlistCount,
      });

      await this.adjustWaitlistPositions(eventId, 1);

      this.logger.log(
        `Promoted user ${firstWaitlistUser.userId} from waitlist to confirmed for event ${eventId}`
      );
    } catch (error) {
      this.logger.error('Failed to promote from waitlist', error);
      throw error;
    }
  }

  private async adjustWaitlistPositions(
    eventId: string,
    removedPosition: number
  ): Promise<void> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getRegistrationsCollectionId();

      const waitlistUsers = await this.databases.listDocuments(
        databaseId,
        collectionId,
        [
          Query.equal('eventId', eventId),
          Query.equal('status', RegistrationStatus.WAITLIST),
          Query.greaterThan('waitlistPosition', removedPosition),
          Query.limit(5000),
        ]
      );

      for (const user of waitlistUsers.documents) {
        await this.databases.updateDocument(
          databaseId,
          collectionId,
          user.$id,
          {
            waitlistPosition: user.waitlistPosition - 1,
          }
        );
      }

      this.logger.log(
        `Adjusted ${waitlistUsers.documents.length} waitlist positions for event ${eventId}`
      );
    } catch (error) {
      this.logger.error('Failed to adjust waitlist positions', error);
      throw error;
    }
  }

  async getEventRegistrations(eventId: string): Promise<Registration[]> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getRegistrationsCollectionId();

      const response = await this.databases.listDocuments(
        databaseId,
        collectionId,
        [
          Query.equal('eventId', eventId),
          Query.orderDesc('$createdAt'),
          Query.limit(5000),
        ]
      );

      return response.documents.map((doc) =>
        this.mapAppwriteDocumentToRegistration(doc)
      );
    } catch (error) {
      this.logger.error(
        `Failed to get registrations for event ${eventId}`,
        error
      );
      throw error;
    }
  }

  async getConfirmedRegistrations(eventId: string): Promise<Registration[]> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getRegistrationsCollectionId();

      const response = await this.databases.listDocuments(
        databaseId,
        collectionId,
        [
          Query.equal('eventId', eventId),
          Query.equal('status', RegistrationStatus.CONFIRMED),
          Query.orderDesc('$createdAt'),
          Query.limit(5000),
        ]
      );

      return response.documents.map((doc) =>
        this.mapAppwriteDocumentToRegistration(doc)
      );
    } catch (error) {
      this.logger.error(
        `Failed to get confirmed registrations for event ${eventId}`,
        error
      );
      throw error;
    }
  }

  async getWaitlistRegistrations(eventId: string): Promise<Registration[]> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getRegistrationsCollectionId();

      const response = await this.databases.listDocuments(
        databaseId,
        collectionId,
        [
          Query.equal('eventId', eventId),
          Query.equal('status', RegistrationStatus.WAITLIST),
          Query.orderAsc('waitlistPosition'),
          Query.limit(5000),
        ]
      );

      return response.documents.map((doc) =>
        this.mapAppwriteDocumentToRegistration(doc)
      );
    } catch (error) {
      this.logger.error(
        `Failed to get waitlist registrations for event ${eventId}`,
        error
      );
      throw error;
    }
  }

  async getUserRegistrations(userId: string): Promise<Registration[]> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getRegistrationsCollectionId();

      const response = await this.databases.listDocuments(
        databaseId,
        collectionId,
        [
          Query.equal('userId', userId),
          Query.orderDesc('$createdAt'),
          Query.limit(5000),
        ]
      );

      return response.documents.map((doc) =>
        this.mapAppwriteDocumentToRegistration(doc)
      );
    } catch (error) {
      this.logger.error(
        `Failed to get registrations for user ${userId}`,
        error
      );
      throw error;
    }
  }

  async getUserRegistrationStatus(
    eventId: string,
    userId: string
  ): Promise<Registration | null> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getRegistrationsCollectionId();

      const response = await this.databases.listDocuments(
        databaseId,
        collectionId,
        [
          Query.equal('eventId', eventId),
          Query.equal('userId', userId),
          Query.limit(1),
        ]
      );

      if (response.documents.length === 0) {
        return null;
      }

      return this.mapAppwriteDocumentToRegistration(response.documents[0]);
    } catch (error) {
      this.logger.error(
        `Failed to get registration status for user ${userId} and event ${eventId}`,
        error
      );
      throw error;
    }
  }

  async getRegistrationCounts(eventId: string): Promise<RegistrationCountsDto> {
    try {
      const event = await this.eventService.getEventById(eventId);
      const confirmedCount = event.confirmedCount || 0;
      const waitlistCount = event.waitlistCount || 0;
      const availableSpots = Math.max(0, event.capacity - confirmedCount);

      return {
        confirmedCount,
        waitlistCount,
        availableSpots,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get registration counts for event ${eventId}`,
        error
      );
      throw error;
    }
  }

  private mapAppwriteDocumentToRegistration(doc: any): Registration {
    return {
      id: doc.$id,
      eventId: doc.eventId,
      userId: doc.userId,
      userName: doc.userName,
      status: doc.status,
      waitlistPosition: doc.waitlistPosition,
      registeredAt: doc.$createdAt ? new Date(doc.$createdAt) : new Date(),
    };
  }
}
