import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import {
  CreateRegistrationDto,
  RegistrationResponseDto,
  RegistrationCountsDto,
} from '../dto/registration.dto';
import { RegistrationService } from '../services/registration.service';

@ApiTags('registrations')
@Controller('registrations')
export class RegistrationController {
  private readonly logger = new Logger(RegistrationController.name);

  constructor(private readonly registrationService: RegistrationService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register for an event' })
  @ApiResponse({
    status: 201,
    description: 'Successfully registered for event',
    type: RegistrationResponseDto,
  })
  @ApiResponse({ status: 409, description: 'Already registered' })
  async registerForEvent(
    @Body() createRegistrationDto: CreateRegistrationDto
  ): Promise<RegistrationResponseDto> {
    try {
      return await this.registrationService.registerForEvent(
        createRegistrationDto
      );
    } catch (error) {
      this.logger.error('Failed to register for event', error);
      throw new InternalServerErrorException('Failed to register for event');
    }
  }

  @Delete(':eventId/user/:userId')
  @ApiOperation({ summary: 'Unregister from an event' })
  @ApiParam({ name: 'eventId', description: 'Event ID' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'Successfully unregistered from event',
  })
  @ApiResponse({ status: 404, description: 'Registration not found' })
  async unregisterFromEvent(
    @Param('eventId') eventId: string,
    @Param('userId') userId: string
  ): Promise<{ message: string }> {
    try {
      await this.registrationService.unregisterFromEvent(eventId, userId);
      return { message: 'Successfully unregistered from event' };
    } catch (error) {
      this.logger.error('Failed to unregister from event', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to unregister from event');
    }
  }

  @Get('event/:eventId')
  @ApiOperation({ summary: 'Get all registrations for an event' })
  @ApiParam({ name: 'eventId', description: 'Event ID' })
  @ApiResponse({
    status: 200,
    description: 'List of all registrations',
    type: [RegistrationResponseDto],
  })
  async getEventRegistrations(
    @Param('eventId') eventId: string
  ): Promise<RegistrationResponseDto[]> {
    try {
      return await this.registrationService.getEventRegistrations(eventId);
    } catch (error) {
      this.logger.error(
        `Failed to get registrations for event ${eventId}`,
        error
      );
      throw new InternalServerErrorException('Failed to get registrations');
    }
  }

  @Get('event/:eventId/confirmed')
  @ApiOperation({ summary: 'Get confirmed registrations for an event' })
  @ApiParam({ name: 'eventId', description: 'Event ID' })
  @ApiResponse({
    status: 200,
    description: 'List of confirmed registrations',
    type: [RegistrationResponseDto],
  })
  async getConfirmedRegistrations(
    @Param('eventId') eventId: string
  ): Promise<RegistrationResponseDto[]> {
    try {
      return await this.registrationService.getConfirmedRegistrations(eventId);
    } catch (error) {
      this.logger.error(
        `Failed to get confirmed registrations for event ${eventId}`,
        error
      );
      throw new InternalServerErrorException(
        'Failed to get confirmed registrations'
      );
    }
  }

  @Get('event/:eventId/waitlist')
  @ApiOperation({ summary: 'Get waitlist registrations for an event' })
  @ApiParam({ name: 'eventId', description: 'Event ID' })
  @ApiResponse({
    status: 200,
    description: 'List of waitlist registrations',
    type: [RegistrationResponseDto],
  })
  async getWaitlistRegistrations(
    @Param('eventId') eventId: string
  ): Promise<RegistrationResponseDto[]> {
    try {
      return await this.registrationService.getWaitlistRegistrations(eventId);
    } catch (error) {
      this.logger.error(
        `Failed to get waitlist registrations for event ${eventId}`,
        error
      );
      throw new InternalServerErrorException(
        'Failed to get waitlist registrations'
      );
    }
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get all registrations for a user' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'List of user registrations',
    type: [RegistrationResponseDto],
  })
  async getUserRegistrations(
    @Param('userId') userId: string
  ): Promise<RegistrationResponseDto[]> {
    try {
      return await this.registrationService.getUserRegistrations(userId);
    } catch (error) {
      this.logger.error(
        `Failed to get registrations for user ${userId}`,
        error
      );
      throw new InternalServerErrorException(
        'Failed to get user registrations'
      );
    }
  }

  @Get('status/:eventId/user/:userId')
  @ApiOperation({ summary: 'Get user registration status for an event' })
  @ApiParam({ name: 'eventId', description: 'Event ID' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'User registration status',
    type: RegistrationResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Not registered' })
  async getUserRegistrationStatus(
    @Param('eventId') eventId: string,
    @Param('userId') userId: string
  ): Promise<RegistrationResponseDto | null> {
    try {
      return await this.registrationService.getUserRegistrationStatus(
        eventId,
        userId
      );
    } catch (error) {
      this.logger.error(
        `Failed to get registration status for user ${userId} and event ${eventId}`,
        error
      );
      throw new InternalServerErrorException(
        'Failed to get registration status'
      );
    }
  }

  @Get('counts/:eventId')
  @ApiOperation({ summary: 'Get registration counts for an event' })
  @ApiParam({ name: 'eventId', description: 'Event ID' })
  @ApiResponse({
    status: 200,
    description: 'Registration counts',
    type: RegistrationCountsDto,
  })
  async getRegistrationCounts(
    @Param('eventId') eventId: string
  ): Promise<RegistrationCountsDto> {
    try {
      return await this.registrationService.getRegistrationCounts(eventId);
    } catch (error) {
      this.logger.error(
        `Failed to get registration counts for event ${eventId}`,
        error
      );
      throw new InternalServerErrorException(
        'Failed to get registration counts'
      );
    }
  }
}
