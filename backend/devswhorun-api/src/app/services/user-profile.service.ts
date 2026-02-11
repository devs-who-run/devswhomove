import { Injectable, Logger } from '@nestjs/common';
import { Databases, ID, Models, Query } from 'node-appwrite';
import { AppwriteService } from './appwrite.service';
import {
  CreateUserProfileDto,
  UpdateUserProfileDto,
  UserProfileDocument,
} from '../dto/user-profile.dto';

interface UserProfileAppwriteDocument extends Models.Document {
  authUserId: string;
  name: string;
  email: string;
  country?: string;
  city?: string;
}

@Injectable()
export class UserProfileService {
  private readonly logger = new Logger(UserProfileService.name);
  private databases: Databases;

  constructor(private readonly appwriteService: AppwriteService) {
    this.databases = this.appwriteService.getDatabases();
  }

  async createProfile(dto: CreateUserProfileDto): Promise<UserProfileDocument> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getUsersCollectionId();

      const document =
        await this.databases.createDocument<UserProfileAppwriteDocument>(
          databaseId,
          collectionId,
          ID.unique(),
          {
            authUserId: dto.authUserId,
            name: dto.name,
            email: dto.email,
            country: dto.country || '',
            city: dto.city || '',
          }
        );

      this.logger.log(`User profile created for authUserId: ${dto.authUserId}`);
      return this.mapDocument(document);
    } catch (error) {
      this.logger.error('Failed to create user profile', error);
      throw error;
    }
  }

  async getProfileByAuthUserId(
    authUserId: string
  ): Promise<UserProfileDocument | null> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getUsersCollectionId();

      const response =
        await this.databases.listDocuments<UserProfileAppwriteDocument>(
          databaseId,
          collectionId,
          [Query.equal('authUserId', authUserId), Query.limit(1)]
        );

      if (response.documents.length === 0) {
        return null;
      }

      return this.mapDocument(response.documents[0]);
    } catch (error) {
      this.logger.error(
        `Failed to get profile for authUserId: ${authUserId}`,
        error
      );
      throw error;
    }
  }

  async updateProfile(
    authUserId: string,
    dto: UpdateUserProfileDto
  ): Promise<UserProfileDocument> {
    try {
      const databaseId = this.appwriteService.getDatabaseId();
      const collectionId = this.appwriteService.getUsersCollectionId();

      const existing = await this.getProfileByAuthUserId(authUserId);
      if (!existing) {
        throw new Error(`Profile not found for authUserId: ${authUserId}`);
      }

      const updateData: Record<string, string> = {};
      if (dto.name !== undefined) updateData['name'] = dto.name;
      if (dto.country !== undefined) updateData['country'] = dto.country;
      if (dto.city !== undefined) updateData['city'] = dto.city;

      const document =
        await this.databases.updateDocument<UserProfileAppwriteDocument>(
          databaseId,
          collectionId,
          existing.id,
          updateData
        );

      this.logger.log(`User profile updated for authUserId: ${authUserId}`);
      return this.mapDocument(document);
    } catch (error) {
      this.logger.error(
        `Failed to update profile for authUserId: ${authUserId}`,
        error
      );
      throw error;
    }
  }

  async findOrCreateProfile(
    authUserId: string,
    name: string,
    email: string
  ): Promise<UserProfileDocument> {
    const existing = await this.getProfileByAuthUserId(authUserId);
    if (existing) {
      return existing;
    }

    return this.createProfile({ authUserId, name, email });
  }

  private mapDocument(doc: UserProfileAppwriteDocument): UserProfileDocument {
    return {
      id: doc.$id,
      authUserId: doc.authUserId,
      name: doc.name,
      email: doc.email,
      country: doc.country || '',
      city: doc.city || '',
      createdAt: doc.$createdAt ? new Date(doc.$createdAt) : undefined,
      updatedAt: doc.$updatedAt ? new Date(doc.$updatedAt) : undefined,
    };
  }
}
