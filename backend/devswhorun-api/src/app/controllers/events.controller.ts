import {
  Controller,
  Post,
  Body,
  Logger,
  Get,
  Param,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CreateEventDto, EventResponseDto, Event } from '../dto/events.dto';
import { EventService } from '../services/event.service';

@ApiTags('events')
@Controller('events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(private readonly eventService: EventService) {}

  @Get('all')
  @ApiOperation({ summary: 'Get all events' })
  @ApiResponse({
    status: 200,
    description: 'List of all events',
    type: [EventResponseDto],
  })
  async getAllEvents(): Promise<Event[]> {
    try {
      return await this.eventService.getEvents();
    } catch (error) {
      this.logger.error('Failed to get all events', error);
      throw new InternalServerErrorException('Failed to retrieve events');
    }
  }

  @Post('add')
  @ApiOperation({ summary: 'Create a new event' })
  @ApiResponse({
    status: 201,
    description: 'Event created successfully',
    type: EventResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async createEvent(@Body() createEventDto: CreateEventDto): Promise<Event> {
    try {
      return await this.eventService.createEvent(createEventDto);
    } catch (error) {
      this.logger.error('Failed to create event', error);
      throw new InternalServerErrorException('Failed to create event');
    }
  }

  @Get('conference/:conference')
  @ApiOperation({ summary: 'Get events by conference name' })
  @ApiParam({ name: 'conference', description: 'Conference name' })
  @ApiResponse({
    status: 200,
    description: 'Events for the specified conference',
    type: [EventResponseDto],
  })
  async getEventsByConference(
    @Param('conference') conference: string
  ): Promise<Event[]> {
    try {
      return await this.eventService.getEventsByConference(conference);
    } catch (error) {
      this.logger.error(
        `Failed to get events by conference: ${conference}`,
        error
      );
      throw new InternalServerErrorException('Failed to retrieve events');
    }
  }

  @Get('type/:eventType')
  @ApiOperation({ summary: 'Get events by event type' })
  @ApiParam({
    name: 'eventType',
    description: 'Event type (Workshop, Conference, Meetup)',
  })
  @ApiResponse({
    status: 200,
    description: 'Events of the specified type',
    type: [EventResponseDto],
  })
  async getEventsByType(
    @Param('eventType') eventType: string
  ): Promise<Event[]> {
    try {
      return await this.eventService.getEventsByType(eventType);
    } catch (error) {
      this.logger.error(`Failed to get events by type: ${eventType}`, error);
      throw new InternalServerErrorException('Failed to retrieve events');
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get event by ID' })
  @ApiParam({ name: 'id', description: 'Event ID' })
  @ApiResponse({
    status: 200,
    description: 'Event found',
    type: EventResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async getEventById(@Param('id') id: string): Promise<Event> {
    try {
      return await this.eventService.getEventById(id);
    } catch (error) {
      this.logger.error(`Failed to get event with ID: ${id}`, error);
      if (error?.code === 404 || error?.type === 'document_not_found') {
        throw new NotFoundException('Event not found');
      }
      throw new InternalServerErrorException('Failed to retrieve event');
    }
  }
}
