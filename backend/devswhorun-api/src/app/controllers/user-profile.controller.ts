import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import {
  UpdateUserProfileDto,
  UserProfileResponseDto,
} from '../dto/user-profile.dto';
import { UserProfileService } from '../services/user-profile.service';

@ApiTags('user-profile')
@Controller('user-profile')
export class UserProfileController {
  private readonly logger = new Logger(UserProfileController.name);

  constructor(private readonly userProfileService: UserProfileService) {}

  @Get(':authUserId')
  @ApiOperation({ summary: 'Get user profile by auth user ID' })
  @ApiParam({ name: 'authUserId', description: 'Appwrite Auth user ID' })
  @ApiResponse({
    status: 200,
    description: 'User profile found',
    type: UserProfileResponseDto,
  })
  @ApiResponse({ status: 404, description: 'User profile not found' })
  async getProfile(@Param('authUserId') authUserId: string) {
    try {
      const profile = await this.userProfileService.getProfileByAuthUserId(
        authUserId
      );
      if (!profile) {
        throw new NotFoundException('User profile not found');
      }
      return profile;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to get profile for authUserId: ${authUserId}`,
        error
      );
      throw new InternalServerErrorException('Failed to retrieve user profile');
    }
  }

  @Put(':authUserId')
  @ApiOperation({ summary: 'Update user profile' })
  @ApiParam({ name: 'authUserId', description: 'Appwrite Auth user ID' })
  @ApiResponse({
    status: 200,
    description: 'User profile updated',
    type: UserProfileResponseDto,
  })
  @ApiResponse({ status: 404, description: 'User profile not found' })
  async updateProfile(
    @Param('authUserId') authUserId: string,
    @Body() updateDto: UpdateUserProfileDto
  ) {
    try {
      return await this.userProfileService.updateProfile(authUserId, updateDto);
    } catch (error) {
      if (error?.message?.includes('not found')) {
        throw new NotFoundException('User profile not found');
      }
      this.logger.error(
        `Failed to update profile for authUserId: ${authUserId}`,
        error
      );
      throw new InternalServerErrorException('Failed to update user profile');
    }
  }
}
