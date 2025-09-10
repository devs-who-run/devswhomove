import {
  Controller,
  Post,
  Body,
  Logger,
  Get,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CreateEventDto, EventResponseDto, Event } from '../dto/events.dto';
import { mockEvents } from '../mock/events.mock';
import { randomUUID } from 'crypto';

@ApiTags('events')
@Controller('events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);
  private events: Event[] = [...mockEvents];

  @Get('all')
  @ApiOperation({ summary: 'Get all events' })
  @ApiResponse({
    status: 200,
    description: 'List of all events',
    type: [EventResponseDto],
  })
  async getAllEvents(): Promise<Event[]> {
    return this.events;
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
    const event = this.events.find((e) => e.id === id);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return event;
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
    const id = randomUUID();
    const now = new Date();

    const newEvent: Event = {
      id,
      conference: createEventDto.conference,
      eventType: createEventDto.eventType,
      date: createEventDto.date,
      location: createEventDto.location,
      name: createEventDto.name,
      sport: createEventDto.sport,
      description: createEventDto.description,
      time: createEventDto.time,
      capacity: createEventDto.capacity,
      createdAt: now,
      updatedAt: now,
    };

    // currently stores events in memory
    this.events.push(newEvent);

    return newEvent;
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
    const events = this.events.filter((e) =>
      e.conference.toLowerCase().includes(conference.toLowerCase())
    );

    return events;
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
    const events = this.events.filter(
      (e) => e.eventType.toLowerCase() === eventType.toLowerCase()
    );

    return events;
  }
}
