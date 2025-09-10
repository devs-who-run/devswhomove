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
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
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
  createdAt: Date;
  updatedAt: Date;
}
