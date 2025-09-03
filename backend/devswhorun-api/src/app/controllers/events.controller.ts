import { Controller, Post, Body, Logger, Get } from '@nestjs/common';
import { EventsDto, Event } from '../dto/events.dto';
import { randomUUID } from 'crypto';

@Controller('events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  @Post('add')
  async createEvent(@Body() events: EventsDto): Promise<Event> {
    const id = randomUUID();
    const event: Event = { ...events, id };

    return event;
  }

  @Get('all')
  async getAllEvents(): Promise<Event[]> {
    return [
      {
        id: randomUUID(),
        conferenceName: 'Tech Conference 2023',
        location: 'New York',
        startDate: new Date('2023-09-01'),
        endDate: new Date('2023-09-03'),
      },
      {
        id: randomUUID(),
        conferenceName: 'Health Summit 2023',
        location: 'San Francisco',
        startDate: new Date('2023-10-15'),
        endDate: new Date('2023-10-17'),
      },
    ];
  }
}
