import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsDateString, IsNumber } from 'class-validator';

export class CreateEventDto {
  @ApiProperty({ description: 'Conference name' })
  @IsString()
  @IsNotEmpty()
  conference: string;

  @ApiProperty({ description: 'Event type' })
  @IsString()
  @IsNotEmpty()
  eventType: string;

  @ApiProperty({ description: 'Event date' })
  @IsDateString()
  @IsNotEmpty()
  date: string;

  @ApiProperty({ description: 'Event location' })
  @IsString()
  @IsNotEmpty()
  location: string;

  @ApiProperty({ description: 'Event name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Sport name' })
  @IsString()
  @IsNotEmpty()
  sport: string;

  @ApiProperty({ description: 'Event description' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ description: 'Event time' })
  @IsString()
  @IsNotEmpty()
  time: string;

  @ApiProperty({ description: 'Event capacity' })
  @IsNumber()
  @IsNotEmpty()
  capacity: number;

  @ApiProperty({ description: 'Name of the user who created the event' })
  @IsString()
  @IsNotEmpty()
  createdBy: string;

  @ApiProperty({ description: 'User ID of the user who created the event' })
  @IsString()
  @IsNotEmpty()
  createdByUserId: string;
}

export class UpdateEventDto {
  @ApiProperty({ description: 'Conference name', required: false })
  @IsString()
  conference?: string;

  @ApiProperty({ description: 'Event type', required: false })
  @IsString()
  eventType?: string;

  @ApiProperty({ description: 'Event date', required: false })
  @IsDateString()
  date?: string;

  @ApiProperty({ description: 'Event location', required: false })
  @IsString()
  location?: string;

  @ApiProperty({ description: 'Event name', required: false })
  @IsString()
  name?: string;

  @ApiProperty({ description: 'Sport name', required: false })
  @IsString()
  sport?: string;

  @ApiProperty({ description: 'Event description', required: false })
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Event time', required: false })
  @IsString()
  time?: string;

  @ApiProperty({ description: 'Event capacity', required: false })
  @IsNumber()
  capacity?: number;

  @ApiProperty({
    description: 'Name of the user who created the event',
    required: false,
  })
  @IsString()
  createdBy?: string;

  @ApiProperty({
    description: 'Confirmed registrations count',
    required: false,
  })
  @IsNumber()
  confirmedCount?: number;

  @ApiProperty({ description: 'Waitlist registrations count', required: false })
  @IsNumber()
  waitlistCount?: number;
}

export class EventResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  conference: string;

  @ApiProperty()
  eventType: string;

  @ApiProperty()
  date: string;

  @ApiProperty()
  location: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  sport: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  time: string;

  @ApiProperty()
  capacity: number;

  @ApiProperty()
  createdBy: string;

  @ApiProperty()
  createdByUserId: string;

  @ApiProperty({ required: false })
  confirmedCount?: number;

  @ApiProperty({ required: false })
  waitlistCount?: number;

  @ApiProperty()
  createdAt?: Date;

  @ApiProperty()
  updatedAt?: Date;
}

export class Event {
  id: string;
  conference: string;
  eventType: string;
  date: string;
  location: string;
  name: string;
  sport: string;
  description: string;
  time: string;
  capacity: number;
  createdBy: string;
  createdByUserId: string;
  confirmedCount?: number;
  waitlistCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
}
